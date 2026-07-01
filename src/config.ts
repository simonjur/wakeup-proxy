// Centralised configuration loaded from environment variables and validated
// with ajv. Everything is resolved once at startup so the rest of the app can
// stay synchronous. The config is split by concern: proxy, immich, and the
// individual wake services (Home Assistant, shell command).

import { Ajv, type JSONSchemaType } from "ajv";

// ---- Public config shape -------------------------------------------------

export interface ImmichConfig {
  url: string;
  healthPath: string;
}

export interface HomeAssistantConfig {
  // If a webhook URL is set it takes precedence and requires no token.
  webhookUrl?: string;
  baseUrl?: string;
  token?: string;
  // "domain.service", e.g. "script.turn_on" or "wake_on_lan.send_magic_packet".
  service?: string;
  // Service data sent in the POST body (merged: entityId first, then HA_WAKE_DATA).
  data: Record<string, unknown>;
  // True when enough is configured to actually fire a wake call.
  enabled: boolean;
}

export interface ShellCommandConfig {
  // Command executed via the system shell to wake the upstream.
  command?: string;
  // True when a command is configured.
  enabled: boolean;
}

export interface Config {
  host: string;
  port: number;

  healthCacheMs: number;
  healthTimeoutMs: number;
  wakeCooldownMs: number;
  wakeTimeoutMs: number;

  // Client-side polling cadence for the waiting page, in milliseconds.
  pollIntervalMs: number;

  immich: ImmichConfig;
  ha: HomeAssistantConfig;
  shell: ShellCommandConfig;
}

// ---- Raw (pre-validation) shape ------------------------------------------
// Read straight from env vars. ajv coerces strings to numbers and applies
// defaults; JSON blobs (HA_WAKE_DATA) are parsed here since env vars are strings.

interface RawHomeAssistant {
  webhookUrl?: string;
  baseUrl?: string;
  token?: string;
  service?: string;
  data: Record<string, unknown>;
}

interface RawShell {
  command?: string;
}

interface RawConfig {
  host: string;
  port: number;
  healthCacheMs: number;
  healthTimeoutMs: number;
  wakeCooldownMs: number;
  wakeTimeoutMs: number;
  pollIntervalMs: number;
  immich: {
    url: string;
    healthPath: string;
  };
  ha: RawHomeAssistant;
  shell: RawShell;
}

const schema: JSONSchemaType<RawConfig> = {
  type: "object",
  additionalProperties: false,
  properties: {
    host: { type: "string", default: "0.0.0.0" },
    port: { type: "integer", default: 3000 },

    healthCacheMs: { type: "integer", default: 3000 },
    healthTimeoutMs: { type: "integer", default: 2000 },
    wakeCooldownMs: { type: "integer", default: 60_000 },
    wakeTimeoutMs: { type: "integer", default: 5000 },
    pollIntervalMs: { type: "integer", default: 3000 },

    immich: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", minLength: 1 },
        healthPath: { type: "string", default: "/api/server/ping" },
      },
      required: ["url"],
    },

    ha: {
      type: "object",
      additionalProperties: false,
      properties: {
        webhookUrl: { type: "string", nullable: true },
        baseUrl: { type: "string", nullable: true },
        token: { type: "string", nullable: true },
        service: { type: "string", nullable: true },
        data: { type: "object", default: {} },
      },
      required: ["data"],
    },

    shell: {
      type: "object",
      additionalProperties: false,
      properties: {
        command: { type: "string", nullable: true },
      },
      required: [],
    },
  },
  required: ["immich", "ha", "shell"],
};

// ---- Helpers -------------------------------------------------------------

function optionalString(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

function parseJsonObject(name: string): Record<string, unknown> {
  const v = process.env[name];
  if (v === undefined || v === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch (error) {
    throw new Error(`Env var ${name} must be valid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Env var ${name} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

// Drop undefined keys so ajv's `useDefaults` and `required` behave predictably.
function compact<T extends Record<string, unknown>>(object: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(object)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

// ---- Build & validate ----------------------------------------------------

function loadConfig(): Config {
  const ha = {
    webhookUrl: optionalString("HA_WAKE_WEBHOOK_URL"),
    baseUrl: optionalString("HA_BASE_URL")?.replace(/\/+$/, ""),
    token: optionalString("HA_TOKEN"),
    service: optionalString("HA_WAKE_SERVICE"),
    data: parseJsonObject("HA_WAKE_DATA"),
  };
  const entityId = optionalString("HA_WAKE_ENTITY_ID");
  if (entityId) ha.data = { entity_id: entityId, ...ha.data };

  const raw: Record<string, unknown> = compact({
    host: optionalString("HOST"),
    port: optionalString("PORT"),
    healthCacheMs: optionalString("HEALTH_CACHE_MS"),
    healthTimeoutMs: optionalString("HEALTH_TIMEOUT_MS"),
    wakeCooldownMs: optionalString("WAKE_COOLDOWN_MS"),
    wakeTimeoutMs: optionalString("WAKE_TIMEOUT_MS"),
    pollIntervalMs: optionalString("POLL_INTERVAL_MS"),
    immich: compact({
      url: optionalString("IMMICH_URL"),
      healthPath: optionalString("IMMICH_HEALTH_PATH"),
    }),
    ha: compact(ha),
    shell: compact({
      command: optionalString("WAKE_SHELL_COMMAND"),
    }),
  });

  const ajv = new Ajv({ coerceTypes: true, useDefaults: true, allErrors: true });
  const validate = ajv.compile(schema);
  if (!validate(raw)) {
    const details = (validate.errors ?? [])
      .map((e) => `  ${e.instancePath || "(root)"} ${e.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${details}`);
  }

  const valid = raw as unknown as RawConfig;

  const isServiceCallReady = Boolean(valid.ha.baseUrl && valid.ha.token && valid.ha.service);

  return {
    host: valid.host,
    port: valid.port,
    healthCacheMs: valid.healthCacheMs,
    healthTimeoutMs: valid.healthTimeoutMs,
    wakeCooldownMs: valid.wakeCooldownMs,
    wakeTimeoutMs: valid.wakeTimeoutMs,
    pollIntervalMs: valid.pollIntervalMs,
    immich: {
      url: valid.immich.url.replace(/\/+$/, ""),
      healthPath: valid.immich.healthPath,
    },
    ha: {
      webhookUrl: valid.ha.webhookUrl,
      baseUrl: valid.ha.baseUrl,
      token: valid.ha.token,
      service: valid.ha.service,
      data: valid.ha.data,
      enabled: Boolean(valid.ha.webhookUrl) || isServiceCallReady,
    },
    shell: {
      command: valid.shell.command,
      enabled: Boolean(valid.shell.command),
    },
  };
}

export const config: Config = loadConfig();
