import type { Response } from "express";

export class SseWriter {
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(private readonly response: Response) {
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();
    this.heartbeat = setInterval(() => {
      if (!this.closed) response.write(": heartbeat\n\n");
    }, 10000);
  }

  send(event: unknown): void {
    if (!this.closed) this.response.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    this.response.end();
  }
}
