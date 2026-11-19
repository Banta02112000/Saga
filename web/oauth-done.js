// Saga website (0.7.5): the page a sign-in (Spotify, IsThereAnyDeal, AniList) comes back to. It hands the address to the
// Saga page that started it (same browser) and closes itself.
(function () {
  try { localStorage.setItem("saga_oauth", location.href); } catch (e) { /* private mode */ }
  try { if (window.opener && !window.opener.closed) window.opener.postMessage({ sagaOauth: location.href }, location.origin); } catch (e) { /* no opener */ }
  document.body.textContent = "Signed in. You can close this tab and go back to Saga.";
  setTimeout(function () { try { window.close(); } catch (e) { /* stays */ } }, 900);
})();
