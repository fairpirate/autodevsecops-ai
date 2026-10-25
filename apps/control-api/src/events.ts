import { EventEmitter } from "node:events";
import type { Response } from "express";
import type { RunEvent } from "@ads/shared-types";
import type { Store } from "./store/types";

/**
 * Run event bus backing the SSE endpoint (`GET /api/v1/runs/:id/events`).
 * Every event is persisted first (for replay), then fanned out to live
 * subscribers. When EVENT_DRIVER=redis, an optional Redis subscriber can push
 * events emitted by other processes (orchestrator worker).
 */
export class RunEventBus {
  private emitter = new EventEmitter();
  private clients = new Map<string, Set<Response>>();

  constructor(private readonly store: Store) {
    this.emitter.setMaxListeners(1000);
  }

  /** Persist + broadcast. Used as the orchestrator's RunEventSink. */
  async publish(runId: string, type: string, payload: Record<string, unknown>): Promise<RunEvent> {
    const evt = await this.store.events.append(runId, type, payload);
    this.broadcast(runId, evt);
    return evt;
  }

  /** Synchronous sink adapter for the orchestrator (fire-and-forget persist). */
  sink(): { emit: (runId: string, type: string, payload: Record<string, unknown>) => void } {
    return {
      emit: (runId, type, payload) => {
        void this.publish(runId, type, payload).catch((err) =>
          console.error("[events] publish failed:", err instanceof Error ? err.message : err),
        );
      },
    };
  }

  broadcast(runId: string, evt: RunEvent): void {
    const set = this.clients.get(runId);
    if (!set) return;
    const data = `id: ${evt.id}\nevent: run-event\ndata: ${JSON.stringify(evt)}\n\n`;
    for (const res of set) {
      try {
        res.write(data);
      } catch {
        set.delete(res);
      }
    }
  }

  /** Attach an SSE client: replay history since `sinceId`, then stream live. */
  async subscribe(runId: string, res: Response, sinceId = 0): Promise<() => void> {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const history = await this.store.events.listByRun(runId, sinceId);
    for (const evt of history) {
      res.write(`id: ${evt.id}\nevent: run-event\ndata: ${JSON.stringify(evt)}\n\n`);
    }

    let set = this.clients.get(runId);
    if (!set) {
      set = new Set();
      this.clients.set(runId, set);
    }
    set.add(res);

    const keepAlive = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        /* client gone; cleanup handles removal */
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(keepAlive);
      set?.delete(res);
      if (set && set.size === 0) this.clients.delete(runId);
      try {
        res.end();
      } catch {
        /* already closed */
      }
    };
    res.on("close", cleanup);
    return cleanup;
  }
}
