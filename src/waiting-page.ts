// Fully self-contained waiting page (inline CSS + JS, zero external requests so
// it renders even while the upstream is fully asleep). Polls the status
// endpoint and reloads into Immich once it's up.

import { config } from "./config.ts";

const STATUS_PATH = "/__wake/status";

// Minimal HTML-escape so configured title/message can't break out of the markup.
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function waitingPage(): string {
  const title = escapeHtml(config.waiting.title);
  const message = escapeHtml(config.waiting.message);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}…</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100dvh;
    display: grid;
    place-items: center;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: radial-gradient(120% 120% at 50% 0%, #1b2030 0%, #0c0e14 60%, #07080c 100%);
    color: #e7e9ee;
  }
  .card {
    width: min(92vw, 30rem);
    padding: 2.5rem 2rem;
    text-align: center;
  }
  .spinner {
    width: 3.25rem;
    height: 3.25rem;
    margin: 0 auto 1.75rem;
    border-radius: 50%;
    border: 3px solid rgba(255,255,255,0.12);
    border-top-color: #6ea8fe;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .spinner { animation-duration: 2.4s; }
  }
  h1 { font-size: 1.4rem; font-weight: 600; margin: 0 0 0.6rem; letter-spacing: -0.01em; }
  p { margin: 0; color: #9aa3b2; font-size: 0.95rem; line-height: 1.5; }
  .meta { margin-top: 1.5rem; font-size: 0.8rem; color: #677085; font-variant-numeric: tabular-nums; }
  .dot { color: #6ea8fe; }
</style>
</head>
<body>
  <main class="card">
    <div class="spinner" role="status" aria-label="Loading"></div>
    <h1>${title}<span class="dot">…</span></h1>
    <p>${message}</p>
    <p class="meta" id="meta">Elapsed: 0s</p>
  </main>
<script>
  (function () {
    var start = Date.now();
    var pollMs = ${config.pollIntervalMs};
    var meta = document.getElementById("meta");
    var done = false;

    function tick() {
      var s = Math.round((Date.now() - start) / 1000);
      meta.textContent = "Elapsed: " + s + "s";
    }
    setInterval(tick, 1000);

    async function poll() {
      if (done) return;
      try {
        var res = await fetch(${JSON.stringify(STATUS_PATH)}, { cache: "no-store" });
        var data = await res.json();
        if (data && data.status === "up") {
          done = true;
          location.reload();
          return;
        }
      } catch (e) { /* server still down; keep trying */ }
      setTimeout(poll, pollMs);
    }
    setTimeout(poll, pollMs);
  })();
</script>
</body>
</html>`;
}
