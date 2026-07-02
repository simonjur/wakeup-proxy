// Centralised logging. Wraps winston with a single, human-readable console
// format so logs are easy to scan while debugging:
//
//   2026-07-02 12:00:00.123 info  [proxy] error: upstream_error
//
// Usage: create one root logger at startup (`createLogger()`), then hand a
// per-component child to each class/function via its constructor/arguments:
//
//   const logger = createLogger();
//   new WakeService(logger);              // WakeService makes its own children
//   logger.child({ component: "proxy" }); // ad-hoc component logger
//
// The level is controlled by the LOG_LEVEL env var (default "info"); set it to
// "debug" to see the fine-grained probe/wake tracing.

import { createLogger as createWinstonLogger, format, transports, type Logger } from "winston";

export type { Logger } from "winston";

const { combine, timestamp, printf, colorize, errors } = format;

// One-line-per-entry format. `component` (set via logger.child({ component }))
// becomes a "[name]" tag; Error objects logged directly print their stack.
const consoleLine = printf((info) => {
  const {
    level,
    message,
    timestamp: ts,
    component,
    stack,
  } = info as {
    level: string;
    message: unknown;
    timestamp?: string;
    component?: string;
    stack?: string;
  };
  const tag = component ? ` [${component}]` : "";
  return `${ts}${tag} ${level}: ${stack ?? String(message)}`;
});

export function createLogger(): Logger {
  return createWinstonLogger({
    level: process.env.LOG_LEVEL ?? "info",
    format: combine(
      errors({ stack: true }),
      timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
      colorize({ level: true }),
      consoleLine,
    ),
    transports: [new transports.Console()],
  });
}
