// The shareable (blank) edition: every tab starts empty, works, and carries none of Banta's data.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const OUT = process.argv[2] || "/tmp/shots";
const STAGE = path.join(OUT, "blank-stage");
fs.rmSync(STAGE, { recursive: true, force: true }); fs.mkdirSync(STAGE, { recursive: true });
execSync(`python3 ${path.join(__dirname, "../legacy/prepare.py")} --out ${STAGE} --scheme canonsyncstarter --blank`);
for (const f of ["index.html", "style.css", "saga.css", "core.js", "extras.js", "app.js", "library.js", "activity.js", "imports.js", "kit.js", "images.js", "games.js", "games-ui.js", "books-ui.js", "timeline.js", "music.js", "website.js", "deals.js", "backup.js", "tidy.js", "rules.js", "foryou.js", "dw-data.js"]) fs.copyFileSync(path.join(__dirname, f), path.join(STAGE, f));
for (const f of ["core.js", "app.js"]) fs.writeFileSync(path.join(STAGE, f), fs.readFileSync(path.join(STAGE, f), "utf8").replace(/PKCE \/ Public Client \(App 000001\)/g, "PKCE (your own Trakt app)").replace(/OAuth OOB \(App 000002\)/g, "OAuth with secret (your own Trakt app)"));
fs.writeFileSync(path.join(STAGE, "preset.js"), "window.CANONSYNC_PRESET = {};\n");
fs.writeFileSync(path.join(STAGE, "core.js"), fs.readFileSync(path.join(STAGE, "core.js"), "utf8").replace(/client_id: "YOUR_TRAKT_CLIENT_ID_PKCE"/, 'client_id: ""').replace(/client_id: "YOUR_TRAKT_CLIENT_ID_OOB"/, 'client_id: ""'));
for (const d of ["shared", "fonts", "books"]) execSync(`cp -r ${path.join(__dirname, d)} ${STAGE}/`);
const LEAKS = /App 2324\d\d|p\.vsme7fnle3pffachw24q4p2jwe|ur00000001|ls100000015|00000000000000000000000000000000|AQ\.REDACTED00|ExampleUser|YOUR_TRAKT_ID_A|YOUR_TRAKT_ID_B/;
for (const f of execSync(`find ${STAGE} -type f -name "*.js" -o -type f -name "*.html"`).toString().trim().split("\n")) if (LEAKS.test(fs.readFileSync(f, "utf8"))) throw new Error("personal data in " + f);

