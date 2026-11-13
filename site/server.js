#!/usr/bin/env node
/* Saga website server. No extra packages: Node 18 or newer.
   Serves the Saga app to a browser, keeps its files in DATA (one file each, like on the phone), passes the app's
   calls to Trakt, TMDB, IMDb and the AI services on (a browser can't make them itself), and opens .zip exports.
   Listens on 127.0.0.1 only: `tailscale serve` puts it on your tailnet with HTTPS. Nothing is reachable from the internet.
   Settings (environment): SAGA_PORT (8787), SAGA_HOST (127.0.0.1), SAGA_DATA (./data), SAGA_WEB (./web). */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), zlib = require("zlib");
const PORT = +(process.env.SAGA_PORT || 8787), HOST = process.env.SAGA_HOST || "127.0.0.1";
const DATA = path.resolve(process.env.SAGA_DATA || path.join(__dirname, "data"));
const WEB = path.resolve(process.env.SAGA_WEB || path.join(__dirname, "web"));
const SHIM = fs.readFileSync(path.join(__dirname, "web-shim.js"));
const KEEP_DAYS = 7, MAX_BODY = 200 * 1024 * 1024;
fs.mkdirSync(path.join(DATA, ".daily"), { recursive: true });

const safe = n => /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(n) && !n.endsWith(".tmp") ? n : null;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

function readBody(req, limit = MAX_BODY) {
  return new Promise((res, rej) => {
    const parts = []; let n = 0;
    req.on("data", c => { n += c.length; if (n > limit) { rej(new Error("too large")); req.destroy(); } else parts.push(c); });
    req.on("end", () => res(Buffer.concat(parts)));
    req.on("error", rej);
  });
}
const send = (res, code, body, type = "application/json") => { res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); res.end(body); };

// ---- a copy of each file as it was at the start of the day, kept for a week (in DATA/.daily)
function daily(name) {
  const day = new Date().toISOString().slice(0, 10), dir = path.join(DATA, ".daily", day), src = path.join(DATA, name), dst = path.join(dir, name);
  try { if (!fs.existsSync(dst) && fs.existsSync(src)) { fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(src, dst); } } catch (e) { /* best effort */ }
}
function prune() {
  try {
    const cut = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
    for (const d of fs.readdirSync(path.join(DATA, ".daily"))) if (d < cut) fs.rmSync(path.join(DATA, ".daily", d), { recursive: true, force: true });
  } catch (e) { /* best effort */ }
}
setInterval(prune, 6 * 3600e3).unref(); prune();

function writeAtomic(name, buf) {
  daily(name);
  const f = path.join(DATA, name), tmp = f + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, buf); fs.renameSync(tmp, f);
}

// ---- a .zip export opened: text entries come back as text (the same shape the phone app gives)
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const zip = {}, other = []; let total = 0;
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("damaged zip");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/")) continue;
    if (!/\.(json|csv|txt|tsv|xml)$/i.test(name)) { other.push(name); continue; }
    const lstart = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(lstart, lstart + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) { other.push(name); continue; }
    total += data.length; if (total > 400 * 1024 * 1024) throw new Error("zip too large");
    zip[name] = data.toString("utf8");
  }
  return { zip, other };
}

// ---- the app's calls to other sites. HTTPS only, except your own tailnet (.ts.net) and this machine (a local AI server).
async function passOn(spec) {
  let u;
  try { u = new URL(spec.url); } catch (e) { return { status: 0, headers: {}, body: "", error: "bad address" }; }
  const local = /\.ts\.net$/i.test(u.hostname) || u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return { status: 0, headers: {}, body: "", error: "HTTPS only" };
  const headers = Object.assign({}, spec.headers || {});
  for (const h of Object.keys(headers)) if (/^(host|content-length|connection|accept-encoding)$/i.test(h)) delete headers[h];
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), local ? 600e3 : 120e3);
  try {
    const m = String(spec.method || "GET").toUpperCase();
    const r = await fetch(u, { method: m, headers, body: m === "GET" || m === "HEAD" ? undefined : spec.body || "", redirect: "follow", signal: ctl.signal });
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    return { status: r.status, headers: h, body: await r.text() };
  } catch (e) {
    return { status: 0, headers: {}, body: "", error: e.name === "AbortError" ? "timed out" : String(e.cause && e.cause.code || e.message) };
  } finally { clearTimeout(timer); }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x"), p = decodeURIComponent(url.pathname);
    if (p.startsWith("/api/")) {
      if (p === "/api/all" && req.method === "GET") {
        const out = {};
        for (const n of fs.readdirSync(DATA)) if (safe(n) && fs.statSync(path.join(DATA, n)).isFile()) out[n] = fs.readFileSync(path.join(DATA, n), "utf8");
        return send(res, 200, JSON.stringify(out));
      }
      if (p.startsWith("/api/file/")) {
        const n = safe(p.slice(10));
        if (!n) return send(res, 400, '{"error":"bad name"}');
        if (req.method === "PUT") { writeAtomic(n, await readBody(req)); return send(res, 200, "{}"); }
        if (req.method === "POST") { daily(n); fs.appendFileSync(path.join(DATA, n), await readBody(req)); return send(res, 200, "{}"); }
        if (req.method === "DELETE") { daily(n); fs.rmSync(path.join(DATA, n), { force: true }); return send(res, 200, "{}"); }
        if (req.method === "GET") { const f = path.join(DATA, n); return send(res, 200, fs.existsSync(f) ? fs.readFileSync(f) : "", "text/plain; charset=utf-8"); }
      }
      if (p === "/api/http" && req.method === "POST") return send(res, 200, JSON.stringify(await passOn(JSON.parse((await readBody(req, 50 * 1024 * 1024)).toString("utf8")))));
      if (p === "/api/unzip" && req.method === "POST") { try { return send(res, 200, JSON.stringify(unzip(await readBody(req)))); } catch (e) { return send(res, 200, JSON.stringify({ error: e.message })); } }
      if (p === "/api/health") return send(res, 200, JSON.stringify({ ok: true, data: DATA }));
      return send(res, 404, '{"error":"not found"}');
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "", "text/plain");
    if (p === "/web-shim.js") return send(res, 200, SHIM, TYPES[".js"]);
    const rel = p === "/" ? "index.html" : p.replace(/^\/+/, "");
    const f = path.resolve(WEB, rel);
    if (!f.startsWith(WEB + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return send(res, 404, "Not found", "text/plain");
    let body = fs.readFileSync(f);
    if (rel === "index.html") body = Buffer.from(body.toString("utf8").replace(/<script src="boot\.js"><\/script>/, '<script src="web-shim.js"></script><script src="boot.js"></script>'));
    send(res, 200, body, TYPES[path.extname(f).toLowerCase()] || "application/octet-stream");
  } catch (e) {
    console.error(new Date().toISOString(), req.method, req.url, e);
    if (!res.headersSent) send(res, 500, JSON.stringify({ error: e.message }));
  }
});
server.listen(PORT, HOST, () => console.log(`Saga website on http://${HOST}:${PORT}  (files in ${DATA})`));
