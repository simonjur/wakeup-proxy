// Common contract every wake service implements. A trigger knows whether it is
// configured (`enabled`) and how to fire its wake action (`triggerWake`).

export interface ServiceWakeUpTrigger {
  // Human-readable name used in logs, e.g. "home-assistant" or "shell-command".
  readonly name: string;

  // True when the service has enough configuration to actually fire.
  readonly enabled: boolean;

  // Fire the wake action. Rejects if the wake could not be requested.
  triggerWake(): Promise<void>;
}
