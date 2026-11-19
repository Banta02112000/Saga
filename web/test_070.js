// 0.7.0: the website sync that sends only changes, the history and undo. Runs the real server.
// Run: node test_070.js
const assert = require("assert");
const { spawn } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const SE = require("./shared/entries.js");
const ok = m => console.log("ok  " + m);

(async () => {
  // ---- entries: a file comes apart and back together exactly
  const lib = { v: 1, app: "library", items: { a: { id: "a", title: "Film A", rating: 4 }, b: { id: "b", title: "Show B", eps: { "1:1": 1 } } }, adopted: {}, outbox: [{ id: "a", ts: 1, op: "rate", v: 4 }] };
  const m0 = SE.split("library.json", lib);
  assert.deepStrictEqual(SE.join(m0), lib);
  const cs = { v: 1, settings: { region: "IT", upd_ver: "0.7", tmdb_key: "" }, items: [{ source: "imdb", kind: "rated", list_name: "", key: "tt1", title: "X" }], tmdbCache: [["k", 1]], canon: [] };
  assert.deepStrictEqual(SE.join(SE.split("canonsync.json", cs)), cs);
  const games = { app: "games", v: 1, games: [{ id: "g1", title: "G" }, { id: "g2", title: "H" }], removed: [], settings: {}, meta: { n: 1 } };
  assert.deepStrictEqual(SE.join(SE.split("games.json", games)), games);
  const h0 = SE.hashes("library.json", m0);
  const lib2 = JSON.parse(JSON.stringify(lib)); lib2.items.a.rating = 5; delete lib2.items.b; lib2.items.c = { id: "c", title: "New" };
  const d = SE.diff("library.json", h0, SE.split("library.json", lib2));
  assert.deepStrictEqual(d.map(x => [x[0].split("\t")[1], x.length]).sort(), [["oa", 2], ["ob", 1], ["oc", 2]]);
  assert.ok(SE.isDevice("canonsync.json", "settings\toupd_ver") && !SE.isDevice("canonsync.json", "settings\toregion") && SE.isDevice("canonsync.json", "tmdbCache\tak"));
  ok("files split into entries and back, exactly; changes found by hash");
  const core = fs.readFileSync(path.join(__dirname, "core.js"), "utf8");
  assert.ok(core.includes(SE.DEVICE_RX.source), "per-device settings: the same list in core.js and entries.js");

  // ---- the server
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "saga-070-")), port = 21000 + Math.floor(Math.random() * 2000);
  const srv = spawn(process.execPath, [path.join(__dirname, "../site/server.js")], { env: Object.assign({}, process.env, { SAGA_DATA: data, SAGA_WEB: __dirname, SAGA_PORT: String(port), SAGA_PUBLIC_PORT: "0", SAGA_JOURNAL_MAX: "4000" }), stdio: ["ignore", "inherit", "inherit"] });
  await new Promise(r => setTimeout(r, 900));
  const api = async (p, o = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, o); return { status: r.status, j: await r.json().catch(() => null) }; };
  const post = (p, body, h) => api(p, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, h || {}), body: typeof body === "string" ? body : JSON.stringify(body) });
  const put = (n, text) => api("/api/file/" + n, { method: "PUT", body: text });
  try {
    // the phone's first sync: the whole file (as before), and the revision to start from
    let phone = JSON.parse(JSON.stringify(lib));
    let r = await post("/api/sync/file/library.json", JSON.stringify(phone), { "X-Saga-Version": "0.7.0" });
    assert.strictEqual(r.status, 200); let rev = r.j.rev; assert.ok(rev >= 1, "the first copy is in the history: " + rev);
    let st = { rev, h: SE.hashes("library.json", SE.split("library.json", phone)) };
    const man = (await api("/api/sync/manifest")).j; assert.strictEqual(man.sync2, 1); assert.strictEqual(man.revs["library.json"], rev);
    ok("first sync: whole file, revision " + rev);

    // the phone sends one change: only that entry goes
    const sync = async () => {
      const m = SE.split("library.json", phone), patch = SE.diff("library.json", st.h, m);
      const res = await post("/api/sync2/library.json", { since: st.rev, patch, version: "0.7.0" });
      assert.strictEqual(res.status, 200, JSON.stringify(res.j));
      if (res.j.full) return { full: true };
      SE.apply(m, res.j.changes);
      assert.strictEqual(SE.digest("library.json", m), res.j.digest, "phone and website agree after the sync");
      phone = SE.join(m); st = { rev: res.j.rev, h: SE.hashes("library.json", m) };
      return { patch, changes: res.j.changes };
    };
    phone.items.a.rating = 5;
    let s = await sync();
    assert.strictEqual(s.patch.length, 1); assert.strictEqual(s.changes.length, 0);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(data, "library.json"), "utf8")).items.a.rating, 5);
    ok("a rating changed on the phone: one entry sent");

    // the website changes another title meanwhile; both arrive on both sides
    const web = JSON.parse(fs.readFileSync(path.join(data, "library.json"), "utf8")); web.items.b.eps["1:2"] = 1; web.items.w = { id: "w", title: "Added On The Website" };
    await put("library.json", JSON.stringify(web));
    phone.items.a.notes = "rewatch";
    s = await sync();
    assert.ok(phone.items.w && phone.items.b.eps["1:2"] === 1 && phone.items.a.notes === "rewatch");
    assert.strictEqual(s.changes.length, 2, "only the two titles the website changed come back");
    ok("changes on both sides, each side gets the other's");

    // the same title changed on both: merged field by field, the phone's wins where they really differ
    const web2 = JSON.parse(fs.readFileSync(path.join(data, "library.json"), "utf8")); web2.items.a.tags = ["fav"]; web2.items.a.rating = 3;
    await put("library.json", JSON.stringify(web2));
    phone.items.a.rating = 4;
    await sync();
    assert.deepStrictEqual([phone.items.a.rating, phone.items.a.tags], [4, ["fav"]]);
    ok("the same title on both sides: merged, the phone's rating wins, the website's tag stays");

    // removed on the phone
    delete phone.items.w; s = await sync();
    assert.ok(!JSON.parse(fs.readFileSync(path.join(data, "library.json"), "utf8")).items.w);
    ok("removed on the phone, removed on the website");

    // nothing changed: nothing sent, nothing back
    s = await sync(); assert.strictEqual(s.patch.length, 0); assert.strictEqual(s.changes.length, 0);

    // history and undo
    const hist = (await api("/api/history")).j.items;
    const rate = hist.find(x => x.title === "Film A" && x.fields.some(f => f.f === "rating"));
    assert.ok(rate && rate.what === "changed" && rate.dev, JSON.stringify(hist.slice(0, 3)));
    assert.ok(hist.some(x => x.title === "Added On The Website" && x.what === "removed"));
    const gone = hist.find(x => x.title === "Added On The Website" && x.what === "removed");
    assert.strictEqual((await post("/api/history/undo", { file: gone.file, r: gone.r })).j.ok, true);
    s = await sync();
    assert.ok(phone.items.w && phone.items.w.title === "Added On The Website", "undone on the website, back on the phone");
    ok("history lists who changed what; undoing a removal brings the title back on the phone");

    // device settings never cross; the TMDB cache stays on each side
    const csText = JSON.stringify(cs);
    r = await post("/api/sync/file/canonsync.json", csText); let crev = r.j.rev;
    const csWeb = JSON.parse(fs.readFileSync(path.join(data, "canonsync.json"), "utf8")); csWeb.settings.upd_ver = "9.9"; csWeb.settings.region = "GB"; csWeb.tmdbCache = [["other", 2]];
    await put("canonsync.json", JSON.stringify(csWeb));
    const cm = SE.split("canonsync.json", cs);
    r = await post("/api/sync2/canonsync.json", { since: crev, patch: SE.diff("canonsync.json", SE.hashes("canonsync.json", cm), cm) });
    assert.deepStrictEqual(r.j.changes.map(c => c[0]), ["settings\toregion"]);
    SE.apply(cm, r.j.changes); assert.strictEqual(SE.digest("canonsync.json", cm), r.j.digest);
    ok("per-device settings and the TMDB cache stay out of it");

    // a journal trimmed past where a device was: the whole file once more
    for (let i = 0; i < 40; i++) { const w = JSON.parse(fs.readFileSync(path.join(data, "library.json"), "utf8")); w.items["x" + i] = { id: "x" + i, title: "Filler " + i + " ".repeat(200) }; await put("library.json", JSON.stringify(w)); }
    r = await post("/api/sync2/library.json", { since: 1, patch: [] });
    assert.strictEqual(r.j.full, true);
    ok("too far behind: the whole file again");
    const me = (await api("/api/me")).j; assert.strictEqual(me.phone.version, "0.7.0");
    ok("the website knows which Saga the phone runs");
    console.log("0.7.0 TESTS PASSED");
  } finally { srv.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
