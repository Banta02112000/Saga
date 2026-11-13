// The Saga website (site/server.js + site/web-shim.js): the app runs in a browser, files are kept by the server,
// calls to other sites go through it, .zip exports are opened. Run: node test_site.js
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exit(1); } console.log("ok  " + m); };
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "saga-site-")), port = 18000 + Math.floor(Math.random() * 2000);
  const srv = spawn(process.execPath, [path.join(__dirname, "../site/server.js")], { env: Object.assign({}, process.env, { SAGA_DATA: data, SAGA_WEB: __dirname, SAGA_PORT: String(port) }), stdio: "inherit" });
  const target = http.createServer((q, r) => { r.writeHead(200, { "Content-Type": "application/json" }); r.end(JSON.stringify({ path: q.url, method: q.method })); }).listen(port + 1, "127.0.0.1");
  await new Promise(r => setTimeout(r, 900));
  const b = await chromium.launch(); const pg = await b.newPage(); const errs = [];
  pg.on("pageerror", e => errs.push(String(e)));
  try {
    await pg.goto(`http://127.0.0.1:${port}/`); await pg.waitForFunction(() => window.__app && document.querySelector("#view"), null, { timeout: 15000 });
    ok(await pg.evaluate(() => !!window.__sagaWeb && !window.__sagaServerError), "the app opens through the server");
    await pg.evaluate(() => { __app.lib.add({ type: "movie", title: "Website Film", year: 2001 }, "watchlist"); __app.lib.save(); __app.db.set("site_test", "yes"); __app.db.flush(true); });
    await pg.waitForFunction(() => __sagaWeb.pending() === 0 && __app.lib.toJSON && !document.hidden, null, { timeout: 15000 });
    await pg.waitForTimeout(6000); await pg.waitForFunction(() => __sagaWeb.pending() === 0);
    ok(fs.existsSync(path.join(data, "canonsync.json")) && JSON.parse(fs.readFileSync(path.join(data, "canonsync.json"), "utf8")).settings.site_test === "yes", "settings saved on the server");
    await pg.reload(); await pg.waitForFunction(() => window.__app, null, { timeout: 15000 });
    ok(await pg.evaluate(() => __app.lib.all().some(x => x.title === "Website Film") && __app.db.get("site_test") === "yes"), "after reloading, everything is still there");
    const r = await pg.evaluate(p => new Promise(res => { const id = "t1"; window.__httpDone = i => res(JSON.parse(Android.take(i))); Android.http(id, "POST", `http://127.0.0.1:${p}/x?y=1`, "Accept: application/json", "{}"); }), port + 1);
    ok(r.status === 200 && r.split === 1 && /\/x\?y=1/.test(await pg.evaluate(() => Android.takeBody("t1"))), "calls to other sites go through the server");
    const bad = await pg.evaluate(() => fetch("api/http", { method: "POST", body: JSON.stringify({ method: "GET", url: "http://example.com/" }) }).then(r => r.json()));
    ok(bad.error === "HTTPS only", "plain http only to your own tailnet or this machine");
    execFileSync("python3", ["-c", `import zipfile; z=zipfile.ZipFile('${data}/../t-${port}.zip','w',zipfile.ZIP_DEFLATED); z.writestr('watched-movies.json','[{"a":1}]'); z.writestr('pic.png',b'x'); z.close()`]);
    const z = JSON.parse(execFileSync("curl", ["-s", "--data-binary", `@${data}/../t-${port}.zip`, `http://127.0.0.1:${port}/api/unzip`]).toString());
    ok(z.zip["watched-movies.json"] === '[{"a":1}]' && z.other[0] === "pic.png", "a .zip export is opened by the server");
    ok(execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-X", "PUT", "--data", "x", `http://127.0.0.1:${port}/api/file/..%2Fescape`]).toString() === "400", "file names can't leave the data folder");
    ok(!errs.length, "no page errors: " + errs.join(" | "));
    console.log("WEBSITE TESTS PASSED");
  } finally { await b.close(); srv.kill(); target.close(); }
})().catch(e => { console.error(e); process.exit(1); });
