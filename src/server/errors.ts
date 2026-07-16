export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class VersionConflictError extends Error {
  readonly currentVersionId: string;

  constructor(currentVersionId: string) {
    super("可视化已经被其他操作更新，请重新读取当前版本后再试");
    this.name = "VersionConflictError";
    this.currentVersionId = currentVersionId;
  }
}

export class AgentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentConfigurationError";
  }
}
