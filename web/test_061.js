// 0.6.1: Steam DLC and studio, games from IMDb search (consoles), anime relations. Run: node test_061.js
const assert = require("assert");
const G = require("./games.js"), L = require("./library.js");
const resp = (b, status = 200) => ({ status, headers: {}, body: typeof b === "string" ? b : JSON.stringify(b) });
(async () => {
  { const http = async (m, url) => {
      const id = +url.match(/appids=(\d+)/)[1];
      if (id === 292030) return resp({ 292030: { success: true, data: { name: "The Witcher 3", developers: ["CD PROJEKT RED"], publishers: ["CD PROJEKT"], dlc: [378648, 378649] } } });
      if (id === 378648) return resp({ 378648: { success: true, data: { name: "Hearts of Stone", release_date: { date: "13 Oct, 2015" }, price_overview: { final: 999, initial: 999, discount_percent: 0 } } } });
      return resp({ [id]: { success: false } });
    };
    const x = await G.steamExtras(http, 292030);
    assert.strictEqual(x.dev, "CD PROJEKT RED");
    assert.strictEqual(x.dlc.length, 1, "a DLC Steam has no details for is skipped");
    assert.ok(x.dlc[0].title === "Hearts of Stone" && x.dlc[0].steam === 378648 && x.dlc[0].price.eur === 9.99 && /^2015/.test(x.dlc[0].date), JSON.stringify(x.dlc[0]));
    console.log("ok  Steam: DLC and developer"); }
  { const http = async (m, url) => { assert.ok(/v3\.sg\.media-imdb\.com\/suggestion\/x\/zelda/.test(url), url);
      return resp({ d: [{ id: "tt0000001", l: "Zelda: Tears of the Kingdom", qid: "videoGame", y: 2023, i: { imageUrl: "https://m.media-amazon.com/images/M/x._V1_.jpg" } }, { id: "tt0000002", l: "Zelda film", qid: "movie", y: 2027 }] }); };
    const r = await G.imdbGameSearch(http, "Zelda");
    assert.strictEqual(r.length, 1); assert.ok(r[0].imdb === "tt0000001" && r[0].src === "imdb" && r[0].dateText === "2023" && /UX300/.test(r[0].cover), JSON.stringify(r[0]));
    await assert.rejects(G.imdbGameSearch(async () => resp("", 503), "x"), /503/);
    console.log("ok  games search finds console games on IMDb"); }
  { const http = async (m, url) => { assert.ok(/jikan\.moe\/v4\/anime\/44511\/relations/.test(url), url);
      return resp({ data: [{ relation: "Adaptation", entry: [{ mal_id: 116778, type: "manga", name: "Chainsaw Man" }] }, { relation: "Sequel", entry: [{ mal_id: 57555, type: "anime", name: "Chainsaw Man Movie: Reze-hen" }] }, { relation: "Character", entry: [{ mal_id: 1, type: "anime", name: "x" }] }] }); };
    const r = await L.animeRelations(http, 44511);
    assert.deepStrictEqual(r, [{ mal: 57555, title: "Chainsaw Man Movie: Reze-hen", relation: "Sequel" }]);
    console.log("ok  anime: related films and sequels, manga left out"); }
  console.log("0.6.1 TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
