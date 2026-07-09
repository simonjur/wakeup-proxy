import { EventEmitter } from "node:events";
import type http from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { observeRequest, registry, setUpstreamUp } from "../metrics.ts";

function fakeRequest(method: string): http.IncomingMessage {
  return { method } as http.IncomingMessage;
}

// Minimal ServerResponse stand-in: just an event emitter with a statusCode,
// enough for observeRequest to hook "finish" and read the code.
function fakeResponse(statusCode: number): http.ServerResponse {
  const res = new EventEmitter() as unknown as http.ServerResponse;
  res.statusCode = statusCode;
  return res;
}

// Pull a single metric sample's value out of the registry by name + labels.
async function metricValue(
  name: string,
  labels: Record<string, string> = {},
): Promise<number | undefined> {
  const all = await registry.getMetricsAsJSON();
  const metric = all.find((m) => m.name === name);
  const sample = (metric?.values ?? []).find((v) =>
    Object.entries(labels).every(([k, value]) => v.labels[k] === value),
  );
  return sample?.value;
}

describe("metrics", () => {
  beforeEach(() => {
    registry.resetMetrics();
  });

  afterEach(() => {
    registry.resetMetrics();
  });

  it("counts requests by (upper-cased) method", async () => {
    observeRequest(fakeRequest("get"), fakeResponse(200));
    observeRequest(fakeRequest("GET"), fakeResponse(200));
    observeRequest(fakeRequest("POST"), fakeResponse(201));

    expect(await metricValue("wakeup_proxy_http_requests_total", { method: "GET" })).toBe(2);
    expect(await metricValue("wakeup_proxy_http_requests_total", { method: "POST" })).toBe(1);
  });

  it("counts responses by status code only once the response finishes", async () => {
    const res = fakeResponse(503);
    observeRequest(fakeRequest("GET"), res);

    // Nothing recorded until the response actually finishes.
    expect(await metricValue("wakeup_proxy_http_responses_total", { code: "503" })).toBeUndefined();

    res.emit("finish");
    expect(await metricValue("wakeup_proxy_http_responses_total", { code: "503" })).toBe(1);
  });

  it("tracks upstream up/down as a 1/0 gauge", async () => {
    setUpstreamUp(true);
    expect(await metricValue("wakeup_proxy_upstream_up")).toBe(1);

    setUpstreamUp(false);
    expect(await metricValue("wakeup_proxy_upstream_up")).toBe(0);
  });
});
