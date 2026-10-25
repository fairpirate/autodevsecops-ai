import { createHash, randomUUID } from "node:crypto";
import type {
  ArtifactRecord,
  EnvironmentName,
  ReleaseRecord,
} from "@ads/shared-types";

/**
 * Immutable artifact + provenance service.
 *
 * A release candidate is built ONCE; its digest is promoted across
 * environments. If the source changes after validation, a new artifact
 * (new digest) must be built and re-validated before promotion.
 */
export interface BuildArtifactInput {
  runId: string;
  sourceCommitSha: string;
  pipelineId?: string;
  buildJobId?: string;
  kind: ArtifactRecord["kind"];
  metadata?: Record<string, string>;
  /** Raw bytes used to derive the content digest (tarball, bundle, manifest JSON). */
  content: Buffer | string;
}

export function computeDigest(content: Buffer | string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function createArtifact(input: BuildArtifactInput): ArtifactRecord {
  return {
    id: randomUUID(),
    runId: input.runId,
    sourceCommitSha: input.sourceCommitSha,
    pipelineId: input.pipelineId,
    buildJobId: input.buildJobId,
    digest: computeDigest(input.content),
    kind: input.kind,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
  };
}

export interface CreateReleaseInput {
  artifact: ArtifactRecord;
  testEvidence: string[];
  securityScanStatus: ReleaseRecord["securityScanStatus"];
  qualityGateDecision: string;
}

export function createRelease(input: CreateReleaseInput): ReleaseRecord {
  return {
    id: randomUUID(),
    artifactId: input.artifact.id,
    sourceCommitSha: input.artifact.sourceCommitSha,
    artifactDigest: input.artifact.digest,
    testEvidence: input.testEvidence,
    securityScanStatus: input.securityScanStatus,
    qualityGateDecision: input.qualityGateDecision,
    approvals: [],
    createdAt: new Date().toISOString(),
  };
}

export function approveRelease(
  release: ReleaseRecord,
  by: string,
  environment: EnvironmentName,
): ReleaseRecord {
  return {
    ...release,
    approvals: [...release.approvals, { by, at: new Date().toISOString(), environment }],
  };
}

/**
 * Verify that an artifact is the exact one referenced by a release
 * (identity + provenance check before any deployment).
 */
export function verifyArtifactIdentity(
  release: ReleaseRecord,
  artifact: ArtifactRecord,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (artifact.digest !== release.artifactDigest) reasons.push("Digest mismatch");
  if (artifact.sourceCommitSha !== release.sourceCommitSha) reasons.push("Source commit mismatch");
  if (artifact.id !== release.artifactId) reasons.push("Artifact id mismatch");
  return { ok: reasons.length === 0, reasons };
}

/** Validate a `sha256:<64 hex>` digest string. */
export function isValidDigest(digest: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(digest);
}
