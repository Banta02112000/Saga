// 0.5.4.4: API keys move out of canonsync.json into the encrypted store, and never come back into the file.
const assert = require("assert");
const C = require("./core.js");
function phone(initial, opts = {}) {
  const files = { "canonsync.json": initial ? JSON.stringify(initial) : "" };
  let sec = opts.sec === undefined ? "" : opts.sec, writes = 0;
  return {
    files, get sec() { return sec; }, set sec(v) { sec = v; }, get writes() { return writes; },
    persist: { load: () => files["canonsync.json"], save: t => { files["canonsync.json"] = t; },
      secrets: opts.none ? null : { load: () => sec, save: t => { if (opts.failSave) return false; writes++; sec = t; return true; } } },
  };
}
// 1. keys from an older version move out of the file
{ const p = phone({ settings: { tmdb_key: "T", gemini_key: "G", token: "tok", region: "IT", backup_secrets: "0" } });
  const db = new C.Store(p.persist); db.flush();
  const file = JSON.parse(p.files["canonsync.json"]);
  assert.ok(!("tmdb_key" in file.settings) && !("token" in file.settings) && file.settings.region === "IT", "keys left the file");
  assert.strictEqual(db.get("tmdb_key"), "T"); assert.strictEqual(db.get("token"), "tok");
  assert.deepStrictEqual(JSON.parse(p.sec).gemini_key, "G");
  // 2. setting a key writes the encrypted store, not the file
  db.set("gemini_key", "G2"); db.flush();
  assert.ok(!/G2/.test(p.files["canonsync.json"]) && JSON.parse(p.sec).gemini_key === "G2", "new key only in the store");
  assert.ok(db.has("gemini_key") && !("gemini_key" in db.toJSON().settings));
  // 3. a restore that carries keys (fromJSON) moves them too
  db.reset(); db.fromJSON({ settings: { region: "US", steam_key: "S" } });
  assert.strictEqual(db.get("steam_key"), "S"); assert.ok(!("steam_key" in db.settings));
  assert.strictEqual(db.get("tmdb_key"), "T", "keys already on the phone survive a reset");
  // 4. the background job changed the token: reload picks it up
  db.flush(); let st = "a"; db.persist.stamp = () => st; db._stamp = "a";
  p.sec = JSON.stringify(Object.assign(JSON.parse(p.sec), { token: "tok2" })); p.files["canonsync.json"] = JSON.stringify({ settings: { region: "US" } });
  st = "b"; db.reload();
  assert.strictEqual(db.get("token"), "tok2");
}
// 5. no Keystore (older bridge, tests): everything stays in settings as before
{ const p = phone({ settings: { tmdb_key: "T" } }, { none: true });
  const db = new C.Store(p.persist); db.set("gemini_key", "G"); db.flush();
  assert.ok(/"tmdb_key":"T"/.test(p.files["canonsync.json"]) && /"gemini_key":"G"/.test(p.files["canonsync.json"]) && !db.secretsOn()); }
// 6. "!" from the phone = Keystore unusable: same as none
{ const p = phone({ settings: { tmdb_key: "T" } }, { sec: "!" }); const db = new C.Store(p.persist);
  assert.ok(!db.secretsOn() && db.settings.tmdb_key === "T"); }
// 7. the store can't be written: keys stay in the file, nothing is lost
{ const p = phone({ settings: { tmdb_key: "T" } }, { failSave: true }); const db = new C.Store(p.persist);
  assert.strictEqual(db.settings.tmdb_key, "T"); db.set("gemini_key", "G"); assert.strictEqual(db.settings.gemini_key, "G"); assert.strictEqual(db.get("gemini_key"), "G"); }
console.log("SECURE STORE TESTS PASSED");
