// Aggregates the configured wake services behind a single WakeService.
// Every enabled ServiceWakeUpTrigger is fired; the wake counts as successful as
// long as at least one trigger succeeds.

import { config } from "./config.ts";
import type { Logger } from "./logger.ts";
import { HomeAssistantWakeUpTrigger } from "./wake-up-services/homeassistant.ts";
import { ShellCommandWakeUpTrigger } from "./wake-up-services/shell-command.ts";
import type { ServiceWakeUpTrigger } from "./wake-trigger.ts";

export class WakeService {
  private readonly log: Logger;
  readonly enabledTriggers: ServiceWakeUpTrigger[];

  constructor(logger: Logger) {
    this.log = logger.child({ component: "wake" });

    const allTriggers: ServiceWakeUpTrigger[] = [
      new HomeAssistantWakeUpTrigger(config.ha, config.wakeTimeoutMs, logger),
      new ShellCommandWakeUpTrigger(config.shell, config.wakeTimeoutMs, logger),
    ];
    this.enabledTriggers = allTriggers.filter((t) => t.enabled);
  }

  async triggerWake(): Promise<void> {
    if (this.enabledTriggers.length === 0) {
      this.log.warn(
        "no wake service configured - skipping (set Home Assistant or WAKE_SHELL_COMMAND).",
      );
      return;
    }

    this.log.info(`triggering wake via ${this.enabledTriggers.map((t) => t.name).join(", ")}`);
    const results = await Promise.allSettled(this.enabledTriggers.map((t) => t.triggerWake()));

    const failures: string[] = [];
    for (const [index, result] of results.entries()) {
      if (result.status !== "rejected") continue;

      const name = this.enabledTriggers[index]!.name;
      const message = (result.reason as Error)?.message ?? String(result.reason);
      this.log.error(`${name} failed: ${message}`);
      failures.push(`${name}: ${message}`);
    }

    // Only surface an error if every trigger failed, so the caller can retry.
    if (failures.length === this.enabledTriggers.length) {
      throw new Error(`all wake services failed - ${failures.join("; ")}`);
    }
  }
}
