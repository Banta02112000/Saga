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
const { mergeText, merge3 } = require("./merge.js");
const J = require("./journal.js"); // 0.7.0: every change, entry by entry
const E = require(path.join(WEB_DIR_FOR_ENTRIES(), "shared", "entries.js"));
function WEB_DIR_FOR_ENTRIES() { for (const d of [process.env.SAGA_WEB, path.join(__dirname, "..", "web"), path.join(__dirname, "web")]) if (d && fs.existsSync(path.join(d, "shared", "entries.js"))) return d; return path.join(__dirname, "web"); }
const JOURNALED = ["canonsync.json", "library.json", "games.json", "books.json", "dw.json", "music.json"];
const hooks = require("./webhooks.js");
const PORT = +(process.env.SAGA_PORT || 8787), HOST = process.env.SAGA_HOST || "127.0.0.1";
const PUBLIC_PORT = +(process.env.SAGA_PUBLIC_PORT || 8788), TRUST_TS = process.env.SAGA_TRUST_TAILSCALE !== "0";
const DATA = path.resolve(process.env.SAGA_DATA || path.join(__dirname, "data"));
const WEB = path.resolve(process.env.SAGA_WEB || path.join(__dirname, "web"));
const SHIM = fs.readFileSync(path.join(__dirname, "web-shim.js"));
// 0.6.8: the version this server runs (the app's own number), so the website can say when the Pi is behind
const APP_VERSION = (() => { try { return (/const VERSION = "([\d.]+)"/.exec(fs.readFileSync(path.join(WEB, "app.js"), "utf8")) || [])[1] || ""; } catch (e) { return ""; } })();
// 0.6.2: installable app (manifest) and the offline copy of the app and its pictures (service worker)
const SW = fs.readFileSync(path.join(__dirname, "sw.js"));
const MANIFEST = JSON.stringify({ name: "Saga", short_name: "Saga", start_url: "./", scope: "./", display: "standalone", background_color: "#14121B", theme_color: "#14121B",
  description: "Films, series, games, books and Doctor Who in one place",
  icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }, { src: "icon-512.png", sizes: "512x512", type: "image/png" }] });
const ICONS = Object.fromEntries(["icon-192.png", "icon-512.png"].filter(n => fs.existsSync(path.join(__dirname, n))).map(n => [n, fs.readFileSync(path.join(__dirname, n))]));
const KEEP_DAYS = 7, MAX_BODY = 200 * 1024 * 1024;
fs.mkdirSync(path.join(DATA, ".daily"), { recursive: true });
fs.mkdirSync(path.join(DATA, ".sync"), { recursive: true });
const SYNC_FILES = ["canonsync.json", "library.json", "games.json", "books.json", "dw.json", "music.json", "keys.json"];

