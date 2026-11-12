/* Finding a picture for anything: each kind of title has its own list of sources, tried in order until one has an
   image. A picture that later fails to load is reported back and the next source is tried. Runs in Node for tests. */
(function (root) {
  "use strict";
  const norm = t => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[™®©]/g, "").replace(/^(the|a|an)\s+/, "").replace(/[^a-z0-9]/g, "");
  const same = (a, b) => { const x = norm(a), y = norm(b); return !!x && (x === y || (x.length > 5 && (x.startsWith(y) || y.startsWith(x)) && Math.abs(x.length - y.length) <= 3)); };
  const yearOk = (a, b) => !a || !b || Math.abs(+a - +b) <= 1;
  async function J(http, url, headers) {
    const r = await http("GET", url, { headers: Object.assign({ Accept: "application/json" }, headers || {}) });
    if (r.status !== 200) return null;
    try { return JSON.parse(r.body); } catch (e) { return null; }
  }
  const imdbImg = u => (u ? String(u).replace(/\._V1_.*\.(jpg|png)$/i, "._V1_UX400_.$1") : "");
  const https = u => String(u || "").replace(/^http:/, "https:");
  const TMDB = "https://image.tmdb.org/t/p/w342";

  const SRC = {
    async tmdb(http, o, opt) {
      if (!opt.tmdbKey) return null;
      const k = String(opt.tmdbKey), auth = k.startsWith("eyJ") ? { Authorization: `Bearer ${k}` } : {}, ak = k.startsWith("eyJ") ? "" : `api_key=${k}&`;
      const base = "https://api.themoviedb.org/3";
      if (o.imdb) {
        const j = await J(http, `${base}/find/${o.imdb}?${ak}external_source=imdb_id`, auth);
        const x = j && [].concat(j.movie_results || [], j.tv_results || [])[0];
        if (x && x.poster_path) return TMDB + x.poster_path;
      }
      const tv = o.kind === "show" || o.kind === "anime";
      const j = await J(http, `${base}/search/${tv ? "tv" : "movie"}?${ak}query=${encodeURIComponent(o.title)}${o.year ? `&${tv ? "first_air_date_year" : "year"}=${o.year}` : ""}`, auth);
      const x = j && (j.results || []).find(r => (same(r.title || r.name, o.title) || same(r.original_title || r.original_name, o.title)) && r.poster_path);
      return x ? TMDB + x.poster_path : null;
    },
    async imdbId(http, o) {
      if (!o.imdb) return null;
      const j = await J(http, `https://v3.sg.media-imdb.com/suggestion/x/${o.imdb}.json`);
      const d = j && (j.d || []).find(x => x.id === o.imdb);
      return d && d.i ? imdbImg(d.i.imageUrl) : null;
    },
    async imdbSearch(http, o) {
      const q = String(o.title || "").toLowerCase().trim();
      if (!q) return null;
      const j = await J(http, `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(q[0].replace(/[^a-z0-9]/, "x"))}/${encodeURIComponent(q.slice(0, 60))}.json`);
      const want = { game: /video ?game/i, movie: /feature|movie|video$/i, show: /series|mini/i, anime: /series|mini|feature/i }[o.kind] || /./;
      const d = j && (j.d || []).find(x => x.i && x.i.imageUrl && same(x.l, o.title) && yearOk(x.y, o.year) && want.test(x.q || x.qid || ""));
      return d ? imdbImg(d.i.imageUrl) : null;
    },
    async tvmaze(http, o) {
      let s = null;
      if (o.imdb) s = await J(http, `https://api.tvmaze.com/lookup/shows?imdb=${o.imdb}`);
      if (!s) { const x = await J(http, `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(o.title)}`); if (x && same(x.name, o.title) && yearOk((x.premiered || "").slice(0, 4), o.year)) s = x; }
      return s && s.image ? https(s.image.original || s.image.medium) : null;
    },
    async itunes(http, o) {
      const j = await J(http, `https://itunes.apple.com/search?term=${encodeURIComponent(o.title)}&media=movie&entity=movie&limit=10&country=${opt0.country || "IT"}`);
      const x = j && (j.results || []).find(r => same(r.trackName, o.title) && yearOk((r.releaseDate || "").slice(0, 4), o.year));
      return x && x.artworkUrl100 ? x.artworkUrl100.replace(/100x100(bb)?/, "600x900bb") : null;
    },
    async jikanAnime(http, o) {
      if (o.mal) { const j = await J(http, `https://api.jikan.moe/v4/anime/${o.mal}`); const d = j && j.data; if (d && d.images) return (d.images.jpg || {}).large_image_url || (d.images.jpg || {}).image_url || null; }
      const j = await J(http, `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(o.title)}&limit=8`);
      const d = j && (j.data || []).find(x => [x.title, x.title_english, ...(x.titles || []).map(t => t.title)].some(t => same(t, o.title)));
      return d && d.images ? (d.images.jpg || {}).large_image_url || null : null;
    },
    async jikanManga(http, o) {
      if (o.mal) { const j = await J(http, `https://api.jikan.moe/v4/manga/${o.mal}`); const d = j && j.data; if (d && d.images) return (d.images.jpg || {}).large_image_url || null; }
      const t = String(o.series || o.title).replace(/\s*(vol\.?|volume|n\.|#)\s*\d+.*$/i, "").replace(/\s+\d+$/, "");
      const j = await J(http, `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(t)}&limit=8`);
      const d = j && (j.data || []).find(x => [x.title, x.title_english, ...(x.titles || []).map(z => z.title)].some(z => same(z, t)));
      return d && d.images ? (d.images.jpg || {}).large_image_url || null : null;
    },
    async steam(http, o) {
      if (o.steam) return `https://cdn.cloudflare.steamstatic.com/steam/apps/${o.steam}/library_600x900.jpg`;
      const j = await J(http, `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(o.title)}&cc=IT&l=english`);
      const x = j && (j.items || []).find(i => same(i.name, o.title));
      return x ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${x.id}/library_600x900.jpg` : null;
    },
    async steamHeader(http, o) { return o.steam ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${o.steam}/header.jpg` : null; },
    async googleBooks(http, o) {
      const q = o.isbn ? `isbn:${o.isbn}` : `intitle:${o.title}${o.author ? ` inauthor:${o.author}` : ""}`;
      const j = await J(http, `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=8`);
      const v = j && (j.items || []).map(x => x.volumeInfo || {}).find(v => v.imageLinks && (o.isbn || same(v.title, o.title)));
      return v ? https(v.imageLinks.thumbnail || v.imageLinks.smallThumbnail).replace("&edge=curl", "") : null;
    },
    async openLibrary(http, o) {
      if (o.isbn) { const r = await http("GET", `https://covers.openlibrary.org/b/isbn/${o.isbn}-L.jpg?default=false`, {}); if (r.status === 200) return `https://covers.openlibrary.org/b/isbn/${o.isbn}-L.jpg`; }
      const j = await J(http, `https://openlibrary.org/search.json?title=${encodeURIComponent(o.title)}${o.author ? `&author=${encodeURIComponent(o.author)}` : ""}&limit=5&fields=title,cover_i`);
      const d = j && (j.docs || []).find(x => x.cover_i && same(x.title, o.title));
      return d ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null;
    },
    async wikipedia(http, o) { return wiki(http, "https://en.wikipedia.org/w/api.php", titlesFor(o)); },
    async wikipediaIt(http, o) { return wiki(http, "https://it.wikipedia.org/w/api.php", titlesFor(o, true)); },
    async tardis(http, o) { return wiki(http, "https://tardis.fandom.com/api.php", [o.title, `${o.title} (TV story)`, `${o.title} (audio story)`, `${o.title} (novel)`]); },
  };
  function titlesFor(o, it) {
    const t = o.title, y = o.year;
    const sfx = { game: it ? ["(videogioco)"] : ["(video game)"], movie: it ? ["(film " + (y || "") + ")", "(film)"] : [y ? `(${y} film)` : "", "(film)"], show: it ? ["(serie televisiva)"] : ["(TV series)", y ? `(${y} TV series)` : ""], anime: ["(TV series)", "(manga)"], book: it ? ["(romanzo)"] : ["(novel)"], manga: ["(manga)"] }[o.kind] || [];
    return sfx.filter(Boolean).map(x => `${t} ${x}`).concat([t]);
  }
  async function wiki(http, api, titles) {
    const j = await J(http, `${api}?action=query&format=json&prop=pageimages&piprop=thumbnail&pithumbsize=600&redirects=1&titles=${encodeURIComponent(titles.slice(0, 5).join("|"))}`);
    const pages = j && j.query && j.query.pages ? Object.values(j.query.pages) : [];
    const map = {};
    for (const r of ((j && j.query && j.query.redirects) || []).concat((j && j.query && j.query.normalized) || [])) map[r.from] = r.to;
    for (const t of titles) {
      let k = t; for (let i = 0; i < 3 && map[k]; i++) k = map[k];
      const p = pages.find(x => x.title === k && x.thumbnail && !/\.svg/i.test(x.thumbnail.source || ""));
      if (p) return p.thumbnail.source;
    }
    return null;
  }
  const CHAIN = {
    movie: ["tmdb", "imdbId", "imdbSearch", "itunes", "wikipedia", "wikipediaIt"],
    show: ["tmdb", "tvmaze", "imdbId", "imdbSearch", "wikipedia", "wikipediaIt"],
    anime: ["jikanAnime", "tvmaze", "tmdb", "imdbId", "imdbSearch", "wikipedia"],
    game: ["steam", "imdbId", "imdbSearch", "wikipedia", "steamHeader", "wikipediaIt"],
    book: ["googleBooks", "openLibrary", "wikipedia", "wikipediaIt"],
    manga: ["jikanManga", "googleBooks", "openLibrary", "wikipedia"],
    story: ["tardis"],
  };
  let opt0 = {};
  // o: {kind, title, year, imdb, tmdb, steam, isbn, author, mal, series}; opt: {tmdbKey, skip: [sources already tried]}
  async function find(http, o, opt = {}) {
    opt0 = opt;
    const skip = new Set(opt.skip || []);
    for (const s of CHAIN[o.kind] || []) {
      if (skip.has(s)) continue;
      try { const url = await SRC[s](http, o, opt); if (url) return { url, src: s }; } catch (e) { /* next source */ }
    }
    return null;
  }
  const API = { find, CHAIN, SRC, norm, same, imdbImg, titlesFor };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Images = API;
})(typeof window !== "undefined" ? window : globalThis);
