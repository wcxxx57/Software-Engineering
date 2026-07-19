import { createApp } from "./app.js";
import { config } from "./config.js";
import { AgentService } from "./services/agentService.js";
import { VersionStore } from "./services/versionStore.js";
import { startInteractiveHtmlWorker } from "./worker.js";

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

if (config.workerEnabled) {
  void startInteractiveHtmlWorker(agents, {
    rabbitmqUrl: config.rabbitmqUrl,
    backendBaseUrl: config.backendBaseUrl,
    apiKey: config.interactiveHtmlApiKey,
    prefetch: config.workerPrefetch,
  }).catch((error) => {
    console.error("Education2D worker failed to start", error);
    process.exitCode = 1;
    server.close();
  });
}
