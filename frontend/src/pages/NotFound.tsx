import { Link } from "react-router-dom";

import { TITLE_SUFFIX, usePageMeta } from "../hooks/usePageMeta";

/** Catch-all fuer unbekannte Routen. */
export default function NotFound() {
  usePageMeta(`Seite nicht gefunden${TITLE_SUFFIX}`);
  return (
    <section data-testid="page-not-found" className="p-8 max-w-2xl">
      <h1 className="text-3xl">Seite nicht gefunden</h1>
      <p className="mt-2 text-stone-400">
        Diese Adresse gibt es nicht (mehr). Vielleicht hat sich ein Tippfehler
        eingeschlichen.
      </p>
      <Link
        to="/"
        data-testid="not-found-home"
        className="mt-6 inline-block text-amber-200 hover:underline"
      >
        Zur Startseite
      </Link>
    </section>
  );
}
