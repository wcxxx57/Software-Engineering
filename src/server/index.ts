import { createApp } from "./app.js";
import { config } from "./config.js";
import { AgentService } from "./services/agentService.js";
import { VersionStore } from "./services/versionStore.js";

const store = new VersionStore(config.dataDir);
const agents = new AgentService(store, {
  baseUrl: config.dmxBaseUrl,
  apiKey: config.dmxApiKey,
  editorModel: config.editorModel,
  authorModel: config.authorModel,
  timeoutMs: config.agentTimeoutMs,
}, config.dataDir);

const app = createApp({ store, agents });
const server = app.listen(config.port, () => {
  console.log(`Education2D listening on http://localhost:${config.port}`);
});
server.keepAliveTimeout = 310000;
server.headersTimeout = 315000;
