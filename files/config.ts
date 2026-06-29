// Centralised, validated configuration loaded from environment variables.
// Everything is resolved once at startup so the rest of the app can stay sync.

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optionalStr(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be an integer, got: ${v}`);
  return n;
}

function json(name: string): Record<string, unknown> {
  const v = process.env[name];
  if (v === undefined || v === "") return {};
  try {
    const parsed = JSON.parse(v);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Env var ${name} must be a valid JSON object: ${(err as Error).message}`);
  }
}

export interface HomeAssistantConfig {
  // If a webhook URL is set it takes precedence and requires no token.
  webhookUrl: string | undefined;
  baseUrl: string | undefined;
  token: string | undefined;
  // "domain.service", e.g. "script.turn_on" or "wake_on_lan.send_magic_packet".
  service: string | undefined;
  // Service data sent in the POST body (merged: entityId first, then HA_WAKE_DATA).
  data: Record<string, unknown>;
  // True when enough is configured to actually fire a wake call.
  enabled: boolean;
}

export interface Config {
  host: string;
  port: number;

  immichUrl: string;
  immichHealthPath: string;

  healthCacheMs: number;
  healthTimeoutMs: number;
  wakeCooldownMs: number;
  wakeTimeoutMs: number;

  // Client-side polling cadence for the waiting page, in milliseconds.
  pollIntervalMs: number;

  ha: HomeAssistantConfig;
}

function buildHaConfig(): HomeAssistantConfig {
  const webhookUrl = optionalStr("HA_WAKE_WEBHOOK_URL");
  const baseUrl = optionalStr("HA_BASE_URL")?.replace(/\/+$/, "");
  const token = optionalStr("HA_TOKEN");
  const service = optionalStr("HA_WAKE_SERVICE");
  const entityId = optionalStr("HA_WAKE_ENTITY_ID");

  const data: Record<string, unknown> = {};
  if (entityId) data.entity_id = entityId;
  Object.assign(data, json("HA_WAKE_DATA"));

  const serviceCallReady = Boolean(baseUrl && token && service);
  const enabled = Boolean(webhookUrl) || serviceCallReady;

  return { webhookUrl, baseUrl, token, service, data, enabled };
}

export const config: Config = {
  host: str("HOST", "0.0.0.0"),
  port: int("PORT", 3000),

  immichUrl: str("IMMICH_URL").replace(/\/+$/, ""),
  immichHealthPath: str("IMMICH_HEALTH_PATH", "/api/server/ping"),

  healthCacheMs: int("HEALTH_CACHE_MS", 3000),
  healthTimeoutMs: int("HEALTH_TIMEOUT_MS", 2000),
  wakeCooldownMs: int("WAKE_COOLDOWN_MS", 60000),
  wakeTimeoutMs: int("WAKE_TIMEOUT_MS", 5000),

  pollIntervalMs: int("POLL_INTERVAL_MS", 3000),

  ha: buildHaConfig(),
};
