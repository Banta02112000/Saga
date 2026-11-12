// Updates never overwrite save data; a clean install starts empty. Banta's own build carries her Games list and
// Doctor Who ratings only into a phone that already has her data from an earlier version.
const PRIVATE = require("fs").existsSync(require("path").join(__dirname, "../legacy/assets/gc/mine.js")); // personal data, absent from the public repo
if (!PRIVATE) { console.log("PERSISTENCE TESTS SKIPPED (need the private games and Doctor Who data)"); process.exit(0); }
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const MAP = { "/shared/": path.join(__dirname, "shared"), "/fonts/": path.join(__dirname, "fonts"), "/gc/": path.join(ROOT, "legacy/assets/gc"), "/dw/": path.join(ROOT, "legacy/assets/dw") };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]); const k = Object.keys(MAP).find(p => u.startsWith(p)); const f = k && path.join(MAP[k], u.slice(k.length));
  if (!f || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" }[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); }).listen(0);
const ok = (c, m) => { if (!c) throw new Error(m); };
(async () => {
  const b = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"] }) // no outside network: the same result on any machine;
  const page = async (ctx, u) => { const p = await ctx.newPage(); await p.goto(`http://127.0.0.1:${srv.address().port}${u}`); await p.waitForTimeout(600); return p; };
  const base = () => window.Android = new Proxy({}, { get: () => () => "" });

  // clean install: nothing in storage
  let ctx = await b.newContext(); await ctx.addInitScript(base);
  let gc = await page(ctx, "/gc/index.html");
  ok((await gc.evaluate(() => [all().length, localStorage.getItem("gc_mine"), SET.imdbUser])).join() === "0,0,", "clean Games is empty");
  await gc.reload(); await gc.waitForTimeout(500);
  ok((await gc.evaluate(() => all().length)) === 0, "still empty after the page saved its own data (marker is kept)");
  let dw = await page(ctx, "/dw/index.html");
  const dwClean = await dw.evaluate(() => { const ws = Object.keys(D.works).map(W); return [ws.filter(w => w.done).length, ws.filter(w => w.rating != null).length, localStorage.getItem("dwcanon.mine")]; });
  ok(dwClean.join() === "0,0,0", "clean Doctor Who has no ratings or ticks: " + dwClean);
  console.log("clean install: Games empty, Doctor Who unrated and unticked");
  await ctx.close();

  // update over an earlier version: her save data is there
  ctx = await b.newContext();
  await ctx.addInitScript(() => { window.Android = new Proxy({}, { get: () => () => "" });
    if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");
      if (location.pathname.startsWith("/gc/") && localStorage.getItem("gc_mine") === null) { localStorage.setItem("gc_done", JSON.stringify({ "Mega Man: Dr. Wily's Revenge|July 26, 1991": 1700000000000 })); localStorage.setItem("gc_set", JSON.stringify({ auto: 1, lastSync: 1 })); }
      if (location.pathname.startsWith("/dw/") && localStorage.getItem("dwcanon.mine") === null) localStorage.setItem("dwcanon.v1", JSON.stringify({ works: {}, ui: {} })); } });
  gc = await page(ctx, "/gc/index.html");
  const ID = "Mega Man: Dr. Wily's Revenge|July 26, 1991";
  const g = await gc.evaluate(ID => ({ n: all().length, done: !!done[ID], mine: localStorage.getItem("gc_mine"), base: (JSON.parse(localStorage.getItem("gc_base") || "[]")).length, user: SET.imdbUser, lists: SET.imdbLists.length }), ID);
  ok(g.n === 1305 && g.done && g.mine === "1" && g.base === 1305 && g.user && g.lists === 11, "existing Games data kept, list carried over: " + JSON.stringify(g));
  // an edit sticks across a reload, the shipped list never overwrites it
  await gc.evaluate(ID => { patchRow(ID, { t: "Renamed by me" }); VER++; saveAll(); }, ID);
  await gc.reload(); await gc.waitForTimeout(500);
  ok((await gc.evaluate(ID => all().find(x => x.id === ID).t, ID)) === "Renamed by me", "edit kept after reload");
  // the backup snapshot carries the list
  ok(await gc.evaluate(() => { GCX.publish(); return JSON.parse(BantaShell.shared.read("snap_games.json")).base.length === 1305; }), "backup includes the games list");
  dw = await page(ctx, "/dw/index.html");
  const d = await dw.evaluate(() => { const ws = Object.keys(D.works).map(W); return { done: ws.filter(w => w.done).length, rated: ws.filter(w => w.rating != null).length, moved: Object.keys(ST.works).length, flag: ST.ui.mineMoved }; });
  ok(d.done > 500 && d.rated > 500 && d.moved > 500 && d.flag === 1, "existing Doctor Who data: ratings and ticks kept and moved into save data: " + JSON.stringify(d));
  console.log(`update: ${g.n} games and ${d.done} Doctor Who ticks kept; both now live in save data`);
  await ctx.close();

  // restoring a backup onto a clean install brings the games back
  const snap = await (async () => { const c = await b.newContext(); await c.addInitScript(() => { window.Android = new Proxy({}, { get: () => () => "" }); localStorage.setItem("gc_mine", "1"); });
    const p = await page(c, "/gc/index.html"); const s = await p.evaluate(() => { done[all()[4].id] = 1; window.__g5 = all()[4].id; localStorage.setItem("g5", all()[4].id); saveAll(); GCX.publish(); return BantaShell.shared.read("snap_games.json"); }); await c.close(); return s; })();
  ctx = await b.newContext(); await ctx.addInitScript(base);
  gc = await page(ctx, "/gc/index.html");
  ok((await gc.evaluate(() => all().length)) === 0, "clean before restore");
  await gc.evaluate(s => { BantaShell.shared.write("restore_games.json", s); GCX.applyRestore(); }, snap);
  await gc.waitForTimeout(1200);
  const r = await gc.evaluate(() => ({ n: all().length, done: Object.keys(done).length === 1 }));
  ok(r.n === 1305 && r.done, "restore onto a clean install: " + JSON.stringify(r));
  console.log("restore onto a clean install brings back the games list and progress");
  console.log("PERSISTENCE TESTS PASSED");
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
