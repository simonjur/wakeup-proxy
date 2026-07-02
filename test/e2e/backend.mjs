// Tiny stand-in "upstream" for the shell-command wake e2e test.
//
// The proxy's WAKE_SHELL_COMMAND launches this on demand. Once it's listening,
// the proxy's health check passes and requests get proxied through to it. It
// serves a minimal HTML page so a browser renders "I'm alive!" on screen.
//
// Usage: node backend.mjs <port>

import http from "node:http";

const port = Number(process.argv[2]);
if (!Number.isSafeInteger(port) || port <= 0) {
  console.error(`backend: invalid port ${process.argv[2]}`);
  process.exit(1);
}

const server = http.createServer((_request, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      "<title>alive</title></head><body><h1>I'm alive!</h1></body></html>\n",
  );
});

// Simulate a real upstream that takes a moment to boot after being woken, so the
// test actually exercises the waiting page's poll-and-reload loop.
const bootDelayMs = 1000 + Math.floor(Math.random() * 4000);
console.log(`backend: booting in ${bootDelayMs}ms…`);
setTimeout(() => {
  server.listen(port, "127.0.0.1", () => {
    // Printed so the test (and a human tailing logs) can see it came up.
    console.log(`I'm alive! listening on 127.0.0.1:${port}`);
  });
}, bootDelayMs);
