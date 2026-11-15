/* Saga: three-way merge of one data file (canonsync.json, library.json, games.json, books.json, dw.json).
   base = the version both sides last agreed on, mine = the phone's, theirs = the server's (the website's).
   Per entry: changed on one side only → that side; changed on both → merged further down, and where they really
   differ the phone's wins. Entries removed on one side and untouched on the other stay removed. Lists of
   records (films, games, books, sync rows…) are matched by their id, not their position. */
"use strict";
const KEYS = {
  "canonsync.json": { items: x => `${x.source}|${x.kind}|${x.list_name}|${x.key}`, exclusions: x => x.key, canon: x => `${x.franchise}|${x.norm}|${x.year}|${x.origin}`,
    specials: x => x.imdb, franchiseMap: x => `${x.franchise}|${x.norm}|${x.year}`, tmdbCache: x => Array.isArray(x) ? x[0] : null },
  "library.json": { outbox: x => `${x.id}|${x.ts}|${x.op}|${x.s || ""}|${x.e || ""}` },
  "games.json": { games: x => x.id },
  "books.json": { books: x => x.id },
};
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
function keyFor(file, field) {
  const k = (KEYS[file] || {})[field];
  if (k) return k;
  return x => (isObj(x) ? (x.id != null ? "id:" + x.id : x.k != null ? "k:" + x.k : x.key != null ? "key:" + x.key : null) : null);
}
function merge3(base, mine, theirs, file = "", field = "") {
  if (same(mine, theirs)) return mine;
  if (same(mine, base)) return theirs;
  if (same(theirs, base)) return mine;
  // both changed
  if (isObj(mine) && isObj(theirs)) {
    const b = isObj(base) ? base : {}, out = {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const v = merge3(b[k], mine[k], theirs[k], file, field || k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (Array.isArray(mine) && Array.isArray(theirs)) {
    const kf = keyFor(file, field);
    const keyed = arr => { const m = new Map(); for (const x of arr) { const k = kf(x); if (k == null) return null; m.set(k, x); } return m; };
    const M = keyed(mine), T = keyed(theirs), B = keyed(Array.isArray(base) ? base : []) || new Map();
    if (M && T) {
      const out = [];
      for (const [k, x] of M) { const v = merge3(B.get(k), x, T.get(k), file, field); if (v !== undefined) out.push(v); }
      for (const [k, x] of T) if (!M.has(k)) { const v = merge3(B.get(k), undefined, x, file, field); if (v !== undefined) out.push(v); }
      return out;
    }
    // plain values (dates of viewings, tags): everything either side added, minus what either side removed
    if (mine.every(x => !isObj(x) && !Array.isArray(x)) && theirs.every(x => !isObj(x) && !Array.isArray(x))) {
      const bs = new Set(Array.isArray(base) ? base.map(String) : []), ms = new Set(mine.map(String)), ts = new Set(theirs.map(String));
      const out = [];
      for (const x of [...mine, ...theirs]) { const s = String(x); if (out.some(y => String(y) === s)) continue; if (bs.has(s) && (!ms.has(s) || !ts.has(s))) continue; out.push(x); }
      return out;
    }
  }
  return mine === undefined ? (base === undefined ? theirs : undefined) : mine; // a real conflict: the phone's version
}
function mergeText(file, baseText, mineText, theirsText) {
  const P = t => { if (t == null || t === "") return undefined; try { return JSON.parse(t); } catch (e) { return undefined; } };
  const mine = P(mineText), theirs = P(theirsText), base = P(baseText);
  if (mine === undefined) return theirsText || "";
  if (theirs === undefined) return mineText;
  return JSON.stringify(merge3(base === undefined ? {} : base, mine, theirs, file, ""));
}
if (typeof module !== "undefined") module.exports = { merge3, mergeText, KEYS };
