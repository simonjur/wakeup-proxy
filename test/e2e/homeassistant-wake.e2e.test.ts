// End-to-end test of the Home Assistant wake flow.
//
// Flow under test:
//   1. A mock Home Assistant server stands in for a real HA instance. It accepts
//      an authenticated service call and, when hit, launches backend.ts.
//   2. The proxy boots with its upstream DOWN (backend.ts isn't running) and is
//      configured to wake via the mock HA (HA_BASE_URL/HA_TOKEN/HA_WAKE_SERVICE).
//   3. A browser opens the proxy -> it renders the waiting page and fires the HA
//      service call.
//   4. The mock HA launches backend.ts, which starts serving "I'm alive!".
//   5. The waiting page's client-side JS polls /__wake/status, sees "up", and
//      reloads -> the browser now renders "I'm alive!" proxied from the backend.

import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getFreePort, waitForLog } from "./helpers.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const serverEntry = path.join(repoRoot, "src", "server.ts");
const backendScript = path.join(here, "backend.ts");

const HA_TOKEN = "test-token-abc123";
const HA_SERVICE = "script.wake_immich";

interface MockHomeAssistant {
  server: http.Server;
  port: number;
  // Resolves once the expected service call has been received and authenticated.
  serviceCalled: Promise<void>;
  // The fake upstream the service call spawned, if any (for cleanup).
  getBackend: () => ChildProcess | undefined;
}

// Stand-in for Home Assistant's REST API. It only implements the one endpoint
// the proxy uses — POST /api/services/{domain}/{service} — and spawns backend.ts
// (the fake upstream) when that call arrives, mimicking HA turning the box on.
async function startMockHomeAssistant(backendPort: number): Promise<MockHomeAssistant> {
  let backend: ChildProcess | undefined;
  const { promise: serviceCalled, resolve: resolveCalled } = Promise.withResolvers<void>();

  const dot = HA_SERVICE.indexOf(".");
  const expectedPath = `/api/services/${HA_SERVICE.slice(0, dot)}/${HA_SERVICE.slice(dot + 1)}`;

  const server = http.createServer((req, res) => {
    const authorized = req.headers.authorization === `Bearer ${HA_TOKEN}`;

    if (req.method === "POST" && req.url === expectedPath && authorized) {
      // Launch the fake upstream on demand, exactly as a real HA script/WoL call
      // would bring the machine up. Only the first call spawns it.
      backend ??= spawn("node", [backendScript, String(backendPort)], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
      resolveCalled();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]"); // HA returns a JSON array of changed states.
      return;
    }

    res.writeHead(authorized ? 404 : 401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "unexpected request" }));
  });

  const port = await getFreePort();
  await once(server.listen(port, "127.0.0.1"), "listening");
  return { server, port, serviceCalled, getBackend: () => backend };
}

describe("home-assistant wake (e2e)", () => {
  let proxy: ChildProcess;
  let browser: Browser;
  let ha: MockHomeAssistant;
  let proxyPort: number;
  let backendPort: number;

  beforeAll(async () => {
    proxyPort = await getFreePort();
    backendPort = await getFreePort();

    ha = await startMockHomeAssistant(backendPort);

    proxy = spawn("node", [serverEntry], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(proxyPort),
        UPSTREAM_URL: `http://127.0.0.1:${backendPort}`,
        UPSTREAM_HEALTH_PATH: "/",
        // Snappy timings so the test doesn't dawdle. Cooldown stays above the
        // backend's max boot delay (5s) so exactly one wake fires per test.
        HEALTH_CACHE_MS: "500",
        POLL_INTERVAL_MS: "1000",
        WAKE_COOLDOWN_MS: "10000",
        // Wake via the mock Home Assistant service call.
        HA_BASE_URL: `http://127.0.0.1:${ha.port}`,
        HA_TOKEN,
        HA_WAKE_SERVICE: HA_SERVICE,
        LOG_LEVEL: "info",
      },
    });

    await waitForLog(proxy, "wakeup-proxy listening", 20_000);
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();

    if (proxy && proxy.exitCode === null) {
      proxy.kill("SIGTERM");
      await Promise.race([once(proxy, "exit"), new Promise((r) => setTimeout(r, 5000))]);
    }

    const backend = ha?.getBackend();
    if (backend && backend.exitCode === null) {
      backend.kill("SIGTERM");
      await Promise.race([once(backend, "exit"), new Promise((r) => setTimeout(r, 5000))]);
    }

    await new Promise((resolve) => ha?.server.close(resolve));
  });

  it("shows the waiting page, calls the HA service, and reloads into the woken backend", async () => {
    const page = await browser.newPage();
    const proxyUrl = `http://127.0.0.1:${proxyPort}/`;

    // First navigation: upstream is down -> the waiting page, which also fires
    // the HA service call. Assert on the navigation response body directly so we
    // catch it before the client-side poller reloads the page out from under us.
    const response = await page.goto(proxyUrl, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    expect(await response!.text()).toContain("Waking the server");

    // The proxy should have actually hit our mock HA's service endpoint.
    await expect(ha.serviceCalled).resolves.toBeUndefined();

    // The poller should detect the now-awake backend and reload into it.
    await page.waitForFunction(
      () => globalThis.document.body?.textContent?.includes("I'm alive!") ?? false,
      undefined,
      { timeout: 30_000 },
    );

    expect(await page.locator("body").textContent()).toContain("I'm alive!");
    await page.close();
  });
});
