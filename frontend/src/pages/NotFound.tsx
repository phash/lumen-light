import { Link, useLocation } from "react-router-dom";

import { TITLE_SUFFIX, usePageMeta } from "../hooks/usePageMeta";
import { localeForPath } from "../i18n/locale";

const TEXT = {
  de: {
    title: "Seite nicht gefunden",
    body: "Diese Adresse gibt es nicht (mehr). Vielleicht hat sich ein Tippfehler eingeschlichen.",
    home: "Zur Startseite",
    homeHref: "/",
  },
  en: {
    title: "Page not found",
    body: "This address does not exist (anymore). Maybe there is a typo.",
    home: "Back to the homepage",
    homeHref: "/en",
  },
} as const;

/** Catch-all fuer unbekannte Routen. Unter /en/... auf Englisch. */
export default function NotFound() {
  const lang = localeForPath(useLocation().pathname);
  const t = TEXT[lang];
  usePageMeta(`${t.title}${TITLE_SUFFIX}`, lang);
  return (
    <section data-testid="page-not-found" className="p-8 max-w-2xl">
      <h1 className="text-3xl">{t.title}</h1>
      <p className="mt-2 text-stone-400">{t.body}</p>
      <Link
        to={t.homeHref}
        data-testid="not-found-home"
        className="mt-6 inline-block text-amber-200 hover:underline"
      >
        {t.home}
      </Link>
    </section>
  );
}
