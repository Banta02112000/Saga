/* Italian mode for every tab. The pages are written in English; when Settings › Language is Italiano, every
   text on screen (and placeholders, labels, tooltips) is looked up in the dictionary below and swapped, also for
   whatever the page draws later. Titles of films, games and books are never in the dictionary, so they stay as they are.
   Switching back to English reloads the page. */
(function () {
  "use strict";
  var IT = window.BANTA_IT || {};
  // [English pattern, Italian replacement] for texts with numbers or names in them
  var PAT = (window.BANTA_IT_PAT || []).map(function (p) { return [new RegExp("^" + p[0] + "$"), p[1]]; });
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };
  var on = false, obs = null;
  var lang = function () { try { return window.BantaShell && BantaShell.lang ? BantaShell.lang() : "en"; } catch (e) { return "en"; } };

  function tr(s) {
    if (!s) return null;
    var k = s.trim();
    if (!k || k.length > 400) return null;
    var v = IT[k];
    if (v == null) {
      for (var i = 0; i < PAT.length; i++) if (PAT[i][0].test(k)) { v = k.replace(PAT[i][0], PAT[i][1]); break; }
      if (v == null) {
        // "Label: value" and "Label ›" style texts: translate the label part
        var m = k.match(/^(.+?)(\s*[:›·…]\s*)$/);
        if (m && IT[m[1]] != null) v = IT[m[1]] + m[2];
      }
    }
    if (v == null || v === k) return null;
    return s.replace(k, v);
  }
  function skipEl(el) { return !el || SKIP[el.nodeName] || (el.closest && el.closest('[translate="no"],.notr')); }
  function attrs(el) {
    ["placeholder", "aria-label", "title"].forEach(function (a) {
      var v = el.getAttribute && el.getAttribute(a);
      if (v) { var t = tr(v); if (t != null) el.setAttribute(a, t); }
    });
    if (el.nodeName === "INPUT" && (el.type === "button" || el.type === "submit") && el.value) { var t = tr(el.value); if (t != null) el.value = t; }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (!skipEl(root.parentNode)) { var t = tr(root.nodeValue); if (t != null) root.nodeValue = t; } return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (root.closest && root.closest('[translate="no"],.notr')) return; attrs(root); if (SKIP[root.nodeName]) return; }
    var w = document.createTreeWalker(root, 5 /* elements + text */, null), n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 1) { if (n.hasAttribute("placeholder") || n.hasAttribute("aria-label") || n.hasAttribute("title") || n.nodeName === "INPUT") attrs(n); continue; }
      if (skipEl(n.parentNode)) continue;
      var t2 = tr(n.nodeValue);
      if (t2 != null) n.nodeValue = t2;
    }
  }
  function start() {
    if (on || !document.body) return;
    on = true;
    document.documentElement.lang = "it";
    walk(document.body);
    if (document.title) { var tt = tr(document.title); if (tt) document.title = tt; }
    obs = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === "characterData") walk(m.target);
        else if (m.type === "attributes") attrs(m.target);
        else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "aria-label", "title"] });
  }
  function apply() {
    if (lang() === "it") start();
    else if (on) { on = false; if (obs) obs.disconnect(); location.reload(); }
  }
  // toasts and confirm() texts that never touch the page go through t()
  function t(s) { if (lang() !== "it") return s; var r = tr(String(s)); return r == null ? s : r; }
  if (document.body) apply(); else document.addEventListener("DOMContentLoaded", apply);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) apply(); });
  window.BantaI18n = { apply: apply, t: t, tr: tr, walk: walk, isOn: function () { return on; } };
})();
