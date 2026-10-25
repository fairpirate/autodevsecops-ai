import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { ZodError } from "zod";
import type { ApiError } from "@ads/shared-types";
import { authMiddleware } from "./auth";
import { buildRouter, type AppDeps } from "./routes";

export interface BuildAppOptions extends AppDeps {
  /** Skip auth for tests that exercise public endpoints only. */
  disableAuth?: boolean;
}

export function buildApp(opts: BuildAppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors());

  // Keep the raw body for webhook signature verification.
  app.use(
    express.json({
      limit: "2mb",
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      if (req.path !== "/api/v1/health") {
        console.log(`[api] ${req.method} ${req.path} -> ${res.statusCode} (${ms}ms)`);
      }
    });
    next();
  });

  const router = buildRouter(opts);

  // Public: health + webhooks (webhooks carry their own signature check).
  app.use("/api/v1", (req, res, next) => {
    const isPublic = req.path === "/health" || req.path.startsWith("/webhooks/");
    if (opts.disableAuth || isPublic) return next();
    // SSE (EventSource) cannot set headers — allow token query param.
    if (req.query.token && typeof req.query.token === "string") {
      req.headers.authorization = `Bearer ${req.query.token}`;
    }
    authMiddleware(opts.config)(req, res, next);
  });

  app.use("/api/v1", router);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      const body: ApiError = { error: { code: "validation_error", message: "Invalid request", details: err.flatten() } };
      res.status(400).json(body);
      return;
    }
    console.error("[api] unhandled error:", err);
    const body: ApiError = { error: { code: "internal_error", message: "Internal server error" } };
    res.status(500).json(body);
  });

  return app;
}
