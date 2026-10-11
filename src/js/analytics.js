// Google Analytics com Consent Mode v2. Ficheiro externo (e não inline) por causa da CSP script-src 'self'.
// O ID vem do atributo data-ga-id da tag <script> (partials/head.html, content/site.yaml › google_analytics).
(function () {
  var id = document.currentScript && document.currentScript.getAttribute('data-ga-id');
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  // Tudo recusado até o visitante aceitar no banner (js/cookie-consent.js).
  gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    analytics_storage: 'denied', wait_for_update: 500
  });
  try {
    if (localStorage.getItem('cookie_consent') === 'granted') gtag('consent', 'update', { analytics_storage: 'granted' });
  } catch (e) {}
  gtag('js', new Date());
  if (id) gtag('config', id);
})();
