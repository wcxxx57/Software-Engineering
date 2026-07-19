import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  port: numberFromEnv("PORT", 3100),
  dataDir: path.resolve(process.cwd(), process.env.DATA_DIR || "data"),
  dmxBaseUrl: process.env.DMX_BASE_URL || "https://vip.dmxapi.com/v1",
  dmxApiKey: process.env.DMX_API_KEY || "",
  editorModel: process.env.AGENT_MODEL || process.env.LOGIC_MODEL || "",
  authorModel: process.env.AUTHOR_MODEL || process.env.CODE_MODEL || "",
  agentTimeoutMs: numberFromEnv("AGENT_TIMEOUT_MS", 300000),
  rabbitmqUrl: process.env.RABBITMQ_URL || "",
  backendBaseUrl: (process.env.BACKEND_BASE_URL || "http://backend:9000").replace(/\/$/, ""),
  interactiveHtmlApiKey: process.env.INTERACTIVE_HTML_API_KEY || "",
  workerPrefetch: numberFromEnv("WORKER_PREFETCH", 1),
  workerEnabled: (process.env.WORKER_ENABLED || "true").toLowerCase() !== "false",
};
