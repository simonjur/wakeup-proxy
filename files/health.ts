// Lightweight upstream health probe with a short cache so we don't hammer
// Immich (or the network) on every single request / poll.

import { config } from "./config.ts";

let cached: { up: boolean; at: number } | null = null;

async function probe(): Promise<boolean> {
  try {
    const res = await fetch(config.immichUrl + config.immichHealthPath, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(config.healthTimeoutMs),
    });
    // Any non-5xx, non-network response means something is listening and
    // serving. Immich's /api/server/ping returns 200 {"res":"pong"}.
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function isImmichUp(): Promise<boolean> {
  const now = Date.now();
  if (cached && now - cached.at < config.healthCacheMs) return cached.up;
  const up = await probe();
  cached = { up, at: now };
  return up;
}

// Force the next isImmichUp() call to re-probe (used right after a wake so we
// notice "up" as soon as possible).
export function invalidateHealthCache(): void {
  cached = null;
}
