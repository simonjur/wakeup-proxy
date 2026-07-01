# Example: shell-command wake

A self-contained manual test of the `shell-command` wake service. No Home
Assistant, no real Immich — just the proxy and a tiny "I'm alive!" server that
the wake command starts on demand.

## What happens

1. The proxy boots with its upstream **down** (`backend.js` isn't running yet).
2. You open the proxy in a browser → it shows the **waiting page** and fires
   `WAKE_SHELL_COMMAND`.
3. That command launches `backend.js` inside the proxy container. The server
   logs **`I'm alive!`** and starts serving on `127.0.0.1:8080`.
4. The waiting page polls, sees the upstream is now up, and reloads — the
   browser shows **`I'm alive!`** proxied from the backend.

## Run

```bash
cd examples
docker compose up --build
```

Then:

- Open <http://localhost:3000> — you'll first see the waiting page.
- Watch this terminal: you'll see `[wake] shell command ran` followed by
  `I'm alive!`.
- Within a couple of seconds the page reloads into the backend's `I'm alive!`.

Stop with `Ctrl-C`, then `docker compose down` to clean up.

## Notes

- The wake command runs via `/bin/sh -c` (as all shell wakes do). The
  `>/proc/1/fd/1 2>&1 &` part backgrounds the server and routes its output to the
  container's stdout so you can see it in `docker compose logs`.
- `WAKE_COOLDOWN_MS` is lowered to 10s so you can re-trigger the flow quickly
  (e.g. after `docker compose restart`).
