// Fires the wake action against Home Assistant. Two modes:
//   1. Webhook  -> POST HA_WAKE_WEBHOOK_URL (no auth needed).
//   2. Service  -> POST {HA_BASE_URL}/api/services/{domain}/{service}
//                  with a long-lived access token, e.g. wake_on_lan or a script.

import { config } from "./config.ts";

export async function triggerWake(): Promise<void> {
  const ha = config.ha;

  if (!ha.enabled) {
    console.warn(
      "[wake] Home Assistant not configured - skipping wake (set HA_WAKE_WEBHOOK_URL or HA_BASE_URL + HA_TOKEN + HA_WAKE_SERVICE).",
    );
    return;
  }

  if (ha.webhookUrl) {
    const res = await fetch(ha.webhookUrl, {
      method: "POST",
      signal: AbortSignal.timeout(config.wakeTimeoutMs),
    });
    if (!res.ok) {
      throw new Error(`HA webhook returned ${res.status} ${res.statusText}`);
    }
    console.log("[wake] webhook fired");
    return;
  }

  // Service call. service is "domain.service".
  const dot = ha.service!.indexOf(".");
  if (dot < 1) {
    throw new Error(`HA_WAKE_SERVICE must look like "domain.service", got: ${ha.service}`);
  }
  const domain = ha.service!.slice(0, dot);
  const service = ha.service!.slice(dot + 1);
  const url = `${ha.baseUrl}/api/services/${domain}/${service}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ha.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(ha.data),
    signal: AbortSignal.timeout(config.wakeTimeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HA ${domain}.${service} returned ${res.status} ${res.statusText} ${text}`.trim());
  }
  console.log(`[wake] called ${domain}.${service}`);
}
