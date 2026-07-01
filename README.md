# immich-wake-proxy

A tiny reverse proxy for a sleeping Immich server. Runs on an always-on box
(your Pi, server B); Immich lives on a powerful box that suspends to save power
(server A).

- **Immich up** → transparently reverse-proxies everything to it (HTTP + the
  socket.io websockets Immich needs), URL unchanged.
- **Immich down** → fires a wake action via Home Assistant and serves a
  self-refreshing waiting page. The page polls a status endpoint and reloads
  into Immich the moment it answers.

No build step: Node 24+ runs the TypeScript directly.

## Requirements

- Node.js **24+** (native TypeScript). Or use the Docker image.

## Run

```bash
cp .env.example .env   # edit it
npm install            # only http-proxy-3 at runtime
npm start              # = node src/server.ts
```

Then point your browser / external reverse proxy / Tailscale at the Pi on
`PORT` (default 3000) instead of at Immich directly.

`npm run typecheck` runs `tsc --noEmit`. `npm run dev` watches and restarts.

## Configuration

All via env vars (see `.env.example`). Key ones:

| Var                  | Default            | Notes                                                                         |
| -------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `IMMICH_URL`         | – (required)       | e.g. `http://192.168.1.10:2283`                                               |
| `IMMICH_HEALTH_PATH` | `/api/server/ping` | treated as up on any non-5xx response                                         |
| `PORT` / `HOST`      | `3000` / `0.0.0.0` | proxy listen address                                                          |
| `WAKE_COOLDOWN_MS`   | `60000`            | min gap between wake calls; also the WoL re-send interval while still booting |
| `POLL_INTERVAL_MS`   | `3000`             | waiting-page poll cadence                                                     |

### Wake action

Wake is handled by pluggable services that all implement a common
`ServiceWakeUpTrigger` interface (`triggerWake()`). Any number can be enabled at
once — every configured service is fired on wake, and the wake succeeds as long
as at least one of them does. Two are built in:

#### Home Assistant

Either a **webhook** (no auth) or a **service call** (long-lived token). If
`HA_WAKE_WEBHOOK_URL` is set it wins.

**Service call — run a script:**

```
HA_BASE_URL=http://homeassistant.local:8123
HA_TOKEN=<long-lived-access-token>
HA_WAKE_SERVICE=script.turn_on
HA_WAKE_ENTITY_ID=script.wake_immich_server
```

**Service call — direct Wake-on-LAN** (needs HA's `wake_on_lan` integration):

```
HA_BASE_URL=http://homeassistant.local:8123
HA_TOKEN=<long-lived-access-token>
HA_WAKE_SERVICE=wake_on_lan.send_magic_packet
HA_WAKE_DATA={"mac":"AA:BB:CC:DD:EE:FF"}
```

The body sent is `{entity_id: HA_WAKE_ENTITY_ID, ...HA_WAKE_DATA}`. Leave
`HA_WAKE_ENTITY_ID` empty for service calls that don't take an entity (like WoL).

#### Shell command

Runs an arbitrary command via `/bin/sh -c` (subject to `WAKE_TIMEOUT_MS`):

```
WAKE_SHELL_COMMAND=etherwake AA:BB:CC:DD:EE:FF
```

If no wake service is configured the proxy still runs and shows the waiting
page — the wake just becomes a logged no-op, handy for wiring things up
incrementally.

## Docker

```bash
docker compose up -d --build
```

The `node:24-slim` base is multi-arch, so it builds on the Pi (arm64).

## systemd (bare metal)

`/etc/systemd/system/immich-wake-proxy.service`:

```ini
[Unit]
Description=Immich wake proxy
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/immich-wake-proxy
EnvironmentFile=/opt/immich-wake-proxy/.env
ExecStart=/usr/bin/node src/server.ts
Restart=on-failure
RestartSec=2
User=immich-proxy

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now immich-wake-proxy
```

## Notes

- Endpoints `/__wake/status` are internal; everything else is proxied verbatim.
- The proxy preserves the `Host` header and adds `X-Forwarded-For/-Host/-Proto`,
  matching the standard "Immich behind a reverse proxy" setup.
- This only **wakes** server A. Putting it back to sleep when idle is out of
  scope — handle that on server A itself (e.g. an autosuspend timer that checks
  for active Immich sessions / connections).
