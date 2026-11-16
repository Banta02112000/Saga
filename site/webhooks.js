// Saga website: what Jellyfin and Plex send when something has been watched, turned into a tick in library.json.
// parse() reads the request; apply() changes the library text (null = nothing to change).
"use strict";

const truthy = v => v === true || /^(true|1|yes)$/i.test(String(v == null ? "" : v));
const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const ttId = v => { const m = String(v || "").match(/tt\d{5,10}/); return m ? m[0] : null; };

// Plex sends multipart/form-data with a "payload" field holding JSON (and sometimes a thumbnail)
function multipartPayload(buf, type) {
  const m = String(type || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) return null;
  const parts = buf.toString("latin1").split("--" + (m[1] || m[2]).trim());
  for (const p of parts) {
    if (!/name="payload"/i.test(p)) continue;
    const i = p.indexOf("\r\n\r\n");
    if (i < 0) continue;
    return Buffer.from(p.slice(i + 4).replace(/\r\n$/, ""), "latin1").toString("utf8");
  }
  return null;
}

// Jellyfin (Webhook plugin, JSON body). Fields are the plugin's template names.
function fromJellyfin(j) {
  const kind = String(j.NotificationType || j.Event || "");
  const done = (kind === "PlaybackStop" && truthy(j.PlayedToCompletion)) || (kind === "UserDataSaved" && truthy(j.Played) && /played/i.test(String(j.SaveReason || "TogglePlayed")))
    || (kind === "MarkPlayed");
  if (!done) return null;
  const type = String(j.ItemType || j.Type || "");
  if (type === "Movie") return { type: "movie", title: j.Name || "", year: num(j.Year), imdb: ttId(j.Provider_imdb), tmdb: num(j.Provider_tmdb) };
  if (type === "Episode") return { type: "episode", show: j.SeriesName || "", year: num(j.SeriesYear || j.Year), s: num(j.SeasonNumber != null ? j.SeasonNumber : j.SeasonNumber00), e: num(j.EpisodeNumber != null ? j.EpisodeNumber : j.EpisodeNumber00),
    showImdb: ttId(j.SeriesProvider_imdb || j.Provider_series_imdb), showTmdb: num(j.SeriesProvider_tmdb || j.Provider_series_tmdb) };
  return null;
}

// Plex (Plex Pass webhooks): media.scrobble is sent at about 90% of the way through
function fromPlex(j) {
  if (!j || j.event !== "media.scrobble" || !j.Metadata) return null;
  const m = j.Metadata, guids = [].concat((m.Guid || []).map(g => g.id), m.guid || []).map(String);
  const imdb = ttId(guids.find(g => /imdb/.test(g))), tmdbG = guids.find(g => /tmdb|themoviedb/.test(g)), tmdb = tmdbG ? num(tmdbG.replace(/^\D+/, "")) : null;
  if (m.type === "movie") return { type: "movie", title: m.title || "", year: num(m.year), imdb, tmdb };
  if (m.type === "episode") return { type: "episode", show: m.grandparentTitle || "", year: null, s: num(m.parentIndex), e: num(m.index) };
  return null;
}

function parse(kind, body, contentType) {
  let text = body.toString("utf8");
  if (kind === "plex" && /multipart/i.test(contentType || "")) text = multipartPayload(body, contentType);
  if (kind === "plex" && /x-www-form-urlencoded/i.test(contentType || "")) text = new URLSearchParams(text).get("payload");
  let j; try { j = JSON.parse(text || ""); } catch (e) { throw new Error("not JSON"); }
  return kind === "plex" ? fromPlex(j) : fromJellyfin(j);
}

// ev → the library text with the film watched today or the episode ticked; null when nothing changes
function apply(libText, ev, Lib, today = new Date().toISOString().slice(0, 10)) {
  if (!ev) return null;
  const lib = new Lib.Library({ load: () => libText || "{}" });
  if (ev.type === "movie") {
    if (!ev.title && !ev.imdb) return null;
    const o = { type: "movie", title: ev.title, year: ev.year || null, imdb: ev.imdb || null, tmdb: ev.tmdb || null };
    const it = lib.find(o) || lib.add(o, "watchlist").item;
    if (it.watches.includes(today)) return null; // the same viewing sent twice
    lib.logWatch(it, today);
    it.status = "watched";
    return { text: JSON.stringify(lib.toJSON()), title: it.title, what: "watched" };
  }
  if (ev.type === "episode") {
    if (!ev.show || !ev.s || !ev.e) return null;
    const o = { type: "show", title: ev.show, year: ev.year || null, imdb: ev.showImdb || null, tmdb: ev.showTmdb || null };
    const it = lib.find(o) || lib.add(o, "watching").item;
    const k = Lib.epKey ? Lib.epKey(ev.s, ev.e) : `${ev.s}:${ev.e}`;
    if (it.eps[k]) return null;
    it.eps[k] = today;
    if (lib.q) lib.q(it, { op: "ep", s: ev.s, e: ev.e, d: today });
    lib.afterEps(it);
    return { text: JSON.stringify(lib.toJSON()), title: `${it.title} S${ev.s} E${ev.e}`, what: "ticked" };
  }
  return null;
}

module.exports = { parse, apply, fromJellyfin, fromPlex, multipartPayload };