const srv = http.createServer((q, r) => { const f = path.join(STAGE, decodeURIComponent(q.url.split("?")[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" }[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); }).listen(0);
const mock = () => {
  const app = location.pathname.startsWith("/gc/") ? "games" : location.pathname.startsWith("/dw/") ? "dw" : "canon";
  const LS = localStorage;
  window.Banta = { app: () => app, read: n => LS.getItem("f:" + n) || "", write: (n, t) => { LS.setItem("f:" + n, String(t)); return true; }, remove: n => { LS.removeItem("f:" + n); return true; },
    stamp: n => { const v = LS.getItem("f:" + n) || ""; return v.length + ":" + v.slice(-24); }, post: () => {}, take: () => "", busy: () => {}, paste: () => "", shareTo: () => true, notify: () => {}, widget: () => {} };
  if (app === "canon") {
    const results = {}, files = {};
    window.__http = [];
    window.Android = { load: n => files[n] || "", save: (n, t) => { files[n] = t; return true; }, take: id => { const r = results[id]; delete results[id]; return r || ""; },
      http: (id, m, url) => { window.__http.push(url); setTimeout(() => { results[id] = JSON.stringify({ status: 401, headers: {}, body: "" }); window.__httpDone(id); }, 5); },
      browse: id => setTimeout(() => { results[id] = JSON.stringify({ status: 0, value: null, error: "x" }); window.__httpDone(id); }, 5),
      openApp: () => {}, openUrl: () => {}, copy: () => {}, notify: () => {}, status: () => {}, clearStatus: () => {}, setBackground: () => true, requestNotifications: () => {},
      isBackground: () => false, sha256url: s => s, randomUrl: n => "v".repeat(n), version: () => "4.0", stamp: () => "", pick: () => {}, saveAs: () => {} };
  } else window.Android = new Proxy({}, { get: (_, n) => () => (n === "notifEnabled" ? true : ""), has: () => true });
};
(async () => {
  const b = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"] }) // no outside network: the same result on any machine;
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(mock);
  const errors = [];
  const open = async u => { const p = await ctx.newPage(); p.on("pageerror", e => errors.push(u + ": " + e.message)); await p.goto(`http://127.0.0.1:${srv.address().port}${u}`); await p.waitForTimeout(800); return p; };

  const cn = await open("/index.html");
  const st = await cn.evaluate(() => { const s = window.__app.db.settings; return { u: s.username || "", imdb: s.imdb_user || "", lists: s.imdb_lists || "", tmdb: s.tmdb_key || "", gem: s.gemini_key || "", cid: s.client_id || "" }; });
  if (Object.values(st).some(Boolean)) throw new Error("blank Canon has settings filled in: " + JSON.stringify(st));
  await cn.evaluate(() => (window.__app.ui.setGroup = "*", window.__app.setTab("settings")));
  if (!/Your API Apps/.test(await cn.textContent("#view")) || /2324\d\d/.test(await cn.textContent("#view"))) throw new Error("blank Trakt settings");
  await cn.screenshot({ path: `${OUT}/blank-settings.png`, fullPage: true });
  await cn.evaluate(() => window.__app.setTab("home"));
  await cn.click('[data-action="sync"]').catch(() => {});
  await cn.waitForFunction(() => !window.__app.ui.job, null, { timeout: 20000 });
  const urls = await cn.evaluate(() => window.__http.join("\n"));
  if (/vsme|ExampleUser|ls594/.test(urls)) throw new Error("blank Canon fetched Banta's sources:\n" + urls);
  await cn.screenshot({ path: `${OUT}/blank-home.png`, fullPage: true });
  console.log("canon: empty settings, sync with nothing set up runs cleanly (" + (await cn.evaluate(() => window.__app.ui.status)) + ")");

  const gc = await open("/gc/index.html");
  const g = await gc.evaluate(() => ({ n: all().length, user: SET.imdbUser, lists: (SET.imdbLists || []).length }));
  if (g.n || g.user || g.lists) throw new Error("blank Games not empty: " + JSON.stringify(g));
  if (!/No games yet/.test(await gc.textContent("#list"))) throw new Error("blank Games empty state");
  await gc.screenshot({ path: `${OUT}/blank-games.png`, fullPage: true });
  await gc.evaluate(() => { document.querySelector('[data-v="vAi"]').click(); renderAi(); });
  await gc.waitForTimeout(200);
  console.log("games: no games, no IMDb account or lists; AI tab renders");

  const dw = await open("/dw/index.html");
  const d = await dw.evaluate(() => { const ws = Object.keys(D.works).map(k => W(k)); return { works: ws.length, done: ws.filter(w => w.done).length, rated: ws.filter(w => w.rating != null).length }; });
  if (!d.works || d.done || d.rated) throw new Error("blank Doctor Who: " + JSON.stringify(d));
  await dw.screenshot({ path: `${OUT}/blank-dw.png`, fullPage: true });
  console.log(`doctor who: ${d.works} stories in the timelines, none done or rated`);

  const bk = await open("/books/index.html");
  if (!/Start your library/.test(await bk.textContent("#view"))) throw new Error("blank Books not empty");
  if (!(await bk.$eval('#bswitch a[data-app="dw"]', a => a.hidden))) throw new Error("Doctor Who should start hidden");
  if (await bk.evaluate(() => /mine\.js/.test([...document.scripts].map(s => s.src).join()))) throw new Error("mine.js in blank");
  console.log("books: empty library; Doctor Who tab hidden until switched on");
  if (errors.length) throw new Error("page errors:\n" + errors.join("\n"));
  console.log("BLANK EDITION TESTS PASSED");
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
