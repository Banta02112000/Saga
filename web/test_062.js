// 0.6.2: Store.items() kept between calls, Jellyfin and Plex webhooks, the installable website (manifest, service worker),
// a person's work, the poster picker. Run: node test_062.js
const assert = require("assert");
const { spawn, execFileSync } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const C = require("./core.js"), Lib = require("./library.js"), hooks = require("../site/webhooks.js");
const resp = (b, status = 200) => ({ status, headers: {}, body: typeof b === "string" ? b : JSON.stringify(b) });
const memDb = () => { const db = new C.Store(); db.set("tmdb_key", "k"); return db; };

(async () => {
  // ---- items(): answered from the last answer until a row is added or removed
  { const db = new C.Store();
    db.addItems([{ title: "Alien", year: 1979, imdb: "tt0078748" }, { title: "Aliens", year: 1986, imdb: "tt0090605" }], "imdb", "watched");
    db.addItems([{ title: "Heat", year: 1995, imdb: "tt0113277" }], "trakt", "watchlist");
    let scans = 0; const scan = db.itemsScan.bind(db); db.itemsScan = (a, b) => { scans++; return scan(a, b); };
    const a = db.items("imdb", ["watched"]); db.items("imdb", ["watched"]); db.items("imdb", ["watched"]);
    assert.strictEqual(a.length, 2); assert.strictEqual(scans, 1, "asked three times, worked out once");
    a.pop(); assert.strictEqual(db.items("imdb", ["watched"]).length, 2, "a caller changing its copy changes nothing");
    db.items(); assert.strictEqual(scans, 2, "another question is worked out on its own");
    db.addItems([{ title: "Ronin", year: 1998, imdb: "tt0122690" }], "imdb", "watched");
    assert.strictEqual(db.items("imdb", ["watched"]).length, 3, "a new row shows at once");
    for (const [k, r] of db.itemsMap) if (r.title === "Alien") db.itemsMap.delete(k);
    assert.strictEqual(db.items("imdb", ["watched"]).length, 2, "a removed row goes at once");
    db.reset(); assert.strictEqual(db.items().length, 0, "after a reset");
    console.log("ok  Store.items() kept between calls and refreshed on every change"); }

  // ---- webhooks: reading the payloads
  { const jf = hooks.fromJellyfin({ NotificationType: "PlaybackStop", PlayedToCompletion: "True", ItemType: "Movie", Name: "Heat", Year: 1995, Provider_imdb: "tt0113277", Provider_tmdb: "949" });
    assert.deepStrictEqual(jf, { type: "movie", title: "Heat", year: 1995, imdb: "tt0113277", tmdb: 949 });
    assert.strictEqual(hooks.fromJellyfin({ NotificationType: "PlaybackStop", PlayedToCompletion: false, ItemType: "Movie", Name: "Heat" }), null, "stopped half-way: nothing");
    assert.strictEqual(hooks.fromJellyfin({ NotificationType: "PlaybackStart", ItemType: "Movie", Name: "Heat" }), null);
    const je = hooks.fromJellyfin({ NotificationType: "UserDataSaved", Played: true, SaveReason: "TogglePlayed", ItemType: "Episode", SeriesName: "Severance", SeasonNumber: 1, EpisodeNumber: 3 });
    assert.ok(je.type === "episode" && je.show === "Severance" && je.s === 1 && je.e === 3, JSON.stringify(je));
    const px = hooks.fromPlex({ event: "media.scrobble", Metadata: { type: "movie", title: "Alien", year: 1979, Guid: [{ id: "imdb://tt0078748" }, { id: "tmdb://348" }] } });
    assert.deepStrictEqual(px, { type: "movie", title: "Alien", year: 1979, imdb: "tt0078748", tmdb: 348 });
    assert.strictEqual(hooks.fromPlex({ event: "media.pause", Metadata: { type: "movie", title: "Alien" } }), null);
    const pe = hooks.fromPlex({ event: "media.scrobble", Metadata: { type: "episode", grandparentTitle: "Andor", parentIndex: 2, index: 12 } });
    assert.ok(pe.show === "Andor" && pe.s === 2 && pe.e === 12);
    const b = "----x1"; const mp = Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="payload"\r\nContent-Type: application/json\r\n\r\n{"event":"media.scrobble","Metadata":{"type":"movie","title":"Amélie","year":2001}}\r\n--${b}--\r\n`);
    const pm = hooks.parse("plex", mp, `multipart/form-data; boundary=${b}`);
    assert.strictEqual(pm.title, "Amélie", "multipart and accents");
    console.log("ok  Jellyfin and Plex payloads read"); }

  // ---- webhooks: the library changed
  { const lib0 = new Lib.Library(); lib0.add({ type: "show", title: "Severance", year: 2022, imdb: "tt11280740" }, "watchlist"); lib0.add({ type: "movie", title: "Heat", year: 1995, imdb: "tt0113277" }, "watchlist");
    let text = JSON.stringify(lib0.toJSON());
    const r1 = hooks.apply(text, { type: "movie", title: "Heat", year: 1995, imdb: "tt0113277" }, Lib, "2026-11-16");
    const L1 = new Lib.Library({ load: () => r1.text }), heat = L1.find({ type: "movie", imdb: "tt0113277" });
    assert.ok(heat.status === "watched" && heat.watches.includes("2026-11-16"), JSON.stringify(heat));
    assert.strictEqual(L1.all().length, 2, "found, not added twice");
    assert.strictEqual(hooks.apply(r1.text, { type: "movie", title: "Heat", year: 1995, imdb: "tt0113277" }, Lib, "2026-11-16"), null, "the same viewing sent twice counts once");
    const r2 = hooks.apply(r1.text, { type: "episode", show: "Severance", s: 1, e: 1 }, Lib, "2026-11-16");
    const sev = new Lib.Library({ load: () => r2.text }).find({ type: "show", title: "Severance" });
    assert.ok(sev.eps["1:1"] === "2026-11-16" || sev.eps[Lib.epKey(1, 1)] === "2026-11-16", JSON.stringify(sev.eps));
    assert.strictEqual(sev.status, "watching", "a tick starts the series");
    const r3 = hooks.apply(r2.text, { type: "movie", title: "Past Lives", year: 2023, imdb: "tt13238346" }, Lib, "2026-11-16");
    assert.strictEqual(new Lib.Library({ load: () => r3.text }).find({ type: "movie", imdb: "tt13238346" }).status, "watched", "a film not in the library is added as watched");
    console.log("ok  webhooks tick films and episodes in library.json"); }

  // ---- the server: webhooks with the sync key, manifest, service worker
  { const data = fs.mkdtempSync(path.join(os.tmpdir(), "s62-")), port = 19960, SRV = path.join(__dirname, "../site/server.js");
    const env = Object.assign({}, process.env, { SAGA_DATA: data, SAGA_WEB: __dirname, SAGA_PORT: String(port), SAGA_PUBLIC_PORT: String(port + 1), SAGA_HOST: "127.0.0.1" });
    execFileSync(process.execPath, [SRV, "--set-password", "me", "pw-one-two-three"], { env, stdio: "ignore" });
    execFileSync(process.execPath, [SRV, "--add-user", "friend", "pw-four-five-six"], { env, stdio: "ignore" });
    const auth = JSON.parse(fs.readFileSync(path.join(data, "auth.json"), "utf8")), token = auth.users.me.token, ftoken = auth.users.friend.token;
    const lib0 = new Lib.Library(); lib0.add({ type: "movie", title: "Heat", year: 1995, imdb: "tt0113277" }, "watchlist");
    fs.writeFileSync(path.join(data, "library.json"), JSON.stringify(lib0.toJSON()));
    const srv = spawn(process.execPath, [SRV], { env, stdio: "ignore" });
    try {
      const api = (p, o) => fetch(`http://127.0.0.1:${port + 1}${p}`, o);
      for (let i = 0; i < 40; i++) { try { if ((await api("/api/health")).ok) break; } catch (e) { /* starting */ } await new Promise(r => setTimeout(r, 150)); }
      const jf = JSON.stringify({ NotificationType: "PlaybackStop", PlayedToCompletion: true, ItemType: "Movie", Name: "Heat", Year: 1995, Provider_imdb: "tt0113277" });
      assert.strictEqual((await api("/api/webhook/jellyfin", { method: "POST", body: jf })).status, 401, "no key, no entry");
      assert.strictEqual((await api("/api/webhook/jellyfin?key=wrong", { method: "POST", body: jf })).status, 401);
      const ok1 = await (await api(`/api/webhook/jellyfin?key=${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: jf })).json();
      assert.ok(ok1.changed && ok1.what === "watched", JSON.stringify(ok1));
      const L1 = new Lib.Library({ load: () => fs.readFileSync(path.join(data, "library.json"), "utf8") });
      assert.strictEqual(L1.find({ type: "movie", imdb: "tt0113277" }).status, "watched", "written to the owner's library.json");
      const b = "zz9"; const body = `--${b}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify({ event: "media.scrobble", Metadata: { type: "episode", grandparentTitle: "Andor", parentIndex: 1, index: 2 } })}\r\n--${b}--\r\n`;
      const ok2 = await (await api("/api/webhook/plex", { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${b}`, Authorization: `Bearer ${ftoken}` }, body })).json();
      assert.ok(ok2.changed && /Andor S1 E2/.test(ok2.title), JSON.stringify(ok2));
      const fl = new Lib.Library({ load: () => fs.readFileSync(path.join(data, "users", "friend", "library.json"), "utf8") });
      assert.ok(fl.find({ type: "show", title: "Andor" }), "the friend's key writes to the friend's library");
      assert.ok(!new Lib.Library({ load: () => fs.readFileSync(path.join(data, "library.json"), "utf8") }).find({ type: "show", title: "Andor" }), "and not to yours");
      const man = await api("/manifest.json"); const mj = await man.json();
      assert.ok(man.ok && mj.name === "Saga" && mj.display === "standalone" && mj.icons.length === 2, JSON.stringify(mj));
      assert.ok((await api("/icon-512.png")).ok && (await api("/icon-192.png")).ok, "icons");
      const sw = await api("/sw.js"); const swt = await sw.text();
      assert.ok(sw.ok && /javascript/.test(sw.headers.get("content-type")) && /image\\\.tmdb\\\.org/.test(swt) && /api\\\//.test(swt), "service worker served, never stores /api/");
      const page = await (await api("/", { headers: { Cookie: "" }, redirect: "manual" }));
      assert.strictEqual(page.status, 302, "the page itself still needs signing in");
      const login = await api("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "user=me&password=pw-one-two-three", redirect: "manual" });
      const cookie = String(login.headers.get("set-cookie") || "").split(";")[0];
      const html = await (await api("/", { headers: { Cookie: cookie } })).text();
      assert.ok(/<link rel="manifest" href="manifest.json">/.test(html) && /theme-color/.test(html), "index links the manifest");
      console.log("ok  website: webhooks per user, manifest, icons, service worker");
    } finally { srv.kill(); }
  }

  // ---- a person's work, and the posters of a title
  { const db = memDb();
    const http = async (m, url) => {
      if (/search\/person/.test(url)) return resp({ results: [{ id: 7, name: "Denis Villeneuve", popularity: 9, known_for_department: "Directing" }, { id: 8, name: "Denis V.", popularity: 50 }] });
      if (/person\/7\/combined_credits/.test(url)) return resp({ cast: [{ id: 1, media_type: "tv", name: "Late Show", character: "Himself", first_air_date: "2015-01-01", vote_count: 999 }],
        crew: [{ id: 438631, media_type: "movie", title: "Dune", release_date: "2021-09-15", job: "Director", vote_count: 12000, poster_path: "/d.jpg" }, { id: 438631, media_type: "movie", title: "Dune", release_date: "2021-09-15", job: "Screenplay", vote_count: 12000 },
          { id: 27205, media_type: "movie", title: "Sicario", release_date: "2015-09-17", job: "Director", vote_count: 9000 }] });
      if (/movie\/438631\/images/.test(url)) return resp({ posters: [{ file_path: "/a.jpg", vote_average: 5 }, { file_path: "/b.jpg", vote_average: 6 }] });
      return resp({}, 404);
    };
    const p = await C.personWorks(db, http, "Denis Villeneuve");
    assert.strictEqual(p.id, 7, "the exact name wins over a more popular near-match");
    assert.deepStrictEqual(p.works.map(w => w.title), ["Dune", "Sicario"], "talk-show guest spots left out, most known first");
    assert.deepStrictEqual(p.works[0].roles, ["Director", "Screenplay"], "one title, every role");
    let calls = 0; await C.personWorks(db, async (...a) => { calls++; return http(...a); }, "Denis Villeneuve"); assert.strictEqual(calls, 0, "kept for 14 days");
    const ps = await C.tmdbPosters(db, http, { title: "Dune", tmdb: 438631, medium: "Movie" });
    assert.deepStrictEqual(ps, ["https://image.tmdb.org/t/p/w185/b.jpg", "https://image.tmdb.org/t/p/w185/a.jpg"], "best rated first");
    console.log("ok  person sheet and poster picker data"); }

  console.log("0.6.2 TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
