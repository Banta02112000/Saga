// The Saga website (site/server.js + site/web-shim.js): the app runs in a browser, files are kept by the server,
// calls to other sites go through it, .zip exports are opened. Run: node test_site.js
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exit(1); } console.log("ok  " + m); };
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "saga-site-")), port = 18000 + Math.floor(Math.random() * 2000);
  const srv = spawn(process.execPath, [path.join(__dirname, "../site/server.js")], { env: Object.assign({}, process.env, { SAGA_DATA: data, SAGA_WEB: __dirname, SAGA_PORT: String(port), SAGA_PUBLIC_PORT: String(port + 2) }), stdio: "inherit" });
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
    // 0.6.2: installable; the app's files are kept for when the server can't be reached, your data never is
    const swOk = await pg.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active));
    await pg.reload(); await pg.waitForFunction(() => window.__app, null, { timeout: 15000 });
    const kept = await pg.evaluate(async () => { const c = await caches.open("saga-shell-1"); const k = (await c.keys()).map(r => new URL(r.url).pathname); return k; });
    ok(swOk && kept.includes("/app.js") && kept.some(k => k === "/" || k === "/index.html") && !kept.some(k => k.startsWith("/api/")), "service worker keeps the app, not the data: " + kept.slice(0, 6).join(" "));
    const r = await pg.evaluate(p => new Promise(res => { const id = "t1"; window.__httpDone = i => res(JSON.parse(Android.take(i))); Android.http(id, "POST", `http://127.0.0.1:${p}/x?y=1`, "Accept: application/json", "{}"); }), port + 1);
    ok(r.status === 200 && r.split === 1 && /\/x\?y=1/.test(await pg.evaluate(() => Android.takeBody("t1"))), "calls to other sites go through the server");
    const bad = await pg.evaluate(() => fetch("api/http", { method: "POST", body: JSON.stringify({ method: "GET", url: "http://example.com/" }) }).then(r => r.json()));
    ok(bad.error === "HTTPS only", "plain http only to your own tailnet or this machine");
    execFileSync("python3", ["-c", `import zipfile; z=zipfile.ZipFile('${data}/../t-${port}.zip','w',zipfile.ZIP_DEFLATED); z.writestr('watched-movies.json','[{"a":1}]'); z.writestr('pic.png',b'x'); z.close()`]);
    const z = JSON.parse(execFileSync("curl", ["-s", "--data-binary", `@${data}/../t-${port}.zip`, `http://127.0.0.1:${port}/api/unzip`]).toString());
    ok(z.zip["watched-movies.json"] === '[{"a":1}]' && z.other[0] === "pic.png", "a .zip export is opened by the server");
    ok(execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-X", "PUT", "--data", "x", `http://127.0.0.1:${port}/api/file/..%2Fescape`]).toString() === "400", "file names can't leave the data folder");
    // ---- 0.5.9: two-way sync with the phone, and a merge instead of an overwrite for a page that loaded an older file
    const H = (extra) => Object.assign({ "Content-Type": "text/plain" }, extra || {});
    const api = (pth, o) => fetch(`http://127.0.0.1:${port}${pth}`, o);
    const libNow = JSON.parse(fs.readFileSync(path.join(data, "library.json"), "utf8"));
    const phone = JSON.parse(JSON.stringify(libNow)); const fid = Object.keys(phone.items).find(k => phone.items[k].title === "Website Film");
    // first contact: the server's copy is the starting point (no base yet: the phone's version wins where they differ)
    let r1 = await (await api("/api/sync/file/library.json", { method: "POST", headers: H(), body: JSON.stringify(phone) })).json();
    ok(r1.sha256 && JSON.parse(r1.text).items[fid], "phone sync: first merge");
    // the website changes a note, the phone a rating, on the same film: both survive
    const web = JSON.parse(r1.text); web.items[fid].notes = "from the website";
    await api("/api/file/library.json", { method: "PUT", headers: H(), body: JSON.stringify(web) });
    const ph2 = JSON.parse(r1.text); ph2.items[fid].rating = 8; ph2.items["phoneonly"] = { id: "phoneonly", type: "movie", title: "Phone Film", watches: [], eps: {}, status: "watchlist" };
    const r2 = await (await api("/api/sync/file/library.json", { method: "POST", headers: H(), body: JSON.stringify(ph2) })).json();
    const m2 = JSON.parse(r2.text);
    ok(m2.items[fid].notes === "from the website" && m2.items[fid].rating === 8 && m2.items.phoneonly, "phone and website edits of the same film merged: " + JSON.stringify(m2.items[fid]));
    const man = await (await api("/api/sync/manifest")).json();
    ok(man.files["library.json"].sha256 === r2.sha256, "manifest gives each file's hash");
    // a page still holding the old version saves: merged on the server, not overwritten
    const oldSha = (await api("/api/all")).headers.get("x-sha"); // remember current
    const cur = JSON.parse(fs.readFileSync(path.join(data, "library.json"), "utf8"));
    const curSha = JSON.parse(oldSha)["library.json"];
    await api("/api/sync/file/library.json", { method: "POST", headers: H(), body: JSON.stringify(Object.assign({}, m2, { items: Object.assign({}, m2.items, { p2: { id: "p2", title: "Phone Two", watches: [], eps: {} } }) })) });
    const stale = JSON.parse(JSON.stringify(cur)); stale.items[fid].tags = ["web tag"];
    const pr = await (await api("/api/file/library.json", { method: "PUT", headers: H({ "X-Base-Sha": curSha }), body: JSON.stringify(stale) })).json();
    const after = JSON.parse(fs.readFileSync(path.join(data, "library.json"), "utf8"));
    ok(pr.merged && after.items.p2 && (after.items[fid].tags || []).includes("web tag"), "an older page's save is merged with the phone's newer changes");
    // ---- signing in: the public entrance is shut without a password, then needs it
    const pub = port + 2;
    const g = await fetch(`http://127.0.0.1:${pub}/`, { redirect: "manual" });
    ok(g.status === 302 && /login/.test(g.headers.get("location")), "public entrance without a password: sent to the sign-in page");
    const out = execFileSync(process.execPath, [path.join(__dirname, "../site/server.js"), "--set-password", "banta", "correct horse"], { env: Object.assign({}, process.env, { SAGA_DATA: data }) }).toString();
    const token = out.trim().split(/\s+/).pop();
    ok(token.length > 20 && fs.statSync(path.join(data, "auth.json")).mode % 512 === 0o600, "password set, sync key printed, auth.json private");
    ok((await fetch(`http://127.0.0.1:${pub}/api/all`)).status === 401, "public API needs the key");
    ok((await fetch(`http://127.0.0.1:${pub}/api/sync/manifest`, { headers: { Authorization: "Bearer " + token } })).status === 200, "the phone's sync key works");
    ok((await fetch(`http://127.0.0.1:${pub}/api/all`, { headers: { "Tailscale-User-Login": "x@y" } })).status === 401, "the public entrance never trusts a Tailscale header");
    ok((await api("/api/all", { headers: { "Tailscale-User-Login": "banta@tailnet" } })).status === 200 && (await api("/api/all")).status === 401, "tailnet port: Tailscale users in, others asked");
    const login = pw => fetch(`http://127.0.0.1:${pub}/api/auth/login`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": "9.9.9.9" }, body: "user=banta&password=" + encodeURIComponent(pw) });
    ok((await login("wrong")).status === 401, "wrong password refused");
    const good = await login("correct horse"); const cookie = (good.headers.get("set-cookie") || "").split(";")[0];
    ok(good.status === 303 && /^saga_session=banta\.\d+\./.test(cookie) && /HttpOnly; Secure; SameSite=Strict/.test(good.headers.get("set-cookie")), "right password: a 30-day session cookie");
    ok((await fetch(`http://127.0.0.1:${pub}/api/all`, { headers: { Cookie: cookie } })).status === 200, "signed-in browser gets in");
    ok((await fetch(`http://127.0.0.1:${pub}/api/all`, { headers: { Cookie: cookie.replace(/.$/, c => (c === "a" ? "b" : "a")) } })).status === 401, "a tampered cookie doesn't");
    for (let i = 0; i < 5; i++) await login("wrong");
    ok((await login("correct horse")).status === 429, "after 5 wrong passwords: wait");
    // ---- 0.6.1: a second person with their own password, sync key and files
    const out2 = execFileSync(process.execPath, [path.join(__dirname, "../site/server.js"), "--add-user", "marco", "another secret"], { env: Object.assign({}, process.env, { SAGA_DATA: data }) }).toString();
    const tok2 = out2.trim().split(/\s+/).pop();
    ok(tok2 !== token && /marco/.test(out2), "a second account with its own sync key");
    await new Promise(r => setTimeout(r, 50));
    const mine = await (await fetch(`http://127.0.0.1:${pub}/api/all`, { headers: { Authorization: "Bearer " + token } })).json();
    const his0 = await (await fetch(`http://127.0.0.1:${pub}/api/all`, { headers: { Authorization: "Bearer " + tok2 } })).json();
    ok(mine["library.json"] && !his0["library.json"], "each person sees only their own files");
    await fetch(`http://127.0.0.1:${pub}/api/file/games.json`, { method: "PUT", headers: { Authorization: "Bearer " + tok2 }, body: '{"games":[{"id":"g1","title":"Marco Game"}]}' });
    ok(fs.existsSync(path.join(data, "users", "marco", "games.json")) && !/Marco Game/.test(String(fs.existsSync(path.join(data, "games.json")) && fs.readFileSync(path.join(data, "games.json")))), "his changes go to his own folder");
    const login2 = await fetch(`http://127.0.0.1:${pub}/api/auth/login`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": "8.8.8.8" }, body: "user=marco&password=" + encodeURIComponent("another secret") });
    const c2 = (login2.headers.get("set-cookie") || "").split(";")[0];
    const me2 = await (await fetch(`http://127.0.0.1:${pub}/api/me`, { headers: { Cookie: c2 } })).json();
    ok(login2.status === 303 && me2.user === "marco", "he signs in with his name: " + JSON.stringify(me2));
    const wrongName = await fetch(`http://127.0.0.1:${pub}/api/auth/login`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": "7.7.7.7" }, body: "user=banta&password=" + encodeURIComponent("another secret") });
    ok(wrongName.status === 401, "his password doesn't open your account");
    ok(!errs.length, "no page errors: " + errs.join(" | "));
    console.log("WEBSITE TESTS PASSED");
  } finally { await b.close(); srv.kill(); target.close(); }
})().catch(e => { console.error(e); process.exit(1); });
