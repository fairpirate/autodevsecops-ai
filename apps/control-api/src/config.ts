import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CONTROL_API_PORT: z.coerce.number().default(4000),
  PUBLIC_BASE_URL: z.string().default("http://localhost:4000"),
  API_KEYS: z.string().default("dev-admin-key-change-me:admin"),
  CREDENTIAL_KEY_BASE64: z
    .string()
    .default("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  QUEUE_DRIVER: z.enum(["memory", "bullmq"]).default("memory"),
  EVENT_DRIVER: z.enum(["memory", "redis"]).default("memory"),
  STORE: z.enum(["memory", "prisma"]).default("memory"),
  GITLAB_BASE_URL: z.string().default("https://gitlab.com"),
  GITLAB_INTEGRATION_TOKEN: z.string().default(""),
  GITLAB_WEBHOOK_SECRET: z.string().default("change-me-webhook-secret"),
  GITLAB_FLOW_CALLBACK_HOOK_ID: z.string().default(""),
  DUO_FLOW_DEFINITION: z.string().default(""),
  DUO_FLOWS_ENABLED: z.enum(["true", "false"]).default("false"),
  AI_PROVIDER: z.enum(["deterministic", "nebius"]).default("deterministic"),
  NEBIUS_API_KEY: z.string().default(""),
  NEBIUS_BASE_URL: z.string().url().default("https://api.tokenfactory.us-central1.nebius.com/v1"),
  NEBIUS_MODEL: z.string().default("nvidia/nemotron-3-super-120b-a12b"),
  AI_FALLBACK_MODE: z.enum(["strict", "permissive"]).default("strict"),
  EXEC_WORK_DIR: z.string().default("./.exec-workspace"),
  EXEC_JOB_TIMEOUT_MS: z.coerce.number().default(600_000),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof envSchema> & {
  duoFlowsEnabled: boolean;
  /** Parsed API keys: [{ key, role }] */
  apiKeys: Array<{ key: string; role: "admin" | "engineer" | "viewer" }>;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  if (parsed.AI_PROVIDER === "nebius" && !parsed.NEBIUS_API_KEY.trim()) {
    throw new Error("AI_PROVIDER=nebius requires NEBIUS_API_KEY in the server environment");
  }
  if (parsed.AI_PROVIDER === "nebius" && parsed.QUEUE_DRIVER !== "memory") {
    throw new Error("Nebius currently requires QUEUE_DRIVER=memory (embedded orchestrator)");
  }
  const apiKeys = parsed.API_KEYS.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [key, role] = entry.split(":");
      const r = role === "admin" || role === "viewer" ? role : "engineer";
      return { key, role: r as "admin" | "engineer" | "viewer" };
    });
  return {
    ...parsed,
    duoFlowsEnabled: parsed.DUO_FLOWS_ENABLED === "true",
    apiKeys,
  };
}
