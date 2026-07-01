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
import { enabledTriggers } from "./wake.ts";
import { waitingPage } from "./waiting-page.ts";

const STATUS_PATH = "/__wake/status";

const proxy = createProxyServer({
  target: config.immich.url,
  ws: true,
  xfwd: true, // adds X-Forwarded-For / -Host / -Proto for Immich
  changeOrigin: false, // preserve the original Host header
  proxyTimeout: 30_000,
});

proxy.on("error", (error: Error, _request, resOrSocket) => {
  console.error("[proxy] error:", error.message);
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
  void handleRequest(request, res);
});

async function handleRequest(
  request: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const path = (request.url ?? "/").split("?", 1)[0];

  // Internal status endpoint used by the waiting page poller.
  if (path === STATUS_PATH) {
    const status = await checkAndWake();
    sendJson(res, 200, { status });
    return;
  }

  if (await isImmichUp()) {
    proxy.web(request, res);
    return;
  }

  // Upstream is down: kick off a wake and respond appropriately.
  await checkAndWake();
  if (wantsHtml(request)) {
    sendWaitingPage(res);
  } else {
    // Background/API/asset request while asleep – don't proxy, fail fast.
    sendJson(res, 503, { status: "waking" });
  }
}

// Websocket upgrades: only proxy when upstream is actually up.
server.on("upgrade", (request, socket, head) => {
  void (async () => {
    if (await isImmichUp()) {
      proxy.ws(request, socket, head);
    } else {
      socket.destroy();
    }
  })();
});

server.listen(config.port, config.host, () => {
  console.log(`immich-wake-proxy listening on http://${config.host}:${config.port}`);
  console.log(`  -> upstream: ${config.immich.url} (health: ${config.immich.healthPath})`);
  if (enabledTriggers.length > 0) {
    const names = enabledTriggers.map((t) => t.name).join(", ");
    console.log(`  -> wake: ${names} (cooldown ${config.wakeCooldownMs}ms)`);
  } else {
    console.warn("  -> wake: DISABLED (no wake service configured; waiting page will still show)");
  }
});

function shutdown(signal: string): void {
  console.log(`\n${signal} received, shutting down…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
