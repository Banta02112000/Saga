#!/usr/bin/env node
/* Saga website server. No extra packages: Node 18 or newer.
   Serves the Saga app to a browser, keeps its files in DATA (one file each, like on the phone), passes the app's
   calls to Trakt, TMDB, IMDb and the AI services on (a browser can't make them itself), and opens .zip exports.
   Two listeners, both on 127.0.0.1 only:
   - SAGA_PORT (8787) for `tailscale serve`: people on your tailnet are let in (Tailscale says who they are);
   - SAGA_PUBLIC_PORT (8788) for a public tunnel (Cloudflare Tunnel, Caddy…): always needs the password or the sync key.
   With a password set (data/auth.json), the tailnet port asks for it too unless SAGA_TRUST_TAILSCALE=1.
   Settings (environment): SAGA_PORT, SAGA_PUBLIC_PORT, SAGA_HOST (127.0.0.1), SAGA_DATA (./data), SAGA_WEB (./web), SAGA_TRUST_TAILSCALE.
   Set or change the password:  node server.js --set-password   (prints the sync key for the phone app too) */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), zlib = require("zlib"), crypto = require("crypto");
const { mergeText } = require("./merge.js");
const PORT = +(process.env.SAGA_PORT || 8787), HOST = process.env.SAGA_HOST || "127.0.0.1";
const PUBLIC_PORT = +(process.env.SAGA_PUBLIC_PORT || 8788), TRUST_TS = process.env.SAGA_TRUST_TAILSCALE !== "0";
const DATA = path.resolve(process.env.SAGA_DATA || path.join(__dirname, "data"));
const WEB = path.resolve(process.env.SAGA_WEB || path.join(__dirname, "web"));
const SHIM = fs.readFileSync(path.join(__dirname, "web-shim.js"));
const KEEP_DAYS = 7, MAX_BODY = 200 * 1024 * 1024;
fs.mkdirSync(path.join(DATA, ".daily"), { recursive: true });
fs.mkdirSync(path.join(DATA, ".sync"), { recursive: true });
const SYNC_FILES = ["canonsync.json", "library.json", "games.json", "books.json", "dw.json"];

