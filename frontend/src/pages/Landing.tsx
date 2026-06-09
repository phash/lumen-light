import { Link } from "react-router-dom";
import { useAuth } from "react-oidc-context";

import { CONTENT, type Locale } from "../i18n/content";

interface LandingProps {
  readonly lang?: Locale;
}

export default function Landing({ lang = "de" }: LandingProps) {
  const auth = useAuth();
  const c = CONTENT[lang];
  const startHref = auth.isAuthenticated ? "/editor" : "/login";

  return (
    <section data-testid="page-landing" className="min-h-[calc(100vh-3rem)]">
      {/* Hero */}
      <div className="px-8 py-16 max-w-4xl mx-auto">
        <h1 className="text-5xl text-stone-100 leading-tight">{c.hero.h1}</h1>
        <p className="mt-6 text-xl text-stone-400 max-w-xl">{c.hero.tagline}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to={startHref}
            data-testid="landing-cta-primary"
            className="px-6 py-3 text-sm uppercase tracking-[0.2em] bg-amber-200/15 border border-amber-300 text-amber-200 hover:bg-amber-200/25"
          >
            {auth.isAuthenticated ? c.hero.ctaStartAuth : c.hero.ctaStartAnon}
          </Link>
          <Link
            to={startHref}
            data-testid="landing-cta-demo"
            className="px-6 py-3 text-sm uppercase tracking-[0.2em] border border-stone-700 text-stone-300 hover:border-amber-300/40"
          >
            {auth.isAuthenticated ? c.hero.ctaDemoAuth : c.hero.ctaDemoAnon}
          </Link>
        </div>
      </div>

      {/* Feature-Grid */}
      <div className="px-8 py-12 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10">
          <h2 className="col-span-full text-2xl text-stone-200">{c.featuresHeading}</h2>
          {c.features.map((f) => (
            <div key={f.title}>
              <h3 className="text-stone-200 italic">{f.title}</h3>
              <p className="mt-2 text-sm text-stone-400">{f.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tech / Repo */}
      <div className="px-8 py-12 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-stone-300 italic">{c.selfhost.heading}</h2>
          <p className="mt-3 text-stone-400">{c.selfhost.body}</p>
        </div>
      </div>

      {/* Vergleich */}
      <div className="px-8 py-12 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto" data-testid="landing-compare">
          <h2 className="text-2xl text-stone-200">{c.compare.heading}</h2>
          <p className="mt-3 text-stone-400 max-w-2xl">{c.compare.intro}</p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-stone-300 border-b border-stone-700">
                  <th className="py-2 pr-4 font-normal" scope="col">&nbsp;</th>
                  <th className="py-2 pr-4 font-medium text-amber-200" scope="col">
                    Lumen · light
                  </th>
                  <th className="py-2 pr-4 font-normal" scope="col">
                    {c.compare.colLightroom}
                  </th>
                </tr>
              </thead>
              <tbody className="text-stone-400">
                {c.compare.rows.map(([label, lumen, lr]) => (
                  <tr key={label} className="border-b border-stone-800/60">
                    <th scope="row" className="py-2 pr-4 font-normal text-stone-300">
                      {label}
                    </th>
                    <td className="py-2 pr-4 text-stone-200">{lumen}</td>
                    <td className="py-2 pr-4">{lr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div className="px-8 py-12 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto" data-testid="landing-faq">
          <h2 className="text-2xl text-stone-200">{c.faqHeading}</h2>
          <div className="mt-6 divide-y divide-stone-800/60">
            {c.faq.map(({ q, a }) => (
              <details key={q} className="group py-3">
                <summary className="cursor-pointer text-stone-200 marker:text-amber-300/60 hover:text-amber-200">
                  {q}
                </summary>
                <p className="mt-2 text-sm text-stone-400">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-8 py-6 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto flex flex-wrap gap-4 text-xs text-stone-500">
          <Link to="/datenschutz" className="hover:text-stone-300">{c.footer.privacy}</Link>
          <Link to="/impressum" className="hover:text-stone-300">{c.footer.imprint}</Link>
          <a
            href="https://github.com/phash/lumen-light"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="landing-github"
            className="hover:text-stone-300"
          >
            GitHub
          </a>
          <a
            href="https://buymeacoffee.com/phash"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="landing-bmac"
            className="ml-auto text-amber-200/80 hover:text-amber-200"
          >
            ☕ Buy me a coffee
          </a>
        </div>
      </div>
    </section>
  );
}
