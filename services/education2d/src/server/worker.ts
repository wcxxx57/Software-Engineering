import amqp from "amqplib";
import crypto from "node:crypto";
import type { AgentService } from "./services/agentService.js";

const EXCHANGE = "zhiying.interactive_html";
const QUEUE = "zhiying.interactive_html.generate";
const ROUTING_KEY = "generate";

interface GenerateMessage {
  task_id: number;
  prompt: string;
}

interface WorkerConfig {
  rabbitmqUrl: string;
  backendBaseUrl: string;
  apiKey: string;
  prefetch: number;
}

async function callback(config: WorkerConfig, taskId: number, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${config.backendBaseUrl}/internal/interactive-htmls/${taskId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`backend callback failed: ${response.status} ${await response.text()}`);
  }
}

function parseMessage(content: Buffer): GenerateMessage {
  const value = JSON.parse(content.toString("utf8")) as Partial<GenerateMessage>;
  if (!Number.isInteger(value.task_id) || !value.prompt?.trim()) {
    throw new Error("invalid interactive_html message");
  }
  return { task_id: value.task_id as number, prompt: value.prompt.trim() };
}

export async function startInteractiveHtmlWorker(agents: AgentService, config: WorkerConfig): Promise<void> {
  if (!config.rabbitmqUrl) throw new Error("RABBITMQ_URL is required when the worker is enabled");
  if (!config.apiKey.startsWith("sk-")) throw new Error("INTERACTIVE_HTML_API_KEY must start with sk-");

  const connection = await amqp.connect(config.rabbitmqUrl);
  const channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, "direct", { durable: true });
  await channel.assertQueue(QUEUE, { durable: true });
  await channel.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
  await channel.prefetch(Math.max(1, config.prefetch));

  connection.on("error", (error) => console.error("Education2D RabbitMQ connection error", error));
  connection.on("close", () => console.error("Education2D RabbitMQ connection closed"));

  await channel.consume(QUEUE, async (message) => {
    if (!message) return;
    let taskId: number | undefined;
    try {
      const request = parseMessage(message.content);
      taskId = request.task_id;
      await callback(config, taskId, { status: "GENERATING" });
      const stored = await agents.author(request.prompt, {}, crypto.randomUUID(), () => undefined);
      await callback(config, taskId, {
        status: "FINISHED",
        object_key: `education2d:${stored.index.visualizationId}`,
      });
      channel.ack(message);
      console.log(`interactive_html task finished task_id=${taskId} visualization_id=${stored.index.visualizationId}`);
    } catch (error) {
      console.error(`interactive_html task failed task_id=${taskId ?? "unknown"}`, error);
      if (taskId != null) {
        try {
          await callback(config, taskId, { status: "FAILED" });
        } catch (callbackError) {
          console.error(`interactive_html failure callback failed task_id=${taskId}`, callbackError);
          channel.nack(message, false, true);
          return;
        }
      }
      channel.ack(message);
    }
  });

  console.log(`Education2D worker ready queue=${QUEUE}`);
}
