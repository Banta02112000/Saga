/* Music (0.6.9.5): your listening from Last.fm (full history and play counts, from any service that scrobbles:
   Spotify, YouTube Music, Apple Music, Tidal…) and Spotify (top artists and tracks, last 50 plays).
   MusicCore: the data (no screen); Kit.mods.music: the section. Saved in music.json. */
(function () {
  "use strict";
  const LFM = "https://ws.audioscrobbler.com/2.0/";
  const SP = "https://api.spotify.com/v1";
  const PERIODS = [["7day", "Week"], ["1month", "Month"], ["12month", "Year"], ["overall", "All time"]];
  const SP_RANGES = [["short_term", "4 weeks"], ["medium_term", "6 months"], ["long_term", "All time"]];
  const qs = o => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const img = (arr, want = "extralarge") => { const a = Array.isArray(arr) ? arr : []; const x = a.find(i => i.size === want) || a[a.length - 1]; const u = x && x["#text"]; return u && !/2a96cbd8b46e442fc41c2b86b821562f/.test(u) ? u.replace(/^http:/, "https:") : ""; };

  // ---- Last.fm
  async function lfm(http, method, params, key) {
    const r = await http("GET", `${LFM}?${qs(Object.assign({ method, api_key: key, format: "json" }, params))}`, { headers: { Accept: "application/json" } });
    let j = null; try { j = JSON.parse(r.body || "null"); } catch (e) { j = null; }
    if (j && j.error) throw new Error(`Last.fm: ${j.message || "error " + j.error}${j.error === 10 ? " (check the API key)" : j.error === 6 ? " (no such user)" : ""}`);
    if (!r || r.status !== 200 || !j) throw new Error(`Last.fm: ${r && r.status ? "HTTP " + r.status : "no answer"}`);
    return j;
  }
  const lfmTrack = t => ({ artist: (t.artist && (t.artist["#text"] || t.artist.name)) || "", track: t.name || "", album: (t.album && t.album["#text"]) || "", img: img(t.image, "large"),
    at: t.date ? +t.date.uts : 0, now: !!(t["@attr"] && t["@attr"].nowplaying), url: t.url || "" });
  // everything new since the last sync: profile, tops for each period, scrobbles (new ones only; the newest 5,000 kept)
  async function lastfmSync(http, user, key, prev, progress = () => {}) {
    const d = Object.assign({}, prev || {});
    progress(0.05, "Last.fm: your profile");
    const u = (await lfm(http, "user.getinfo", { user }, key)).user || {};
    d.info = { name: u.name || user, playcount: +u.playcount || 0, artists: +u.artist_count || 0, tracks: +u.track_count || 0, albums: +u.album_count || 0,
      since: u.registered ? +(u.registered.unixtime || u.registered["#text"]) || 0 : 0, url: u.url || "", img: img(u.image) };
    d.top = d.top || {};
    let i = 0;
    for (const [p] of PERIODS) {
      progress(0.1 + 0.4 * (i++ / PERIODS.length), `Last.fm: top of ${p}`);
      const [a, t, al] = await Promise.all([lfm(http, "user.gettopartists", { user, period: p, limit: 50 }, key), lfm(http, "user.gettoptracks", { user, period: p, limit: 50 }, key), lfm(http, "user.gettopalbums", { user, period: p, limit: 30 }, key)]);
      d.top[p] = {
        artists: ((a.topartists || {}).artist || []).map(x => ({ name: x.name, plays: +x.playcount || 0, url: x.url || "" })),
        tracks: ((t.toptracks || {}).track || []).map(x => ({ name: x.name, artist: (x.artist || {}).name || "", plays: +x.playcount || 0, img: img(x.image, "large"), url: x.url || "" })),
        albums: ((al.topalbums || {}).album || []).map(x => ({ name: x.name, artist: (x.artist || {}).name || "", plays: +x.playcount || 0, img: img(x.image), url: x.url || "" })),
      };
    }
    // scrobbles: only what's newer than the newest one stored (the first sync takes the newest 1,000)
    const have = (d.recent || []).filter(x => x.at), newest = have.length ? have[0].at : 0;
    const got = [];
    for (let page = 1; page <= (newest ? 25 : 5); page++) {
      progress(0.55 + 0.4 * Math.min(1, page / 5), `Last.fm: scrobbles, page ${page}`);
      const j = await lfm(http, "user.getrecenttracks", { user, limit: 200, page, from: newest ? newest + 1 : undefined, extended: 0 }, key);
      const rt = j.recenttracks || {}, list = (Array.isArray(rt.track) ? rt.track : rt.track ? [rt.track] : []).map(lfmTrack);
      got.push(...list);
      const pages = +((rt["@attr"] || {}).totalPages) || 1;
      if (page >= pages || !list.length) break;
    }
    const nowPlaying = got.find(x => x.now) || null;
    const fresh = got.filter(x => x.at && !x.now);
    const seen = new Set(have.map(x => x.at + "|" + x.track));
    // 0.6.9.9: up to 10,000 kept for the stats; pictures and links only on the newest 300 (they're what takes the room)
    d.recent = fresh.filter(x => !seen.has(x.at + "|" + x.track)).concat(have).sort((a, b) => b.at - a.at).slice(0, 10000)
      .map((x, k) => (k < 300 || (!x.img && !x.url) ? x : Object.assign({}, x, { img: "", url: "" })));
    d.now = nowPlaying;
    d.lastfmAt = Date.now();
    return d;
  }

  // ---- Spotify (PKCE sign-in; the app owner needs Spotify Premium for a development-mode app, since March 2026)
  const SP_SCOPE = "user-top-read user-read-recently-played";
  const spotifyAuthUrl = (clientId, redirect, challenge, state) => "https://accounts.spotify.com/authorize?" + qs({ response_type: "code", client_id: clientId, scope: SP_SCOPE, redirect_uri: redirect, code_challenge_method: "S256", code_challenge: challenge, state });
  async function spotifyToken(http, form) {
    const r = await http("POST", "https://accounts.spotify.com/api/token", { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: qs(form) });
    let j = null; try { j = JSON.parse(r.body || "null"); } catch (e) { j = null; }
    if (!r || r.status !== 200 || !j || !j.access_token) throw new Error(`Spotify sign-in: ${(j && (j.error_description || j.error)) || (r && r.status ? "HTTP " + r.status : "no answer")}`);
    return { access: j.access_token, refresh: j.refresh_token || form.refresh_token || "", exp: Date.now() + ((+j.expires_in || 3600) - 60) * 1000 };
  }
  async function spotifyFresh(http, tok, clientId) {
    if (tok && tok.access && tok.exp > Date.now()) return tok;
    if (!tok || !tok.refresh) throw new Error("Spotify: sign in again");
    return spotifyToken(http, { grant_type: "refresh_token", refresh_token: tok.refresh, client_id: clientId });
  }
  async function sp(http, tok, path) {
    const r = await http("GET", SP + path, { headers: { Authorization: "Bearer " + tok.access, Accept: "application/json" } });
    if (r.status === 204) return null;
    if (r.status === 401) throw new Error("Spotify: sign in again");
    if (r.status === 403) throw new Error("Spotify refused (403): the Spotify app's owner needs Premium, and your account must be on the app's user list (developer.spotify.com › your app › User Management)");
    if (r.status === 429) throw new Error("Spotify: too many requests, try again later");
    if (r.status !== 200) throw new Error(`Spotify: HTTP ${r.status}`);
    return JSON.parse(r.body || "null");
  }
  async function spotifySync(http, tok, prev, progress = () => {}) {
    const d = Object.assign({}, prev || {});
    progress(0.1, "Spotify: your account");
    const me = await sp(http, tok, "/me");
    d.spMe = me ? { name: me.display_name || me.id || "", product: me.product || "", img: ((me.images || [])[0] || {}).url || "" } : d.spMe;
    d.spTop = {};
    let i = 0;
    for (const [rg] of SP_RANGES) {
      progress(0.2 + 0.6 * (i++ / SP_RANGES.length), `Spotify: top of ${rg.replace("_term", "")}`);
      const [a, t] = await Promise.all([sp(http, tok, `/me/top/artists?limit=50&time_range=${rg}`), sp(http, tok, `/me/top/tracks?limit=50&time_range=${rg}`)]);
      d.spTop[rg] = {
        artists: ((a && a.items) || []).map(x => ({ name: x.name, img: ((x.images || [])[1] || (x.images || [])[0] || {}).url || "", genres: (x.genres || []).slice(0, 3), url: (x.external_urls || {}).spotify || "" })),
        tracks: ((t && t.items) || []).map(x => ({ name: x.name, artist: (x.artists || []).map(y => y.name).join(", "), album: (x.album || {}).name || "", img: (((x.album || {}).images || [])[1] || ((x.album || {}).images || [])[0] || {}).url || "", ms: x.duration_ms || 0, url: (x.external_urls || {}).spotify || "" })),
      };
    }
    progress(0.9, "Spotify: recently played");
    const rp = await sp(http, tok, "/me/player/recently-played?limit=50");
    d.spRecent = ((rp && rp.items) || []).map(x => ({ track: (x.track || {}).name || "", artist: ((x.track || {}).artists || []).map(y => y.name).join(", "), album: ((x.track || {}).album || {}).name || "",
      img: ((((x.track || {}).album || {}).images || [])[2] || {}).url || "", ms: (x.track || {}).duration_ms || 0, at: Date.parse(x.played_at) / 1000 || 0 }));
    // 0.7.8: Spotify only ever gives the last 50 plays: Saga keeps every one it sees, so the stats grow with each sync
    // even without Last.fm (up to 10,000, newest first; first artist only, like Last.fm)
    const seen = new Set((d.spHist || []).map(x => x.at + "|" + x.track));
    d.spHist = d.spRecent.filter(x => x.at && !seen.has(x.at + "|" + x.track)).map(x => ({ at: x.at, track: x.track, artist: String(x.artist || "").split(",")[0].trim(), album: x.album, ms: x.ms }))
      .concat(d.spHist || []).sort((a, b) => b.at - a.at).slice(0, 10000);
    d.spotifyAt = Date.now();
    return d;
  }

  // ---- numbers from the scrobbles: plays per day (last 30), by hour, streak, this week
  // the plays the stats count: Last.fm's scrobbles when there are any, otherwise the Spotify plays Saga has kept
  const plays = d => ((d.recent || []).length ? d.recent : d.spHist || []).filter(x => x.at);
  function stats(d, now = Date.now()) {
    const rec = plays(d), dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);
    const days = [];
    for (let k = 29; k >= 0; k--) days.push(new Date(now - k * 864e5).toISOString().slice(0, 10));
    const perDay = Object.fromEntries(days.map(x => [x, 0]));
    const hours = Array(24).fill(0), artists7 = {};
    for (const x of rec) {
      const dd = dayOf(x.at);
      if (dd in perDay) perDay[dd]++;
      if (now / 1000 - x.at < 30 * 86400) hours[new Date(x.at * 1000).getHours()]++;
      if (now / 1000 - x.at < 7 * 86400) artists7[x.artist] = (artists7[x.artist] || 0) + 1;
    }
    let streak = 0;
    for (let k = days.length - 1; k >= 0; k--) { if (perDay[days[k]]) streak++; else if (k === days.length - 1) continue; else break; }
    const week = Object.entries(artists7).sort((a, b) => b[1] - a[1]);
    const total7 = rec.filter(x => now / 1000 - x.at < 7 * 86400).length;
    const spMins = (d.spRecent || []).reduce((a, x) => a + (x.ms || 0), 0) / 60000;
    // 0.6.9.9: more numbers. Over the scrobbles Saga keeps (up to 10,000): weekdays, months, the busiest day, the
    // longest streak, artists new to you in the last 30 days, the song you repeated most, how much you listen at night.
    const sec = now / 1000, in30 = rec.filter(x => sec - x.at < 30 * 86400);
    const weekday = Array(7).fill(0), byDay = {}, byMonth = {}, firstSeen = {};
    for (const x of rec) {
      const dt = new Date(x.at * 1000); weekday[(dt.getDay() + 6) % 7]++;
      const dd = dayOf(x.at); byDay[dd] = (byDay[dd] || 0) + 1;
      const mm = dd.slice(0, 7); byMonth[mm] = (byMonth[mm] || 0) + 1;
      const a = String(x.artist || "").toLowerCase(); if (a && (!firstSeen[a] || x.at < firstSeen[a].at)) firstSeen[a] = { at: x.at, name: x.artist };
    }
    const months = [];
    for (let k = 11; k >= 0; k--) { const dt = new Date(now); dt.setUTCDate(1); dt.setUTCMonth(dt.getUTCMonth() - k); const m = dt.toISOString().slice(0, 7); months.push([m, byMonth[m] || 0]); }
    const busiest = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0] || null;
    const allDays = Object.keys(byDay).sort(); let longest = 0, run = 0, prevD = null;
    for (const dd of allDays) { run = prevD && (Date.parse(dd) - Date.parse(prevD)) === 864e5 ? run + 1 : 1; longest = Math.max(longest, run); prevD = dd; }
    const oldest = rec.length ? rec[rec.length - 1].at : 0, fullWindow = oldest && sec - oldest > 30 * 86400; // only if history reaches back past 30 days
    const newArtists = fullWindow ? Object.values(firstSeen).filter(f => sec - f.at < 30 * 86400).sort((a, b) => b.at - a.at).map(f => f.name) : [];
    const rep = {}; for (const x of in30) { const k = `${x.track}\u0000${x.artist}`; rep[k] = (rep[k] || 0) + 1; }
    const topRep = Object.entries(rep).sort((a, b) => b[1] - a[1])[0];
    const art30 = {}; for (const x of in30) art30[x.artist] = (art30[x.artist] || 0) + 1;
    const night = in30.filter(x => new Date(x.at * 1000).getHours() < 5).length;
    const uniq = list => new Set(list.map(x => String(x.artist || "").toLowerCase())).size;
    // minutes: Spotify's lengths where known, otherwise 3.5 minutes a play (an estimate, said so on screen)
    const lens = {}; for (const x of (d.spRecent || []).concat(...Object.values(d.spTop || {}).map(t => t.tracks || []))) if (x.ms) lens[`${x.track || x.name}\u0000${String(x.artist || "").split(",")[0]}`.toLowerCase()] = x.ms / 60000;
    const minsOf = list => Math.round(list.reduce((a, x) => a + (lens[`${x.track}\u0000${x.artist}`.toLowerCase()] || 3.5), 0));
    const in7 = rec.filter(x => sec - x.at < 7 * 86400);
    // genres from Spotify's top artists (weighted by rank), and how much of the month your top 10 artists take
    const genres = {}; for (const [rg, w] of [["short_term", 3], ["medium_term", 2], ["long_term", 1]]) ((d.spTop || {})[rg] || { artists: [] }).artists.forEach((a, k) => (a.genres || []).forEach(g => { genres[g] = (genres[g] || 0) + w * (50 - k); }));
    const m1 = ((d.top || {})["1month"] || { artists: [] }).artists, m1tot = m1.reduce((a, x) => a + x.plays, 0);
    const i = d.info || {}, life = i.since ? Math.max(1, (sec - i.since) / 86400) : 0;
    return { days: days.map(x => [x, perDay[x]]), hours, streak, week: week.slice(0, 5), total7, avgDay: Math.round(days.reduce((a, x) => a + perDay[x], 0) / 30), spMins: Math.round(spMins),
      weekday, months, busiest, longest, newArtists, topRepeat: topRep ? { track: topRep[0].split("\u0000")[0], artist: topRep[0].split("\u0000")[1], plays: topRep[1] } : null,
      top30: Object.entries(art30).sort((a, b) => b[1] - a[1]).slice(0, 10), nightPct: in30.length ? Math.round((night / in30.length) * 100) : 0,
      artists7: uniq(in7), artists30: uniq(in30), mins7: minsOf(in7), mins30: minsOf(in30), plays30: in30.length,
      genres: Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 8).map(g => g[0]),
      top10Share: m1tot && i.playcount ? Math.round((m1.slice(0, 10).reduce((a, x) => a + x.plays, 0) / m1tot) * 100) : 0,
      lifeAvg: life ? Math.round((i.playcount || 0) / life) : 0, kept: rec.length, keptFrom: oldest };
  }

  const MusicCore = { lastfmSync, spotifyAuthUrl, spotifyToken, spotifyFresh, spotifySync, stats, PERIODS, SP_RANGES, lfmTrack };
  if (typeof module !== "undefined" && module.exports) module.exports = MusicCore;
  if (typeof window === "undefined") return;
  window.MusicCore = MusicCore;

  // ================================================================ the section
  const K = window.Kit, esc = K.esc;
  const ui = { view: "overview", period: "1month", kind: "artists", src: "lastfm", busy: false };
  let data = null;
  const S = () => window.Saga;
  const load = () => { if (data) return data; try { data = JSON.parse(S().Native.load("music.json") || "{}") || {}; } catch (e) { data = {}; } return data; };
  const save = () => { S().Native.save("music.json", JSON.stringify(data)); S().changed("music"); };
  const db = () => S().db;
  const fmt = n => (+n || 0).toLocaleString(S().lang() === "it" ? "it-IT" : "en-GB");
  const ago = t => { const m = Math.round((Date.now() / 1000 - t) / 60); return m < 1 ? "now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : K.when(t * 1000, S().lang()); };
  const ready = () => ({ lastfm: !!(db().get("lastfm_user") && db().get("lastfm_key")), spotify: !!(db().get("spotify_client_id") && db().get("spotify_token")) });
  const redirect = () => (window.__sagaWeb ? window.__sagaWeb.oauthUrl("spotify") : `${(S().Native.linkScheme && S().Native.linkScheme()) || "bantaapps"}://oauth/spotify`);

  function connectCard(full) {
    const r = ready();
    return `<div class="card" style="padding:12px;margin:10px 0">
      <h3 style="margin:0 0 6px">Last.fm ${r.lastfm ? "✓" : ""}</h3>
      <p class="small muted" style="margin:0 0 8px">Your whole listening history and play counts, from any app that scrobbles to Last.fm (Spotify: Settings › Apps › Last.fm; YouTube Music, Apple Music and others through a scrobbler app). Free API key at last.fm/api/account/create.</p>
      <label class="field"><span>Last.fm username</span><input data-mset="lastfm_user" value="${esc(db().get("lastfm_user", ""))}" autocomplete="off" autocapitalize="off"></label>
      <label class="field"><span>Last.fm API key</span><input data-mset="lastfm_key" type="password" value="${esc(db().get("lastfm_key", ""))}" autocomplete="off"></label>
      <h3 style="margin:14px 0 6px">Spotify ${r.spotify ? "✓" : ""}</h3>
      <p class="small muted" style="margin:0 0 8px">Your top artists and tracks (4 weeks, 6 months, all time) and your last 50 plays. Spotify gives no full history: that comes from Last.fm. Make an app at developer.spotify.com (Web API) with the redirect URI <code>${esc(redirect())}</code>, add yourself under User Management, and paste its Client ID. Spotify needs the app's owner to have Premium.</p>
      <label class="field"><span>Spotify Client ID</span><input data-mset="spotify_client_id" value="${esc(db().get("spotify_client_id", ""))}" autocomplete="off" autocapitalize="off"></label>
      <div class="row wrap" style="gap:8px"><button class="btn small" data-action="musplogin">${r.spotify ? "Sign in to Spotify again" : "Sign in to Spotify"}</button>${r.spotify ? `<button class="btn quiet small" data-action="musplogout">Sign out of Spotify</button>` : ""}
        ${full ? "" : `<button class="btn primary small" data-action="musync">Sync music</button>`}</div></div>`;
  }

  function bars(rows, labelEvery) {
    const mx = Math.max(1, ...rows.map(r => r[1]));
    return `<div class="mbars">${rows.map(([l, v], i) => `<div class="mb" title="${esc(l)}: ${v}"><i style="height:${Math.round((v / mx) * 100)}%"></i>${i % labelEvery === 0 ? `<small>${esc(l)}</small>` : ""}</div>`).join("")}</div>`;
  }
  const row = (x, i, sub, pic) => `<div class="item"${x.url ? ` data-action="muopen" data-url="${esc(x.url)}"` : ""}><span class="small muted" style="width:22px;text-align:right">${i + 1}</span>
    <span class="uposter sq">${pic ? `<img loading="lazy" decoding="async" alt="" src="${esc(pic)}">` : `<i style="background:hsl(${K.hue(x.name || x.track)} 40% 30%)">${esc(String(x.name || x.track || "?").slice(0, 1))}</i>`}</span>
    <div class="grow" style="min-width:0"><b class="ell" style="display:block">${esc(x.name || x.track)}</b><div class="small muted ell">${sub}</div></div></div>`;

  function render() {
    const d = load(), r = ready();
    if (!r.lastfm && !r.spotify && !d.info && !d.spMe) {
      return `<div class="empty2"><div class="kicker">Music</div><h2>What you listen to, counted</h2><p>Connect Last.fm for your full history and play counts (from Spotify, YouTube Music, Apple Music and more), Spotify for your top lists, or both.</p></div>${connectCard(false)}`;
    }
    const tabs = [["overview", "Overview"], ["top", "Top"], ["recent", "Recent"], ["connect", "Accounts"]];
    let body = "";
    if (ui.view === "connect") body = connectCard(false);
    else if (ui.view === "top") body = renderTop(d);
    else if (ui.view === "recent") body = renderRecent(d);
    else body = renderOverview(d);
    return `<div class="subnav">${tabs.map(([k, l]) => `<button data-action="muview" data-v="${k}" ${ui.view === k ? 'aria-current="page"' : ""}>${l}</button>`).join("")}</div>
      <div class="row" style="justify-content:space-between;margin:6px 0"><span class="small muted">${d.lastfmAt || d.spotifyAt ? `Synced ${ago(Math.max(d.lastfmAt || 0, d.spotifyAt || 0) / 1000)}` : "Not synced yet"}</span>
      <button class="btn small" data-action="musync" ${ui.busy ? "disabled" : ""}>${ui.busy ? "Syncing…" : "Sync music"}</button></div>${body}`;
  }
  const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hm = m => (m >= 60 ? `${fmt(Math.floor(m / 60))} h${m % 60 ? ` ${m % 60} m` : ""}` : `${m} m`);
  function renderOverview(d) {
    const st = stats(d), i = d.info, wk = st.week[0];
    const n = d.now;
    return `${n ? `<div class="nextbox" style="margin:8px 0"><div class="grow"><div class="kicker">Playing now</div><b>${esc(n.track)}</b><div class="small muted">${esc(n.artist)}${n.album ? " · " + esc(n.album) : ""}</div></div></div>` : ""}
      ${i ? `<div class="sstrip"><div><b>${fmt(i.playcount)}</b><span>scrobbles${i.since ? ` since ${new Date(i.since * 1000).getFullYear()}` : ""}</span></div>${i.artists ? `<div><b>${fmt(i.artists)}</b><span>artists</span></div>` : ""}${i.tracks ? `<div><b>${fmt(i.tracks)}</b><span>tracks</span></div>` : ""}<div><b>${fmt(st.total7)}</b><span>this week</span></div></div>` : ""}
      ${st.kept ? `<div class="sstrip"><div><b>${fmt(st.avgDay)}</b><span>a day (30 days)</span></div><div><b>${fmt(st.streak)}</b><span>day streak</span></div><div><b class="ell">${wk ? esc(wk[0]) : "–"}</b><span>top artist this week${wk ? ` (${wk[1]})` : ""}</span></div></div>` : ""}
      ${st.kept ? `${(d.recent || []).length ? "" : `<p class="small muted" style="margin:0 0 8px">From the ${fmt(st.kept)} Spotify plays Saga has kept so far (Spotify gives the last 50 at each sync; Last.fm gives your whole history).</p>`}<div class="sstrip"><div><b>${hm(st.mins7)}</b><span>listened this week*</span></div><div><b>${hm(st.mins30)}</b><span>in 30 days*</span></div><div><b>${fmt(st.artists30)}</b><span>artists in 30 days</span></div>${st.lifeAvg ? `<div><b>${fmt(st.lifeAvg)}</b><span>a day, all time</span></div>` : ""}</div>
        <div class="sstrip"><div><b>${fmt(st.longest)}</b><span>longest streak (days)</span></div>${st.busiest ? `<div><b>${fmt(st.busiest[1])}</b><span>busiest day: ${esc(K.when(Date.parse(st.busiest[0]), S().lang()))}</span></div>` : ""}<div><b>${st.nightPct}%</b><span>after midnight (30 days)</span></div>${st.top10Share ? `<div><b>${st.top10Share}%</b><span>of this month is your top 10 artists</span></div>` : ""}</div>
        ${st.topRepeat && st.topRepeat.plays > 2 ? `<p class="small" style="margin:6px 0">On repeat: <b>${esc(st.topRepeat.track)}</b> by ${esc(st.topRepeat.artist)}, ${fmt(st.topRepeat.plays)} plays in 30 days</p>` : ""}
        ${K.head("Last 30 days")}${bars(st.days.map(([x, v]) => [x.slice(8), v]), 5)}${K.head("By hour (30 days)")}${bars(st.hours.map((v, h) => [String(h), v]), 3)}
        ${K.head("By weekday")}${bars(st.weekday.map((v, k) => [WD[k], v]), 1)}
        ${K.head("Last 12 months")}${bars(st.months.map(([m, v]) => [MO[+m.slice(5) - 1], v]), 2)}
        ${st.top30.length ? `${K.head("Top artists, 30 days")}<div class="listcard">${st.top30.slice(0, 5).map(([a, v], k) => row({ name: a }, k, `${fmt(v)} plays`)).join("")}</div>` : ""}
        ${st.newArtists.length ? `${K.head("New to you, last 30 days")}<p class="small">${st.newArtists.slice(0, 12).map(esc).join(" · ")}${st.newArtists.length > 12 ? ` and ${fmt(st.newArtists.length - 12)} more` : ""}</p>` : ""}
        <p class="small muted">* Minutes use Spotify's song lengths where Saga knows them, 3.5 minutes a play otherwise. Weekdays, months, streaks and new artists count the ${fmt(st.kept)} newest scrobbles Saga keeps${st.keptFrom ? ` (since ${esc(K.when(st.keptFrom * 1000, S().lang()))})` : ""}.</p>` : ""}
      ${st.genres.length ? `${K.head("Your genres (Spotify)")}<p class="small">${st.genres.map(esc).join(" · ")}</p>` : ""}
      ${d.spMe ? `${K.head(`Spotify${d.spMe.name ? " · " + d.spMe.name : ""}`)}<p class="small muted" style="margin:0 0 6px">${d.spRecent && d.spRecent.length ? `${fmt(d.spRecent.length)} recent plays, ${fmt(st.spMins)} minutes` : "No recent plays"}</p>
        ${(d.spTop && d.spTop.short_term && d.spTop.short_term.artists.length) ? `<div class="listcard">${d.spTop.short_term.artists.slice(0, 5).map((x, k) => row(x, k, esc(x.genres.join(", ") || "Top artist, last 4 weeks"), x.img)).join("")}</div>` : ""}` : ""}
      ${d.top && d.top["7day"] && d.top["7day"].tracks.length ? `${K.head("Top tracks this week")}<div class="listcard">${d.top["7day"].tracks.slice(0, 5).map((x, k) => row(x, k, `${esc(x.artist)} · ${fmt(x.plays)} plays`, x.img)).join("")}</div>` : ""}`;
  }
  function renderTop(d) {
    const hasL = !!(d.top && Object.keys(d.top).length), hasS = !!(d.spTop && Object.keys(d.spTop).length);
    if (ui.src === "spotify" && !hasS) ui.src = "lastfm"; if (ui.src === "lastfm" && !hasL && hasS) ui.src = "spotify";
    const chip = (act, v, cur, l) => `<button class="chip" data-action="${act}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`;
    let list = "";
    if (ui.src === "spotify") {
      const rg = SP_RANGES.some(r => r[0] === ui.period) ? ui.period : "short_term", t = (d.spTop || {})[rg] || { artists: [], tracks: [] };
      const kind = ui.kind === "albums" ? "artists" : ui.kind;
      list = `<div class="chips">${SP_RANGES.map(([v, l]) => chip("muperiod", v, rg, l)).join("")}</div><div class="chips">${chip("mukind", "artists", kind, "Artists")}${chip("mukind", "tracks", kind, "Tracks")}</div>
        <div class="listcard">${(t[kind] || []).map((x, k) => row(x, k, kind === "tracks" ? `${esc(x.artist)}${x.album ? " · " + esc(x.album) : ""}` : esc(x.genres.join(", ")), x.img)).join("") || `<p class="muted">Nothing yet.</p>`}</div>`;
    } else {
      const p = PERIODS.some(r => r[0] === ui.period) ? ui.period : "1month", t = (d.top || {})[p] || { artists: [], tracks: [], albums: [] };
      list = `<div class="chips">${PERIODS.map(([v, l]) => chip("muperiod", v, p, l)).join("")}</div><div class="chips">${chip("mukind", "artists", ui.kind, "Artists")}${chip("mukind", "tracks", ui.kind, "Tracks")}${chip("mukind", "albums", ui.kind, "Albums")}</div>
        <div class="listcard">${(t[ui.kind] || []).map((x, k) => row(x, k, `${x.artist ? esc(x.artist) + " · " : ""}${fmt(x.plays)} plays`, x.img)).join("") || `<p class="muted">Nothing yet.</p>`}</div>`;
    }
    return `${hasL && hasS ? `<div class="chips">${chip("musrc", "lastfm", ui.src, "Last.fm")}${chip("musrc", "spotify", ui.src, "Spotify")}</div>` : ""}${list}`;
  }
  function renderRecent(d) {
    const lf = (d.recent || []).slice(0, 100), spr = d.spRecent || [];
    const items = lf.length ? lf : spr;
    return `${items.length ? `<div class="listcard">${items.map((x, k) => row({ track: x.track, name: x.track }, k, `${esc(x.artist)}${x.album ? " · " + esc(x.album) : ""} · ${ago(x.at)}`, x.img)).join("")}</div>` : `<p class="muted">No plays yet: sync first.</p>`}`;
  }

  async function sync(quiet) {
    if (ui.busy) return "";
    const r = ready();
    if (!r.lastfm && !r.spotify) { if (!quiet) K.toast("Connect Last.fm or Spotify first"); return ""; }
    ui.busy = true; if (!quiet) S().render();
    const said = [];
    const http = S().http, d = load();
    try {
      if (r.lastfm) { try { Object.assign(d, await lastfmSync(http, db().get("lastfm_user").trim(), db().get("lastfm_key").trim(), d)); said.push(`Last.fm: ${fmt((d.info || {}).playcount)} scrobbles`); } catch (e) { said.push(e.message); } }
      if (r.spotify) {
        try {
          let tok = JSON.parse(db().get("spotify_token") || "null");
          const fresh = await spotifyFresh(http, tok, db().get("spotify_client_id").trim());
          if (fresh !== tok) { db().set("spotify_token", JSON.stringify(fresh)); tok = fresh; }
          Object.assign(d, await spotifySync(http, tok, d)); said.push(`Spotify: top lists and ${fmt((d.spRecent || []).length)} recent plays`);
        } catch (e) { said.push(e.message); }
      }
      data = d; save();
    } finally { ui.busy = false; }
    const msg = said.join("; ");
    if (!quiet) { K.toast(msg); S().render(); }
    return msg;
  }
  async function spotifySignIn() {
    const cid = String(db().get("spotify_client_id", "")).trim();
    if (!cid) { K.toast("Paste your Spotify app's Client ID first"); return; }
    const N = S().Native, verifier = N.randomUrl(48), state = N.randomUrl(16);
    db().set("spotify_pkce_secret", JSON.stringify({ verifier, state, redirect: redirect() })); db().flush();
    N.openUrl(spotifyAuthUrl(cid, redirect(), await N.sha256url(verifier), state));
    K.toast("Approve Saga on Spotify; you'll come back here by yourself");
  }
  async function spotifyFinish(url) {
    let st = {}; try { st = JSON.parse(db().get("spotify_pkce_secret", "{}")) || {}; } catch (e) { st = {}; }
    const q = new URLSearchParams(String(url).replace(/^[^?]*\?/, "").replace(/#.*/, ""));
    if (q.get("error")) { K.toast(`Spotify: ${q.get("error")}`); return; }
    if (!q.get("code") || !st.verifier) { K.toast("That isn't a Spotify sign-in address"); return; }
    if (st.state && q.get("state") !== st.state) { K.toast("Sign-in didn't match: try again"); return; }
    try {
      const t = await spotifyToken(S().http, { grant_type: "authorization_code", code: q.get("code"), redirect_uri: st.redirect || redirect(), client_id: db().get("spotify_client_id").trim(), code_verifier: st.verifier });
      db().set("spotify_token", JSON.stringify(t)); db().set("spotify_pkce_secret", ""); db().flush();
      K.toast("Signed in to Spotify"); S().go("music"); sync(false);
    } catch (e) { K.toast(e.message); }
  }

  function act(a, el) {
    switch (a) {
      case "muview": ui.view = el.dataset.v; S().render(); return true;
      case "muperiod": ui.period = el.dataset.v; S().render(); return true;
      case "mukind": ui.kind = el.dataset.v; S().render(); return true;
      case "musrc": ui.src = el.dataset.v; ui.period = el.dataset.v === "spotify" ? "short_term" : "1month"; S().render(); return true;
      case "musync": sync(false); return true;
      case "musplogin": spotifySignIn(); return true;
      case "musplogout": db().set("spotify_token", ""); db().flush(); K.toast("Signed out of Spotify"); S().render(); return true;
      case "muopen": S().Native.openUrl(el.dataset.url); return true;
    }
    return false;
  }
  function change(el) {
    if (el.dataset && el.dataset.mset) { db().set(el.dataset.mset, el.value.trim()); db().flush(); S().render(); return true; }
    return false;
  }
  const reset = () => { data = null; };
  K.mods.music = { title: "Music", render, act, change, sync, reset, ready, spotifyFinish, ui };
})();
