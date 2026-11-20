/* Saga 0.7.0: a data file as a set of entries, so a sync sends only what changed.
   Every film, game, book, setting, canon row… is one entry with a key; containers keep a small marker so the file
   can be put back together exactly. Used by the app (phone and website page) and by the website's server.
   Entry keys: "field" (a plain value or a container marker), "field\to<key>" (one value of an object),
   "field\ta<key>" (one record of a list, matched by its id). */
(function (root) {
  "use strict";
  const KEYS = {
    "canonsync.json": { items: x => `${x.source}|${x.kind}|${x.list_name}|${x.key}`, exclusions: x => x.key, canon: x => `${x.franchise}|${x.norm}|${x.year}|${x.origin}`,
      specials: x => x.imdb, franchiseMap: x => `${x.franchise}|${x.norm}|${x.year}`, tmdbCache: x => (Array.isArray(x) ? x[0] : null) },
    "library.json": { outbox: x => `${x.id}|${x.ts}|${x.op}|${x.s || ""}|${x.e || ""}` },
    "games.json": { games: x => x.id },
    "books.json": { books: x => x.id },
    "music.json": { recent: x => `${x.at}|${x.track}|${x.artist}` },
  };
  // settings that belong to one device only (keep in step with DEVICE_RX in core.js): never sent, never compared
  const DEVICE_RX = /^(ota_|upd_|seen_version$|auto_backup|backup_file|backup_uri$|cal_path$|notif_asked$|imdb_signed_in$|live_|snap_sync_at$|stage_state$|stage_report$)/;
  const isObj = v => v && typeof v === "object" && !Array.isArray(v);
  const T = "\t";
  function keyFor(file, field) {
    const k = (KEYS[file] || {})[field];
    if (k) return k;
    return x => (isObj(x) ? (x.id != null ? "id:" + x.id : x.k != null ? "k:" + x.k : x.key != null ? "key:" + x.key : null) : null);
  }
  // …and the TMDB answers cache, which each side keeps for itself (the phone keeps it outside the file)
  const isDevice = (file, k) => file === "canonsync.json" && ((k.startsWith("settings" + T + "o") && DEVICE_RX.test(k.slice(10))) || k === "tmdbCache" || k.startsWith("tmdbCache" + T));
  // a file's object → Map(key → value), in the file's order
  function split(file, obj) {
    const m = new Map();
    if (!isObj(obj)) return m;
    for (const f of Object.keys(obj)) {
      const v = obj[f];
      if (isObj(v)) { m.set(f, { $c: "o" }); for (const k of Object.keys(v)) m.set(f + T + "o" + k, v[k]); continue; }
      if (Array.isArray(v) && v.length) {
        const kf = keyFor(file, f), keys = v.map(x => { try { return kf(x); } catch (e) { return null; } });
        if (keys.every(k => k != null) && new Set(keys).size === keys.length) { m.set(f, { $c: "a" }); v.forEach((x, i) => m.set(f + T + "a" + keys[i], x)); continue; }
      }
      m.set(f, v);
    }
    return m;
  }
  // Map → the file's object
  function join(m) {
    const out = {};
    for (const [k, v] of m) {
      const t = k.indexOf(T);
      if (t < 0) { out[k] = v && v.$c === "o" ? out[k] || {} : v && v.$c === "a" ? out[k] || [] : v; continue; }
      const f = k.slice(0, t), kind = k[t + 1], sub = k.slice(t + 2);
      if (kind === "o") { if (!isObj(out[f])) out[f] = {}; out[f][sub] = v; }
      else { if (!Array.isArray(out[f])) out[f] = []; out[f].push(v); }
    }
    return out;
  }
  // FNV-1a over the entry's JSON: what each side remembers of the other, instead of a whole copy
  function hash(v) {
    const s = v === undefined ? "" : JSON.stringify(v);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36) + ":" + s.length.toString(36);
  }
  function hashes(file, m) { const h = {}; for (const [k, v] of m) if (!isDevice(file, k)) h[k] = hash(v); return h; }
  // the same for both sides when they agree (the order of entries doesn't matter)
  function digest(file, m) {
    const h = hashes(file, m), ks = Object.keys(h).sort();
    return hash(ks.map(k => k + "=" + h[k]).join("\n"));
  }
  // what changed since the hashes of the last agreed version: [key, value] for added or changed, [key] for removed
  function diff(file, before, m) {
    const out = [];
    for (const [k, v] of m) { if (isDevice(file, k)) continue; const h = hash(v); if (before[k] !== h) out.push([k, v]); }
    for (const k of Object.keys(before)) if (!m.has(k) && !isDevice(file, k)) out.push([k]);
    return out;
  }
  // applies [key, value] / [key] changes; a new record goes where its container is, after the ones already there
  function apply(m, changes) {
    for (const c of changes) {
      const k = c[0];
      if (c.length < 2) { m.delete(k); continue; }
      const t = k.indexOf(T);
      if (t > 0) { const f = k.slice(0, t); if (!m.has(f) || !(m.get(f) && m.get(f).$c)) m.set(f, { $c: k[t + 1] }); }
      m.set(k, c[1]);
    }
    // keep each container's entries together, in place (join() needs them after their marker only for order)
    return m;
  }
  const fieldOf = k => { const t = k.indexOf(T); return t < 0 ? k : k.slice(0, t); };
  // a short name for an entry, for the history list
  function label(file, k, v) {
    const x = isObj(v) ? v : {};
    const t = x.title || x.name || x.track || "";
    const f = fieldOf(k), sub = k.indexOf(T) > 0 ? k.slice(k.indexOf(T) + 2) : "";
    if (t) return t;
    if (file === "canonsync.json" && f === "settings") return "Setting: " + sub;
    return sub ? `${f}: ${sub}` : f;
  }
  // 0.7.8: the same, a few milliseconds at a time (a big library is thousands of entries: done at once, the screen
  // froze for a second or more on the phone after every sync)
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const rest = () => new Promise(r => setTimeout(r, 0));
  async function hashesAsync(file, m, slice = 8) {
    const h = {}; let t = now();
    for (const [k, v] of m) { if (!isDevice(file, k)) h[k] = hash(v); if (now() - t > slice) { await rest(); t = now(); } }
    return h;
  }
  // → { patch, h }: the changes since `before`, and every entry's hash now (kept for the next sync)
  async function diffAsync(file, before, m, slice = 8) {
    const h = await hashesAsync(file, m, slice), out = [];
    for (const k of Object.keys(h)) if (before[k] !== h[k]) out.push([k, m.get(k)]);
    for (const k of Object.keys(before)) if (!(k in h) && !isDevice(file, k)) out.push([k]);
    return { patch: out, h };
  }
  const digestOf = h => { const ks = Object.keys(h).sort(); return hash(ks.map(k => k + "=" + h[k]).join("\n")); };
  const API = { hashesAsync, diffAsync, digestOf, split, join, hash, hashes, digest, diff, apply, keyFor, isDevice, fieldOf, label, KEYS, DEVICE_RX, T };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.SagaEntries = API;
})(typeof window !== "undefined" ? window : this);
