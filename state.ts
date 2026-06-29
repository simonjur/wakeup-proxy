// Ties health-checking and waking together, with a cooldown so we don't spam
// Home Assistant / re-send magic packets too often.

import { config } from "./config.ts";
import { isImmichUp, invalidateHealthCache } from "./health.ts";
import { triggerWake } from "./homeassistant.ts";

export type Status = "up" | "waking";

let lastWakeAt = 0;
let inFlight = false;

// Returns "up" if Immich answers, otherwise ensures a wake has been requested
// (respecting the cooldown) and returns "waking".
export async function checkAndWake(): Promise<Status> {
  if (await isImmichUp()) return "up";

  const now = Date.now();
  const cooledDown = now - lastWakeAt >= config.wakeCooldownMs;

  if (cooledDown && !inFlight) {
    lastWakeAt = now;
    inFlight = true;
    triggerWake()
      .then(() => {
        // Probe again soon rather than trusting the cached "down".
        invalidateHealthCache();
      })
      .catch((err: unknown) => {
        console.error("[wake] failed:", (err as Error).message);
        // Allow an immediate retry on the next request.
        lastWakeAt = 0;
      })
      .finally(() => {
        inFlight = false;
      });
  }

  return "waking";
}
