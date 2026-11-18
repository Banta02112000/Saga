// 0.6.9.5: one title synced on its own from Trakt (public profile, no sign-in); canon progress without games or
// what's not out yet. Made-up data. Run: node test_0695.js
const assert = require("assert");
const C = require("./core.js");
const calls = [];
const http = async (method, url, o) => {
  calls.push(url);
  const j = b => ({ status: 200, headers: { "x-pagination-page-count": "1" }, body: JSON.stringify(b) });
  const show = { title: "Made Up Show", year: 2020, ids: { trakt: 77, imdb: "tt0777777", slug: "made-up-show" } };
  if (/\/search\/imdb\/tt0777777/.test(url)) return j([{ type: "show", show }]);
  if (/\/users\/someone\/history\/shows\/77/.test(url)) return j([{ watched_at: "2026-11-17T21:00:00.000Z", episode: { season: 2, number: 3 } }, { watched_at: "2026-11-10T21:00:00.000Z", episode: { season: 2, number: 2 } }, { watched_at: "2026-11-01T21:00:00.000Z", episode: { season: 0, number: 1 } }]);
  if (/\/users\/someone\/ratings\/shows/.test(url)) return j([{ rating: 8, show }, { rating: 3, show: { title: "Other", ids: { trakt: 1 } } }]);
  if (/\/users\/someone\/ratings\/episodes/.test(url)) return j([{ rating: 9, show, episode: { season: 2, number: 4 } }]);
  if (/\/users\/someone\/watchlist\/shows/.test(url)) return j([]);
  return { status: 404, headers: {}, body: "" };
};
(async () => {
  const t = await C.traktOne(http, "cid", null, { type: "show", title: "Made Up Show", year: 2020, imdb: "tt0777777" }, "someone");
  assert.deepStrictEqual(t.eps, { "2:3": "2026-11-17", "2:2": "2026-11-10" }, "episodes from the public history, specials left out");
  assert.strictEqual(t.rating, 8); assert.deepStrictEqual(t.epRatings, { "2:4": 9 }); assert.strictEqual(t.watchlisted, false);
  assert.ok(calls.every(u => !/\/sync\//.test(u)), "no sign-in needed: only public profile addresses");
  await assert.rejects(C.traktOne(http, "cid", null, { type: "movie", title: "X" }, ""), /username/);
  console.log("ok  one title from Trakt without a sign-in: episodes with dates, your rating, episode ratings, watchlist");

  const today = "2026-11-18";
  assert.strictEqual(C.isUnreleased({ date: "2027-01-01" }, today), true);
  assert.strictEqual(C.isUnreleased({ date: "2026-11" }, today), false);
  assert.strictEqual(C.isUnreleased({ year: 2030 }, today), true);
  assert.strictEqual(C.isUnreleased({}, today), true, "no date and no year: not out as far as anyone knows");
  assert.strictEqual(C.isUnreleased({ year: 2030, state: "seen" }, today), false);
  const fp = C.franchiseProgress([{ franchise: "F", state: "seen", have: true, unreleased: false, medium: "Movie" }, { franchise: "F", state: "missing", have: false, unreleased: true, medium: "Movie" }, { franchise: "F", state: "missing", have: false, unreleased: false, medium: "Movie" }])[0];
  assert.deepStrictEqual([fp.have, fp.total, fp.upcoming], [1, 2, 1]);
  console.log("ok  canon progress leaves out what isn't out yet");
  // ---- Music: Last.fm (profile, tops, only new scrobbles) and Spotify (tops, recent), and the numbers
  { const M = require("./music.js"); const urls = [];
    const now = Date.parse("2026-11-18T12:00:00Z"), uts = h => Math.floor((now - h * 3600e3) / 1000);
    let scrob = [{ name: "Song A", artist: { "#text": "Artist One" }, album: { "#text": "Album" }, image: [], date: { uts: String(uts(2)) } },
      { name: "Song B", artist: { "#text": "Artist Two" }, album: { "#text": "" }, image: [], date: { uts: String(uts(30)) } },
      { name: "Live Now", artist: { "#text": "Artist One" }, album: { "#text": "" }, image: [], "@attr": { nowplaying: "true" } }];
    const lf = async (m, url) => { urls.push(url); const q = new URL(url).searchParams, j = b => ({ status: 200, headers: {}, body: JSON.stringify(b) });
      if (q.get("api_key") !== "k") return j({ error: 10, message: "Invalid API key" });
      switch (q.get("method")) {
        case "user.getinfo": return j({ user: { name: "someone", playcount: "1234", artist_count: "56", track_count: "300", album_count: "90", registered: { unixtime: "1500000000" } } });
        case "user.gettopartists": return j({ topartists: { artist: [{ name: "Artist One", playcount: "40" }] } });
        case "user.gettoptracks": return j({ toptracks: { track: [{ name: "Song A", artist: { name: "Artist One" }, playcount: "12", image: [] }] } });
        case "user.gettopalbums": return j({ topalbums: { album: [{ name: "Album", artist: { name: "Artist One" }, playcount: "9", image: [] }] } });
        case "user.getrecenttracks": return j({ recenttracks: { track: q.get("from") ? scrob.filter(x => x.date && +x.date.uts >= +q.get("from")) : scrob, "@attr": { totalPages: "1" } } });
      } return { status: 404, headers: {}, body: "{}" }; };
    let d = await M.lastfmSync(lf, "someone", "k", {});
    assert.ok(d.info.playcount === 1234 && d.top["7day"].artists[0].plays === 40 && d.recent.length === 2 && d.now.track === "Live Now", JSON.stringify(d).slice(0, 300));
    scrob = [{ name: "Song C", artist: { "#text": "Artist Three" }, album: { "#text": "" }, image: [], date: { uts: String(uts(1)) } }].concat(scrob);
    d = await M.lastfmSync(lf, "someone", "k", d);
    assert.deepStrictEqual(d.recent.map(x => x.track), ["Song C", "Song A", "Song B"], "only new scrobbles added, newest first");
    assert.ok(urls.some(u => /from=\d+/.test(u)), "the second sync asks only for what's newer");
    await assert.rejects(M.lastfmSync(lf, "someone", "bad", {}), /check the API key/);
    const st = M.stats(d, now);
    assert.ok(st.total7 === 3 && st.days.length === 30 && st.week.length === 3 && st.days[29][1] === 2, JSON.stringify(st));
    const spH = async (m, url, o) => { const j = b => ({ status: 200, headers: {}, body: JSON.stringify(b) });
      if (/accounts\.spotify\.com\/api\/token/.test(url)) return /refresh_token=r1/.test(o.body) ? j({ access_token: "a2", expires_in: 3600 }) : { status: 400, headers: {}, body: '{"error":"invalid_grant"}' };
      if (o.headers.Authorization !== "Bearer a2") return { status: 401, headers: {}, body: "" };
      if (/\/me$/.test(url)) return j({ display_name: "Me", product: "premium" });
      if (/\/me\/top\/artists/.test(url)) return j({ items: [{ name: "Top Artist", genres: ["indie"], images: [{ url: "https://i.scdn.co/a" }] }] });
      if (/\/me\/top\/tracks/.test(url)) return j({ items: [{ name: "Top Song", duration_ms: 200000, artists: [{ name: "Top Artist" }], album: { name: "LP", images: [] } }] });
      if (/recently-played/.test(url)) return j({ items: [{ played_at: "2026-11-18T10:00:00Z", track: { name: "Top Song", duration_ms: 180000, artists: [{ name: "Top Artist" }], album: { name: "LP", images: [] } } }] });
      return { status: 404, headers: {}, body: "" }; };
    const tok = await M.spotifyFresh(spH, { access: "old", refresh: "r1", exp: 0 }, "cid");
    assert.ok(tok.access === "a2" && tok.refresh === "r1", "an expired sign-in is renewed, keeping the refresh token");
    const s2 = await M.spotifySync(spH, tok, {});
    assert.ok(s2.spMe.name === "Me" && s2.spTop.short_term.artists[0].genres[0] === "indie" && s2.spTop.long_term.tracks[0].artist === "Top Artist" && s2.spRecent[0].ms === 180000, JSON.stringify(s2).slice(0, 300));
    assert.ok(/code_challenge_method=S256/.test(M.spotifyAuthUrl("cid", "bantaapps://oauth/spotify", "ch", "st")) && /user-top-read/.test(decodeURIComponent(M.spotifyAuthUrl("cid", "x", "y", "z"))));
    console.log("ok  music: Last.fm profile, tops and only-new scrobbles; Spotify tops and recent plays with sign-in renewal; day and hour numbers"); }
  console.log("0.6.9.5 TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
