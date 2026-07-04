import { execFile } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { ShellCommandConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import { ShellCommandWakeUpTrigger } from "../../wake-up-services/shell-command.ts";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
const execFileMock = vi.mocked(execFile) as unknown as Mock;

// The subset of execFile's callback the trigger relies on.
type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

// Drive the mocked execFile by invoking its callback (always the last argument),
// simulating a completed child process.
function whenExecuted(behavior: (cb: ExecFileCallback) => void): void {
  execFileMock.mockImplementation((...callArgs: unknown[]) => {
    const cb = callArgs.at(-1) as ExecFileCallback;
    behavior(cb);
  });
}

// Minimal Logger stand-in: .child() returns something with the level methods the
// trigger uses. We don't assert on log output, only that construction works.
function fakeLogger(): Logger {
  const logger = {
    child: () => logger,
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger as unknown as Logger;
}

function shellConfig(overrides: Partial<ShellCommandConfig> = {}): ShellCommandConfig {
  return { enabled: true, ...overrides };
}

function makeTrigger(overrides: Partial<ShellCommandConfig> = {}, timeoutMs = 5000) {
  return new ShellCommandWakeUpTrigger(shellConfig(overrides), timeoutMs, fakeLogger());
}

describe("ShellCommandWakeUpTrigger", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes a stable name and reflects the configured enabled flag", () => {
    expect(makeTrigger().name).toBe("shell-command");
    expect(makeTrigger({ enabled: true }).enabled).toBe(true);
    expect(makeTrigger({ enabled: false }).enabled).toBe(false);
  });

  it("runs the command via /bin/sh -c with the configured timeout and resolves", async () => {
    whenExecuted((cb) => cb(null, "", ""));

    const trigger = makeTrigger({ command: "etherwake AA:BB:CC:DD:EE:FF" }, 1234);
    await expect(trigger.triggerWake()).resolves.toBeUndefined();

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFileMock.mock.calls[0]!;
    expect(file).toBe("/bin/sh");
    expect(args).toEqual(["-c", "etherwake AA:BB:CC:DD:EE:FF"]);
    expect(options).toMatchObject({ timeout: 1234 });
  });

  it("throws without running anything when no command is configured", async () => {
    const trigger = makeTrigger({ command: undefined });
    await expect(trigger.triggerWake()).rejects.toThrow(/WAKE_SHELL_COMMAND is not configured/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("rejects with stderr detail when the command fails", async () => {
    whenExecuted((cb) => cb(new Error("exit 1"), "", "boom on stderr\n"));

    const trigger = makeTrigger({ command: "false" });
    await expect(trigger.triggerWake()).rejects.toThrow(/shell command failed: boom on stderr/);
  });

  it("falls back to stdout when stderr is empty", async () => {
    whenExecuted((cb) => cb(new Error("exit 2"), "info on stdout\n", ""));

    const trigger = makeTrigger({ command: "somecmd" });
    await expect(trigger.triggerWake()).rejects.toThrow(/shell command failed: info on stdout/);
  });

  it("falls back to the error message when there is no output (e.g. timeout)", async () => {
    whenExecuted((cb) => cb(new Error("Command failed: timed out"), "", ""));

    const trigger = makeTrigger({ command: "sleep 999" });
    await expect(trigger.triggerWake()).rejects.toThrow(/shell command failed: Command failed/);
  });
});
