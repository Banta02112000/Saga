// Saga: game prices and deals from IsThereAnyDeal (sign-in, wishlist and collection sync, price alerts).
// A part of app.js, in its own file: it gets what it uses from the rest of the app through A, and gives back what
// the app uses (made by scripts/split_app.js; the names it uses are listed in app.js where it's put together).
(function (root) {
  "use strict";
  (root.SagaParts = root.SagaParts || {}).deals = function (A) {
  // ---- 0.6.6: IsThereAnyDeal
  async function itadToken() {
    let t = {}; try { t = JSON.parse(A.db.get("itad_token", "{}")) || {}; } catch (e) { t = {}; }
    if (!t.access) return "";
    if (t.until && Date.now() < t.until - 60000) return t.access;
    if (!t.refresh) return "";
    const n = await A.GC.itadToken(A.Native.http, { grant_type: "refresh_token", refresh_token: t.refresh, client_id: A.db.get("itad_client_id") });
    A.db.set("itad_token", JSON.stringify(Object.assign(t, n, { refresh: n.refresh || t.refresh }))); A.db.flush();
    return n.access;
  }
  async function itadRefresh(http, force) {
    const key = A.db.get("itad_key"), cc = A.games.settings.region || "IT", out = [];
    if (!key) throw new Error("add an IsThereAnyDeal API key in Settings");
    const due = force || Date.now() - (A.games.meta.dealsAt || 0) > 11 * 3600e3;
    const ids = await A.GC.itadIds(A.games, http, key, A.GC.priceWatch(A.games));
    if (ids) out.push(`${A.fmt(ids)} games matched`);
    if (due) {
      const deals = await A.GC.itadOverview(A.games, http, key, cc); out.push(`${A.fmt(deals)} on sale`);
      const subs = await A.GC.itadSubs(A.games, http, key, cc); out.push(`${A.fmt(subs)} in a subscription`);
      // a game you want at its lowest price ever: a notification (once per price)
      if (A.feat("priceAlerts")) for (const g of A.games.visible()) if (g.deal && g.deal.atLow && g.deal.cut > 0 && (g.status === "wishlist" || g.next))
        A.Native.notify(A.C.hashId("glow|" + g.id + "|" + g.deal.price), `Lowest price ever: ${g.title}`, `${g.deal.cur === "EUR" ? "€" : g.deal.cur + " "}${(+g.deal.price).toFixed(2)} at ${g.deal.shop} (−${g.deal.cut}%)`, "games");
    }
    if (A.db.get("itad_token")) {
      try { const tok = await itadToken(); if (tok) { const w = await A.GC.itadWaitSync(A.games, http, tok); out.push(`waitlist: ${w.added} in, ${w.pushed} out${w.removedHere + w.removedThere ? `, ${w.removedHere + w.removedThere} removed` : ""}; ${w.owned} to your collection`); } }
      catch (e) { out.push(`waitlist: ${e.message}`); }
    }
    A.games.save();
    return out.join(", ") || "nothing new";
  }
  async function itadSignIn() {
    const cid = String(A.db.get("itad_client_id", "")).trim();
    if (!cid) { A.toast("Add your IsThereAnyDeal app's client ID first"); return; }
    const verifier = A.Native.randomUrl(48), state = A.Native.randomUrl(16);
    A.db.set("itad_pkce_secret", JSON.stringify({ verifier, state, redirect: itadRedirect() })); A.db.flush();
    A.Native.openUrl(A.GC.itadAuthUrl(cid, itadRedirect(), await A.Native.sha256url(verifier), state));
    A.toast("Approve Saga on IsThereAnyDeal; you'll come back here by yourself");
  }
  const itadRedirect = () => (window.__sagaWeb ? window.__sagaWeb.oauthUrl("itad") : `${(A.Native.linkScheme && A.Native.linkScheme()) || "bantaapps"}://oauth/itad`); // 0.7.5: the website signs in too
  // the browser comes back with …://oauth/itad?code=…&state=… (or the address pasted by hand)
  async function itadFinish(url) {
    let st = {}; try { st = JSON.parse(A.db.get("itad_pkce_secret", "{}")) || {}; } catch (e) { st = {}; }
    const q = new URLSearchParams(String(url).replace(/^[^?]*\?/, "").replace(/#.*/, ""));
    if (q.get("error")) { A.toast(`IsThereAnyDeal: ${q.get("error_description") || q.get("error")}`); return; }
    if (!q.get("code") || !st.verifier) { A.toast("That isn't an IsThereAnyDeal sign-in address"); return; }
    if (st.state && q.get("state") !== st.state) { A.toast("Sign-in didn't match: try again"); return; }
    A.runJob("IsThereAnyDeal sign-in", async () => {
      const t = await A.GC.itadToken(A.Native.http, { grant_type: "authorization_code", code: q.get("code"), redirect_uri: st.redirect || itadRedirect(), client_id: A.db.get("itad_client_id"), code_verifier: st.verifier });
      A.db.set("itad_token", JSON.stringify(t)); A.db.set("itad_pkce_secret", ""); A.db.flush();
      return "Signed in to IsThereAnyDeal. " + await itadRefresh(A.Native.http, true);
    });
  }
  window.__oauth = url => { if (/oauth\/itad/.test(url)) itadFinish(url); else if (/oauth\/anilist/.test(url)) anilistFinish(url); else if (/oauth\/spotify/.test(url) && Kit.mods.music) Kit.mods.music.spotifyFinish(url); };
  // 0.6.9: AniList sign-in (the token comes back in the address: …://oauth/anilist#access_token=…)
  const anilistRedirect = () => (window.__sagaWeb ? window.__sagaWeb.oauthUrl("anilist") : `${(A.Native.linkScheme && A.Native.linkScheme()) || "bantaapps"}://oauth/anilist`);
  function anilistFinish(url) {
    const t = Imports.anilistTokenFrom(url);
    if (!t) { A.toast("That isn't an AniList sign-in address"); return; }
    A.db.set("anilist_token", t.token); A.db.set("anilist_until", String(t.until)); A.db.flush();
    A.toast("Signed in to AniList: changes go back to it after each sync"); A.render();
  }
  window.__oauthPoll = () => { const u = A.Native.takeOauth(); if (u) window.__oauth(u); };
  setTimeout(() => { try { window.__oauthPoll(); } catch (e) { A.logError("oauth", e.message); } }, 600);
  async function afterSync() {
    setTimeout(() => A.otaCheck(false).catch(() => {}), 5000);
    setTimeout(() => { if (A.db.get("cal_path")) A.pushCalendar(); }, 7000);
    setTimeout(() => A.recsRefresh(false).catch(() => {}), 9000);
    setTimeout(() => A.peopleRefresh(false).catch(() => {}), 12000);
    setTimeout(() => { if (A.db.get("cal_path")) A.pushCalendar(); }, 14000);
    if (A.afterRunning) return;
    A.afterRunning = true;
    try {
      for (let i = 0; i < 600 && A.ui.job; i++) await new Promise(r => setTimeout(r, 500));
      await new Promise(r => setTimeout(r, 1200)); // the result on screen first
      await A.db.settled();
      await A.statusSoon();
      await A.C.breathe(30);
      try { A.updateWidget(); } catch (e) { /* optional */ }
      await A.C.breathe(30);
      await runDetails();
      await A.C.breathe(30);
      await A.fillImages();
      await A.db.settled();
      await A.backupToFile(false).catch(() => {});
      if (A.db.get("web_sync_url") && A.db.get("web_sync_auto", "1") === "1") await A.syncWithWebServer(false);
      if (window.__sagaAuto) await window.__sagaAuto.run("after sync"); // 0.7.2: auto.js
    } catch (e) { A.logError("after sync", e.message); }
    A.afterRunning = false;
  }
  async function runDetails() {
    if (A.detailsRunning || !A.db.get("tmdb_key")) return;
    A.detailsRunning = true;
    const t0 = Date.now();
    try {
      const r = await A.C.details(A.db, A.Native.http, () => {});
      // where your watchlist streams, for the "On my services" filter
      const want = A.lib.all().filter(it => it.status === "watchlist").slice(0, 40);
      await A.C.pool(want, 3, it => A.C.titleInfo(A.db, A.C.robust(A.Native.http, { timeout: 25000, tries: 2 }), libCanon(it)).catch(() => null));
      A.setStage("details", !/FAIL/.test(r), r.split("\n").map(l => l.replace(/^\S+\s+/, "")).join(" · "), t0);
      A.db.set("stage_report", (A.db.get("stage_report", "") + "\n" + r).trim());
      A.invalidate(); A.db.flush();
    } catch (e) { A.setStage("details", false, e.message, t0); }
    A.detailsRunning = false;
    if (!A.ui.job && !document.querySelector("#overlay .sheet")) A.render();
  }
  // finished: watched here, caught up on an ended series, or watched/rated on IMDb or Trakt
  function isFinished(it) {
    if (it.status === "watched") return true;
    if (it.type === "movie" && it.watches.length) return true;
    if (it.type === "show" && it.ended && A.lib.caughtUp(it)) return true;
    return seenElsewhere(it);
  }
  let seenIdx = null, seenAt = 0;
  function seenElsewhere(it) {
    if (!seenIdx || Date.now() - seenAt > 5000) {
      seenIdx = new Set(); seenAt = Date.now();
      for (const r of A.db.items(null, ["watched", "rated"])) { if (r.source === "app" || r.medium === "Episode" || r.medium === "Video Game") continue; if (r.imdb) seenIdx.add(r.imdb); seenIdx.add(`${r.norm}|${r.year || ""}`); }
    }
    if (it.type === "show") return false; // a series you've started isn't finished just because you rated it
    return (it.imdb && seenIdx.has(it.imdb)) || seenIdx.has(`${A.L.norm(it.title)}|${it.year || ""}`);
  }
  const libCanon = it => ({ title: it.title, year: it.year, medium: it.type === "show" ? "TV Series" : "Movie", imdb: it.imdb || null, tmdb: it.tmdb || null, franchise: "" });
  function streamsFor(it) {
    const inf = A.C.cachedInfo(A.db, libCanon(it));
    if (!inf) return null;
    const mine = A.myServices().map(x => x.toLowerCase());
    const o = A.C.bestOffer(inf);
    const on = o && A.shortName(o.name).toLowerCase().replace(/\s*\(ads\)/, "");
    if (on && mine.some(m => on.includes(m) || m.includes(on))) return { mine: true, o };
    const v = A.feat("vpn") ? A.C.bestVpn(inf, A.myServices()) : null;
    return o ? { o } : v ? { vpn: v } : null;
  }

    return { itadRefresh, itadSignIn, itadRedirect, itadFinish, anilistRedirect, anilistFinish, afterSync, isFinished, seenElsewhere, libCanon, streamsFor };
  };
})(typeof window !== "undefined" ? window : this);
