// Prometheus metrics exposed on the configurable /metrics endpoint (METRICS_URL).
//
// Exports:
//   - default Node.js process/runtime metrics (prom-client's collectDefaultMetrics)
//   - wakeup_proxy_upstream_up          gauge   target status (1 up / 0 down)
//   - wakeup_proxy_http_requests_total  counter requests, labelled by method
//   - wakeup_proxy_http_responses_total counter responses, labelled by status code

import type http from "node:http";

import { collectDefaultMetrics, Counter, Gauge, Registry } from "prom-client";

// A dedicated registry keeps our metrics isolated (and easy to reset in tests).
export const registry = new Registry();

let defaultsCollected = false;

// Register prom-client's default Node.js process/runtime metrics. Called once at
// startup (kept out of module scope so importing this file has no side effects).
// https://github.com/siimon/prom-client#default-metrics
export function initMetrics(): void {
  if (defaultsCollected) return;
  collectDefaultMetrics({ register: registry });
  defaultsCollected = true;
}

const upstreamUp = new Gauge({
  name: "wakeup_proxy_upstream_up",
  help: "Whether the upstream target is currently reachable (1 = up, 0 = down).",
  registers: [registry],
});

const requestsTotal = new Counter({
  name: "wakeup_proxy_http_requests_total",
  help: "Total HTTP requests received by the proxy, by method.",
  labelNames: ["method"],
  registers: [registry],
});

const responsesTotal = new Counter({
  name: "wakeup_proxy_http_responses_total",
  help: "Total HTTP responses sent by the proxy, by status code.",
  labelNames: ["code"],
  registers: [registry],
});

// Count an incoming request (by method) and, once it finishes, its response
// status code. Call this once per request at the top of the server handler.
export function observeRequest(request: http.IncomingMessage, res: http.ServerResponse): void {
  const method = (request.method ?? "UNKNOWN").toUpperCase();
  requestsTotal.inc({ method });
  res.once("finish", () => {
    responsesTotal.inc({ code: String(res.statusCode) });
  });
}

// Record the latest known upstream status; call right before rendering so the
// gauge reflects the state at scrape time.
export function setUpstreamUp(up: boolean): void {
  upstreamUp.set(up ? 1 : 0);
}

// The exposition text and its content type, for the /metrics response.
export function renderMetrics(): Promise<string> {
  return registry.metrics();
}

export const metricsContentType = registry.contentType;
