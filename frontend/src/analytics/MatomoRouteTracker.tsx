import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

declare global {
  interface Window {
    _paq?: unknown[][];
  }
}

/**
 * Meldet SPA-Navigationen an Matomo. Der initiale Pageview kommt bereits aus
 * public/analytics.js — daher wird der erste Render uebersprungen, damit der
 * Einstieg nicht doppelt gezaehlt wird. Cookieless/DNT-Setup steckt in
 * analytics.js; hier wird nur pro Routenwechsel ein trackPageView gepusht.
 * Nur der Pfad wird gemeldet — Query-Parameter (z.B. ?image=<id>) tragen
 * private Ressourcen-IDs und gehoeren nicht in Third-Party-Logs.
 */
export default function MatomoRouteTracker(): null {
  const location = useLocation();
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    const paq = window._paq;
    if (!paq) return;
    paq.push(["setCustomUrl", window.location.origin + location.pathname]);
    paq.push(["setDocumentTitle", document.title]);
    paq.push(["trackPageView"]);
  }, [location.pathname]);

  return null;
}
