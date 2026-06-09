// Pure, SSR-sichere Intro-Sektion fuer den Marketplace. Wird sowohl live (oben
// in Marketplace.tsx) als auch im Prerender (/marketplace) gerendert — damit
// Crawler echten Inhalt statt Landing-Fallback sehen. KEINE Hooks, kein window.
import { CONTENT, type Locale } from "../i18n/content";

interface Props {
  readonly lang?: Locale;
}

export default function MarketplaceIntro({ lang = "de" }: Props) {
  const m = CONTENT[lang].marketplace;
  return (
    <div data-testid="marketplace-intro" className="px-8 pt-10 max-w-4xl mx-auto">
      <h1 className="text-3xl text-stone-100">{m.heading}</h1>
      <p className="mt-3 text-stone-400 max-w-2xl">{m.body}</p>
    </div>
  );
}
