import crypto from "node:crypto";

let activePublish = null;

export class PublishInProgressError extends Error {
  constructor(active) {
    super("A publish is already running.");
    this.name = "PublishInProgressError";
    this.code = "PUBLISH_IN_PROGRESS";
    this.statusCode = 409;
    this.publicMessage = "A publish is already running. Wait for it to finish before trying again.";
    this.activeJobId = active?.jobId || null;
  }
}

export function publishStatus() {
  return activePublish ? { jobId: activePublish.jobId, startedAt: activePublish.startedAt, userId: activePublish.userId } : null;
}

export function cancelActivePublish() {
  activePublish?.controller.abort();
}

export async function withPublishLock(userId, task, { recordAuditImpl = () => {} } = {}) {
  if (activePublish) {
    const rejectedAt = Date.now();
    recordAuditImpl(userId, "publish_rejected_active", {
      jobId: crypto.randomUUID(),
      message: "Publish rejected because another publish was active",
      startedAt: rejectedAt,
      metadata: { activeJobId: activePublish.jobId }
    });
    throw new PublishInProgressError(activePublish);
  }
  const jobId = crypto.randomUUID();
  const startedAt = Date.now();
  const controller = new AbortController();
  activePublish = { jobId, startedAt: new Date(startedAt).toISOString(), userId, controller };
  try {
    return await task({ jobId, startedAt, signal: controller.signal });
  } finally {
    activePublish = null;
  }
}
