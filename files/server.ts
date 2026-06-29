// Entry point. Sits in front of Immich:
//   - upstream up   -> transparently reverse-proxy everything (incl. websockets)
//   - upstream down -> trigger a wake and show a self-refreshing waiting page
//
// Run with Node 24+ (native TypeScript): `node src/server.ts`.

import http from "node:http";
import { createProxyServer } from "http-proxy-3";

import { config } from "./config.ts";
import { isImmichUp } from "./health.ts";
import { checkAndWake } from "./state.ts";
import { waitingPage } from "./waiting-page.ts";

const STATUS_PATH = "/__wake/status";

const proxy = createProxyServer({
  target: config.immichUrl,
  ws: true,
  xfwd: true, // adds X-Forwarded-For / -Host / -Proto for Immich
  changeOrigin: false, // preserve the original Host header
  proxyTimeout: 30000,
});

proxy.on("error", (err: Error, _req, resOrSocket) => {
  console.error("[proxy] error:", err.message);
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

function wantsHtml(req: http.IncomingMessage): boolean {
  return (req.headers["accept"] ?? "").includes("text/html");
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res);
});

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const path = (req.url ?? "/").split("?")[0];

  // Internal status endpoint used by the waiting page poller.
  if (path === STATUS_PATH) {
    const status = await checkAndWake();
    sendJson(res, 200, { status });
    return;
  }

  if (await isImmichUp()) {
    proxy.web(req, res);
    return;
  }

  // Upstream is down: kick off a wake and respond appropriately.
  await checkAndWake();
  if (wantsHtml(req)) {
    sendWaitingPage(res);
  } else {
    // Background/API/asset request while asleep – don't proxy, fail fast.
    sendJson(res, 503, { status: "waking" });
  }
}

// Websocket upgrades: only proxy when upstream is actually up.
server.on("upgrade", (req, socket, head) => {
  void (async () => {
    if (await isImmichUp()) {
      proxy.ws(req, socket, head);
    } else {
      socket.destroy();
    }
  })();
});

server.listen(config.port, config.host, () => {
  console.log(`immich-wake-proxy listening on http://${config.host}:${config.port}`);
  console.log(`  -> upstream: ${config.immichUrl} (health: ${config.immichHealthPath})`);
  if (config.ha.enabled) {
    console.log(
      `  -> wake: ${config.ha.webhookUrl ? "webhook" : config.ha.service} (cooldown ${config.wakeCooldownMs}ms)`,
    );
  } else {
    console.warn("  -> wake: DISABLED (Home Assistant not configured; waiting page will still show)");
  }
});

function shutdown(signal: string): void {
  console.log(`\n${signal} received, shutting down…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
