// Lightweight upstream health probe with a short cache so we don't hammer
// Immich (or the network) on every single request / poll.

import { config } from "./config.ts";
import type { Logger } from "./logger.ts";

export class HealthChecker {
  private readonly log: Logger;
  private cached: { up: boolean; at: number } | null = null;

  constructor(logger: Logger) {
    this.log = logger.child({ component: "health" });
  }

  private async probe(): Promise<boolean> {
    const url = config.upstream.url + config.upstream.healthPath;
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(config.healthTimeoutMs),
      });
      // Any non-5xx, non-network response means something is listening and
      // serving. Immich's /api/server/ping returns 200 {"res":"pong"}.
      const up = res.status < 500;
      this.log.debug(`probe ${url} -> ${res.status} (${up ? "up" : "down"})`);
      return up;
    } catch (error) {
      this.log.debug(`probe ${url} failed: ${(error as Error).message} (down)`);
      return false;
    }
  }

  async isUp(): Promise<boolean> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < config.healthCacheMs) {
      this.log.debug(`cache hit -> ${this.cached.up ? "up" : "down"}`);
      return this.cached.up;
    }
    const up = await this.probe();
    this.cached = { up, at: now };
    return up;
  }

  // Force the next isUp() call to re-probe (used right after a wake so we
  // notice "up" as soon as possible).
  invalidate(): void {
    this.log.debug("health cache invalidated");
    this.cached = null;
  }
}
