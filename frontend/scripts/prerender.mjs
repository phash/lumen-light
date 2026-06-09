/**
 * Prerendering der Public-Routes: schreibt das SSR-gerenderte HTML in den
 * `#root`-Container der gebauten index.html und legt pro Route eine statische
 * Datei ab (dist/index.html, dist/datenschutz/index.html, ...). Dadurch sehen
 * Crawler/KI-Engines echten Inhalt ohne JS; der Client ersetzt den Inhalt beim
 * Mount via createRoot (kein Hydration-Vertrag -> kein Mismatch-Risiko).
 *
 * Lauf: nach `vite build` (Client) + `vite build --ssr src/entry-server.tsx`.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { render, PRERENDER_ROUTES, LANDING_JSONLD, HREFLANG_HTML } from "../dist-ssr/entry-server.js";

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(FRONTEND, "dist");
const BASE = "https://lumen.mr-development.de";

// Pro Route: Ziel-Datei + Head-Overrides. Landing-Locales ("/" + "/en")
// bekommen das locale-korrekte JSON-LD (markiert via `locale`) und hreflang;
// Sub-Routen (Marketplace/Rechtsseiten) bekommen eigene title/description/og
// und KEIN Landing-JSON-LD (sonst FAQPage ohne sichtbare FAQ -> Google-
// Strukturdaten-Verstoss).
const ROUTE_META = {
  // Flat-Files (datenschutz.html) statt Verzeichnis (datenschutz/index.html):
  // nginx liefert sie ueber `try_files $uri.html` ohne 301-Trailing-Slash.
  "/": { file: "index.html", title: null, description: null, locale: "de" },
  "/en": {
    file: "en.html",
    title: "Free Lightroom Alternative in Your Browser — Lumen",
    description:
      "Lumen is a free, lightweight, self-hostable Lightroom alternative: develop RAW photos right in your browser — local masks, HSL, tone curve, auto-tone. No subscription, no forced cloud.",
    locale: "en",
  },
  "/marketplace": {
    file: "marketplace.html",
    title: "Kostenlose Presets — Lumen · light Marketplace",
    description:
      "Kostenlose Foto-Presets für Lumen · light, die browser-basierte Lightroom-Alternative. Ohne Konto stöbern, mit einem Klick anwenden.",
  },
  "/datenschutz": {
    file: "datenschutz.html",
    title: "Datenschutz — Lumen · light",
    description:
      "Datenschutzerklärung von Lumen · light: welche Daten verarbeitet werden, Matomo-Analyse und deine Rechte nach DSGVO.",
  },
  "/impressum": {
    file: "impressum.html",
    title: "Impressum — Lumen · light",
    description:
      "Impressum und Anbieterkennzeichnung von Lumen · light nach TMG/DDG.",
  },
};

const ROOT_RE = /<div id="root"><\/div>/;
const template = readFileSync(resolve(DIST, "index.html"), "utf8");
if (!ROOT_RE.test(template)) {
  throw new Error("prerender: <div id=\"root\"></div> nicht in dist/index.html gefunden");
}

// Ersetzt genau ein Vorkommen und wirft, falls das Muster fehlt (fail-loud:
// faengt Template-Drift in index.html, statt still Landing-Defaults zu lassen).
function replaceOnce(html, re, repl, route, label) {
  if (!re.test(html)) {
    throw new Error(
      `prerender: Head-Muster '${label}' nicht im Template gefunden (Route ${route})`,
    );
  }
  return html.replace(re, repl);
}

function applyHead(html, route) {
  const meta = ROUTE_META[route];
  let out = html;
  const url = route === "/" ? `${BASE}/` : `${BASE}${route}`;

  // Muster sind whitespace-robust ([\s\S]*?\/>), weil Tags in index.html
  // ueber mehrere Zeilen formatiert sein koennen (name=/content= getrennt).
  if (meta?.title) {
    out = replaceOnce(out, /<title>[\s\S]*?<\/title>/, `<title>${meta.title}</title>`, route, "title");
    out = replaceOnce(
      out,
      /<meta\s+property="og:title"[\s\S]*?\/>/,
      `<meta property="og:title" content="${meta.title}" />`,
      route,
      "og:title",
    );
  }
  if (meta?.description) {
    out = replaceOnce(
      out,
      /<meta\s+name="description"[\s\S]*?\/>/,
      `<meta name="description" content="${meta.description}" />`,
      route,
      "description",
    );
    out = replaceOnce(
      out,
      /<meta\s+property="og:description"[\s\S]*?\/>/,
      `<meta property="og:description" content="${meta.description}" />`,
      route,
      "og:description",
    );
  }

  out = replaceOnce(
    out,
    /<link\s+rel="canonical"[\s\S]*?\/>/,
    `<link rel="canonical" href="${url}" />`,
    route,
    "canonical",
  );
  out = replaceOnce(
    out,
    /<meta\s+property="og:url"[\s\S]*?\/>/,
    `<meta property="og:url" content="${url}" />`,
    route,
    "og:url",
  );

  // hreflang nur fuer das de/en-Landing-Cluster; Rechtsseiten/Marketplace ohne.
  const HREFLANG_RE = /\s*<!-- HREFLANG_SLOT -->/;
  if (meta.locale) {
    out = replaceOnce(out, HREFLANG_RE, `\n    ${HREFLANG_HTML}`, route, "hreflang");
  } else if (HREFLANG_RE.test(out)) {
    out = out.replace(HREFLANG_RE, "");
  }

  // JSON-LD: Landing-Locales bekommen den generierten Block, alle anderen Routen
  // bekommen KEIN JSON-LD (Slot leer entfernen) — verhindert FAQPage ohne FAQ.
  const LD_RE = /\s*<!-- LD_JSON_SLOT -->/;
  if (meta.locale) {
    out = replaceOnce(out, LD_RE, `\n    ${LANDING_JSONLD[meta.locale]}`, route, "ld-json");
  } else if (LD_RE.test(out)) {
    out = out.replace(LD_RE, "");
  }
  return out;
}

for (const route of PRERENDER_ROUTES) {
  const meta = ROUTE_META[route];
  if (!meta) {
    console.warn(`prerender: keine ROUTE_META fuer ${route} — uebersprungen`);
    continue;
  }
  const body = render(route);
  let page = template.replace(ROOT_RE, `<div id="root">${body}</div>`);
  page = applyHead(page, route);

  const target = resolve(DIST, meta.file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, page, "utf8");
  console.log(`prerender: ${route} -> dist/${meta.file} (${page.length} B)`);
}

// Sitemap: prerenderte Routen inkl. EN-Landing mit hreflang-Alternates
// (xhtml:link). /marketplace + Rechtsseiten ohne Alternates (nur DE).
const SITEMAP = [
  { loc: `${BASE}/`, freq: "weekly", priority: "1.0", alt: { de: `${BASE}/`, en: `${BASE}/en` } },
  { loc: `${BASE}/en`, freq: "weekly", priority: "1.0", alt: { de: `${BASE}/`, en: `${BASE}/en` } },
  { loc: `${BASE}/marketplace`, freq: "weekly", priority: "0.8" },
  { loc: `${BASE}/datenschutz`, freq: "yearly", priority: "0.3" },
  { loc: `${BASE}/impressum`, freq: "yearly", priority: "0.3" },
];
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
  SITEMAP.map(({ loc, freq, priority, alt }) => {
    const alts = alt
      ? `\n    <xhtml:link rel="alternate" hreflang="de" href="${alt.de}"/>` +
        `\n    <xhtml:link rel="alternate" hreflang="en" href="${alt.en}"/>` +
        `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${alt.en}"/>`
      : "";
    return `  <url>\n    <loc>${loc}</loc>\n    <changefreq>${freq}</changefreq>\n    <priority>${priority}</priority>${alts}\n  </url>`;
  }).join("\n") +
  `\n</urlset>\n`;
writeFileSync(resolve(DIST, "sitemap.xml"), sitemap, "utf8");
console.log(`prerender: sitemap.xml (${SITEMAP.length} URLs)`);
