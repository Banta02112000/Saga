// Games and Doctor Who tabs: shared strip/theme, Gemini app copy-and-paste, adaptive widths. Serves the merged asset tree over http.
if (!require("fs").existsSync(require("path").join(__dirname, "../legacy/assets/gc/mine.js"))) { console.log("LEGACY TESTS SKIPPED (they replay Banta's own data, which is not in the public repo)"); process.exit(0); }
const PRIVATE = require("fs").existsSync(require("path").join(__dirname, "../legacy/assets/gc/mine.js")); // personal data, absent from the public repo
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const OUT = process.argv[2] || "/tmp/shots";
const ROOT = path.join(__dirname, "..");
const MAP = { "/shared/": path.join(__dirname, "shared"), "/fonts/": path.join(__dirname, "fonts"), "/gc/": path.join(ROOT, "legacy/assets/gc"), "/dw/": path.join(ROOT, "legacy/assets/dw") };
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split("?")[0]);
  const k = Object.keys(MAP).find(p => u.startsWith(p));
  const f = k && path.join(MAP[k], u.slice(k.length));
  if (!f || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
}).listen(0);
const BASE = () => `http://127.0.0.1:${srv.address().port}`;
const mock = () => {
  // this is Banta's phone with data from earlier versions (the Games list and Doctor Who ratings carry over)
  try { if (localStorage.getItem("gc_mine") === null) localStorage.setItem("gc_mine", "1"); if (localStorage.getItem("dwcanon.mine") === null) localStorage.setItem("dwcanon.mine", "1"); } catch (e) {}
  window.__log = [];
  const fn = name => (...a) => { window.__log.push(name + " " + String(a[0]).slice(0, 80)); return name === "paste" ? (window.__clip || "") : name === "notifEnabled" ? true : ""; };
  // GameCheck's http bridge answers through NET.cbs; fake Microsoft's Game Pass catalog, everything else 404
  const http = (id, url) => {
    window.__log.push("http " + url.slice(0, 90));
    let r = { status: 404, text: "" };
    if (/catalog\.gamepass\.com/.test(url)) r = { status: 200, text: JSON.stringify(/fdd9e2a7/.test(url) ? [{ siglId: "x" }, { id: "9AAA" }, { id: "9BBB" }] : [{ siglId: "y" }]) };
    if (/displaycatalog/.test(url)) r = { status: 200, text: JSON.stringify({ Products: [{ ProductId: "9AAA", LocalizedProperties: [{ ProductTitle: "Mega Man II" }] }, { ProductId: "9BBB", LocalizedProperties: [{ ProductTitle: "Some Other Game for Windows" }] }] }) };
    setTimeout(() => { try { NET.cbs[id] && NET.cbs[id](r); } catch (e) {} }, 5);
  };
  window.Android = new Proxy({}, { get: (_, n) => n === "http" ? http : fn(n), has: () => true });
  if (!window.Banta) window.__bantaMem = { "features.json": "{\"gemini\":1}" };
};
(async () => {
  const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"] }) // no outside network: the same result on any machine;
  const errors = [];
  const page = async (w, h) => { const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 }); p.on("pageerror", e => errors.push(String(e))); await p.addInitScript(mock); return p; };
  const check = async (p, label) => {
    const m = await p.evaluate(() => {
      const s = document.getElementById("bswitch"), on = s && s.querySelector("a.on");
      return { strip: !!s, on: on && on.dataset.app, overflow: document.documentElement.scrollWidth - innerWidth, font: getComputedStyle(document.body).fontFamily };
    });
    if (!m.strip || m.overflow > 1 || !/Atkinson/.test(m.font)) throw new Error(label + " " + JSON.stringify(m));
    return m;
  };

  // ---- Games
  for (const [name, w, h] of [["phone", 412, 915], ["cover", 344, 882], ["unfolded", 884, 1104], ["landscape", 915, 412]]) {
    const p = await page(w, h);
    await p.goto(BASE() + "/gc/index.html");
    await p.waitForTimeout(400);
    const m = await check(p, "games/" + name);
    if (m.on !== "games") throw new Error("games strip");
    await p.screenshot({ path: `${OUT}/gc-${name}.png` });
    if (name === "phone") {
      const top = await p.evaluate(() => document.querySelector(".top").getBoundingClientRect().top);
      if (top < 40) throw new Error("games header under strip: " + top);
      if (!(await p.$eval('#bswitch a[data-app="dw"]', a => a.hidden))) throw new Error("Doctor Who should start hidden");
      await p.click('#bswitch a[data-app="books"]');
      if (!(await p.evaluate(() => window.__log.some(l => l.includes("bantaapps://open/books"))))) throw new Error("games → books switch");
      // AI tab: no key in automatic mode → the Gemini app takes over
      await p.evaluate(() => { document.querySelector('[data-v="vAi"]').click(); });
      await p.waitForTimeout(200);
      await p.screenshot({ path: `${OUT}/gc-ai.png`, fullPage: true });
      // Android back closes the sheet (stopping the step) before anything else
      const back = p.evaluate(() => claude({ prompt: "x", label: "Ask Gemini" }).then(() => "answered", e => "stopped: " + e.message));
      await p.waitForSelector(".bai-sheet");
      if ((await p.evaluate(() => window.__back())) !== true || await p.$(".bai-sheet")) throw new Error("games back didn't close the Gemini sheet");
      if (!/stopped/.test(await back)) throw new Error("games back: step not stopped");
      await p.evaluate(() => { CL.stop = false; CL.running = false; });
      const r = p.evaluate(() => claude({ prompt: "Is Hades worth it?", label: "Ask Gemini" }).then(x => x.text));
      await p.waitForSelector(".bai-sheet");
      const warn = await p.$eval(".bai-note.warn", e => e.textContent);
      if (!/No Gemini API key/.test(warn)) throw new Error("games fallback warning: " + warn);
      await p.click('.bai-sheet [data-a="gem"]');
      await p.waitForTimeout(450);
      const log = await p.evaluate(() => window.__log.join("\n"));
      if (!/copy .*GameCheck/.test(log) || !/openUrl https:\/\/gemini.google.com\/app/.test(log)) throw new Error("games copy/open: " + log);
      await p.screenshot({ path: `${OUT}/gc-ask.png` });
      await p.fill(".bai-in", "Yes. It's a great roguelike.\n<json>{\"verdict\":\"yes\"}</json>");
      await p.click('.bai-sheet [data-a="ok"]');
      const text = await r;
      if (!/great roguelike/.test(text)) throw new Error("games answer: " + text);
      console.log("games: fallback to Gemini app OK");

      // AI tab: multiverse and subscription tools
      await p.evaluate(() => renderAi());
      const aiText = await p.textContent("#aiBody");
      if (!/Group franchises into multiverses/.test(aiText) || !/Check subscription catalogues/.test(aiText)) throw new Error("games AI tab tools missing");
      if (PRIVATE) {
      await p.click('[data-gcx="subs"]');
      await p.waitForSelector(".bai-sheet");
      await p.click('.bai-sheet [data-a="show"]');
      const sp = await p.$eval(".bai-prompt", e => e.value);
      const first = sp.split("Format: id | title | newest version | platform.\n\n")[1].split("\n")[0].split(" | ");
      await p.fill(".bai-in", 'Found one.\n<json>{"subs":[{"id":"' + first[0] + '","services":[{"name":"PS Plus Extra","leaving":"2026-12-15"}]}]}</json>');
      await p.click('.bai-sheet [data-a="ok"]');
      await p.waitForSelector(".bai-sheet");
      await p.click('.bai-sheet [data-a="stop"]');
      await p.waitForFunction(() => !CL.running, null, { timeout: 10000 });
      const subs = await p.evaluate(t => {
        const by = n => all().find(g => g.t === n);
        const a = by(t), mm = by("Mega Man II");
        return { a: (live[a.id].subs || {}).list, mm: (live[mm.id].subs || {}).list, mmId: mm.id };
      }, first[1]);
      if (!subs.a.some(x => x.name === "PS Plus Extra" && x.leaving === "2026-12-15")) throw new Error("games subs from Gemini: " + JSON.stringify(subs.a));
      if (!subs.mm.some(x => x.name === "PC Game Pass" && x.src === "xbox")) throw new Error("games Game Pass from catalog: " + JSON.stringify(subs.mm));
      await p.evaluate(id => openEditor(id), subs.mmId);
      await p.waitForTimeout(200);
      const ed = await p.textContent("#eLinks");
      if (!/PC store/.test(ed) || !/PC Game Pass/.test(ed) || !/Search Steam/.test(ed)) throw new Error("games store box: " + ed.slice(0, 400));
      await p.screenshot({ path: `${OUT}/gc-store.png`, fullPage: true });
      } else console.log("games subscription check skipped (needs the private games list)");
      await p.evaluate(() => closeSh && document.querySelectorAll(".sh.open").forEach(x => x.classList.remove("open")));
      // find missing games for one multiverse → Suggestions
      await p.evaluate(() => { document.querySelector('[data-v="vAi"]').click(); renderAi(); });
      const cq0 = await p.evaluate(() => CQ.length);
      await p.selectOption("#gcxMv", { index: 1 });
      const mvName = await p.$eval("#gcxMv", e => e.value);
      await p.click('[data-gcx="one"]');
      await p.waitForSelector(".bai-sheet");
      await p.fill(".bai-in", '<json>{"missing":[{"title":"Brand New Crossover X","franchise":"' + mvName + '","date":"2027-03-01","platform":"PC","type":"spin-off","why":"announced"}]}</json>');
      await p.click('.bai-sheet [data-a="ok"]');
      await p.waitForFunction(() => !CL.running, null, { timeout: 10000 });
      const cq1 = await p.evaluate(() => CQ.length);
      if (cq1 !== cq0 + 1) throw new Error(`games find missing per multiverse: ${cq0} -> ${cq1}`);
      await p.evaluate(() => renderAi());
      await p.screenshot({ path: `${OUT}/gc-ai-tools.png`, fullPage: true });
      // subscription tag on the card
      await p.evaluate(() => { document.querySelector('[data-v="vGames"]').click(); renderAll(true); });
      await p.waitForTimeout(200);
      if (!(await p.$('.card .tag.sub'))) throw new Error("games: no subscription tag on cards");
      console.log(`games: subscriptions (Gemini + Game Pass catalog), store box, find missing in ${mvName} OK`);
    }
    await p.close();
  }

  // ---- Doctor Who
  for (const [name, w, h] of [["phone", 412, 915], ["cover", 344, 882], ["unfolded", 884, 1104], ["tablet", 1280, 800]]) {
    const p = await page(w, h);
    await p.goto(BASE() + "/dw/index.html");
    await p.waitForTimeout(500);
    const m = await check(p, "dw/" + name);
    if (m.on !== "dw") throw new Error("dw strip");
    if (!(await p.$(".dwx"))) throw new Error("dw overview Gemini panel missing");
    await p.screenshot({ path: `${OUT}/dw-${name}.png` });
    if (name === "phone" || name === "unfolded") {
      // open the first timeline, then Gemini › Find missing stories
      const tid = await p.evaluate(() => { go(1, D.groups[1].tabs[0].id); return D.groups[1].tabs[0].id; });
      await p.waitForTimeout(200);
      await p.screenshot({ path: `${OUT}/dw-${name}-tab.png` });
      await p.click('[data-dwx="menu"]');
      await p.click('[data-dwx="find"]');
      await p.waitForSelector(".bai-sheet");
      await p.click('.bai-sheet [data-a="show"]');
      const prompt = await p.$eval(".bai-prompt", e => e.value);
      const list = prompt.split("MY LIST:\n")[1].trim().split("\n");
      const anchor = list[1].split(" | ").slice(1).join(" | ");
      const known = list[2].split(" | ").slice(1).join(" | ");
      await p.fill(".bai-in", "```json\n" + JSON.stringify([{ title: "The Brand New Adventure", type: "audio", after: anchor, release_date: "2026-12-01", why: "Big Finish" }, { title: known, type: "audio", after: null }]) + "\n```");
      await p.click('.bai-sheet [data-a="ok"]');
      await p.waitForTimeout(200);
      const pend = await p.evaluate(t => (ST.pending[t] || []).map(x => x.title), tid);
      if (pend.length !== 1 || pend[0] !== "The Brand New Adventure") throw new Error("dw pending: " + pend);
      await p.screenshot({ path: `${OUT}/dw-${name}-review.png` });
      await p.click('#sheet .pend .act.y');
      await p.waitForTimeout(200);
      const pos = await p.evaluate(([t, a]) => { const items = tabItems(tabById(t).t).map(i => W(i.k).title); return [items.indexOf(a), items.indexOf("The Brand New Adventure")]; }, [tid, anchor]);
      if (pos[1] !== pos[0] + 1) throw new Error("dw insert position " + pos);
      console.log(`doctor who (${name}): Gemini suggestion approved after '${anchor}'`);
      // where to watch / listen / read
      await p.evaluate(() => closeSheet());
      await p.click('[data-dwx="menu"]');
      await p.click('[data-dwx="avail"]');
      await p.waitForSelector(".bai-sheet");
      await p.fill(".bai-in", JSON.stringify([{ n: 1, italy: [{ service: "Big Finish", how: "buy", note: "download" }], world: [{ service: "BBC Sounds", country: "GB", how: "free" }] }]));
      await p.click('.bai-sheet [data-a="ok"]');
      await p.waitForTimeout(200);
      const k = await p.evaluate(t => { const it = tabItems(tabById(t).t).find(i => ST.avail && ST.avail[i.k]); if (it) itemSheet(it.k, it.id); return it && it.k; }, tid);
      if (!k) throw new Error("dw availability not saved");
      await p.waitForTimeout(200);
      const sh = await p.textContent("#sheet");
      if (!/Where to get it/.test(sh) || !/Big Finish/.test(sh) || !/BBC Sounds/.test(sh)) throw new Error("dw availability not shown: " + sh.slice(0, 300));
      await p.screenshot({ path: `${OUT}/dw-${name}-avail.png` });
    }
    await p.close();
  }
  if (errors.length) throw new Error("page errors: " + errors.join("\n"));
  console.log("LEGACY TESTS PASSED");
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
