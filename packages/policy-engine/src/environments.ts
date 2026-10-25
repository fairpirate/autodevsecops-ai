import type { EnvironmentName, ReleaseRecord } from "@ads/shared-types";
import { DEFAULT_POLICY, type PolicySet } from "./gates";

export interface EnvironmentEligibility {
  eligible: boolean;
  reasons: string[];
}

/**
 * A release may be promoted to an environment only if:
 * - required approvals for that environment are recorded
 * - (immutable promotion) the exact same artifact digest verified earlier is
 *   promoted; PRODUCTION requires the digest already deployed to STAGING
 * - security scan passed and quality gates passed
 */
export function checkEnvironmentEligibility(
  release: ReleaseRecord,
  environment: EnvironmentName,
  priorDeployedDigest: string | undefined,
  approvalsForEnvironment: number,
  policy: PolicySet = DEFAULT_POLICY,
): EnvironmentEligibility {
  const reasons: string[] = [];
  const required = policy.requiredApprovals[environment];
  if (approvalsForEnvironment < required) {
    reasons.push(`${approvalsForEnvironment}/${required} approval(s) present for ${environment}`);
  }
  if (policy.requireImmutablePromotion && environment === "PRODUCTION") {
    if (!priorDeployedDigest) reasons.push("Artifact was not deployed to STAGING first");
    else if (priorDeployedDigest !== release.artifactDigest) {
      reasons.push("STAGING deployed a different artifact digest (promotion must be immutable)");
    }
  }
  if (release.securityScanStatus === "fail") {
    reasons.push("Release security scan failed");
  }
  if (release.qualityGateDecision !== "pass") {
    reasons.push(`Quality gate decision is '${release.qualityGateDecision}', not 'pass'`);
  }
  return { eligible: reasons.length === 0, reasons };
}