// ---- sign-in: a password (scrypt), a sync key for the phone app, a secret for session cookies (data/auth.json)
const AUTH_FILE = path.join(DATA, "auth.json");
// 0.6.1: several people, each with a password, a sync key and their own files. auth.json:
// { users: { name: { salt, hash, token, tailscale } }, owner, secret }. The owner's files stay in DATA itself
// (as before), everyone else's in DATA/users/<name>/. An older single-user auth.json becomes the owner "me".
const loadAuth = () => {
  let a; try { a = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")); } catch (e) { return null; }
  if (a && a.hash && !a.users) a = { users: { me: { salt: a.salt, hash: a.hash, token: a.token } }, owner: "me", secret: a.secret };
  return a && a.users ? a : null;
};
let AUTH = loadAuth(), authAt = 0;
function freshAuth() { try { const m = fs.statSync(AUTH_FILE).mtimeMs; if (m !== authAt) { authAt = m; AUTH = loadAuth(); } } catch (e) { if (authAt) { authAt = 0; AUTH = null; } } }
const saveAuth = a => { fs.writeFileSync(AUTH_FILE, JSON.stringify(a, null, 1), { mode: 0o600 }); fs.chmodSync(AUTH_FILE, 0o600); AUTH = a; };
const validName = n => /^[a-z0-9][a-z0-9._-]{0,31}$/i.test(n || "");
function setPassword(name, pw) {
  const a = loadAuth() || { users: {}, owner: name, secret: crypto.randomBytes(32).toString("hex") };
  if (!a.owner) a.owner = name;
  const u = a.users[name] || {};
  u.salt = crypto.randomBytes(16).toString("hex"); u.hash = crypto.scryptSync(pw, u.salt, 64).toString("hex"); u.token = u.token || crypto.randomBytes(24).toString("base64url");
  a.users[name] = u; a.secret = a.secret || crypto.randomBytes(32).toString("hex");
  saveAuth(a); return u;
}
const eqSafe = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const checkPassword = (name, pw) => { const u = AUTH && AUTH.users[name]; return !!(u && u.hash && eqSafe(crypto.scryptSync(String(pw || ""), u.salt, 64).toString("hex"), u.hash)); };
const DAY = 864e5, SESSION_DAYS = 30;
const sign = v => crypto.createHmac("sha256", AUTH.secret).update(v).digest("base64url");
const newSession = name => { const v = name + "." + (Date.now() + SESSION_DAYS * DAY); return v + "." + sign(v); };
const sessionUser = c => { if (!AUTH || !c) return null; const p = String(c).split("."); if (p.length < 3) return null; const sig = p.pop(), exp = p.pop(), name = p.join("."), v = name + "." + exp;
  return +exp > Date.now() && eqSafe(sign(v), sig) && AUTH.users[name] ? name : null; };
const cookieOf = (req, name) => { for (const p of String(req.headers.cookie || "").split(/;\s*/)) { const i = p.indexOf("="); if (i > 0 && p.slice(0, i) === name) return decodeURIComponent(p.slice(i + 1)); } return ""; };
// who is asking: the phone's sync key, a signed-in browser, or (on the tailnet port) someone Tailscale vouches for.
// Returns the user's name ("" = the owner without any password set yet), or null for no entry.
function whoIs(req, isPublic) {
  if (!AUTH) return isPublic ? null : ""; // no password set: the tailnet port works as before, the public port stays shut
  const h = String(req.headers.authorization || "");
  if (h.startsWith("Bearer ")) { const t = h.slice(7).trim(); for (const [n, u] of Object.entries(AUTH.users)) if (u.token && eqSafe(t, u.token)) return n; }
  const s0 = sessionUser(cookieOf(req, "saga_session"));
  if (s0) return s0;
  const ts = req.headers["tailscale-user-login"];
  if (!isPublic && TRUST_TS && ts) { for (const [n, u] of Object.entries(AUTH.users)) if (u.tailscale && String(u.tailscale).toLowerCase() === String(ts).toLowerCase()) return n; return AUTH.owner; }
  return null;
}
// each person's folder
function dirOf(user) {
  if (!user || !AUTH || user === AUTH.owner) return DATA;
  const d = path.join(DATA, "users", user);
  fs.mkdirSync(path.join(d, ".daily"), { recursive: true }); fs.mkdirSync(path.join(d, ".sync"), { recursive: true });
  return d;
}
// a few wrong passwords per address, then a pause
const tries = new Map();
const clientIp = req => String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
function limited(ip) { const t = tries.get(ip); if (!t) return false; if (Date.now() - t.first > 15 * 60e3) { tries.delete(ip); return false; } return t.n >= 5; }
function failed(ip) { const t = tries.get(ip) || { n: 0, first: Date.now() }; t.n++; tries.set(ip, t); }
const LOGIN = (msg, next = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saga · sign in</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#0d1117;color:#e6edf3;display:grid;place-items:center;min-height:100dvh;margin:0}form{background:#161b22;border:1px solid #30363d;border-radius:16px;padding:28px;width:min(340px,88vw)}h1{font-size:22px;margin:0 0 16px}input{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #30363d;background:#0d1117;color:inherit;font:inherit}button{margin-top:14px;width:100%;padding:12px;border-radius:10px;border:0;background:#6d8bff;color:#fff;font:600 16px system-ui}p{color:#f0883e;font-size:14px;margin:10px 0 0}</style></head>
<body><form method="post" action="api/auth/login"><h1>Saga</h1><input name="user" placeholder="Name" autocomplete="username" autocapitalize="off" autofocus required style="margin-bottom:10px"><input type="password" name="password" placeholder="Password" autocomplete="current-password" required>${next ? `<input type="hidden" name="next" value="${String(next).replace(/[^a-z0-9/_.-]/gi, "")}">` : ""}<button>Sign in</button>${msg ? `<p>${msg}</p>` : ""}</form></body></html>`;

// ---- the last version each file had when the phone and the server agreed (the base of the next merge)
const basePath = (dir, n) => path.join(dir, ".sync", n);
const sha = t => crypto.createHash("sha256").update(t || "").digest("hex");
// texts the website was given, by hash, so a save from an older page can be merged instead of overwriting
const served = new Map();
function remember(n, t) { const h = sha(t); let m = served.get(n); if (!m) served.set(n, m = new Map()); /* n is "dir|name" */ m.set(h, t); while (m.size > 4) m.delete(m.keys().next().value); return h; }
// open website pages are told when a file changes (Server-Sent Events)
const listeners = new Set();
function announce(dir, files, from) { const msg = `data: ${JSON.stringify({ files, from })}\n\n`; for (const r of listeners) { if (r.sagaDir !== dir) continue; try { r.write(msg); } catch (e) { listeners.delete(r); } } }
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
function daily(base, name) {
  const day = new Date().toISOString().slice(0, 10), dir = path.join(base, ".daily", day), src = path.join(base, name), dst = path.join(dir, name);
  try { if (!fs.existsSync(dst) && fs.existsSync(src)) { fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(src, dst); } } catch (e) { /* best effort */ }
}
function prune() {
  try {
    const cut = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
    const bases = [DATA]; try { for (const u of fs.readdirSync(path.join(DATA, "users"))) bases.push(path.join(DATA, "users", u)); } catch (e) { /* no other users */ }
    for (const b of bases) for (const d of fs.readdirSync(path.join(b, ".daily"))) if (d < cut) fs.rmSync(path.join(b, ".daily", d), { recursive: true, force: true });
  } catch (e) { /* best effort */ }
}
setInterval(prune, 6 * 3600e3).unref(); prune();

// 0.7.0: the Saga version the person's phone last synced with (the website stops editing when it's older)
function phoneVersion(dir, v) {
  const f = path.join(dir, ".phone.json");
  if (v) { try { fs.writeFileSync(f, JSON.stringify({ version: String(v).slice(0, 20), at: Date.now() })); } catch (e) { /* read-only */ } return null; }
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; }
}
function writeAtomic(dir, name, buf, dev) {
  daily(dir, name);
  const f = path.join(dir, name), tmp = f + "." + process.pid + ".tmp";
  let old = null;
  if (JOURNALED.includes(name)) try { old = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""; } catch (e) { old = null; }
  fs.writeFileSync(tmp, buf); fs.renameSync(tmp, f);
  if (old != null) try { J.record(dir, name, old, buf.toString("utf8"), dev || "web"); } catch (e) { console.error("journal:", e.message); }
}

// ---- a .zip export opened: text entries come back as text (the same shape the phone app gives)
// 0.6.9: when each person last used the website or synced (kept in <data>/.seen.json, written at most once a minute)
const SEEN_FILE = path.join(DATA, ".seen.json");
let SEEN = (() => { try { return JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")); } catch (e) { return {}; } })(), seenWrite = 0;
function seen(name, p) {
  if (!name) return;
  const e = SEEN[name] || (SEEN[name] = {}); e.at = Date.now(); if (/^\/api\/sync\//.test(p)) e.sync = Date.now();
  if (Date.now() - seenWrite > 60000) { seenWrite = Date.now(); try { fs.writeFileSync(SEEN_FILE, JSON.stringify(SEEN)); } catch (err) { /* read-only disk */ } }
}
// 0.6.9.4: a JSON file read once and kept until it changes (friends' pages read whole libraries: on a Pi that's slow)
const jsonMemo = new Map();
function readJson(f) {
  let st; try { st = fs.statSync(f); } catch (e) { jsonMemo.delete(f); return null; }
  const m = jsonMemo.get(f), stamp = st.mtimeMs + ":" + st.size;
  if (m && m.stamp === stamp) return m.v;
  let v = null; try { v = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { v = null; }
  jsonMemo.set(f, { stamp, v }); if (jsonMemo.size > 60) jsonMemo.delete(jsonMemo.keys().next().value);
  return v;
}
// 0.6.9.5: what `owner` shares with `viewer`: { lib, games, books, dw } or null. Sharing on with no list of people
// (the way 0.6.5–0.6.9.4 saved it) means films, series, games and books with everyone, as before.
const SHARE_PARTS = ["lib", "games", "books", "dw"];
function shareFor(owner, viewer) {
  if (!AUTH || !AUTH.users[owner]) return null;
  const sh = readJson(path.join(dirOf(owner === AUTH.owner ? "" : owner), "share.json"));
  if (!sh || !sh.on) return null;
  const sec = sh.to ? sh.to[viewer] : { lib: true, games: true, books: true, dw: false };
  return sec && SHARE_PARTS.some(k => sec[k]) ? Object.fromEntries(SHARE_PARTS.map(k => [k, !!sec[k]])) : null;
}
// 0.6.9: what a person who shares did lately, for their friends: watched, finished, read (newest first)
function activityOf(d, sec = { lib: true, games: true, books: true }) {
  const read = n => readJson(path.join(d, n));
  const out = [], L = sec.lib ? read("library.json") || {} : {}, G = sec.games ? read("games.json") || {} : {}, B = sec.books ? read("books.json") || {} : {};
  for (const i of Object.values(L.items || {})) {
    const w = (i.watches || []).filter(Boolean).sort().pop();
    if (w) out.push({ kind: i.type === "show" ? "finished" : "watched", type: i.type, title: i.title, year: i.year || null, tmdb: i.tmdb || null, imdb: i.imdb || null, date: String(w).slice(0, 10), rating: i.rating || 0 });
    const eps = Object.entries(i.eps || {}).filter(([, v]) => typeof v === "string").sort((a, b) => a[1].localeCompare(b[1]));
    if (i.type === "show" && eps.length) { const [k, v] = eps[eps.length - 1]; out.push({ kind: "episode", type: "show", title: i.title, year: i.year || null, tmdb: i.tmdb || null, imdb: i.imdb || null, date: v.slice(0, 10), ep: k }); }
  }
  for (const g of (G.games || [])) { const pl = (g.plays || []).slice().sort().pop(); if (pl && !g.hidden) out.push({ kind: "played", type: "game", title: g.title, date: String(pl).slice(0, 10), rating: g.rating || 0 }); }
  for (const b of (B.books || [])) if (b.finished) out.push({ kind: "read", type: "book", title: b.title, date: new Date(b.finished).toISOString().slice(0, 10), rating: b.rating || 0 });
  const seenK = new Set();
  return out.filter(x => /^\d{4}-\d\d-\d\d$/.test(x.date)).sort((a, b) => b.date.localeCompare(a.date)).filter(x => { const k = x.kind + x.title; if (seenK.has(k)) return false; seenK.add(k); return true; }).slice(0, 40);
}
// 0.6.5: a ZIP of files (deflated), for "Download a backup"
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function zipFiles(files) {
  const parts = [], central = []; let off = 0;
  const d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff, dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8"), raw = f.data, z = zlib.deflateRawSync(raw), crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(dt, 10); lh.writeUInt16LE(dd, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(z.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(dt, 12); ch.writeUInt16LE(dd, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(z.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, name, z); central.push(ch, name); off += 30 + name.length + z.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat(parts.concat([cd, end]));
}
// every file under dir (skipping the names given), as { name, data }
function filesUnder(dir, skip = () => false, pre = "") {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const n of fs.readdirSync(dir)) {
    const rel = pre + n, f = path.join(dir, n);
    if (skip(rel)) continue;
    const st = fs.statSync(f);
    if (st.isDirectory()) out.push(...filesUnder(f, skip, rel + "/")); else if (st.isFile()) out.push({ name: rel, data: fs.readFileSync(f) });
  }
  return out;
}
// 0.6.5: app updates put in <data>/apk/ by the owner. Everyone signed in sees the Starter builds; the owner sees all
// (the owner's own build holds the owner's keys).
const APK_DIR = path.join(DATA, "apk");
function apksFor(user) {
  if (!fs.existsSync(APK_DIR)) return [];
  const owner = !AUTH || user === AUTH.owner || user === "";
  return fs.readdirSync(APK_DIR).filter(n => /\.apk$/i.test(n) && (owner || /starter/i.test(n)))
    .map(n => ({ name: n, size: fs.statSync(path.join(APK_DIR, n)).size, at: fs.statSync(path.join(APK_DIR, n)).mtimeMs })).sort((a, b) => b.at - a.at);
}
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
  // 0.6.9.5: Node's own User-Agent ("node") is turned away by Cloudflare in front of Trakt (403, "denied access"),
  // so a sync from the website never got your watched episodes. The phone sends its own; the website now does too.
  if (!Object.keys(headers).some(h => /^user-agent$/i.test(h))) headers["User-Agent"] = `Saga/${APP_VERSION} (website; +https://github.com/Banta02112000/Saga)`;
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
    // 0.6.5: every answer of the sign-in sends the browser back to a real page (it used to land on /api/auth/, which
    // showed {"error":"not found"} even with the right password), and the cookie is https-only only on https
    // (on plain http, like http://100.x.x.x:8787, browsers dropped it, so you were asked to sign in again)
    const MSG = { wrong: "Wrong name or password.", wait: "Too many tries. Wait 15 minutes." };
    const secure = req.socket.encrypted || /^https$/i.test(String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim()) ? "; Secure" : "";
    if (p === "/login" && req.method === "GET") return send(res, (MSG[url.searchParams.get("e")] && url.searchParams.get("e") === "wait") ? 429 : 200, LOGIN(!AUTH ? "No password is set yet: on the server run  node server.js --set-password" : MSG[url.searchParams.get("e")] || "", url.searchParams.get("next") || ""), "text/html; charset=utf-8");
    if (p === "/api/auth/login" && req.method !== "POST") { res.writeHead(303, { Location: "../../login" }); return res.end(); }
    if (p === "/api/auth/login" && req.method === "POST") {
      const ip = clientIp(req);
      if (limited(ip)) { res.writeHead(303, { Location: "../../login?e=wait", "X-Saga-Login": "wait" }); return res.end(); }
      const body = (await readBody(req, 8192)).toString("utf8");
      const form = /^\s*\{/.test(body) ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body));
      const name = String(form.user || (AUTH && Object.keys(AUTH.users).length === 1 ? Object.keys(AUTH.users)[0] : "")).trim().toLowerCase();
      const next = String(form.next || "").replace(/[^a-z0-9/_.-]/gi, "").replace(/^\/+|\.\./g, "");
      if (!checkPassword(name, form.password || "")) { failed(ip); res.writeHead(303, { Location: `../../login?e=wrong${next ? "&next=" + encodeURIComponent(next) : ""}`, "X-Saga-Login": "wrong" }); return res.end(); }
      tries.delete(ip);
      res.writeHead(303, { Location: "../../" + next, "X-Saga-Login": "ok", "Set-Cookie": `saga_session=${newSession(name)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`, "Cache-Control": "no-store" });
      return res.end();
    }
    if (p === "/api/auth/logout") { res.writeHead(303, { Location: "../../login", "Set-Cookie": `saga_session=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0` }); return res.end(); }
    if (p === "/api/health") return send(res, 200, JSON.stringify({ ok: true, auth: !!AUTH, version: APP_VERSION }));
    if (p === "/manifest.json") return send(res, 200, MANIFEST, "application/manifest+json");
    if (p === "/sw.js") { res.writeHead(200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" }); return res.end(SW); }
    if (ICONS[p.slice(1)]) { res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=604800" }); return res.end(ICONS[p.slice(1)]); }
    // 0.6.9: your calendar for Google Calendar: /cal/<random code>.ics (a code of its own, not your sync key)
    if (/^\/cal\/[A-Za-z0-9_-]{20,}\.ics$/.test(p) && req.method === "GET") {
      const code = p.slice(5, -4); let who = null;
      if (AUTH) for (const [n, u] of Object.entries(AUTH.users)) if (u.cal && eqSafe(code, u.cal)) who = n;
      const ip = clientIp(req);
      if (who === null) { if (limited(ip)) return send(res, 429, "Too many tries", "text/plain"); failed(ip); return send(res, 404, "Not found", "text/plain"); }
      const f = path.join(dirOf(who === AUTH.owner ? "" : who), "calendar.ics");
      if (!fs.existsSync(f)) return send(res, 404, "No calendar yet: sync the app once", "text/plain");
      res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-cache" });
      return res.end(fs.readFileSync(f));
    }
    // 0.6.2: Jellyfin and Plex say what was watched: POST /api/webhook/jellyfin?key=<sync key> (or Authorization: Bearer <sync key>)
    if (p.startsWith("/api/webhook/")) {
      const kind = p.slice(13);
      if (kind !== "jellyfin" && kind !== "plex") return send(res, 404, '{"error":"jellyfin or plex"}');
      if (req.method !== "POST") return send(res, 405, '{"error":"POST only"}');
      const ip = clientIp(req);
      if (limited(ip)) return send(res, 429, '{"error":"too many tries, wait 15 minutes"}');
      const key = url.searchParams.get("key") || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      let who = null;
      if (AUTH && key) for (const [n, u] of Object.entries(AUTH.users)) if (u.token && eqSafe(key, u.token)) who = n;
      if (who === null) { failed(ip); return send(res, 401, '{"error":"wrong or missing key"}'); }
      let ev;
      try { ev = hooks.parse(kind, await readBody(req), req.headers["content-type"]); } catch (e) { return send(res, 400, JSON.stringify({ error: e.message })); }
      if (!ev) return send(res, 200, '{"ok":true,"changed":false}'); // pauses, starts, other events
      const D = dirOf(who), f = path.join(D, "library.json");
      const out = hooks.apply(fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "", ev, require(path.join(WEB, "library.js")));
      if (!out) return send(res, 200, '{"ok":true,"changed":false}');
      writeAtomic(D, "library.json", Buffer.from(out.text));
      remember(D + "|library.json", out.text);
      announce(D, ["library.json"], kind);
      console.log(new Date().toISOString(), `${kind}: ${out.title} ${out.what} (${who || "owner"})`);
      return send(res, 200, JSON.stringify({ ok: true, changed: true, title: out.title, what: out.what }));
    }
    const user = whoIs(req, isPublic);
    if (user !== null && user !== undefined) seen(user || (AUTH && AUTH.owner) || "", p);
    if (user === null) {
      if (p.startsWith("/api/")) return send(res, 401, '{"error":"sign in"}');
      const next = p.slice(1).replace(/[^a-z0-9/_.-]/gi, "");
      res.writeHead(302, { Location: next && next !== "index.html" ? `login?next=${encodeURIComponent(next)}` : "login" }); return res.end();
    }
    const DIR = dirOf(user);
    // 0.6.9: the phone sends the calendar file after each sync; the answer is the address to subscribe to
    if (p === "/api/calendar" && req.method === "POST" && AUTH) {
      let j = {}; try { j = JSON.parse((await readBody(req, 4 * 1048576)).toString("utf8")); } catch (e) { return send(res, 400, '{"error":"not JSON"}'); }
      if (!/^BEGIN:VCALENDAR/.test(String(j.text || ""))) return send(res, 400, '{"error":"not a calendar"}');
      writeAtomic(DIR, "calendar.ics", Buffer.from(String(j.text)));
      const a = loadAuth(), me = user || a.owner;
      if (a && a.users[me] && (!a.users[me].cal || j.renew)) { a.users[me].cal = crypto.randomBytes(18).toString("base64url"); saveAuth(a); AUTH = a; }
      return send(res, 200, JSON.stringify({ path: `cal/${(AUTH.users[me] || {}).cal}.ics` }));
    }
    // 0.6.5: updates for the phone app, and a backup of your files
    if (p === "/api/apk") return send(res, 200, JSON.stringify(apksFor(user)));
    if (p === "/download") {
      const list = apksFor(user), esc2 = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      return send(res, 200, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saga · download</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#14121B;color:#ece8f4;max-width:560px;margin:0 auto;padding:24px}a.b{display:block;padding:14px 16px;margin:10px 0;border-radius:12px;background:#2a2537;color:inherit;text-decoration:none}small{color:#a39cb3}</style></head>
<body><h1>Saga for Android</h1>${list.length ? list.map(a => `<a class="b" href="download/${encodeURIComponent(a.name)}"><b>${esc2(a.name)}</b><br><small>${(a.size / 1048576).toFixed(1)} MB · ${new Date(a.at).toISOString().slice(0, 10)}</small></a>`).join("")
        : "<p>No app updates here yet.</p>"}<p><small>Download, open the file and tap Install (allow installs from your browser once). Your data stays: an update never wipes it.</small></p><p><a href="./" style="color:#b9a6ff">Back to Saga</a></p></body></html>`, "text/html; charset=utf-8");
    }
    if (p.startsWith("/download/")) {
      const n = decodeURIComponent(p.slice(10)), a = apksFor(user).find(x => x.name === n);
      if (!a) return send(res, 404, "Not found", "text/plain");
      res.writeHead(200, { "Content-Type": "application/vnd.android.package-archive", "Content-Disposition": `attachment; filename="${n.replace(/"/g, "")}"`, "Content-Length": a.size, "Cache-Control": "no-store" });
      return fs.createReadStream(path.join(APK_DIR, n)).pipe(res);
    }
    if (p === "/api/backup") {
      // your own files (the owner's: everything but other people's folders, the apps and the sign-in file)
      const files = filesUnder(DIR, rel => /^(users|apk|\.sync)(\/|$)/.test(rel) || rel === "auth.json" || /^\.daily\//.test(rel));
      res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="saga-backup-${user || "me"}-${new Date().toISOString().slice(0, 10)}.zip"`, "Cache-Control": "no-store" });
      return res.end(zipFiles(files));
    }
    // 0.6.5: friends on the same website. Each person chooses to share; only then do the others see their films,
    // series, games and books (title, status, rating; no notes, no diary, no keys).
    // 0.6.9.5: and for each person, which parts: films and series, games, books, Doctor Who.
    if (p === "/api/share") {
      const f = path.join(DIR, "share.json"), me = user || (AUTH && AUTH.owner) || "";
      const others = AUTH ? Object.keys(AUTH.users).filter(n => n !== me) : [];
      if (req.method === "POST") {
        let j = {}; try { j = JSON.parse((await readBody(req, 65536)).toString("utf8")); } catch (e) { j = {}; }
        const out = { on: !!j.on, at: Date.now() };
        if (j.to && typeof j.to === "object") { out.to = {}; for (const n of others) { const v = j.to[n] || {}; out.to[n] = Object.fromEntries(SHARE_PARTS.map(k => [k, !!v[k]])); } }
        writeAtomic(DIR, "share.json", Buffer.from(JSON.stringify(out)));
        return send(res, 200, JSON.stringify(Object.assign({ ok: true, people: others }, out)));
      }
      let sh = {}; try { sh = JSON.parse(fs.readFileSync(f, "utf8")) || {}; } catch (e) { sh = {}; }
      return send(res, 200, JSON.stringify({ on: !!sh.on, to: sh.to || null, people: others, parts: SHARE_PARTS }));
    }
    if (p === "/api/people" && AUTH) {
      const me = user || AUTH.owner, out = [];
      const read = (d, n) => readJson(path.join(d, n));
      for (const n of Object.keys(AUTH.users)) {
        if (n === me) continue;
        const sec = shareFor(n, me);
        if (!sec) continue;
        const d = dirOf(n === AUTH.owner ? "" : n);
        const L = sec.lib ? read(d, "library.json") || {} : {}, G = sec.games ? read(d, "games.json") || {} : {}, B = sec.books ? read(d, "books.json") || {} : {};
        let dw = null;
        if (sec.dw) { const W = (read(d, "dw.json") || {}).works || {}, done = Object.values(W).filter(w => w && w.done), rated = done.filter(w => +w.rating > 0);
          dw = { done: done.length, rated: rated.length, avg: rated.length ? Math.round(10 * rated.reduce((a, w) => a + +w.rating, 0) / rated.length) / 10 : null }; }
        out.push({ name: n, parts: sec, recent: activityOf(d, sec),
          lib: Object.values(L.items || {}).map(i => ({ type: i.type, title: i.title, year: i.year || null, imdb: i.imdb || null, tmdb: i.tmdb || null, status: i.status, rating: i.rating || 0, poster: i.poster || "" })),
          games: (G.games || []).filter(g => !g.hidden).map(g => ({ title: g.title, date: g.date || "", platform: g.platform || "", status: g.status, rating: g.rating || 0 })),
          books: (B.books || []).map(b => ({ title: b.title, authors: (b.authors || []).slice(0, 2), status: b.status, rating: b.rating || 0 })), dw });
      }
      return send(res, 200, JSON.stringify({ me, people: out }));
    }
    // 0.6.9: send a title to someone (only to people who share, and only if you share too); your inbox
    const shares = n => { try { return !!JSON.parse(fs.readFileSync(path.join(dirOf(n === AUTH.owner ? "" : n), "share.json"), "utf8")).on; } catch (e) { return false; } };
    const sharesWith = (a, b) => !!shareFor(a, b);
    if (p === "/api/send" && req.method === "POST" && AUTH) {
      let j = {}; try { j = JSON.parse((await readBody(req, 65536)).toString("utf8")); } catch (e) { return send(res, 400, '{"error":"not JSON"}'); }
      const me = user || AUTH.owner, to = String(j.to || "").toLowerCase(), it = j.item || {};
      if (!AUTH.users[to] || to === me) return send(res, 404, '{"error":"no such person"}');
      if (!sharesWith(me, to) || !sharesWith(to, me)) return send(res, 403, '{"error":"you both need to share with each other (Settings › Accounts and sync › Sharing)"}');
      if (!it.title || !/^(movie|show|game|book)$/.test(it.type || "")) return send(res, 400, '{"error":"what to send?"}');
      const d = dirOf(to === AUTH.owner ? "" : to), f = path.join(d, "inbox.json");
      let box = []; try { box = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { box = []; }
      box.unshift({ id: crypto.randomBytes(6).toString("hex"), from: me, at: Date.now(), note: String(j.note || "").slice(0, 300),
        item: { type: it.type, title: String(it.title).slice(0, 200), year: +it.year || null, tmdb: +it.tmdb || null, imdb: /^tt\d+$/.test(it.imdb || "") ? it.imdb : null, poster: /^https:\/\/[\w./-]+$/.test(it.poster || "") ? it.poster : "" } });
      fs.mkdirSync(d, { recursive: true }); writeAtomic(d, "inbox.json", Buffer.from(JSON.stringify(box.slice(0, 100))));
      return send(res, 200, '{"ok":true}');
    }
    if (p === "/api/inbox") {
      const f = path.join(DIR, "inbox.json"); let box = []; try { box = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { box = []; }
      if (req.method === "POST") { let j = {}; try { j = JSON.parse((await readBody(req, 4096)).toString("utf8")); } catch (e) { /* none */ }
        box = box.filter(x => x.id !== j.done); writeAtomic(DIR, "inbox.json", Buffer.from(JSON.stringify(box))); }
      return send(res, 200, JSON.stringify(box));
    }
    // 0.6.9: the owner's view of the website: people, last seen, space, backups, updates
    if (p === "/api/admin") {
      if (AUTH && (user || AUTH.owner) !== AUTH.owner) return send(res, 403, '{"error":"only the owner"}');
      const du = d => { let n = 0; try { for (const f of filesUnder(d, rel => /^(users|apk)(\/|$)/.test(rel))) n += f.data.length; } catch (e) { /* none */ } return n; };
      let disk = null; try { const st = fs.statfsSync(DATA); disk = { free: st.bavail * st.bsize, total: st.blocks * st.bsize }; } catch (e) { /* old Node */ }
      const daily = path.join(DATA, ".daily"); let lastDaily = null; try { lastDaily = fs.readdirSync(daily).sort().pop() || null; } catch (e) { /* none */ }
      const people = AUTH ? Object.keys(AUTH.users).map(n => ({ name: n, owner: n === AUTH.owner, at: (SEEN[n] || {}).at || 0, sync: (SEEN[n] || {}).sync || 0, size: du(dirOf(n === AUTH.owner ? "" : n)), shares: shares(n), calendar: !!AUTH.users[n].cal })) : [];
      return send(res, 200, JSON.stringify({ version: APP_VERSION, uptime: Math.round(process.uptime()), node: process.version, people, disk, lastDaily,
        autoUpdate: fs.existsSync("/etc/systemd/system/timers.target.wants/saga-update.timer"), apks: fs.existsSync(APK_DIR) ? fs.readdirSync(APK_DIR).filter(n => /\.apk$/i.test(n)) : [] }));
    }
    // 0.6.9.9: the owner updates the website from the app (Settings › Your Saga website), so the website runs the same
    // version as the phone: git pull from GitHub, then this server stops and systemd starts the new one (Restart=always)
    if (p === "/api/admin/update" && req.method === "POST") {
      if (AUTH && (user || AUTH.owner) !== AUTH.owner) return send(res, 403, '{"error":"only the owner"}');
      const root = path.resolve(__dirname, "..");
      if (!fs.existsSync(path.join(root, ".git"))) return send(res, 200, JSON.stringify({ ok: false, error: "this website wasn't installed with git: update it with site/update.sh" }));
      return require("child_process").execFile("git", ["pull", "--ff-only"], { cwd: root, timeout: 120000 }, (err, out, errOut) => {
        if (err) return send(res, 200, JSON.stringify({ ok: false, error: String(errOut || err.message).trim().slice(0, 400) }));
        let v = ""; try { v = (/const VERSION = "([\d.]+)"/.exec(fs.readFileSync(path.join(WEB, "app.js"), "utf8")) || [])[1] || ""; } catch (e) { /* none */ }
        const same = /Already up to date/i.test(out);
        send(res, 200, JSON.stringify({ ok: true, from: APP_VERSION, to: v || APP_VERSION, restart: !same, log: String(out).trim().slice(-400) }));
        if (!same) setTimeout(() => process.exit(0), 800);
      });
    }
    if (p === "/api/me") return send(res, 200, JSON.stringify({ user: user || null, users: AUTH ? Object.keys(AUTH.users).length : 0, version: APP_VERSION, phone: phoneVersion(DIR) }));
    if (p.startsWith("/api/")) {
      if (p === "/api/all" && req.method === "GET") {
        const out = {};
        for (const n of fs.readdirSync(DIR)) if (safe(n) && n !== "auth.json" && fs.statSync(path.join(DIR, n)).isFile()) { out[n] = fs.readFileSync(path.join(DIR, n), "utf8"); remember(DIR + "|" + n, out[n]); }
        res.setHeader("X-Sha", JSON.stringify(Object.fromEntries(Object.keys(out).filter(n => SYNC_FILES.includes(n)).map(n => [n, sha(out[n])]))));
        return send(res, 200, JSON.stringify(out));
      }
      if (p === "/api/events" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        res.write(": hello\n\n"); res.sagaDir = DIR; listeners.add(res); req.on("close", () => listeners.delete(res)); return;
      }
      // ---- the phone app: which files changed here, and one file merged with the phone's version
      if (p === "/api/sync/manifest" && req.method === "GET") {
        const files = {};
        for (const n of SYNC_FILES) { const f = path.join(DIR, n); if (fs.existsSync(f)) { const t = fs.readFileSync(f, "utf8"); const st = fs.statSync(f); files[n] = { mtime: st.mtimeMs, size: st.size, sha256: sha(t) }; } }
        return send(res, 200, JSON.stringify({ files, serverTime: Date.now(), version: APP_VERSION, revs: Object.fromEntries(JOURNALED.map(n => [n, J.rev(DIR, n)])), sync2: 1 }));
      }
      // 0.7.0: a sync that sends only what changed. Body: { since: the revision this device last had, patch:
      // [[key, value] | [key]], version }. Answer: { rev, changes (what this device doesn't have yet), digest } or
      // { full: true } when the journal doesn't reach back that far (the device then sends the whole file once).
      if (p.startsWith("/api/sync2/") && req.method === "POST") {
        const n = safe(p.slice(11));
        if (!n || !JOURNALED.includes(n)) return send(res, 400, '{"error":"not a synced file"}');
        const j = JSON.parse((await readBody(req, 200 * 1024 * 1024)).toString("utf8") || "{}");
        if (j.version) phoneVersion(DIR, j.version);
        const f = path.join(DIR, n), cur = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
        if (!cur || !J.covers(DIR, n, j.since)) return send(res, 200, JSON.stringify({ full: true, rev: J.rev(DIR, n) }));
        const m = E.split(n, JSON.parse(cur)), theirs = J.since(DIR, n, j.since), touched = new Set();
        for (const c of j.patch || []) {
          const k = c[0]; if (typeof k !== "string" || E.isDevice(n, k)) continue;
          const mine = c.length > 1 ? c[1] : undefined;
          let v = mine;
          if (theirs.has(k)) { const t = theirs.get(k); v = t.known ? merge3(t.before, mine, m.get(k), n, E.fieldOf(k)) : mine; }
          if (v === undefined) m.delete(k); else { E.apply(m, [[k, v]]); }
          touched.add(k);
          if (E.hash(v) !== E.hash(mine)) theirs.set(k, { merged: true });
        }
        const text = JSON.stringify(E.join(m));
        if (text !== cur) { writeAtomic(DIR, n, Buffer.from(text), "phone"); announce(DIR, [n], "phone"); }
        const changes = [];
        for (const k of theirs.keys()) { if (E.isDevice(n, k) || (touched.has(k) && !theirs.get(k).merged)) continue; changes.push(m.has(k) ? [k, m.get(k)] : [k]); }
        // a container whose records changed: its marker too, so the device can put the file back together
        return send(res, 200, JSON.stringify({ rev: J.rev(DIR, n), changes, digest: E.digest(n, m) }));
      }
      // 0.7.0: what changed lately, newest first, and undoing one change
      if (p === "/api/history" && req.method === "GET") {
        const before = +(url.searchParams.get("before") || 0) || Infinity, limit = Math.min(500, +(url.searchParams.get("limit") || 200));
        const items = J.history(DIR, JOURNALED, limit, before).map(x => {
          const what = x.p === undefined ? "added" : x.v === undefined ? "removed" : "changed";
          const fields = what === "changed" && x.p && x.v && typeof x.p === "object" && typeof x.v === "object"
            ? [...new Set([...Object.keys(x.p), ...Object.keys(x.v)])].filter(f => !/^(updated|ts|at|ver|_.*)$/.test(f) && JSON.stringify(x.p[f]) !== JSON.stringify(x.v[f])).slice(0, 6) : [];
          const show = f => { const a = x.p && x.p[f], b = x.v && x.v[f]; const s = v => v == null ? "–" : typeof v === "object" ? (Array.isArray(v) ? v.length + " items" : "…") : String(v).slice(0, 40); return { f, from: s(a), to: s(b) }; };
          return { r: x.r, file: x.file, at: x.at, dev: x.dev, title: E.label(x.file, x.k, x.v !== undefined ? x.v : x.p), what, fields: fields.map(show) };
        });
        return send(res, 200, JSON.stringify({ items }));
      }
      if (p === "/api/history/undo" && req.method === "POST") {
        const j = JSON.parse((await readBody(req)).toString("utf8") || "{}"), n = safe(String(j.file || ""));
        if (!JOURNALED.includes(n)) return send(res, 400, '{"error":"not a synced file"}');
        const x = J.entry(DIR, n, +j.r);
        if (!x || x.x) return send(res, 404, '{"error":"that change is no longer in the history"}');
        const f = path.join(DIR, n), cur = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "{}";
        const m = E.split(n, JSON.parse(cur || "{}"));
        if (x.p === undefined) m.delete(x.k); else E.apply(m, [[x.k, x.p]]);
        const text = JSON.stringify(E.join(m));
        if (text !== cur) { writeAtomic(DIR, n, Buffer.from(text), "undo"); announce(DIR, [n], "undo"); }
        return send(res, 200, JSON.stringify({ ok: true, rev: J.rev(DIR, n) }));
      }
      if (p.startsWith("/api/sync/file/") && req.method === "POST") {
        const n = safe(p.slice(15));
        if (!n || !SYNC_FILES.includes(n)) return send(res, 400, '{"error":"not a synced file"}');
        const mine = (await readBody(req)).toString("utf8");
        if (req.headers["x-saga-version"]) phoneVersion(DIR, req.headers["x-saga-version"]);
        const f = path.join(DIR, n), theirs = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
        const base = fs.existsSync(basePath(DIR, n)) ? fs.readFileSync(basePath(DIR, n), "utf8") : "";
        const merged = mergeText(n, base, mine, theirs);
        if (merged !== theirs) { writeAtomic(DIR, n, Buffer.from(merged), "phone"); announce(DIR, [n], "phone"); }
        fs.writeFileSync(basePath(DIR, n), merged);
        return send(res, 200, JSON.stringify({ text: merged, sha256: sha(merged), changedHere: merged !== mine, rev: JOURNALED.includes(n) ? J.rev(DIR, n) : undefined }));
      }
      if (p.startsWith("/api/file/")) {
        const n = safe(p.slice(10));
        if (!n || n === "auth.json") return send(res, 400, '{"error":"bad name"}');
        if (req.method === "PUT") {
          let body = await readBody(req);
          // a page that loaded an older version of a synced file: merged with what's there now, not overwritten
          const baseSha = String(req.headers["x-base-sha"] || ""), f = path.join(DIR, n);
          if (SYNC_FILES.includes(n) && baseSha && fs.existsSync(f)) {
            const cur = fs.readFileSync(f, "utf8"), curSha = sha(cur);
            if (curSha !== baseSha) {
              const baseText = (served.get(DIR + "|" + n) || new Map()).get(baseSha);
              if (baseText != null) { const m = mergeText(n, baseText, body.toString("utf8"), cur); writeAtomic(DIR, n, Buffer.from(m)); return send(res, 200, JSON.stringify({ merged: true, text: m, sha256: remember(DIR + "|" + n, m) })); }
              return send(res, 409, JSON.stringify({ error: "changed elsewhere", text: cur, sha256: remember(DIR + "|" + n, cur) }));
            }
          }
          const fn = path.join(DIR, n), same = SYNC_FILES.includes(n) && fs.existsSync(fn) && fs.readFileSync(fn).equals(body);
          if (!same) writeAtomic(DIR, n, body, "web");
          const h = remember(DIR + "|" + n, body.toString("utf8"));
          if (SYNC_FILES.includes(n) && !same) announce(DIR, [n], String(req.headers["x-tab"] || "web")); // 0.6.9.4: nothing changed, nobody told
          return send(res, 200, JSON.stringify({ sha256: h }));
        }
        if (req.method === "POST") { daily(DIR, n); fs.appendFileSync(path.join(DIR, n), await readBody(req)); return send(res, 200, "{}"); }
        if (req.method === "DELETE") { daily(DIR, n); fs.rmSync(path.join(DIR, n), { force: true }); return send(res, 200, "{}"); }
        if (req.method === "GET") { const f = path.join(DIR, n), t = fs.existsSync(f) ? fs.readFileSync(f) : Buffer.from(""); if (SYNC_FILES.includes(n)) res.setHeader("X-Sha", remember(DIR + "|" + n, t.toString("utf8"))); return send(res, 200, t, "text/plain; charset=utf-8"); }
      }
      if (p === "/api/http" && req.method === "POST") return send(res, 200, JSON.stringify(await passOn(JSON.parse((await readBody(req, 50 * 1024 * 1024)).toString("utf8")))));
      if (p === "/api/unzip" && req.method === "POST") { try { return send(res, 200, JSON.stringify(unzip(await readBody(req)))); } catch (e) { return send(res, 200, JSON.stringify({ error: e.message })); } }
      if (p === "/api/health") return send(res, 200, JSON.stringify({ ok: true }));
      return send(res, 404, '{"error":"not found"}');
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "", "text/plain");
    if (p === "/web-shim.js") return send(res, 200, SHIM, TYPES[".js"]);
    const rel = p === "/" ? "index.html" : p.replace(/^\/+/, "");
    const f = path.resolve(WEB, rel);
    if (!f.startsWith(WEB + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return send(res, 404, "Not found", "text/plain");
    let body = fs.readFileSync(f);
    // 0.7.0: the app's scripts are started by web-shim.js once your data is there (from the server, or when it can't be
    // reached, from the copy this browser keeps), in the same order
    if (rel === "index.html") body = Buffer.from(body.toString("utf8").replace(/<script src="boot\.js"><\/script>/, '<script src="web-shim.js"></script><script src="boot.js"></script>')
      .replace(/<body([^>]*)>([\s\S]*)<\/body>/, (m, attrs, inner) => { const list = []; const rest = inner.replace(/<script src="([^"]+)"><\/script>/g, (t, src) => { list.push(src); return ""; }); return `<body${attrs} data-scripts="${list.join(",")}">${rest}</body>`; })
      .replace("</head>", '<link rel="manifest" href="manifest.json"><meta name="theme-color" content="#14121B"><link rel="icon" href="icon-192.png"><link rel="apple-touch-icon" href="icon-192.png"></head>'));
    send(res, 200, body, TYPES[path.extname(f).toLowerCase()] || "application/octet-stream");
  } catch (e) {
    console.error(new Date().toISOString(), req.method, req.url, e);
    if (!res.headersSent) send(res, 500, JSON.stringify({ error: e.message }));
  }
};
// ---- accounts, from the command line:
//   node server.js --set-password [name] [password]   (new or changed; prints that person's sync key)
//   node server.js --add-user name [password]         (the same, for someone new)
//   node server.js --remove-user name                  (their files stay in data/users/<name>)
//   node server.js --users                             (who has an account)
//   node server.js --rename-user old new               (e.g. me → banta)
//   node server.js --backup [file.zip]                 (all accounts' files in one ZIP)
//   node server.js --key [name]                         (that person's sync key, for the phone app and Jellyfin / Plex)
//   node server.js --tailscale name login@example.com  (that Tailscale login opens that person's Saga on the tailnet port)
const argv = process.argv.slice(2), cmd = argv[0] || "";
const ask = (q, cb) => { process.stdout.write(q); let buf = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", d => { buf += d; if (buf.includes("\n")) cb(buf.trim()); }); };
if (cmd === "--set-password" || cmd === "--add-user") {
  const cur = loadAuth();
  let name = argv[1], pw = argv[2];
  // the old form "--set-password <password>" (one argument) changes the owner's password
  if (cmd === "--set-password" && argv.length === 2 && cur && !cur.users[String(argv[1]).toLowerCase()]) { pw = argv[1]; name = cur.owner; }
  name = String(name || (cur && cur.owner) || "me").toLowerCase();
  if (!validName(name)) { console.error("A name of letters, digits, . _ - (up to 32)."); process.exit(1); }
  const done = p2 => { if (!p2 || p2.length < 8) { console.error("At least 8 characters."); process.exit(1); } const u = setPassword(name, p2);
    console.log(`Password set for ${name}${(loadAuth() || {}).owner === name ? " (owner)" : ""}. Sync key for ${name}'s phone app (Settings › Accounts and sync › Saga website):\n  ${u.token}`); process.exit(0); };
  if (pw) done(pw); else ask(`New password for ${name}: `, done);
} else if (cmd === "--backup") {
  // 0.6.5: everything (all accounts, sign-in file included) into one ZIP, e.g. onto a USB stick
  const out = argv[1] || `saga-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  const files = filesUnder(DATA, rel => /^(apk|\.daily)(\/|$)|\/\.daily\//.test(rel));
  fs.writeFileSync(out, zipFiles(files)); console.log(`${files.length} files saved to ${path.resolve(out)}`); process.exit(0);
} else if (cmd === "--rename-user") {
  // 0.6.5: e.g. the "me" that an old single-password setup became → your own name
  const a = loadAuth(), from = String(argv[1] || "").toLowerCase(), to = String(argv[2] || "").trim().toLowerCase();
  if (!a || !a.users[from]) { console.error("No such account (see --users)."); process.exit(1); }
  if (!/^[a-z0-9._-]{1,32}$/.test(to) || a.users[to]) { console.error("Give a new, unused name (letters, digits, . _ -)."); process.exit(1); }
  a.users[to] = a.users[from]; delete a.users[from];
  if (a.owner === from) a.owner = to;
  else if (fs.existsSync(path.join(DATA, "users", from))) fs.renameSync(path.join(DATA, "users", from), path.join(DATA, "users", to));
  saveAuth(a); console.log(`${from} is now ${to}. Sign in with the name ${to}.`); process.exit(0);
} else if (cmd === "--remove-user") {
  const a = loadAuth(), n = String(argv[1] || "").toLowerCase();
  if (!a || !a.users[n]) { console.error("No such account."); process.exit(1); }
  if (n === a.owner) { console.error("The owner can't be removed."); process.exit(1); }
  delete a.users[n]; saveAuth(a); console.log(`${n} removed (their files are still in ${path.join(DATA, "users", n)}).`); process.exit(0);
} else if (cmd === "--users") {
  const a = loadAuth(); if (!a) { console.log("No accounts yet."); process.exit(0); }
  for (const [n, u] of Object.entries(a.users)) console.log(`${n}${n === a.owner ? " (owner)" : ""}${u.tailscale ? `  · Tailscale: ${u.tailscale}` : ""}`);
  process.exit(0);
} else if (cmd === "--key") {
  const a = loadAuth(), n = String(argv[1] || (a && a.owner) || "").toLowerCase();
  if (!a || !a.users[n] || !a.users[n].token) { console.error("No such account (see --users)."); process.exit(1); }
  console.log(a.users[n].token); process.exit(0);
} else if (cmd === "--tailscale") {
  const a = loadAuth(), n = String(argv[1] || "").toLowerCase();
  if (!a || !a.users[n] || !argv[2]) { console.error("Usage: --tailscale name login"); process.exit(1); }
  a.users[n].tailscale = argv[2]; saveAuth(a); console.log(`${argv[2]} now opens ${n}'s Saga through Tailscale.`); process.exit(0);
} else {
  http.createServer(handler(false)).listen(PORT, HOST, () => console.log(`Saga website on http://${HOST}:${PORT} for your tailnet (files in ${DATA})`));
  if (PUBLIC_PORT) http.createServer(handler(true)).listen(PUBLIC_PORT, HOST, () => console.log(`Public entrance on http://${HOST}:${PUBLIC_PORT}: ${AUTH ? "password needed" : "closed until a password is set"}`));
}
