// Zero-dependency static server + proxy for laya-serve.
// Needed because laya-serve does not send CORS headers, so browsers
// cannot call it directly from another origin.
// Requests to /api/<path> are forwarded to <backend>/<path>, where <backend> is the
// X-Backend request header (set from the URL field in the page header) or LAYA_BASE.
//
//   node server.mjs            -> http://localhost:8000
//   PORT=9000 LAYA_BASE=http://... node server.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8000);
const LAYA_BASE = process.env.LAYA_BASE || "http://localhost:8100";
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const MAX_BODY = 1_000_000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new Error("Body too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/** Backend chosen in the UI (X-Backend header), falling back to LAYA_BASE. Only http(s) origins. */
function backendFor(req) {
  const raw = req.headers["x-backend"];
  if (!raw) return LAYA_BASE;
  try {
    const u = new URL(raw);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
}

async function proxy(req, res) {
  // Only forward the known laya-serve paths.
  const path = new URL(req.url, "http://x").pathname.slice("/api".length);
  if (!/^\/(health|v1\/systemone(\/batch)?)$/.test(path)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = req.method === "POST" ? await readBody(req) : undefined;
    const base = backendFor(req);
    if (!base) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "Invalid backend URL, expected http(s)://host:port" }));
      return;
    }
    const upstream = await fetch(base + path, {
      method: req.method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body,
      signal: AbortSignal.timeout(90_000),
    });
    res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json" });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: `Proxy error: ${err.message}` }));
  }
}

async function serveStatic(req, res) {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = normalize(join(ROOT, path === "/" ? "index.html" : path));
  if (!file.startsWith(ROOT) || file.endsWith(".mjs") || file.endsWith(".md")) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

createServer((req, res) => {
  if (req.url.startsWith("/api/")) return proxy(req, res);
  if (req.method !== "GET") return res.writeHead(405).end();
  return serveStatic(req, res);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Laya UI on http://localhost:${PORT}  ->  proxying ${LAYA_BASE}`);
});
