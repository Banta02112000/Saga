// 0.8.5: Tonight (what fits the time you have), goals, the Doctor Who queue beyond TV, and the Letterboxd and games
// exports. Made-up data only. Run: node test_085.js
const assert = require("assert");
const ok = m => console.log("ok  " + m);
let saved = null; const store = {};
const toasts = [];
global.window = { Kit: { esc: x => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"), icon: () => "", mods: {}, head: t => `<h2>${t}</h2>`, rail: a => a.join(""), tile: (o, c, c2) => `<div ${o.attrs}>${c}|${c2}</div>`, toast: m => toasts.push(m), confirmTap: () => true } };
global.Saga = { Native: { load: () => saved, save: (n, t) => { saved = t; } }, changed: () => {}, render: () => {} };
require("./dw-data.js"); require("./timeline.js");
const T = window.Kit.mods.timeline;
const L = require("./library.js"), G = require("./games.js");
const lib = new L.Library(null); lib.save = () => {};
const today = new Date().toISOString().slice(0, 10), past = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
// a series you're watching: 10 aired episodes of 40 minutes, 3 watched
const sh = L.blank({ id: "s1", type: "show", title: "Harbour Lights", status: "watching", runtime: 40, epl: Array.from({ length: 10 }, (_, i) => [1, i + 1, past(100 - i), `Ep ${i + 1}`, 40]), eps: { [L.epKey(1, 1)]: past(3), [L.epKey(1, 2)]: past(2), [L.epKey(1, 3)]: past(1) } });
const film1 = L.blank({ id: "m1", type: "movie", title: "Short Film", status: "watchlist", runtime: 85, added: 1 });
const film2 = L.blank({ id: "m2", type: "movie", title: "Very Long Epic", status: "watchlist", runtime: 210, added: 0 });
const seen = L.blank({ id: "m3", type: "movie", title: "Seen Twice, \"Quoted\"", year: 1999, imdb: "tt0000001", status: "watched", rating: 7, watches: ["2020-05-01", "2024-06-02"] });
const seen2 = L.blank({ id: "m4", type: "movie", title: "No Date", year: 2001, status: "watched", rating: 10, watches: [] });
for (const it of [sh, film1, film2, seen, seen2]) lib.items[it.id] = it;
const games = new G.Games(null); games.save = () => {};
const g1 = G.blank({ id: "g1", title: "Stone Quest", status: "playing", hours: 10, sessions: [{ d: past(1), mins: 120 }], platform: "PC", date: "2019-03-01", rating: 8, franchise: "Stone", multiverse: "Stone" });
const g2 = G.blank({ id: "g2", title: "Stone Quest 2", status: "done", plays: ["2025-01-02"], date: "2021-03-01", franchise: "Stone", multiverse: "Stone", versions: [{ title: "Stone Quest 2 Remake", date: "2025-02-01", kind: "remake" }] });
const g3 = G.blank({ id: "g3", title: "Stone Quest 3", status: "backlog", date: "2023-03-01", franchise: "Stone", multiverse: "Stone" });
games.games.push(g1, g2, g3);
const books = { books: [{ id: "b1", title: "A Thick Book", status: "reading", pages: 600, currentPage: 100 }] };
const db = { get: (k, d) => (k in store ? store[k] : d), set: (k, v) => { store[k] = v; } };
let rendered = 0, sheet = "", savedFile = null;
window.__app = { lib, games, books, db, secOn: () => true, render: () => rendered++, yearCounts: () => ({ films: 3, episodes: 40, games: 2, books: 1 }),
  Native: { saveAs: (n, t) => { savedFile = { n, t }; return Promise.resolve(true); } } };
window.Saga = { sheet: h => { sheet = h; }, close: () => {} };
require("./tonight.js");
const X = window.SagaExtras, act = window.Kit.mods.tonight.act;
(async () => {
  // ---- Tonight
  let p = X.tonightPicks(60);
  const ser = p.find(x => x.kind === "series");
  assert(ser && /^1 episode from S1 E4/.test(ser.why), JSON.stringify(ser));
  assert(!p.some(x => x.kind === "film"), "an 85-minute film doesn't fit an hour");
  p = X.tonightPicks(120);
  assert(/^3 episodes from S1 E4 · 2 h/.test(p.find(x => x.kind === "series").why));
  assert.strictEqual(p.find(x => x.kind === "film").title, "Short Film");
  assert(!p.some(x => x.title === "Very Long Epic"));
  assert(/about 8 h to finish/.test(p.find(x => x.kind === "game").why), p.find(x => x.kind === "game").why);
  assert(/about 96 pages · 500 left/.test(p.find(x => x.kind === "book").why));
  let h = X.homeCards();
  assert(/How much time/.test(h) && !/Stone Quest/.test(h), "no picks until a chip is tapped");
  act("xtonight", { dataset: { v: "120" } });
  h = X.homeCards(); assert(/aria-pressed="true">2 h/.test(h) && /Stone Quest/.test(h) && /data-action="gopen" data-id="g1"/.test(h));
  act("xtonight", { dataset: { v: "120" } }); assert(!/Stone Quest/.test(X.homeCards()), "tapping the chip again hides them");
  ok("Tonight: an episode run, a film that fits, a game session, pages of a book");
  // ---- goals
  assert(/Set a goal for/.test(X.homeCards()));
  act("xgoaladd", {}); assert(/Finish a games multiverse/.test(sheet) && /Finish a series/.test(sheet) && /Harbour Lights/.test(sheet));
  const vals = { xgK: "books", xgN: "12", xgB: "" };
  global.document = { getElementById: id => (id in vals ? { value: vals[id] } : null) };
  act("xgoalsave", {});
  vals.xgK = "multiverse"; vals.xgM = "Stone"; act("xgoalsave", {});
  vals.xgK = "series"; vals.xgS = "s1"; act("xgoalsave", {});
  vals.xgK = "multiverse"; vals.xgM = ""; act("xgoalsave", {}); assert.strictEqual(toasts.pop(), "Pick a multiverse");
  const gl = JSON.parse(store.goals); assert.strictEqual(gl.length, 3);
  assert.deepStrictEqual(X.progressOf(gl[0]), { done: 1, total: 12 });
  const mv = X.progressOf(gl[1]); assert.strictEqual(mv.total, 3); assert.strictEqual(mv.done, 1);
  assert.deepStrictEqual(X.progressOf(gl[2]), { done: 3, total: 10 });
  h = X.homeCards(); assert(/12 books in/.test(h) && /Finish Stone/.test(h) && /Finish Harbour Lights/.test(h) && /1\/12/.test(h) && /3\/10/.test(h));
  // pace: 12 in a year, half the year gone, 3 done → 3 behind
  const y = new Date().getFullYear();
  const half = { kind: "books", n: 12, year: y, from: past(100), by: new Date(Date.now() + 100 * 864e5).toISOString().slice(0, 10) };
  assert(/^5 behind · 100 days left$/.test(X.paceOf(half, { done: 1, total: 12 })), X.paceOf(half, { done: 1, total: 12 }));
  assert(/^on track/.test(X.paceOf(half, { done: 6, total: 12 }))); assert.strictEqual(X.paceOf(half, { done: 12, total: 12 }), "done");
  act("xgoaldel", { dataset: { id: gl[0].id } }); assert.strictEqual(JSON.parse(store.goals).length, 2);
  delete lib.items.s1; assert(X.progressOf(gl[2]).gone, "a series you removed");
  lib.items.s1 = sh;
  ok("goals: counts, a multiverse, a series, pace, remove");
  assert(!/Doctor Who: next/.test(X.homeCards()), "no queue before you've started the timeline");
  // ---- Doctor Who queue: only stories that aren't TV, in timeline order, skipping what's done
  const q = T.queue(10, ["audio", "comic", "short", "novel"]);
  assert.strictEqual(q.length, 10); assert(q.every(x => ["audio", "comic", "short", "novel"].includes(x.type)));
  assert(new Set(q.map(x => x.k)).size === 10);
  const tv = T.queue(5, ["tv"]); assert(tv.length && tv.every(x => x.type === "tv"));
  const st = JSON.parse(saved || "{}"); st.works = st.works || {}; st.works[q[0].k] = { done: true }; saved = JSON.stringify(st);
  // the timeline caches its state: drop the cache by re-reading through a fresh module
  delete require.cache[require.resolve("./timeline.js")]; require("./timeline.js");
  const q2 = window.Kit.mods.timeline.queue(10, ["audio", "comic", "short", "novel"]);
  assert(!q2.some(x => x.k === q[0].k), "a story you've done leaves the queue");
  assert(/Doctor Who: next 10 beyond TV/.test(X.homeCards()) && /data-action="tlopen"/.test(X.homeCards()));
  ok("Doctor Who: the next 10 beyond TV");
  // ---- exports
  const lb = X.letterboxdCsv().text.trim().split("\n");
  assert.strictEqual(lb[0], "Title,Year,imdbID,WatchedDate,Rating,Rewatch");
  assert.strictEqual(lb[1], `"Seen Twice, ""Quoted""",1999,tt0000001,2020-05-01,,`);
  assert.strictEqual(lb[2], `"Seen Twice, ""Quoted""",1999,tt0000001,2024-06-02,3.5,Yes`);
  assert.strictEqual(lb[3], "No Date,2001,,,5,");
  assert.strictEqual(lb.length, 4, "watchlist films aren't exported");
  const gc = X.gamesCsv().text.trim().split("\n");
  assert(/^Title,Platform,Release Date,Status/.test(gc[0]));
  assert(gc.some(l => l === "Stone Quest 2,,2021-03-01,Completed,,2025-01-02,,Stone,Stone,Stone Quest 2 Remake (2025)"), gc.join("\n"));
  assert(gc.some(l => /^Stone Quest,PC,2019-03-01,Playing,8,,10,/.test(l)));
  act("xexport", { dataset: { v: "letterboxd" } }); await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(savedFile.n, "saga-letterboxd.csv"); assert(/3 rows saved/.test(toasts.pop()));
  assert(/Letterboxd/.test(X.exportHtml()));
  ok("exports: Letterboxd CSV (one row per watch, rating out of 5) and games CSV");
  console.log("ALL OK");
})().catch(e => { console.error(e); process.exit(1); });
