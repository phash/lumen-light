// Matomo (self-hosted auf musikersuche.org/matomo, Site 8).
// Datenschutzfreundlich wie auf phash.de: COOKIELESS (kein Consent-Banner
// noetig) + Do-Not-Track respektiert. IP-Anonymisierung passiert serverseitig
// in der Matomo-Instanz. Als eigene Datei (statt Inline-Script), damit die
// strikte CSP ohne 'unsafe-inline' auskommt (script-src 'self').
(function () {
  var _paq = (window._paq = window._paq || []);
  _paq.push(["disableCookies"]); // keine Cookies -> kein Consent erforderlich
  _paq.push(["setDoNotTrack", true]); // DNT-Header respektieren
  _paq.push(["enableLinkTracking"]);
  _paq.push(["trackPageView"]);
  var u = "//musikersuche.org/matomo/";
  _paq.push(["setTrackerUrl", u + "matomo.php"]);
  _paq.push(["setSiteId", "8"]);
  var d = document,
    g = d.createElement("script"),
    s = d.getElementsByTagName("script")[0];
  g.async = true;
  g.src = u + "matomo.js";
  s.parentNode.insertBefore(g, s);
})();
