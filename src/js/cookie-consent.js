// Banner de cookies (partials/footer.html). Ficheiro externo por causa da CSP script-src 'self'.
(function () {
  var KEY = 'cookie_consent';
  var banner = document.getElementById('cookie-banner');
  if (!banner) return;
  var get = function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  if (!get()) banner.hidden = false;
  banner.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-consent]');
    if (!btn) return;
    var value = btn.getAttribute('data-consent');
    try { localStorage.setItem(KEY, value); } catch (e) {}
    if (window.gtag) gtag('consent', 'update', { analytics_storage: value });
    banner.hidden = true;
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.cookie-settings-link')) return;
    e.preventDefault();
    banner.hidden = false;
  });
})();
