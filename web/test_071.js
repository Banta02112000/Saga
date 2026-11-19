// 0.7.1: your game-details prompt word for word, reading its answer, and Games › Missing checked against IMDb.
// Made-up data. Run: node test_071.js
const assert = require("assert");
const G = require("./games.js"), C = require("./core.js");
const ok = m => console.log("ok  " + m);
(async () => {
  // ---- the prompt, exactly as written
  const exact = "Tell me: game Title, OG Release Date, OG best Platform, Remake Name,re-released, remastered, Remake Release Date, re-released, remastered, Remake best Platform, HLTB\ndates month in letters day in number and year (january 1, 1900)\nremakes count only if they cover the same story\nfor this game\nMade Up Saga";
  assert.strictEqual(G.infoPromptOne("Made Up Saga"), exact);
  ok("your prompt, word for word, one game");

  // ---- answers in the shapes an AI gives them
  const a1 = `**Game Title:** Made Up Saga
**OG Release Date:** November 6, 2007
**OG best Platform:** PlayStation 3 (the PS2 version is weaker)
**Remake Name, re-released, remastered:** Made Up Saga Remastered
**Remake Release Date:** March 3, 2016
**Remake best Platform:** PC
**HLTB:** Main Story 12.5 hours · Main + Extras 18 hours`;
  let r = G.parseInfoText(a1, "Made Up Saga");
  assert.deepStrictEqual([r.date, r.platform, r.remake && r.remake.title, r.remake && r.remake.date, r.remake && r.remake.platform, r.hours], ["2007-11-06", "PlayStation 3", "Made Up Saga Remastered", "2016-03-03", "PC", 12.5]);
  const a2 = `- Title: Other Made Up Game\n- OG Release Date: 21st September 1998 (Japan)\n- OG best Platform: Nintendo 64\n- Remake Name: None (no remake covers the same story)\n- Remake Release Date: N/A\n- Remake best Platform: N/A\n- HLTB: about 30 hours`;
  r = G.parseInfoText(a2, "Other Made Up Game");
  assert.deepStrictEqual([r.date, r.platform, r.remake, r.hours], ["1998-09-21", "Nintendo 64", null, 30]);
  const a3 = `| Field | Value |\n|---|---|\n| OG Release Date | January 1, 1900 |\n| OG best Platform | PC |\n| Remake Name | — |\n| HLTB | 7 |`;
  r = G.parseInfoText(a3, "Third");
  assert.deepStrictEqual([r.date, r.platform, r.remake, r.hours], ["1900-01-01", "PC", null, 7]);
  ok("answers read from labelled lines, lists and tables; None/N/A left empty");
  const lib = new G.Games(null);
  const { game } = lib.add({ title: "Made Up Saga" }, "backlog");
  game.platform = "My Own Pick";
  G.applyInfo(lib, [game], [G.parseInfoText(a1, "Made Up Saga")]);
  assert.strictEqual(game.platform, "My Own Pick", "your own edits win"); assert.strictEqual(game.date, "2007-11-06"); assert.strictEqual(game.hours, 12.5);
  ok("only empty fields are filled");

  // ---- Games › Missing against IMDb
  const games = new G.Games(null);
  const rows = [{ title: "Made Up Racer", year: 2001, franchise: "Racers" }, { title: "Made Up Racer 2", year: 2003, franchise: "Racers" }, { title: "Made Up Racer 3", year: 2005, franchise: "Racers" }, { title: "Nowhere Game", year: 2010, franchise: "X" }];
  const mine = [{ medium: "Video Game", source: "imdb", title: "Made Up Racer", year: 2001, imdb: "tt9000001", rating: 8, kind: "rated" },
    { medium: "Video Game", source: "imdb", title: "Made Up Racer II", year: 2003, imdb: "tt9000002", rating: 0, kind: "watchlist" }];
  const http = async (m, url) => {
    if (/suggestion\/x\/made%20up%20racer%202/.test(url)) return { status: 200, body: JSON.stringify({ d: [{ id: "tt9000002", l: "Made Up Racer 2", y: 2003, qid: "videoGame" }] }) };
    if (/suggestion\/x\/made%20up%20racer%203/.test(url)) return { status: 200, body: JSON.stringify({ d: [{ id: "tt9000003", l: "Made Up Racer 3", y: 2005, qid: "videoGame" }] }) };
    if (/suggestion/.test(url)) return { status: 200, body: JSON.stringify({ d: [] }) };
    return { status: 404, body: "" };
  };
  const gql = async q => ({ titles: [{ id: "tt9000003", ratingsSummary: { aggregateRating: 7.4, voteCount: 1200 } }, { id: "tt9000002", ratingsSummary: { aggregateRating: 6.1, voteCount: 300 } }] });
  const res = await G.imdbCheckMissing(games, rows, mine, http, gql, { gap: 0 });
  assert.deepStrictEqual([res.finished, res.wishlist, res.found, res.notFound], [1, 1, 1, 1], JSON.stringify(res));
  const racer = games.find({ title: "Made Up Racer" }); assert.ok(racer && racer.status === "done" && racer.rating === 8, "rated on IMDb: finished, with your rating");
  const r2 = games.find({ title: "Made Up Racer II" }); assert.ok(r2 && r2.status === "wishlist" && r2.aka.includes("Made Up Racer 2"), "listed on IMDb: wishlist, matched by its IMDb id");
  assert.strictEqual(games.meta.canonImdb["madeupracer3|2005"].r, 7.4, "IMDb's rating kept for the one you haven't rated");
  assert.ok(games.meta.canonImdb["nowheregame|2010"].none, "not on IMDb: remembered, not searched again");
  // the canon list's name now finds the game it came in as
  const db = new C.Store();
  db.replaceCanon("ai", [{ franchise: "Racers", title: "Made Up Racer 2", year: 2003, medium: "Video Game", norm: C.norm("Made Up Racer 2") }]);
  assert.ok(C.gameCanon(db, games.visible()).find(c => c.title === "Made Up Racer 2").have, "Missing no longer lists it");
  ok("Games › Missing on IMDb: rated → finished, listed → wishlist, IMDb's rating for the rest");
  console.log("0.7.1 TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
