/* Saga 0.7.0: the website's record of every change to each person's data files, entry by entry.
   One line per changed entry: { r: number, at: time, dev: "phone" | "web" | "undo" | …, k: key, v: new value,
   p: value before } (v or p left out when the entry didn't exist then; x: 1 when the values aren't kept, for the
   big caches). It answers "what changed since the last sync" (so a phone sends and gets only changes), feeds the
   history list, and lets one change be undone. Kept under ~20 MB per file: the oldest half goes first. */
"use strict";
const fs = require("fs"), path = require("path");
const E = (() => {
  for (const d of [process.env.SAGA_WEB, path.join(__dirname, "..", "web"), path.join(__dirname, "web")]) if (d && fs.existsSync(path.join(d, "shared", "entries.js"))) return require(path.join(d, "shared", "entries.js"));
  throw new Error("Saga: web/shared/entries.js not found (set SAGA_WEB)");
})();
const MAX = +process.env.SAGA_JOURNAL_MAX || 20 * 1024 * 1024;
// entries whose values aren't kept in the journal (big, re-fetchable caches): only that they changed
const NOVALUE = { "canonsync.json": ["tmdbCache", "items"], "music.json": ["recent"] };
const dirOf = dir => path.join(dir, "journal");
const fileOf = (dir, n) => path.join(dirOf(dir), n + ".jsonl");
const metaOf = (dir, n) => path.join(dirOf(dir), n + ".meta");
const parse = t => { if (t == null || t === "") return undefined; try { return JSON.parse(t); } catch (e) { return undefined; } };
function meta(dir, n) { try { return JSON.parse(fs.readFileSync(metaOf(dir, n), "utf8")); } catch (e) { return { rev: 0, from: -1 }; } }
function setMeta(dir, n, m) { fs.mkdirSync(dirOf(dir), { recursive: true }); fs.writeFileSync(metaOf(dir, n), JSON.stringify(m)); }
// the journal's lines, oldest first (cached by size + time)
const cache = new Map();
function lines(dir, n) {
  const f = fileOf(dir, n);
  let st; try { st = fs.statSync(f); } catch (e) { return []; }
  const c = cache.get(f);
  if (c && c.size === st.size && c.mtime === st.mtimeMs) return c.lines;
  const out = [];
  for (const l of fs.readFileSync(f, "utf8").split("\n")) if (l) { try { out.push(JSON.parse(l)); } catch (e) { /* a torn line */ } }
  cache.set(f, { size: st.size, mtime: st.mtimeMs, lines: out });
  return out;
}
// writes down what changed between two versions of a file; returns the new revision
function record(dir, n, oldText, newText, dev) {
  const a = E.split(n, parse(oldText)), b = E.split(n, parse(newText));
  const nov = NOVALUE[n] || [], at = Date.now(), m = meta(dir, n), out = [];
  const add = (k, p, v) => {
    const x = { r: ++m.rev, at, dev, k };
    if (nov.includes(E.fieldOf(k))) x.x = 1;
    else { if (v !== undefined) x.v = v; if (p !== undefined) x.p = p; }
    out.push(JSON.stringify(x));
  };
  for (const [k, v] of b) { const p = a.get(k); if (p === undefined || E.hash(p) !== E.hash(v)) add(k, p, v); }
  for (const [k, p] of a) if (!b.has(k)) add(k, p, undefined);
  if (!out.length) return m.rev;
  fs.mkdirSync(dirOf(dir), { recursive: true });
  fs.appendFileSync(fileOf(dir, n), out.join("\n") + "\n");
  if (!(m.from >= 0)) m.from = m.rev - out.length; // first record: everything after this revision is known
  setMeta(dir, n, m);
  trim(dir, n, m);
  return m.rev;
}
function trim(dir, n, m) {
  const f = fileOf(dir, n);
  let size = 0; try { size = fs.statSync(f).size; } catch (e) { return; }
  if (size <= MAX) return;
  const all = lines(dir, n), keep = all.slice(Math.floor(all.length / 2));
  fs.writeFileSync(f, keep.map(x => JSON.stringify(x)).join("\n") + "\n");
  m.from = keep.length ? keep[0].r - 1 : m.rev; setMeta(dir, n, m);
}
const rev = (dir, n) => meta(dir, n).rev;
// true when every change after `since` is still in the journal
function covers(dir, n, since) { const m = meta(dir, n); return since != null && since >= 0 && since <= m.rev && (since === m.rev || (m.from >= 0 && since >= m.from)); }
// keys changed after `since`, each with its value as it was at `since` (undefined: not known or didn't exist)
function since(dir, n, s) {
  const out = new Map();
  for (const x of lines(dir, n)) if (x.r > s && !out.has(x.k)) out.set(x.k, { before: x.x ? undefined : x.p, known: !x.x });
  return out;
}
function entry(dir, n, r) { return lines(dir, n).find(x => x.r === r) || null; }
// the newest changes across files, for the history list
function history(dir, files, limit = 200, before = Infinity) {
  const all = [];
  for (const n of files) for (const x of lines(dir, n)) if (x.at < before && !x.x && !E.isDevice(n, x.k) && x.k.includes(E.T)) all.push(Object.assign({ file: n }, x));
  all.sort((a, b) => b.at - a.at || b.r - a.r);
  return all.slice(0, limit);
}
module.exports = { record, rev, covers, since, entry, history, lines, meta, NOVALUE };
