// Saga: backups: one file with everything (by hand, automatically, password-protected), and the copies kept
// before every big change (restore, undo).
// A part of app.js, in its own file: it gets what it uses from the rest of the app through A, and gives back what
// the app uses (made by scripts/split_app.js; the names it uses are listed in app.js where it's put together).
(function (root) {
  "use strict";
  (root.SagaParts = root.SagaParts || {}).backup = function (A) {
  // ---- backup: one file with everything, by hand or automatically to a file you choose
  // API keys and sign-in tokens: kept on this phone, left out of backup files unless the person asks for them
  const SECRET_RX = A.C.SECRET_RX;
  const canonForBackup = withSecrets => { const j = A.db.toJSON(); if (withSecrets) { j.settings = Object.assign({}, j.settings, A.db.secretsAll()); return j; } const st = {}; for (const [k, v] of Object.entries(j.settings || {})) if (!SECRET_RX.test(k)) st[k] = v; j.settings = st; j.secretsLeftOut = true; return j; };
  const bundle = (withSecrets = A.db.get("backup_secrets", "0") === "1") => JSON.stringify({ app: "canonsync-all", v: 2, version: A.VERSION, at: new Date().toISOString(), canon: canonForBackup(withSecrets), library: A.lib.toJSON(), games: A.games.toJSON(), books: A.books.toJSON(), dw: Kit.mods.timeline.state() });
  const autoBackups = () => { try { return JSON.parse(A.db.get("auto_backups", "[]")); } catch (e) { return []; } };
  function autoBackup() {
    const last = parseFloat(A.db.get("auto_backup_at", "0")) || 0;
    if (Date.now() - last < 7 * 864e5 || (!A.db.items().length && !A.lib.all().length && !A.games.games.length && !A.books.books.length)) return;
    const slot = Math.floor(Date.now() / (7 * 864e5)) % 4;
    if (!A.SH.write(`auto_backup_${slot}.json`, bundle(false))) return; // keys stay in the phone's encrypted store, not in copies Android may back up
    const list = autoBackups().filter(b => b.slot !== slot).concat([{ slot, at: Date.now() }]).sort((a, b) => b.at - a.at).slice(0, 4);
    A.db.set("auto_backups", JSON.stringify(list));
    A.db.set("auto_backup_at", String(Date.now()));
  }
  // the file you picked once (Drive, a folder on the phone…) is rewritten after changes and at least daily
  // ---- password-protected backups: AES-GCM with a key made from the password (PBKDF2, 250,000 rounds)
  const LOCK_ITER = 250000;
  const toB64 = buf => { const b = new Uint8Array(buf); let out = ""; for (let i = 0; i < b.length; i += 32768) out += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(out); };
  const fromB64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
  async function lockKey(pw, salt, iter) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function sealBackup(text, pw) {
    if (!(window.crypto && crypto.subtle)) throw new Error("This phone can't encrypt here");
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await lockKey(pw, salt, LOCK_ITER), new TextEncoder().encode(text));
    return JSON.stringify({ app: "saga-locked", v: 1, kdf: "PBKDF2-SHA256", iter: LOCK_ITER, salt: toB64(salt), iv: toB64(iv), data: toB64(data) });
  }
  async function openBackup(j, pw) {
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(j.iv) }, await lockKey(pw, fromB64(j.salt), j.iter || LOCK_ITER), fromB64(j.data));
      return new TextDecoder().decode(plain);
    } catch (e) { throw new Error("Wrong password, or the file is damaged"); }
  }
  const isLocked = text => { try { const j = JSON.parse(String(text || "").replace(/^\ufeff/, "")); return j && j.app === "saga-locked" ? j : null; } catch (e) { return null; } };
  // what goes into backup files you keep outside the app: locked when a backup password is set
  // the same backup in pieces, built without holding the screen (the backup file that's rewritten after changes)
  async function bundleParts() {
    const parts = await A.C.jsonParts({ app: "canonsync-all", v: 2, version: A.VERSION, at: new Date().toISOString(), canon: canonForBackup(A.db.get("backup_secrets", "0") === "1"), library: A.lib.toJSON(), games: A.games.toJSON(), books: A.books.toJSON(), dw: Kit.mods.timeline.state() }, 6, 1);
    const pw = A.db.get("backup_password");
    if (!pw) return parts;
    if (!(window.crypto && crypto.subtle)) throw new Error("This phone can't encrypt here");
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await lockKey(pw, salt, LOCK_ITER), new TextEncoder().encode(parts.join(""))));
    const out = [JSON.stringify({ app: "saga-locked", v: 1, kdf: "PBKDF2-SHA256", iter: LOCK_ITER, salt: toB64(salt), iv: toB64(iv) }).slice(0, -1) + ',"data":"'];
    for (let i = 0; i < data.length; i += 196608) { out.push(toB64(data.subarray(i, i + 196608))); await A.C.breathe(0); } // 196608 = 3 × 65536: each piece is whole base64
    out.push('"}');
    return out;
  }
  async function bundleOut() { const t = bundle(); const pw = A.db.get("backup_password"); return pw ? sealBackup(t, pw) : t; }
  async function backupToFile(force) {
    if (!A.db.get("backup_uri") || !(window.Android && Android.writeUri)) return false;
    const last = parseFloat(A.db.get("backup_file_at", "0")) || 0;
    if (!force && Date.now() - last < 10 * 60000) return false;
    A.db.set("backup_file_at", String(Date.now())); // set first: a slow encryption must not start a second write
    let ok = false;
    try { ok = await A.Native.writeUriParts(A.db.get("backup_uri"), await bundleParts()); } catch (e) { A.logError("backup", e.message); }
    A.db.set("backup_file_ok", ok ? "1" : "0");
    A.db.flush();
    return ok;
  }
  window.__backupPicked = async uri => { if (uri) { A.db.set("backup_uri", uri); A.db.flush(); A.toast((await backupToFile(true)) ? "Backup file set and written" : "Couldn't write to that file"); } A.render(); };
  function applyBackup(b) {
    const done = [];
    const J = x => (typeof x === "string" ? JSON.parse(x) : x);
    if (b.canon) {
      // a backup without keys keeps the keys and sign-ins already on this phone
      const keep = Object.assign({}, A.db.secretsAll()); for (const [k, v] of Object.entries(A.db.toJSON().settings || {})) if (SECRET_RX.test(k)) keep[k] = v;
      const c = typeof b.canon === "string" ? JSON.parse(b.canon) : JSON.parse(JSON.stringify(b.canon));
      A.db.reset(); A.db.fromJSON(c); for (const [k, v] of Object.entries(keep)) if (!A.db.get(k)) A.db.set(k, v);
      A.db.flush(); A.invalidate(); done.push("Watch");
    }
    if (b.library) { const j = J(b.library); A.lib.items = {}; A.lib.adopted = j.adopted || {}; A.lib.outbox = []; for (const [k, v] of Object.entries(j.items || {})) A.lib.items[k] = A.L.blank(v); A.libSave(); done.push("Library"); }
    if (b.games) {
      const j = J(b.games);
      if (j && j.app === "games") A.games.fromJSON(j); else A.games.games = A.GC.fromOld(j.state || j, j.base || null);
      A.games.save(); done.push("Games");
    }
    if (b.books) { const j = J(b.books); const imp = A.BC.readImport(JSON.stringify(j), "backup.json"); A.books.books = []; A.BC.applyImport(A.books, imp, "replace"); if (j.goal) A.books.goal = j.goal; A.books.save(); done.push("Books"); }
    if (b.dw) { const j = J(b.dw); const s = j.state || j; A.Native.save("dw.json", JSON.stringify({ works: s.works || {}, migrated: 1 })); Kit.mods.timeline.reset(); done.push("Doctor Who"); }
    A.render();
    A.toast(`Restored: ${done.join(", ")}`);
  }
  function readBackup2(text) {
    let j = null;
    try { j = JSON.parse(String(text || "").replace(/^﻿/, "")); } catch (e) { /* the old reader explains */ }
    if (j && j.app === "canonsync-all") return { kind: "all", canon: j.canon, library: j.library || null, games: j.games, dw: j.dw, books: j.books || null, at: j.at };
    if (j && j.app === "games" && Array.isArray(j.games)) return { kind: "games", games: j };
    return A.C.readBackup(text);
  }
  async function restoreFrom(text) {
    const locked = isLocked(text);
    if (locked) {
      const saved = A.db.get("backup_password");
      if (saved) { try { return restoreFrom(await openBackup(locked, saved)); } catch (e) { /* a different password: ask */ } }
      return A.passwordDialog("This backup is locked", "Type the password it was saved with.", async pw => { try { restoreFrom(await openBackup(locked, pw)); } catch (e) { A.toast(e.message); } });
    }
    let b;
    try { b = readBackup2(text); } catch (e) { A.toast(e.message); return; }
    const parts = [b.canon && "Watch", b.library && "Library", b.games && "Games", b.books && "Books", b.dw && "Doctor Who"].filter(Boolean);
    A.confirmDialog("Restore this backup?", `This replaces ${parts.join(", ")}${b.at ? ` with the copy from ${new Date(b.at).toLocaleString()}` : " with what's in the file"}. A copy of what's there now is kept, so you can undo it in Settings › Data and about.`, "Restore", () => {
      // safety copy first (without keys: they stay in the phone's encrypted store)
      const kept = A.SH.write("before_restore.json", bundle(false));
      applyBackup(b);
      if (kept) { A.db.set("restore_undo_at", String(Date.now())); A.db.flush(); }
    });
  }
  // Every import keeps a copy of the data from just before it, so the latest one can be undone (Settings › Import).
  // ---- 0.6.9: history. Before every import, Start over, list removal, merge, restore and the first sync of the day,
  // a copy of what you made yourself (films and series, games, books, Doctor Who, your lists) is kept: the last 12.
  // What syncs from IMDb and Trakt isn't in it (a sync brings it back), so each copy stays small.
  const SNAP_MAX = 12;
  const snaps = () => { try { return JSON.parse(A.db.get("snaps", "[]")) || []; } catch (e) { return []; } };
  const MINE_SETTINGS = /^(lib_lists|my_lists|mylists|u_order|u_tier|recs_hide|pick_hide|lib_rules)/;
  // a copy can be several MB: it goes to the phone in pieces, written in the background (one huge text would stall the screen)
  function snapWrite(name, body) {
    if (A.Native.parts) { const parts = []; for (let i = 0; i < body.length; i += 150000) parts.push(body.slice(i, i + 150000)); A.Native.saveParts(name, parts); return true; }
    return !!A.Native.save(name, body);
  }
  function snapshot(why) {
    try {
      const mine = {}; for (const [k, v] of Object.entries(A.db.toJSON().settings || {})) if (MINE_SETTINGS.test(k)) mine[k] = v;
      const body = JSON.stringify({ app: "saga-snapshot", v: 1, version: A.VERSION, at: Date.now(), why, settings: mine, library: A.lib.toJSON(), games: A.games.toJSON(), books: A.books.toJSON(), dw: Kit.mods.timeline.state() });
      const list = snaps(), n = list.length ? (Math.max(...list.map(x => x.n)) + 1) : 1;
      if (!snapWrite(`snap_${n}.json`, body)) return false;
      list.unshift({ n, at: Date.now(), why, films: A.lib.all().length, games: A.games.visible().length, books: A.books.books.length, size: body.length });
      for (const old of list.slice(SNAP_MAX)) { try { A.Native.saveLater(`snap_${old.n}.json`, ""); } catch (e) { /* already gone */ } }
      A.db.set("snaps", JSON.stringify(list.slice(0, SNAP_MAX))); A.db.flush();
      return true;
    } catch (e) { A.logError("snapshot", e.message); return false; }
  }
  function restoreSnap(n) {
    const s0 = snaps().find(x => x.n === n), t = s0 && A.Native.load(`snap_${n}.json`);
    if (!t) { A.toast("That copy is no longer on this device"); return; }
    A.confirmDialog(`Go back to ${new Date(s0.at).toLocaleString(A.lang() === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}?`,
      `Your films and series, games, books, Doctor Who and lists go back to how they were ${A.esc(s0.why)} (${A.fmt(s0.films)} films and series, ${A.fmt(s0.games)} games, ${A.fmt(s0.books)} books). A copy of how things are now is kept first, so you can come back. Synced IMDb and Trakt data and your settings stay as they are.`, "Go back", () => {
        snapshot("before going back to an earlier copy");
        try {
          const j = JSON.parse(t);
          applyBackup({ library: j.library, games: j.games, books: j.books, dw: j.dw });
          for (const [k, v] of Object.entries(j.settings || {})) A.db.set(k, v);
          A.db.flush(); A.invalidate(); A.render(); A.toast("Back to the earlier copy");
        } catch (e) { A.toast(e.message); }
      });
  }
  function historySection() {
    const list = snaps();
    return `<section class="stack" id="history"><h2>History</h2>
      <p class="small muted" style="margin:0">A copy of what you made yourself is kept before every import, Start over, list removal, merge and the first sync of each day (the last ${SNAP_MAX}). Going back keeps a copy of now first.</p>
      <div class="listcard">${list.length ? list.map(x => `<div class="item"><div class="grow" style="min-width:0"><b class="ell">${A.esc(new Date(x.at).toLocaleString(A.lang() === "it" ? "it-IT" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</b>
        <div class="small muted ell">${A.esc(x.why)} · ${A.fmt(x.films)} films and series · ${A.fmt(x.games)} games · ${A.fmt(x.books)} books</div></div><button class="btn small" data-action="snaprestore" data-n="${x.n}">Go back</button></div>`).join("")
        : `<p class="small muted" style="padding:8px">No copies yet: the first is made before your next import or sync.</p>`}</div>
      <button class="btn small" data-action="snapnow">${A.icon("box")}Keep a copy now</button></section>`;
  }
    return { bundle, autoBackups, autoBackup, sealBackup, openBackup, bundleOut, backupToFile, applyBackup, readBackup2, restoreFrom, snapshot, restoreSnap, historySection };
  };
})(typeof window !== "undefined" ? window : this);
