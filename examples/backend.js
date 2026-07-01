// Tiny stand-in "upstream" for the shell-command wake example.
// The proxy's WAKE_SHELL_COMMAND launches this; once it's listening the proxy
// health check passes and requests get proxied through to it.

import http from "node:http";

const PORT = 8080;

const server = http.createServer((_request, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("I'm alive!\n");
});

server.listen(PORT, "127.0.0.1", () => {
  // Printed to the container's stdout so you see it in `docker compose logs`.
  console.log("I'm alive!");
});
