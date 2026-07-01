// Ties health-checking and waking together, with a cooldown so we don't spam
// Home Assistant / re-send magic packets too often.

import { config } from "./config.ts";
import { isImmichUp, invalidateHealthCache } from "./health.ts";
import { triggerWake } from "./wake.ts";

export type Status = "up" | "waking";

let lastWakeAt = 0;
let isInFlight = false;

// Returns "up" if Immich answers, otherwise ensures a wake has been requested
// (respecting the cooldown) and returns "waking".
export async function checkAndWake(): Promise<Status> {
  if (await isImmichUp()) return "up";

  const now = Date.now();
  const isCooledDown = now - lastWakeAt >= config.wakeCooldownMs;

  if (isCooledDown && !isInFlight) {
    lastWakeAt = now;
    isInFlight = true;
    // Fire and forget: don't block the current request on the wake completing.
    void wakeInBackground();
  }

  return "waking";
}

async function wakeInBackground(): Promise<void> {
  try {
    await triggerWake();
    // Probe again soon rather than trusting the cached "down".
    invalidateHealthCache();
  } catch (error) {
    console.error("[wake] failed:", (error as Error).message);
    // Allow an immediate retry on the next request.
    lastWakeAt = 0;
  } finally {
    isInFlight = false;
  }
}
