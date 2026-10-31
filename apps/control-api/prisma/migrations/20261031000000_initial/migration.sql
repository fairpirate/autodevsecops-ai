-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gitlabBaseUrl" TEXT NOT NULL,
    "gitlabProjectId" INTEGER NOT NULL,
    "pathWithNamespace" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "tokenEncrypted" TEXT NOT NULL,
    "webUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "gitlabProjectId" INTEGER NOT NULL,
    "ref" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "iteration" INTEGER NOT NULL DEFAULT 1,
    "budget" JSONB NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "parentRunId" TEXT,
    "failureFingerprints" JSONB NOT NULL DEFAULT '{}',
    "noProgressIterations" INTEGER NOT NULL DEFAULT 0,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "costEstimateUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mrIid" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestResultRecord" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "artifactId" TEXT,
    "environment" TEXT NOT NULL,
    "suite" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "failureSummary" TEXT,
    "logLink" TEXT,
    "total" INTEGER,
    "failed" INTEGER,
    "skipped" INTEGER,
    "timestamp" TEXT NOT NULL,

    CONSTRAINT "TestResultRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceCommitSha" TEXT NOT NULL,
    "pipelineId" TEXT,
    "buildJobId" TEXT,
    "digest" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "sourceCommitSha" TEXT NOT NULL,
    "artifactDigest" TEXT NOT NULL,
    "testEvidence" JSONB NOT NULL DEFAULT '[]',
    "securityScanStatus" TEXT NOT NULL DEFAULT 'not_run',
    "qualityGateDecision" TEXT NOT NULL DEFAULT 'pending',
    "approvals" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "artifactDigest" TEXT NOT NULL,
    "sourceCommitSha" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "healthChecks" JSONB NOT NULL DEFAULT '[]',
    "rollbackAvailable" BOOLEAN NOT NULL DEFAULT false,
    "rollbackOfDeploymentId" TEXT,
    "auditTrail" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" SERIAL NOT NULL,
    "runId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "key" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResultRecord" ADD CONSTRAINT "TestResultRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
