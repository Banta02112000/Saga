/* Building blocks every section uses, so they all look and behave the same: posters (real artwork, or a generated
   cover from the title), tiles, rails, grids, title-page heroes and stars. app.js adds toast/icon/sheet at start. */
(function () {
  "use strict";
  // plain-http links are upgraded: the app only talks HTTPS
  const https = u => String(u || "").replace(/^http:\/\//i, "https://");
  const esc = s => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hue = s => { let h = 0; for (const c of String(s || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  const sec = { watch: "Film", show: "Series", movie: "Film", game: "Game", book: "Book", story: "Story" };
  // o: {title, img, kind, badge, badgeR, badgeAcc, progress (0-1), done, wide, act, attrs}
  function poster(o) {
    // a picture that doesn't load is reported (o.key), so the next source is tried
    // no inline handler (the page's security policy forbids them): app.js listens for broken pictures by data-fb
    const img = o.img ? `<img loading="lazy" decoding="async" src="${esc(https(o.img))}" alt="" data-fb="rm"${o.key ? ` data-broken="${esc(o.key)}"` : ""}>` : "";
    const gen = `<span class="gen" style="--h:${hue(o.title)}"><b>${esc(o.title)}</b>${o.kind ? `<small>${esc(sec[o.kind] || o.kind)}</small>` : ""}</span>`;
    return `<button class="poster${o.wide ? " wide" : ""}${o.square ? " square" : ""}" ${o.attrs || ""} aria-label="${esc(o.title)}">${gen}${img}
      ${o.badge ? `<span class="badge${o.badgeAcc ? " acc" : ""}">${esc(o.badge)}</span>` : ""}${o.badgeR ? `<span class="badge r">${esc(o.badgeR)}</span>` : ""}
      ${o.progress != null && o.progress > 0 && o.progress < 1 ? `<span class="bar"><i style="width:${Math.round(o.progress * 100)}%"></i></span>` : ""}
      ${o.done ? `<span class="done"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span>` : ""}</button>`;
  }
  const tile = (o, cap, cap2) => `<div class="tile">${poster(o)}${cap ? `<div class="cap">${esc(cap)}</div>` : ""}${cap2 ? `<div class="cap2">${cap2}</div>` : ""}</div>`;
  const rail = (items, wide) => `<div class="rail${wide ? " wide" : ""}">${items.join("")}</div>`;
  const grid = items => `<div class="grid">${items.join("")}</div>`;
  const head = (title, right, count) => `<div class="sechead"><h2>${esc(title)}</h2>${count != null ? `<span class="count">${esc(count)}</span>` : ""}${right || ""}</div>`;
  // the top of a title sheet: blurred artwork, the poster, the title
  function sheetHero(o, sub) {
    return `<div class="cover-hero">${o.img ? `<div class="bg" style="background-image:url('${esc(o.img)}')"></div>` : `<div class="bg" style="background:linear-gradient(160deg,hsl(${hue(o.title)} 50% 30%),hsl(${(hue(o.title) + 40) % 360} 40% 10%))"></div>`}
      ${poster(Object.assign({}, o, { badge: "", badgeR: "", progress: null, done: false }))}<div class="t"><h3>${esc(o.title)}</h3>${sub || ""}</div></div>`;
  }
  function stars(rating, action) {
    return `<span class="stars">${[1, 2, 3, 4, 5].map(i => `<button data-action="${action}" data-v="${i}" class="${rating >= i * 2 ? "on" : rating === i * 2 - 1 ? "half" : ""}" aria-label="${i} stars">★</button>`).join("")}</span>`;
  }
  const day = d => (d ? new Date(typeof d === "number" ? d : d + "T12:00:00") : null);
  function when(d, lang) {
    const x = day(d);
    if (!x || isNaN(x)) return "";
    return x.toLocaleDateString(lang === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  const iso = d => { if (!d) return ""; const x = typeof d === "number" ? new Date(d) : new Date(String(d).length === 10 ? d + "T12:00:00" : d); return isNaN(x) ? "" : x.toISOString().slice(0, 10); };
  // 0.7.8: a multiverse's banner: a fan of its posters on the right, the name and how far you are on the left
  function banner(o) {
    const imgs = (o.imgs || []).filter(Boolean).slice(0, 5), h = hue(o.name), pct = Math.max(0, Math.min(100, Math.round(o.pct || 0)));
    return `<div class="mvbanner${o.small ? " small" : ""}" style="--h:${h}" ${o.attrs || ""}>
      <div class="mvbg">${imgs.length ? `<div class="bg" style="background-image:url('${esc(imgs[0])}')"></div>` : ""}</div>
      <div class="mvfan">${imgs.length ? imgs.map((u, i) => `<img loading="lazy" decoding="async" alt="" src="${esc(u)}" style="--i:${i};--n:${imgs.length}" onerror="this.remove()">`).join("") : `<b class="mono">${esc(String(o.name || "?").replace(/^the\s+/i, "").slice(0, 1))}</b>`}</div>
      <div class="mvtext">${o.kicker ? `<div class="kicker">${esc(o.kicker)}</div>` : ""}<h2>${esc(o.name)}</h2>${o.line ? `<div class="small">${o.line}</div>` : ""}</div>
      ${o.pct != null ? `<div class="mvbar"><i style="width:${pct}%"></i></div>` : ""}${o.right ? `<div class="mvright">${o.right}</div>` : ""}</div>`;
  }
  // 0.8.4: a button that needs a second tap: the first one changes its text; → true on the second
  function confirmTap(el, text) { if (el.dataset.sure) return true; el.dataset.sure = "1"; el.dataset.was = el.innerHTML; el.textContent = text; setTimeout(() => { if (el.isConnected && el.dataset.sure) { delete el.dataset.sure; el.innerHTML = el.dataset.was; } }, 5000); return false; }
  window.Kit = { confirmTap, banner, esc, hue, poster, tile, rail, grid, head, sheetHero, stars, when, iso, mods: {}, toast: () => {}, icon: () => "", sheet: () => {}, close: () => {} };
})();
