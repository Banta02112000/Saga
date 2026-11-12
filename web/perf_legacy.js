// Boot time of the Games and Doctor Who pages at phone-like CPU speed.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const MAP = { "/shared/": path.join(__dirname, "shared"), "/fonts/": path.join(__dirname, "fonts"), "/gc/": path.join(ROOT, "legacy/assets/gc"), "/dw/": path.join(ROOT, "legacy/assets/dw") };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]); const k = Object.keys(MAP).find(p => u.startsWith(p)); const f = k && path.join(MAP[k], u.slice(k.length));
  if (!f || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200); fs.createReadStream(f).pipe(r); }).listen(0);
(async () => {
  const b = await chromium.launch();
  for (const app of ["gc", "dw"]) {
    const times = [];
    for (let run = 0; run < 3; run++) {
      const p = await b.newPage({ viewport: { width: 412, height: 915 } });
      const cdp = await p.context().newCDPSession(p); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await p.addInitScript(() => { try { localStorage.setItem("gc_mine", "1"); localStorage.setItem("dwcanon.mine", "1"); } catch (e) {} window.Android = new Proxy({}, { get: () => () => "" }); });
      await p.goto(`http://127.0.0.1:${srv.address().port}/${app}/index.html`, { waitUntil: "load" });
      const m = await p.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), dom: document.querySelectorAll("*").length, longTasks: 0 }; });
      times.push(m);
      await p.close();
    }
    console.log(app, JSON.stringify(times));
  }
  await b.close(); srv.close();
})();
