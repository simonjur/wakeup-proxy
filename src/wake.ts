// Aggregates the configured wake services behind a single triggerWake().
// Every enabled ServiceWakeUpTrigger is fired; the wake counts as successful as
// long as at least one trigger succeeds.

import { homeAssistantTrigger } from "./wake-up-services/homeassistant.ts";
import { shellCommandTrigger } from "./wake-up-services/shell-command.ts";
import type { ServiceWakeUpTrigger } from "./wake-trigger.ts";

const allTriggers: ServiceWakeUpTrigger[] = [homeAssistantTrigger, shellCommandTrigger];

export const enabledTriggers: ServiceWakeUpTrigger[] = allTriggers.filter((t) => t.enabled);

export async function triggerWake(): Promise<void> {
  if (enabledTriggers.length === 0) {
    console.warn(
      "[wake] no wake service configured - skipping (set Home Assistant or WAKE_SHELL_COMMAND).",
    );
    return;
  }

  const results = await Promise.allSettled(enabledTriggers.map((t) => t.triggerWake()));

  const failures: string[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status !== "rejected") continue;

    const name = enabledTriggers[index]!.name;
    const message = (result.reason as Error)?.message ?? String(result.reason);
    console.error(`[wake] ${name} failed: ${message}`);
    failures.push(`${name}: ${message}`);
  }

  // Only surface an error if every trigger failed, so the caller can retry.
  if (failures.length === enabledTriggers.length) {
    throw new Error(`all wake services failed - ${failures.join("; ")}`);
  }
}
