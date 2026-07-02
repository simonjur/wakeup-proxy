// Wakes the upstream by running a shell command configured via
// WAKE_SHELL_COMMAND, e.g. `etherwake AA:BB:CC:DD:EE:FF` or a custom script.

import { execFile } from "node:child_process";

import type { ShellCommandConfig } from "../config.ts";
import type { Logger } from "../logger.ts";
import type { ServiceWakeUpTrigger } from "../wake-trigger.ts";

export class ShellCommandWakeUpTrigger implements ServiceWakeUpTrigger {
  private readonly shell: ShellCommandConfig;
  private readonly timeoutMs: number;
  private readonly log: Logger;
  readonly name = "shell-command";

  constructor(shell: ShellCommandConfig, timeoutMs: number, logger: Logger) {
    this.shell = shell;
    this.timeoutMs = timeoutMs;
    this.log = logger.child({ component: this.name });
  }

  get enabled(): boolean {
    return this.shell.enabled;
  }

  async triggerWake(): Promise<void> {
    const command = this.shell.command;
    if (!command) {
      throw new Error("WAKE_SHELL_COMMAND is not configured");
    }

    this.log.debug(`running: ${command}`);
    await new Promise<void>((resolve, reject) => {
      // Run through the system shell so pipes/args in the command work as written.
      execFile("/bin/sh", ["-c", command], { timeout: this.timeoutMs }, (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr || stdout || error.message).toString().trim();
          reject(new Error(`shell command failed: ${detail}`));
          return;
        }
        this.log.info("shell command ran");
        resolve();
      });
    });
  }
}
