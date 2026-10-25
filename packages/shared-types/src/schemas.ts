import { z } from "zod";
import { ENVIRONMENTS } from "./ops";

/* ------------------------------------------------------------------ *
 * Validation schemas for API DTOs
 * ------------------------------------------------------------------ */

export const connectProjectSchema = z
  .object({
    gitlabBaseUrl: z.string().url().default("https://gitlab.com"),
    /** PAT / project access token — encrypted at rest, never sent to AI agents. */
    token: z.string().min(8).max(200),
    gitlabProjectId: z.number().int().positive().optional(),
    pathWithNamespace: z.string().min(1).max(300).optional(),
    name: z.string().min(1).max(120).optional(),
  })
  .refine((v) => v.gitlabProjectId !== undefined || v.pathWithNamespace !== undefined, {
    message: "Provide either gitlabProjectId or pathWithNamespace",
  });
export type ConnectProjectInput = z.infer<typeof connectProjectSchema>;

export const budgetSchema = z.object({
  maxIterations: z.number().int().min(1).max(20),
  maxRuntimeMs: z.number().int().min(10_000),
  maxTokenBudget: z.number().int().min(0),
  maxPatchSizeLines: z.number().int().min(10),
  maxConcurrentRepairs: z.number().int().min(1).max(10),
  maxRepeatedFailures: z.number().int().min(1).max(10),
  minVerificationConfidence: z.number().min(0).max(1),
});

export const createRunSchema = z.object({
  projectId: z.string().min(1),
  ref: z.string().min(1).default("main"),
  commitSha: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/)
    .optional(),
  mrIid: z.number().int().positive().optional(),
  budget: budgetSchema.partial().optional(),
});
export type CreateRunInput = z.infer<typeof createRunSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export const createDeploymentSchema = z.object({
  releaseId: z.string().min(1),
  environment: z.enum(ENVIRONMENTS),
});

export const approveDeploymentSchema = z.object({
  actor: z.string().min(1).max(120),
  decision: z.enum(["approve", "reject"]),
});

export const rollbackSchema = z.object({
  actor: z.string().min(1).max(120),
  reason: z.string().min(3).max(500),
});

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
}
