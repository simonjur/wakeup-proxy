// End-to-end test of the shell-command wake flow, mirroring the manual
// examples/ setup but fully orchestrated by vitest + a headless browser.
//
// Flow under test:
//   1. The proxy boots with its upstream DOWN (backend.mjs isn't running).
//   2. A browser opens the proxy -> it renders the waiting page and fires
//      WAKE_SHELL_COMMAND.
//   3. That command launches backend.mjs, which starts serving "I'm alive!".
//   4. The waiting page's client-side JS polls /__wake/status, sees "up", and
//      reloads -> the browser now renders "I'm alive!" proxied from the backend.

import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getFreePort, waitForLog } from "./helpers.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const serverEntry = path.join(repoRoot, "src", "server.ts");
const backendScript = path.join(here, "backend.ts");

describe("shell-command wake (e2e)", () => {
  let proxy: ChildProcess;
  let browser: Browser;
  let tmp: string;
  let proxyPort: number;
  let backendPort: number;
  let backendPidFile: string;

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "wakeup-e2e-"));
    backendPidFile = path.join(tmp, "backend.pid");

    proxyPort = await getFreePort();
    backendPort = await getFreePort();

    // Launch backend.mjs on demand and record its PID so we can reap it later.
    const wakeCommand =
      `node ${JSON.stringify(backendScript)} ${backendPort} ` +
      `>${JSON.stringify(path.join(tmp, "backend.log"))} 2>&1 & ` +
      `echo $! > ${JSON.stringify(backendPidFile)}`;

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
        WAKE_SHELL_COMMAND: wakeCommand,
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

    // Reap the backend the wake command spawned (it's not a child of the proxy).
    try {
      const raw = await readFile(backendPidFile, "utf8");
      const pid = Number(raw.trim());
      if (Number.isSafeInteger(pid) && pid > 0) process.kill(pid, "SIGTERM");
    } catch {
      /* backend never started or already gone */
    }

    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("shows the waiting page, wakes the backend, and reloads into it", async () => {
    const page = await browser.newPage();
    const proxyUrl = `http://127.0.0.1:${proxyPort}/`;

    // First navigation: upstream is down -> the waiting page, which also fires
    // the wake. Assert on the navigation response body directly so we catch it
    // before the client-side poller reloads the page out from under us.
    const response = await page.goto(proxyUrl, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    expect(await response!.text()).toContain("Waking the server");

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