// ---- sign-in: a password (scrypt), a sync key for the phone app, a secret for session cookies (data/auth.json)
const AUTH_FILE = path.join(DATA, "auth.json");
const loadAuth = () => { try { return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")); } catch (e) { return null; } };
let AUTH = loadAuth(), authAt = 0;
// a password changed with --set-password while the server runs is picked up at the next request
function freshAuth() { try { const m = fs.statSync(AUTH_FILE).mtimeMs; if (m !== authAt) { authAt = m; AUTH = loadAuth(); } } catch (e) { if (authAt) { authAt = 0; AUTH = null; } } }
function setPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const a = { salt, hash: crypto.scryptSync(pw, salt, 64).toString("hex"), token: (AUTH && AUTH.token) || crypto.randomBytes(24).toString("base64url"), secret: crypto.randomBytes(32).toString("hex") };
  fs.writeFileSync(AUTH_FILE, JSON.stringify(a, null, 1), { mode: 0o600 }); fs.chmodSync(AUTH_FILE, 0o600);
  AUTH = a; return a;
}
const eqSafe = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const checkPassword = pw => !!(AUTH && AUTH.hash && eqSafe(crypto.scryptSync(String(pw || ""), AUTH.salt, 64).toString("hex"), AUTH.hash));
const DAY = 864e5, SESSION_DAYS = 30;
const sign = v => crypto.createHmac("sha256", AUTH.secret).update(v).digest("base64url");
const newSession = () => { const exp = String(Date.now() + SESSION_DAYS * DAY); return exp + "." + sign(exp); };
const validSession = c => { if (!AUTH || !c) return false; const [exp, sig] = String(c).split("."); return !!sig && +exp > Date.now() && eqSafe(sign(exp), sig); };
const cookieOf = (req, name) => { for (const p of String(req.headers.cookie || "").split(/;\s*/)) { const i = p.indexOf("="); if (i > 0 && p.slice(0, i) === name) return decodeURIComponent(p.slice(i + 1)); } return ""; };
// who may in: the phone's sync key, a signed-in browser, or (on the tailnet port) someone Tailscale vouches for
function allowed(req, isPublic) {
  if (!AUTH) return !isPublic; // no password set: the tailnet port works as before, the public port stays shut
  const h = String(req.headers.authorization || "");
  if (h.startsWith("Bearer ") && eqSafe(h.slice(7).trim(), AUTH.token)) return true;
  if (validSession(cookieOf(req, "saga_session"))) return true;
  if (!isPublic && TRUST_TS && req.headers["tailscale-user-login"]) return true;
  return false;
}
// a few wrong passwords per address, then a pause
const tries = new Map();
const clientIp = req => String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
function limited(ip) { const t = tries.get(ip); if (!t) return false; if (Date.now() - t.first > 15 * 60e3) { tries.delete(ip); return false; } return t.n >= 5; }
function failed(ip) { const t = tries.get(ip) || { n: 0, first: Date.now() }; t.n++; tries.set(ip, t); }
const LOGIN = msg => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saga · sign in</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#0d1117;color:#e6edf3;display:grid;place-items:center;min-height:100dvh;margin:0}form{background:#161b22;border:1px solid #30363d;border-radius:16px;padding:28px;width:min(340px,88vw)}h1{font-size:22px;margin:0 0 16px}input{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #30363d;background:#0d1117;color:inherit;font:inherit}button{margin-top:14px;width:100%;padding:12px;border-radius:10px;border:0;background:#6d8bff;color:#fff;font:600 16px system-ui}p{color:#f0883e;font-size:14px;margin:10px 0 0}</style></head>
<body><form method="post" action="api/auth/login"><h1>Saga</h1><input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required><button>Sign in</button>${msg ? `<p>${msg}</p>` : ""}</form></body></html>`;

// ---- the last version each file had when the phone and the server agreed (the base of the next merge)
const basePath = n => path.join(DATA, ".sync", n);
const sha = t => crypto.createHash("sha256").update(t || "").digest("hex");
// texts the website was given, by hash, so a save from an older page can be merged instead of overwriting
const served = new Map();
function remember(n, t) { const h = sha(t); let m = served.get(n); if (!m) served.set(n, m = new Map()); m.set(h, t); while (m.size > 4) m.delete(m.keys().next().value); return h; }
// open website pages are told when a file changes (Server-Sent Events)
const listeners = new Set();
function announce(files, from) { const msg = `data: ${JSON.stringify({ files, from })}\n\n`; for (const r of listeners) { try { r.write(msg); } catch (e) { listeners.delete(r); } } }
setInterval(() => { for (const r of listeners) { try { r.write(": ping\n\n"); } catch (e) { listeners.delete(r); } } }, 25000).unref();

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

const handler = isPublic => async (req, res) => {
  try {
    freshAuth();
    const url = new URL(req.url, "http://x"), p = decodeURIComponent(url.pathname);
    // ---- signing in (the only pages open without it)
    if (p === "/login" && req.method === "GET") return send(res, 200, LOGIN(AUTH ? "" : "No password is set yet: on the server run  node server.js --set-password"), "text/html; charset=utf-8");
    if (p === "/api/auth/login" && req.method === "POST") {
      const ip = clientIp(req);
      if (limited(ip)) return send(res, 429, LOGIN("Too many tries. Wait 15 minutes."), "text/html; charset=utf-8");
      const body = (await readBody(req, 8192)).toString("utf8");
      const pw = /^\s*\{/.test(body) ? (JSON.parse(body).password || "") : new URLSearchParams(body).get("password") || "";
      if (!checkPassword(pw)) { failed(ip); return send(res, 401, LOGIN("Wrong password."), "text/html; charset=utf-8"); }
      tries.delete(ip);
      res.writeHead(303, { Location: "./", "Set-Cookie": `saga_session=${newSession()}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}`, "Cache-Control": "no-store" });
      return res.end();
    }
    if (p === "/api/auth/logout") { res.writeHead(303, { Location: "login", "Set-Cookie": "saga_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0" }); return res.end(); }
    if (p === "/api/health") return send(res, 200, JSON.stringify({ ok: true, auth: !!AUTH }));
    if (!allowed(req, isPublic)) {
      if (p.startsWith("/api/")) return send(res, 401, '{"error":"sign in"}');
      res.writeHead(302, { Location: "login" }); return res.end();
    }
    if (p.startsWith("/api/")) {
      if (p === "/api/all" && req.method === "GET") {
        const out = {};
        for (const n of fs.readdirSync(DATA)) if (safe(n) && n !== "auth.json" && fs.statSync(path.join(DATA, n)).isFile()) { out[n] = fs.readFileSync(path.join(DATA, n), "utf8"); remember(n, out[n]); }
        res.setHeader("X-Sha", JSON.stringify(Object.fromEntries(Object.keys(out).filter(n => SYNC_FILES.includes(n)).map(n => [n, sha(out[n])]))));
        return send(res, 200, JSON.stringify(out));
      }
      if (p === "/api/events" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        res.write(": hello\n\n"); listeners.add(res); req.on("close", () => listeners.delete(res)); return;
      }
      // ---- the phone app: which files changed here, and one file merged with the phone's version
      if (p === "/api/sync/manifest" && req.method === "GET") {
        const files = {};
        for (const n of SYNC_FILES) { const f = path.join(DATA, n); if (fs.existsSync(f)) { const t = fs.readFileSync(f, "utf8"); const st = fs.statSync(f); files[n] = { mtime: st.mtimeMs, size: st.size, sha256: sha(t) }; } }
        return send(res, 200, JSON.stringify({ files, serverTime: Date.now() }));
      }
      if (p.startsWith("/api/sync/file/") && req.method === "POST") {
        const n = safe(p.slice(15));
        if (!n || !SYNC_FILES.includes(n)) return send(res, 400, '{"error":"not a synced file"}');
        const mine = (await readBody(req)).toString("utf8");
        const f = path.join(DATA, n), theirs = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
        const base = fs.existsSync(basePath(n)) ? fs.readFileSync(basePath(n), "utf8") : "";
        const merged = mergeText(n, base, mine, theirs);
        if (merged !== theirs) { writeAtomic(n, Buffer.from(merged)); announce([n], "phone"); }
        fs.writeFileSync(basePath(n), merged);
        return send(res, 200, JSON.stringify({ text: merged, sha256: sha(merged), changedHere: merged !== mine }));
      }
      if (p.startsWith("/api/file/")) {
        const n = safe(p.slice(10));
        if (!n || n === "auth.json") return send(res, 400, '{"error":"bad name"}');
        if (req.method === "PUT") {
          let body = await readBody(req);
          // a page that loaded an older version of a synced file: merged with what's there now, not overwritten
          const baseSha = String(req.headers["x-base-sha"] || ""), f = path.join(DATA, n);
          if (SYNC_FILES.includes(n) && baseSha && fs.existsSync(f)) {
            const cur = fs.readFileSync(f, "utf8"), curSha = sha(cur);
            if (curSha !== baseSha) {
              const baseText = (served.get(n) || new Map()).get(baseSha);
              if (baseText != null) { const m = mergeText(n, baseText, body.toString("utf8"), cur); writeAtomic(n, Buffer.from(m)); return send(res, 200, JSON.stringify({ merged: true, text: m, sha256: remember(n, m) })); }
              return send(res, 409, JSON.stringify({ error: "changed elsewhere", text: cur, sha256: remember(n, cur) }));
            }
          }
          writeAtomic(n, body);
          const h = remember(n, body.toString("utf8"));
          if (SYNC_FILES.includes(n)) announce([n], String(req.headers["x-tab"] || "web"));
          return send(res, 200, JSON.stringify({ sha256: h }));
        }
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
};
if (process.argv.includes("--set-password")) {
  const i = process.argv.indexOf("--set-password"), given = process.argv[i + 1];
  const done = pw => { if (!pw || pw.length < 8) { console.error("At least 8 characters."); process.exit(1); } const a = setPassword(pw);
    console.log("Password set. Sync key for the phone app (Settings › Accounts and sync › Saga website):\n  " + a.token); process.exit(0); };
  if (given) done(given);
  else { process.stdout.write("New password: "); let buf = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", d => { buf += d; if (buf.includes("\n")) done(buf.trim()); }); }
} else {
  http.createServer(handler(false)).listen(PORT, HOST, () => console.log(`Saga website on http://${HOST}:${PORT} for your tailnet (files in ${DATA})`));
  if (PUBLIC_PORT) http.createServer(handler(true)).listen(PUBLIC_PORT, HOST, () => console.log(`Public entrance on http://${HOST}:${PUBLIC_PORT}: ${AUTH ? "password needed" : "closed until a password is set"}`));
}
