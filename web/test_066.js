// 0.6.6: IsThereAnyDeal: ids, best price with the all-time low, subscriptions, bundles, waitlist ↔ wishlist sync,
// collection, PKCE sign-in. A fake api.isthereanydeal.com answering in the shapes of its OpenAPI spec. Run: node test_066.js
const assert = require("assert");
const G = require("./games.js");
const J = (b, status = 200) => ({ status, headers: {}, body: b === null ? "" : JSON.stringify(b) });
const U = n => `018d937f-0000-7000-8000-${String(n).padStart(12, "0")}`;

function fakeItad(state) {
  const log = [];
  const http = async (method, url, o = {}) => {
    const u = new URL(url), body = o.body ? (/json/.test((o.headers || {})["Content-Type"] || "") ? JSON.parse(o.body) : o.body) : null;
    log.push(`${method} ${u.pathname}`);
    if (u.hostname === "isthereanydeal.com" && u.pathname === "/oauth/token/") {
      const f = new URLSearchParams(body);
      if (f.get("grant_type") === "authorization_code" && f.get("code") === "good" && f.get("code_verifier") === "v".repeat(48)) return J({ access_token: "tok1", refresh_token: "ref1", expires_in: 3600 });
      if (f.get("grant_type") === "refresh_token" && f.get("refresh_token") === "ref1") return J({ access_token: "tok2", expires_in: 3600 });
      return J({ error: "invalid_grant", error_description: "bad code" }, 400);
    }
    const auth = (o.headers || {}).Authorization;
    if (/^\/(waitlist|collection)\//.test(u.pathname)) { if (auth !== "Bearer tok1") return J({}, 401); }
    else if (u.searchParams.get("key") !== "K") return J({}, 403);
    switch (`${method} ${u.pathname}`) {
      case "POST /lookup/id/shop/61/v1": return J(Object.fromEntries(body.map(x => [x, state.steam[x] || null])));
      case "POST /lookup/id/title/v1": return J(Object.fromEntries(body.map(x => [x, state.titles[x] || null])));
      case "POST /games/overview/v2": return J({ prices: body.filter(id => state.prices[id]).map(id => Object.assign({ id }, state.prices[id])), bundles: state.bundles || [] });
      case "POST /games/subs/v1": return J(body.map(id => ({ id, subs: state.subs[id] || [] })));
      case "GET /games/bundles/v2": return J(state.gameBundles[u.searchParams.get("id")] || []);
      case "GET /waitlist/games/v1": return J(state.wait.map(id => ({ id, slug: "x", title: state.names[id] || "Game " + id.slice(-3), type: "game", mature: false, added: "2026-01-01T00:00:00+00:00" })));
      case "PUT /waitlist/games/v1": for (const id of body) if (!state.wait.includes(id)) state.wait.push(id); return J(null, 204);
      case "DELETE /waitlist/games/v1": state.wait = state.wait.filter(id => !body.includes(id)); return J(null, 204);
      case "PUT /collection/games/v1": state.coll.push(...body); return J(null, 204);
    }
    return J({ error: "not found " + u.pathname }, 404);
  };
  return { http, log };
}
const price = (amount, regular, cut, shop, low) => ({ current: { shop: { id: 1, name: shop }, price: { amount, amountInt: Math.round(amount * 100), currency: "EUR" }, regular: { amount: regular, amountInt: 0, currency: "EUR" }, cut, voucher: null, flag: null, drm: [], platforms: [], timestamp: "2026-11-16T10:00:00+01:00", expiry: null, url: "https://itad.link/x" },
  lowest: low == null ? null : { shop: { id: 2, name: "GOG" }, price: { amount: low, amountInt: 0, currency: "EUR" }, regular: { amount: regular, amountInt: 0, currency: "EUR" }, cut: 80, timestamp: "2024-06-01T00:00:00+02:00" }, bundled: 2, urls: { game: "https://isthereanydeal.com/game/x/" } });

(async () => {
  const L = new G.Games();
  const a = L.add({ title: "Steam Sale Game", steam: 220 }, "wishlist").game;
  const b = L.add({ title: "Console Only", platform: "Switch" }, "backlog").game;
  const c = L.add({ title: "Finished One", steam: 400 }, "done").game;
  const d = L.add({ title: "Unknown Indie" }, "wishlist").game;
  const st = { steam: { "app/220": U(1), "app/400": U(3) }, titles: { "Console Only": U(2) }, names: { [U(9)]: "From Itad" },
    prices: { [U(1)]: price(4.99, 19.99, 75, "Steam", 4.99), [U(2)]: price(30, 60, 50, "Nintendo eShop", 20) },
    subs: { [U(2)]: [{ id: 1, name: "Nintendo Switch Online", leaving: null }], [U(1)]: [{ id: 2, name: "PC Game Pass", leaving: "2026-12-01T00:00:00+01:00" }] },
    bundles: [{ id: 7, title: "Humble Mega Bundle", page: { id: 1, name: "Humble Bundle", shopId: null }, url: "https://hb.example/b", details: "", isMature: false, publish: "2026-11-01", expiry: "2026-11-30T00:00:00+01:00", note: null, counts: { games: 5, media: 0 },
      tiers: [{ price: { amount: 10, amountInt: 1000, currency: "EUR" }, addon: false, games: [{ id: U(1), slug: "s", title: "Steam Sale Game", type: "game", mature: false, assets: {} }] }] }],
    gameBundles: { [U(1)]: [{ id: 5, title: "Old Bundle", page: { id: 1, name: "Fanatical" }, url: "https://f.example", expiry: "2020-01-01T00:00:00+00:00", tiers: [{ price: { amount: 3, currency: "EUR" }, games: [{ id: U(1) }] }] }] },
    wait: [U(9)], coll: [] };
  const F = fakeItad(st);

  // ids
  assert.strictEqual(await G.itadIds(L, F.http, "K"), 3);
  assert.ok(a.itad === U(1) && b.itad === U(2) && c.itad === U(3) && !d.itad && d.itadMiss, "Steam by app id, others by title, misses remembered");
  F.log.length = 0; await G.itadIds(L, F.http, "K"); assert.strictEqual(F.log.length, 0, "a miss isn't asked again for 30 days");
  console.log("ok  IsThereAnyDeal ids: Steam app ids and titles");

  // best price, all-time low, bundles: only games you'd still buy or play
  const onSale = await G.itadOverview(L, F.http, "K", "IT");
  assert.strictEqual(onSale, 2);
  assert.ok(a.deal.price === 4.99 && a.deal.cut === 75 && a.deal.shop === "Steam" && a.deal.atLow && a.deal.low.shop === "GOG" && a.deal.low.at === "2024-06-01", JSON.stringify(a.deal));
  assert.ok(b.deal.price === 30 && !b.deal.atLow && b.deal.low.price === 20, "on sale, but not at its lowest");
  assert.ok(!c.deal, "finished games aren't priced");
  assert.ok(F.log.some(l => l === "POST /games/overview/v2"));
  assert.deepStrictEqual(L.meta.bundles.map(x => [x.title, x.games]), [["Humble Mega Bundle", [U(1)]]]);
  console.log("ok  best price in any store, all-time low, current bundles");

  // subscriptions
  assert.strictEqual(await G.itadSubs(L, F.http, "K"), 2);
  assert.deepStrictEqual(a.subs, [{ name: "PC Game Pass", leaving: "2026-12-01" }]); assert.deepStrictEqual(b.subs, [{ name: "Nintendo Switch Online", leaving: "" }]);
  console.log("ok  subscriptions, with the leaving date");

  // every bundle a game was in
  const bl = await G.itadBundles(F.http, "K", U(1), "IT", true);
  assert.deepStrictEqual(bl, [{ title: "Old Bundle", shop: "Fanatical", url: "https://f.example", expiry: "2020-01-01", price: 3, cur: "EUR" }]);
  console.log("ok  bundle history");

  // sign-in (PKCE)
  const url = G.itadAuthUrl("CID", "bantaapps://oauth/itad", "chal", "st8");
  const q = new URL(url).searchParams;
  assert.ok(url.startsWith("https://isthereanydeal.com/oauth/authorize/?") && q.get("code_challenge_method") === "S256" && q.get("code_challenge") === "chal" && q.get("redirect_uri") === "bantaapps://oauth/itad" && /wait_write/.test(q.get("scope")) && q.get("state") === "st8");
  const t = await G.itadToken(F.http, { grant_type: "authorization_code", code: "good", client_id: "CID", redirect_uri: "bantaapps://oauth/itad", code_verifier: "v".repeat(48) });
  assert.ok(t.access === "tok1" && t.refresh === "ref1" && t.until > Date.now());
  await assert.rejects(G.itadToken(F.http, { grant_type: "authorization_code", code: "bad", code_verifier: "x" }), /bad code/);
  console.log("ok  sign-in with PKCE, refresh token kept");

  // waitlist ↔ wishlist, owned → collection
  const w1 = await G.itadWaitSync(L, F.http, "tok1");
  assert.ok(L.games.some(g => g.title === "From Itad" && g.status === "wishlist" && g.itad === U(9)), "on your ITAD waitlist → on the Saga wishlist");
  assert.ok(st.wait.includes(U(1)), "on the Saga wishlist → on your ITAD waitlist");
  assert.ok(st.coll.includes(U(3)), "finished → your ITAD collection");
  assert.strictEqual(w1.added, 1); assert.strictEqual(w1.pushed, 1);
  // removed on ITAD → off the Saga wishlist (untouched game); removed in Saga → off ITAD
  st.wait = st.wait.filter(id => id !== U(9));
  a.status = "backlog";
  const w2 = await G.itadWaitSync(L, F.http, "tok1");
  assert.ok(!L.visible().some(g => g.title === "From Itad"), "removed on ITAD: removed here");
  assert.ok(!st.wait.includes(U(1)), "no longer on the Saga wishlist: removed on ITAD");
  assert.strictEqual(w2.removedHere, 1); assert.strictEqual(w2.removedThere, 1);
  const w3 = await G.itadWaitSync(L, F.http, "tok1");
  assert.deepStrictEqual([w3.added, w3.pushed, w3.removedHere, w3.removedThere, w3.owned], [0, 0, 0, 0, 0], "nothing twice");
  await assert.rejects(G.itadWaitSync(L, F.http, "expired"), /sign-in expired/);
  await assert.rejects(G.itadOverview(L, F.http, "WRONG"), /refused the API key/);
  console.log("ok  waitlist ↔ wishlist both ways, collection, nothing done twice");
  // Up next: the next game of each franchise you're going through
  { const N = new G.Games(), add = (t, d, st, f = "Saga Bros") => N.add({ title: t, date: d, franchise: f }, st).game;
    const s1 = add("Saga Bros 1", "1990-01-01", "done"), s2 = add("Saga Bros 2", "1992-01-01", "backlog"), s3 = add("Saga Bros 3", "1995-01-01", "backlog");
    s1.plays = ["2025-03-01"];
    add("Untouched 1", "2000-01-01", "backlog", "Untouched"); add("Untouched 2", "2001-01-01", "backlog", "Untouched");
    const k1 = add("Knight 1", "2010-01-01", "done", "Knight"), k2 = add("Knight 2", "2012-01-01", "dropped", "Knight"), k3 = add("Knight 3", "2099-01-01", "wishlist", "Knight"), k4 = add("Knight Zero", "2011-01-01", "playing", "Knight");
    k1.plays = ["2026-10-01"];
    const up = N.nextUp(10).map(g => g.title);
    assert.strictEqual(up[0], "Knight Zero", "playing first");
    assert.ok(up.includes("Saga Bros 2") && !up.includes("Saga Bros 3"), "the next one, not the one after: " + up);
    assert.strictEqual(N.whyNext(s2), "After Saga Bros 1");
    assert.ok(!up.some(t => /^Untouched/.test(t)), "a franchise you haven't started isn't pushed");
    assert.ok(!up.includes("Knight 2") && !up.includes("Knight 3"), "dropped and unreleased games are skipped (Knight continues after the one you're playing, and 3 isn't out)");
    s2.status = "done"; assert.ok(N.nextUp(10).some(g => g.title === "Saga Bros 3"), "finish it: the next one moves up");
    console.log("ok  Up next follows each franchise's order"); }
  console.log("0.6.6 TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
