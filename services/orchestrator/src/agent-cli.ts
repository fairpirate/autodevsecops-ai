import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { redactSecrets } from "@ads/execution-worker";
import { createNebiusRepairProvider, NebiusRepairError } from "./nebius";
import { executeAgent, type AgentName } from "./agent-runtime";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;

/** Redact values recursively before serialization so escaped source strings are handled. */
export function redactAgentOutput(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactAgentOutput);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactSecrets(key), redactAgentOutput(item)]));
  }
  return value;
}

async function readInput(args: string[]): Promise<string> {
  if (args.length === 2 && args[0] === "--input") {
    if ((await stat(args[1])).size > MAX_INPUT_BYTES) throw new Error("input_too_large");
    const text = await readFile(args[1], "utf8");
    if (Buffer.byteLength(text) > MAX_INPUT_BYTES) throw new Error("input_too_large");
    return text;
  }
  if (args.length !== 0 || process.stdin.isTTY) throw new Error("invalid_arguments");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > MAX_INPUT_BYTES) throw new Error("input_too_large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** CLI host only: requests are JSON data, never shell commands or workflow authority. */
export async function runAgentCli(name: AgentName): Promise<void> {
  try {
    const text = await readInput(process.argv.slice(2));
    const input: unknown = JSON.parse(text);
    const wantsNebius = name === "repair" && input !== null && typeof input === "object"
      && "provider" in input && input.provider === "nebius";
    const aiRepair = wantsNebius ? createNebiusRepairProvider({
      apiKey: process.env.NEBIUS_API_KEY ?? "", model: process.env.NEBIUS_MODEL,
      baseUrl: process.env.NEBIUS_BASE_URL,
    }) : undefined;
    const result = await executeAgent(name, input, { aiRepair });
    process.stdout.write(JSON.stringify(redactAgentOutput(result), null, 2) + "\n");
  } catch (error) {
    const code = error instanceof z.ZodError || error instanceof SyntaxError ? "invalid_input" : "agent_failed";
    const message = error instanceof NebiusRepairError ? error.message
      : "Check the agent JSON schema, --input file (maximum 2 MiB), and provider configuration. See agents/README.md.";
    process.stderr.write(JSON.stringify({ agent: name, error: { code, message } }) + "\n");
    process.exitCode = 1;
  }
}
