// Entry point. Sits in front of Immich:
//   - upstream up   -> transparently reverse-proxy everything (incl. websockets)
//   - upstream down -> trigger a wake and show a self-refreshing waiting page
//
// Run with Node 24+ (native TypeScript): `node src/server.ts`.

import http from "node:http";
import { createProxyServer } from "http-proxy-3";

import { config } from "./config.ts";
import { HealthChecker } from "./health.ts";
import { createLogger } from "./logger.ts";
import {
  initMetrics,
  metricsContentType,
  observeRequest,
  renderMetrics,
  setUpstreamUp,
} from "./metrics.ts";
import { WakeController } from "./state.ts";
import { WakeService } from "./wake.ts";
import { waitingPage } from "./waiting-page.ts";

const STATUS_PATH = "/__wake/status";

// Root logger; per-component children are handed to each class below.
const logger = createLogger();
const serverLog = logger.child({ component: "server" });
const proxyLog = logger.child({ component: "proxy" });

const health = new HealthChecker(logger);
const wake = new WakeService(logger);
const controller = new WakeController(health, wake, logger);

if (config.metrics.enabled) initMetrics();

const proxy = createProxyServer({
  target: config.upstream.url,
  ws: true,
  xfwd: true, // adds X-Forwarded-For / -Host / -Proto for Immich
  changeOrigin: false, // preserve the original Host header
  proxyTimeout: 30_000,
});

proxy.on("error", (error: Error, _request, resOrSocket) => {
  proxyLog.error(`error: ${error.message}`);
  if (resOrSocket && "writeHead" in resOrSocket) {
    const res = resOrSocket as http.ServerResponse;
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: "upstream_error" }));
  } else if (resOrSocket && "destroy" in resOrSocket) {
    resOrSocket.destroy();
  }
});

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function sendWaitingPage(res: http.ServerResponse): void {
  const html = waitingPage();
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Retry-After": "5",
  });
  res.end(html);
}

function wantsHtml(request: http.IncomingMessage): boolean {
  return (request.headers["accept"] ?? "").includes("text/html");
}

const server = http.createServer((request, res) => {
  if (config.metrics.enabled) observeRequest(request, res);
  void handleRequest(request, res);
});

async function handleRequest(
  request: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const path = (request.url ?? "/").split("?", 1)[0];

  // Prometheus scrape endpoint (path configurable via METRICS_URL).
  if (config.metrics.enabled && path === config.metrics.path) {
    setUpstreamUp(await health.isUp());
    res.writeHead(200, { "Content-Type": metricsContentType, "Cache-Control": "no-store" });
    res.end(await renderMetrics());
    return;
  }

  // Internal status endpoint used by the waiting page poller.
  if (path === STATUS_PATH) {
    const status = await controller.checkAndWake();
    sendJson(res, 200, { status });
    return;
  }

  if (await health.isUp()) {
    proxy.web(request, res);
    return;
  }

  // Upstream is down: kick off a wake and respond appropriately.
  await controller.checkAndWake();
  if (wantsHtml(request)) {
    proxyLog.debug(`upstream down, serving waiting page for ${path}`);
    sendWaitingPage(res);
  } else {
    // Background/API/asset request while asleep – don't proxy, fail fast.
    proxyLog.debug(`upstream down, 503 for ${path}`);
    sendJson(res, 503, { status: "waking" });
  }
}

// Websocket upgrades: only proxy when upstream is actually up.
server.on("upgrade", (request, socket, head) => {
  void (async () => {
    if (await health.isUp()) {
      proxy.ws(request, socket, head);
    } else {
      proxyLog.debug("upstream down, refusing websocket upgrade");
      socket.destroy();
    }
  })();
});

server.listen(config.port, config.host, () => {
  serverLog.info(`wakeup-proxy listening on http://${config.host}:${config.port}`);
  serverLog.info(`upstream: ${config.upstream.url} (health: ${config.upstream.healthPath})`);
  if (config.metrics.enabled) {
    serverLog.info(`metrics: Prometheus endpoint at ${config.metrics.path}`);
  }
  if (wake.enabledTriggers.length > 0) {
    const names = wake.enabledTriggers.map((t) => t.name).join(", ");
    serverLog.info(`wake: ${names} (cooldown ${config.wakeCooldownMs}ms)`);
  } else {
    serverLog.warn("wake: DISABLED (no wake service configured; waiting page will still show)");
  }
});

function shutdown(signal: string): void {
  serverLog.info(`${signal} received, shutting down…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
