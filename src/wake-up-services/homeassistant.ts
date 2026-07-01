// Wakes the upstream via Home Assistant. Two modes:
//   1. Webhook  -> POST HA_WAKE_WEBHOOK_URL (no auth needed).
//   2. Service  -> POST {HA_BASE_URL}/api/services/{domain}/{service}
//                  with a long-lived access token, e.g. wake_on_lan or a script.

import { config, type HomeAssistantConfig } from "../config.ts";
import type { ServiceWakeUpTrigger } from "../wake-trigger.ts";

export class HomeAssistantWakeUpTrigger implements ServiceWakeUpTrigger {
  private readonly ha: HomeAssistantConfig;
  private readonly timeoutMs: number;
  readonly name = "home-assistant";

  constructor(ha: HomeAssistantConfig, timeoutMs: number) {
    this.ha = ha;
    this.timeoutMs = timeoutMs;
  }

  get enabled(): boolean {
    return this.ha.enabled;
  }

  async triggerWake(): Promise<void> {
    const ha = this.ha;

    if (ha.webhookUrl) {
      const res = await fetch(ha.webhookUrl, {
        method: "POST",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        throw new Error(`HA webhook returned ${res.status} ${res.statusText}`);
      }
      console.log("[wake] webhook fired");
      return;
    }

    // Service call. service is "domain.service".
    const service = ha.service ?? "";
    const dot = service.indexOf(".");
    if (dot < 1) {
      throw new Error(`HA_WAKE_SERVICE must look like "domain.service", got: ${ha.service}`);
    }
    const domain = service.slice(0, dot);
    const name = service.slice(dot + 1);
    const url = `${ha.baseUrl}/api/services/${domain}/${name}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ha.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ha.data),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      let text = "";
      try {
        text = await res.text();
      } catch {
        // Body is best-effort context for the error message.
      }
      throw new Error(
        `HA ${domain}.${name} returned ${res.status} ${res.statusText} ${text}`.trim(),
      );
    }
    console.log(`[wake] called ${domain}.${name}`);
  }
}

export const homeAssistantTrigger = new HomeAssistantWakeUpTrigger(config.ha, config.wakeTimeoutMs);
