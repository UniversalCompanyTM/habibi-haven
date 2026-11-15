// Serves this folder over http so Playwright can rasterise the architecture board.
// Playwright MCP blocks file://, so board.svg is reached at http://127.0.0.1:8731/board.svg
//
//   node habibi-haven-site/docs/architecture/serve-board.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ROOT = import.meta.dirname;
const PORT = Number(process.argv[2] || 8731);
const TYPES = { ".svg": "image/svg+xml", ".html": "text/html; charset=utf-8", ".png": "image/png" };

createServer(async (req, res) => {
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
}).listen(PORT, "127.0.0.1", () => console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}/`));
