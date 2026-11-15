// Tiny static file server used only to rasterise the architecture board.
// A headless browser will not read file:// for this — the board has to come over http, so this exists and
// scripts/fit-board.mjs measures and renders against it. Nothing else in the project uses it.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = normalize(join(process.cwd(), "docs", "architecture"));
const PORT = Number(process.argv[2] || 8731);
const TYPES = { ".svg": "image/svg+xml", ".html": "text/html; charset=utf-8", ".png": "image/png" };

const server = createServer(async (req, res) => {
  try {
    const clean = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    if (!clean || clean.includes("..")) {
      res.writeHead(400).end("bad request");
      return;
    }
    const file = join(ROOT, clean);
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

// The second start-up on the same port used to end in an unhandled 'error' event and a stack trace, which
// reads like a broken tool when it is only "one is already running". Say which it is.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`port ${PORT} is already serving — a board server is running, or use another port: node scripts/shot-server.mjs 8732`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, "127.0.0.1", () => console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}/`));
