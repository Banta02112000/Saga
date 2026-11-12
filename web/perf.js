// Timing harness: CanonSync with a big library (thousands of titles and canon rows), per-tab render cost.
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 412, height: 915 } });
  // Phone-like CPU
  const cdp = await p.context().newCDPSession(p); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await p.addInitScript(() => {
    const files = {};
    window.__saves = 0; window.__saveBytes = 0;
    window.Android = { load: n => files[n] || "", save: (n, t) => { window.__saves++; window.__saveBytes += t.length; files[n] = t; window.__file = t; return true; }, take: () => "", http: () => {}, pick: () => {},
      openUrl: () => {}, openApp: () => {}, copy: () => {}, sha256url: () => "", randomUrl: () => "", version: () => "3.3", notify: () => {}, status: () => {}, clearStatus: () => {},
      setBackground: () => {}, requestNotifications: () => {}, isBackground: () => false, done: () => {}, browse: () => {} };
  });
  const t0 = Date.now();
  await p.goto("file://" + path.join(__dirname, "index.html"));
  await p.waitForFunction(() => window.__app);
  const boot = Date.now() - t0;
  const N = +(process.argv[2] || 3000), M = +(process.argv[3] || 8000);
  const seed = await p.evaluate(([N, M]) => {
    const db = window.__app.db, meds = ["Movie", "TV Series", "Special", "Video Game"];
    const t = performance.now();
    const items = [];
    for (let i = 0; i < N; i++) items.push({ imdb: "tt" + (1000000 + i), title: "Title " + i + " of Saga " + (i % 300), year: 1970 + (i % 56), medium: meds[i % 4], rating: (i % 10) + 1, date: "2024-01-01" });
    db.addItems(items, "imdb", "watched");
    const rows = [];
    for (let i = 0; i < M; i++) rows.push({ franchise: "Saga " + (i % 300), title: (i % 3 ? "Title " + (i * 7 % N) + " of Saga " + (i % 300) : "Missing Entry " + i), year: 1970 + (i % 60), medium: meds[i % 4], date: (2020 + i % 9) + "-0" + (1 + i % 9) + "-15" });
    db.replaceCanon("gemini", rows);
    const map = {}; db.items().forEach((it, i) => map[it.key] = ["Saga " + (i % 300), null]);
    db.set("mv_map", JSON.stringify(map));
    return performance.now() - t;
  }, [N, M]);
  const res = await p.evaluate(() => {
    const out = {}, app = window.__app, C = window.Core;
    let t = performance.now(); const st = C.canonStatus(app.db); out.canonStatus = performance.now() - t; out.rows = st.length;
    t = performance.now(); C.canonStatus(app.db); out.canonStatus2 = performance.now() - t;
    t = performance.now(); C.multiverses(app.db); out.multiverses = performance.now() - t;
    t = performance.now(); C.mvPending(app.db); out.mvPending = performance.now() - t;
    for (const tab of ["home", "upcoming", "missing", "stats", "settings", "home"]) {
      app.ui.tab = tab; t = performance.now(); app.render(); document.body.offsetHeight; out["render_" + tab + (out["render_" + tab] ? "2" : "")] = performance.now() - t;
    }
    out.dom = document.querySelectorAll("*").length;
    return out;
  });
  console.log(JSON.stringify({ boot, seed: Math.round(seed), ...Object.fromEntries(Object.entries(res).map(([k, v]) => [k, Math.round(v)])) }));
  const s0 = await p.evaluate(() => [window.__saves, window.__saveBytes]);
  await p.waitForTimeout(3000);
  const s1 = await p.evaluate(() => [window.__saves, window.__saveBytes]);
  // cold start with that library already saved
  await p.evaluate(() => { window.__app.db.set("last_sync", String(Date.now() / 1000)); window.__app.db.set("bg_enabled", "0"); window.__app.db.flush(); });
  const saved = await p.evaluate(() => { let f = ""; for (const k of ["canonsync.json"]) f = window.__lastSave || ""; return f; });
  const file = await p.evaluate(() => window.__file);
  const p2 = await b.newPage({ viewport: { width: 412, height: 915 } });
  const cdp2 = await p2.context().newCDPSession(p2); await cdp2.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await p2.addInitScript(f => {
    window.__saves = 0;
    window.Android = { load: () => f, save: () => { window.__saves++; return true; }, take: () => "", http: () => {}, pick: () => {}, openUrl: () => {}, openApp: () => {}, copy: () => {}, sha256url: () => "", randomUrl: () => "",
      version: () => "3.3", notify: () => {}, status: () => {}, clearStatus: () => {}, setBackground: () => {}, requestNotifications: () => {}, isBackground: () => false, done: () => {}, browse: () => {}, stamp: () => "1" };
  }, file);
  const c0 = Date.now();
  await p2.goto("file://" + path.join(__dirname, "index.html"));
  await p2.waitForFunction(() => window.__app && document.querySelector("#view").children.length);
  const cold = Date.now() - c0;
  const resume = await p2.evaluate(() => { const t = performance.now(); window.__resumed(); return performance.now() - t; });
  const resume2 = await p2.evaluate(() => { const t = performance.now(); window.__resumed(); return performance.now() - t; });
  await b.close();
  console.log(JSON.stringify({ cold, resume: Math.round(resume), resume2: Math.round(resume2), fileKB: Math.round(file.length / 1024) }));
  return;
  console.log(JSON.stringify({ boot, seed: Math.round(seed), ...Object.fromEntries(Object.entries(res).map(([k, v]) => [k, Math.round(v)])), saves: s1, savesIdle: s1[0] - s0[0] }));
})();
