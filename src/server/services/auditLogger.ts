import fs from "node:fs";
import path from "node:path";

export interface AuditEntry {
  runId: string;
  agent: "author" | "editor";
  event: "run_started" | "tool_started" | "tool_completed" | "tool_failed" | "run_completed" | "run_failed";
  tool?: string;
  durationMs?: number;
  versionId?: string;
  error?: string;
  timestamp: string;
}

export class AuditLogger {
  constructor(private readonly dataDir: string) {}

  async write(entry: AuditEntry): Promise<void> {
    const logDir = path.join(this.dataDir, "agent-runs");
    await fs.promises.mkdir(logDir, { recursive: true });
    await fs.promises.appendFile(path.join(logDir, `${entry.runId}.jsonl`), `${JSON.stringify(entry)}\n`, "utf8");
  }
}
