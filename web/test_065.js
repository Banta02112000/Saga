// 0.6.5: sources that keep failing, suggestions from ratings, the website's app downloads, backups, friends,
// sign-in that returns to where you were going, a games export that imports again. Run: node test_065.js
const assert = require("assert");
const { spawn, execFileSync } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const C = require("./core.js"), G = require("./games.js"), Lib = require("./library.js");
const resp = (b, status = 200) => ({ status, headers: {}, body: typeof b === "string" ? b : JSON.stringify(b) });

(async () => {
  // ---- source health
  { const db = new C.Store(), now = Date.now();
    db.set("sync_state", JSON.stringify({ "IMDb ratings": { ok: false, msg: "HTTP 403", streak: 3, okAt: now - 4 * 864e5 }, "Trakt account": { ok: true, streak: 0 }, "IMDb list x": { ok: false, msg: "once", streak: 1 }, "Never": { ok: false, msg: "no", streak: 2 } }));
    const h = C.sourceHealth(db, now);
    assert.deepStrictEqual(h.map(x => x.label), ["IMDb ratings", "Never"], "one failure is not 'keeps failing'");
    assert.ok(h[0].days === 4 && h[0].msg === "HTTP 403" && h[1].okAt === 0 && h[1].days === null, JSON.stringify(h));
    console.log("ok  sources that keep failing"); }

  // ---- the streak is kept by the sync itself
  { const db = new C.Store(); db.set("imdb_lists", "https://www.imdb.com/list/ls000000001/");
    const http = async () => resp("", 503);
    for (let i = 0; i < 2; i++) await C.syncAll(db, http, () => {}).catch(() => {});
    const st = JSON.parse(db.get("sync_state", "{}")), bad = Object.values(st).find(v => !v.ok);
    assert.ok(bad && bad.streak === 2, "two failed syncs in a row: " + JSON.stringify(st).slice(0, 300));
    console.log("ok  each failed sync adds to the streak"); }

  // ---- suggestions
  { const db = new C.Store(); db.set("tmdb_key", "k"); let calls = 0;
    const http = async (m, url) => { calls++;
      if (/movie\/1\/recommendations/.test(url)) return resp({ results: [{ id: 10, title: "Both Like", release_date: "2001-01-01", vote_average: 8, vote_count: 900, genre_ids: [18] }, { id: 11, title: "Only One", release_date: "2002-01-01", vote_average: 7, vote_count: 900, genre_ids: [35] }, { id: 12, title: "Obscure", vote_count: 3 }] });
      if (/tv\/2\/recommendations/.test(url)) return resp({ results: [{ id: 10, name: "Both Like (tv)", vote_count: 500, vote_average: 7 }] });
      if (/movie\/3\/recommendations/.test(url)) return resp({ results: [{ id: 10, title: "Both Like", vote_average: 8, vote_count: 900, genre_ids: [18] }, { id: 99, title: "Have It", vote_count: 900 }] });
      return resp({}, 404); };
    const seeds = [{ title: "A", type: "movie", tmdb: 1, rating: 10 }, { title: "B", type: "show", tmdb: 2, rating: 8 }, { title: "C", type: "movie", tmdb: 3, rating: 9 }];
    const r = await C.recommend(db, http, seeds, x => x.tmdb === 99);
    assert.strictEqual(r[0].title, "Both Like", "two favourites lead to it: first");
    assert.deepStrictEqual(r[0].because, ["A", "C"]); assert.deepStrictEqual(r[0].genres, ["Drama"]);
    assert.ok(!r.some(x => x.title === "Obscure") && !r.some(x => x.title === "Have It"), "few votes and titles you have are left out");
    assert.ok(r.some(x => x.type === "show" && x.tmdb === 10), "a series and a film with the same number stay apart");
    const n = calls; await C.recommend(db, http, seeds); assert.strictEqual(calls, n, "kept for 3 days");
    console.log("ok  suggestions from your ratings"); }

  // ---- a games export imports again (status, your rating, finished dates)
  { const rows = [["Title", "OG Release Date", "OG Platform", "HLTB", "Franchise", "Next", "Status", "My rating", "Finished dates", "Notes"],
      ["Round Trip", "2010-05-05", "PC", "12", "Trip", "", "done", "9", "2019-01-02 2023-03-04", "great"]];
    const L = new G.Games(); G.fromSheet(L, rows); const g = L.games[0];
    assert.ok(g.status === "done" && g.rating === 9 && g.plays.join() === "2019-01-02,2023-03-04" && g.notes === "great" && g.date === "2010-05-05", JSON.stringify(g));
    console.log("ok  the games export can be imported again"); }

  // ---- the website: app downloads, backup, friends, sign-in that goes back where you were
  { const data = fs.mkdtempSync(path.join(os.tmpdir(), "s65-")), port = 19970, SRV = path.join(__dirname, "../site/server.js");
    const env = Object.assign({}, process.env, { SAGA_DATA: data, SAGA_WEB: __dirname, SAGA_PORT: String(port), SAGA_PUBLIC_PORT: String(port + 1), SAGA_HOST: "127.0.0.1" });
    execFileSync(process.execPath, [SRV, "--set-password", "me", "pw-one-two-three"], { env, stdio: "ignore" });
    execFileSync(process.execPath, [SRV, "--add-user", "pal", "pw-four-five-six"], { env, stdio: "ignore" });
    const auth = JSON.parse(fs.readFileSync(path.join(data, "auth.json"), "utf8")), mine = auth.users.me.token, his = auth.users.pal.token;
    fs.mkdirSync(path.join(data, "apk")); fs.writeFileSync(path.join(data, "apk", "Saga-0.9.9.apk"), "OWN"); fs.writeFileSync(path.join(data, "apk", "Saga-Starter-0.9.9.apk"), "STARTER");
    const L = new Lib.Library(); const a = L.add({ type: "movie", title: "Heat", year: 1995, imdb: "tt0113277" }, "watched").item; a.rating = 9; L.add({ type: "movie", title: "Alien", year: 1979, imdb: "tt0078748" }, "watchlist");
    fs.writeFileSync(path.join(data, "library.json"), JSON.stringify(L.toJSON()));
    const srv = spawn(process.execPath, [SRV], { env, stdio: "ignore" });
    try {
      const api = (p, o = {}) => fetch(`http://127.0.0.1:${port + 1}${p}`, Object.assign({ redirect: "manual" }, o));
      const as = t => ({ headers: { Authorization: "Bearer " + t } });
      for (let i = 0; i < 40; i++) { try { if ((await api("/api/health")).ok) break; } catch (e) { /* starting */ } await new Promise(r => setTimeout(r, 150)); }
      assert.deepStrictEqual((await (await api("/api/apk", as(mine))).json()).map(x => x.name).sort(), ["Saga-0.9.9.apk", "Saga-Starter-0.9.9.apk"], "the owner sees both");
      assert.deepStrictEqual((await (await api("/api/apk", as(his))).json()).map(x => x.name), ["Saga-Starter-0.9.9.apk"], "a friend only the Starter build (yours has your keys)");
      assert.strictEqual((await api("/download/Saga-0.9.9.apk", as(his))).status, 404, "…and can't download yours");
      const dl = await api("/download/Saga-Starter-0.9.9.apk", as(his));
      assert.ok(dl.status === 200 && /android.package-archive/.test(dl.headers.get("content-type")) && (await dl.text()) === "STARTER");
      assert.ok(/Saga-Starter-0\.9\.9\.apk/.test(await (await api("/download", as(his))).text()), "download page");
      // not signed in: sign in, then back to the download page
      const go = await api("/download"); assert.strictEqual(go.headers.get("location"), "login?next=download");
      assert.ok(/name="next" value="download"/.test(await (await api("/login?next=download")).text()));
      const li = await api("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": "4.4.4.4" }, body: "user=pal&password=pw-four-five-six&next=download" });
      assert.strictEqual(new URL(li.headers.get("location"), "http://h/api/auth/login").pathname, "/download", "back to where you were going");
      const evil = await api("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": "4.4.4.5" }, body: "user=pal&password=pw-four-five-six&next=" + encodeURIComponent("//evil.example/x") });
      assert.ok(new URL(evil.headers.get("location"), "http://h/api/auth/login").host === "h", "never to another site");
      // backup
      const bk = await api("/api/backup", as(mine)); const zip = Buffer.from(await bk.arrayBuffer());
      fs.writeFileSync(path.join(data, "b.zip"), zip);
      const listing = execFileSync("unzip", ["-l", path.join(data, "b.zip")]).toString();
      assert.ok(/library\.json/.test(listing) && !/auth\.json|users\/|apk\//.test(listing), "backup: your files, not the sign-in file or other people's: " + listing);
      assert.ok(/library\.json/.test(execFileSync("unzip", ["-t", path.join(data, "b.zip")]).toString()), "a valid ZIP");
      execFileSync(process.execPath, [SRV, "--backup", path.join(data, "all.zip")], { env, stdio: "ignore" });
      assert.ok(/auth\.json/.test(execFileSync("unzip", ["-l", path.join(data, "all.zip")]).toString()), "the full backup has everything");
      // friends: nothing until you share
      assert.deepStrictEqual((await (await api("/api/people", as(his))).json()).people, [], "not shared: nothing");
      await api("/api/share", Object.assign(as(mine), { method: "POST", body: JSON.stringify({ on: true }) }));
      const pp = (await (await api("/api/people", as(his))).json()).people;
      assert.ok(pp.length === 1 && pp[0].name === "me" && pp[0].lib.some(x => x.title === "Heat" && x.rating === 9), JSON.stringify(pp).slice(0, 200));
      assert.ok(!JSON.stringify(pp).includes("notes") && !JSON.stringify(pp).includes("watches"), "titles, status and ratings only");
      assert.deepStrictEqual((await (await api("/api/people", as(mine))).json()).people, [], "he hasn't shared: you see nothing of his");
      console.log("ok  website: downloads per person, backups, friends sharing, sign-in goes back where you were");
    } finally { srv.kill(); }
  }
  console.log("0.6.5 TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
