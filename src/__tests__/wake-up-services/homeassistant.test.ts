import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HomeAssistantConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import { HomeAssistantWakeUpTrigger } from "../../wake-up-services/homeassistant.ts";

// Minimal Logger stand-in: .child() returns something with the level methods the
// trigger uses. We don't assert on log output, only that construction works.
function fakeLogger(): Logger {
  const logger = {
    child: () => logger,
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger as unknown as Logger;
}

// Build a HomeAssistantConfig with sensible defaults, overridable per test.
function haConfig(overrides: Partial<HomeAssistantConfig> = {}): HomeAssistantConfig {
  return {
    data: {},
    enabled: true,
    ...overrides,
  };
}

function makeTrigger(overrides: Partial<HomeAssistantConfig> = {}, timeoutMs = 5000) {
  return new HomeAssistantWakeUpTrigger(haConfig(overrides), timeoutMs, fakeLogger());
}

// Fake `fetch` Response covering just the fields the trigger reads.
function fakeResponse(init: {
  ok: boolean;
  status?: number;
  statusText?: string;
  text?: string;
}): Response {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    statusText: init.statusText ?? (init.ok ? "OK" : "Internal Server Error"),
    text: async () => init.text ?? "",
  } as unknown as Response;
}

describe("HomeAssistantWakeUpTrigger", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("exposes a stable name and reflects the configured enabled flag", () => {
    expect(makeTrigger().name).toBe("home-assistant");
    expect(makeTrigger({ enabled: true }).enabled).toBe(true);
    expect(makeTrigger({ enabled: false }).enabled).toBe(false);
  });

  describe("webhook mode", () => {
    it("POSTs to the webhook URL and resolves on a 2xx response", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, status: 200, statusText: "OK" }));

      const trigger = makeTrigger({ webhookUrl: "https://ha.local/api/webhook/wake" });
      await expect(trigger.triggerWake()).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://ha.local/api/webhook/wake");
      expect(options).toMatchObject({ method: "POST" });
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it("throws when the webhook returns a non-2xx status", async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ ok: false, status: 500, statusText: "Server Error" }),
      );

      const trigger = makeTrigger({ webhookUrl: "https://ha.local/api/webhook/wake" });
      await expect(trigger.triggerWake()).rejects.toThrow(/webhook returned 500 Server Error/);
    });

    it("prefers the webhook over a configured service call", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true }));

      const trigger = makeTrigger({
        webhookUrl: "https://ha.local/api/webhook/wake",
        baseUrl: "https://ha.local:8123",
        token: "tok",
        service: "script.turn_on",
      });
      await trigger.triggerWake();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]![0]).toBe("https://ha.local/api/webhook/wake");
    });
  });

  describe("service-call mode", () => {
    const base = {
      baseUrl: "https://ha.local:8123",
      token: "long-lived-token",
      service: "script.wake_immich",
    };

    it("POSTs to /api/services/{domain}/{service} with auth headers and JSON body", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true }));

      const trigger = makeTrigger({ ...base, data: { entity_id: "script.wake_immich" } });
      await expect(trigger.triggerWake()).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://ha.local:8123/api/services/script/wake_immich");
      expect(options.method).toBe("POST");
      expect(options.headers).toMatchObject({
        Authorization: "Bearer long-lived-token",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(options.body)).toEqual({ entity_id: "script.wake_immich" });
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it("splits the service on the first dot (domain vs. service name)", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true }));

      const trigger = makeTrigger({ ...base, service: "wake_on_lan.send_magic_packet" });
      await trigger.triggerWake();

      expect(fetchMock.mock.calls[0]![0]).toBe(
        "https://ha.local:8123/api/services/wake_on_lan/send_magic_packet",
      );
    });

    it("rejects a service string without a valid domain.service shape", async () => {
      const trigger = makeTrigger({ ...base, service: "noseparator" });
      await expect(trigger.triggerWake()).rejects.toThrow(/must look like "domain.service"/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("includes the response body in the error on a non-2xx status", async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          text: "bad token",
        }),
      );

      const trigger = makeTrigger(base);
      await expect(trigger.triggerWake()).rejects.toThrow(
        /script\.wake_immich returned 401 Unauthorized bad token/,
      );
    });
  });
});
