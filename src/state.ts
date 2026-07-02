// Ties health-checking and waking together, with a cooldown so we don't spam
// Home Assistant / re-send magic packets too often.

import { config } from "./config.ts";
import type { HealthChecker } from "./health.ts";
import type { Logger } from "./logger.ts";
import type { WakeService } from "./wake.ts";

export type Status = "up" | "waking";

export class WakeController {
  private readonly health: HealthChecker;
  private readonly wake: WakeService;
  private readonly log: Logger;

  private lastWakeAt = 0;
  private isInFlight = false;

  constructor(health: HealthChecker, wake: WakeService, logger: Logger) {
    this.health = health;
    this.wake = wake;
    this.log = logger.child({ component: "wake-controller" });
  }

  private async wakeInBackground(): Promise<void> {
    try {
      await this.wake.triggerWake();
      // Probe again soon rather than trusting the cached "down".
      this.health.invalidate();
    } catch (error) {
      this.log.error(`wake failed: ${(error as Error).message}`);
      // Allow an immediate retry on the next request.
      this.lastWakeAt = 0;
    } finally {
      this.isInFlight = false;
    }
  }

  // Returns "up" if Immich answers, otherwise ensures a wake has been requested
  // (respecting the cooldown) and returns "waking".
  async checkAndWake(): Promise<Status> {
    if (await this.health.isUp()) return "up";

    const now = Date.now();
    const isCooledDown = now - this.lastWakeAt >= config.wakeCooldownMs;

    if (isCooledDown && !this.isInFlight) {
      this.lastWakeAt = now;
      this.isInFlight = true;
      // Fire and forget: don't block the current request on the wake completing.
      void this.wakeInBackground();
    } else {
      this.log.debug(
        `skipping wake (${this.isInFlight ? "already in flight" : "still cooling down"})`,
      );
    }

    return "waking";
  }
}
