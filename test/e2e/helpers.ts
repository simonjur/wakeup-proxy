// Shared plumbing for the end-to-end tests: finding free ports and waiting for
// a spawned process to log a particular line.

import type { ChildProcess } from "node:child_process";
import net from "node:net";

// Ask the OS for a currently-free TCP port on loopback.
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

// Resolve once the child's stdout/stderr has emitted a line matching `needle`.
export function waitForLog(child: ChildProcess, needle: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for "${needle}"\n--- output ---\n${buffer}`));
    }, timeoutMs);

    function onData(chunk: Buffer): void {
      buffer += chunk.toString();
      if (buffer.includes(needle)) {
        cleanup();
        resolve();
      }
    }
    function onExit(code: number | null): void {
      cleanup();
      reject(new Error(`process exited (code ${code}) before "${needle}"\n${buffer}`));
    }
    function cleanup(): void {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
    }

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", onExit);
  });
}
