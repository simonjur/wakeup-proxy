// Centralised configuration loaded from environment variables and validated
// with ajv. Everything is resolved once at startup so the rest of the app can
// stay synchronous. The config is split by concern: proxy, upstream, waiting
// page, and the individual wake services (Home Assistant, shell command).

import { Ajv, type JSONSchemaType } from "ajv";

// ---- Public config shape -------------------------------------------------

export interface UpstreamConfig {
  url: string;
  healthPath: string;
  // Fully-resolved URL of a logo shown on the waiting page, or undefined.
  icon?: string;
}

export interface WaitingConfig {
  // Copy shown on the self-refreshing waiting page while the upstream wakes.
  title: string;
  message: string;
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

export interface MetricsConfig {
  // True when the Prometheus /metrics endpoint should be served.
  enabled: boolean;
  // Path the metrics are exposed on (METRICS_URL), e.g. "/metrics".
  path: string;
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

  upstream: UpstreamConfig;
  waiting: WaitingConfig;
  ha: HomeAssistantConfig;
  shell: ShellCommandConfig;
  metrics: MetricsConfig;
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
  metricsUrl: string;
  upstream: {
    url: string;
    healthPath: string;
    icon?: string;
  };
  waiting: {
    title: string;
    message: string;
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

    // Empty string disables the /metrics endpoint entirely.
    metricsUrl: { type: "string", default: "/metrics" },

    upstream: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", minLength: 1 },
        healthPath: { type: "string", default: "/" },
        icon: { type: "string", nullable: true },
      },
      required: ["url"],
    },

    waiting: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", default: "Waking the server" },
        message: {
          type: "string",
          default:
            "This usually takes a moment. You'll be redirected automatically once it's ready.",
        },
      },
      required: [],
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
  required: ["upstream", "waiting", "ha", "shell"],
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

// Resolve an UPSTREAM_ICON value into a logo URL. An "sh-" prefix is shorthand
// for a selfh.st icon (https://selfh.st/icons/): "sh-mail-archiver" expands to
// the project's CDN-hosted SVG. Any other value is treated as a full URL.
function resolveIconUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith("sh-")) {
    const name = raw.slice("sh-".length);
    return `https://cdn.jsdelivr.net/gh/selfhst/icons@main/svg/${encodeURIComponent(name)}.svg`;
  }
  return raw;
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
    // Read directly (not via optionalString) so an explicit "" survives and can
    // disable the endpoint; an unset var falls through to the "/metrics" default.
    metricsUrl: process.env.METRICS_URL,
    upstream: compact({
      url: optionalString("UPSTREAM_URL"),
      healthPath: optionalString("UPSTREAM_HEALTH_PATH"),
      icon: optionalString("UPSTREAM_ICON"),
    }),
    waiting: compact({
      title: optionalString("WAITING_TITLE"),
      message: optionalString("WAITING_MESSAGE"),
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
    metrics: {
      enabled: valid.metricsUrl !== "",
      path: valid.metricsUrl,
    },
    upstream: {
      url: valid.upstream.url.replace(/\/+$/, ""),
      healthPath: valid.upstream.healthPath,
      icon: resolveIconUrl(valid.upstream.icon),
    },
    waiting: {
      title: valid.waiting.title,
      message: valid.waiting.message,
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
