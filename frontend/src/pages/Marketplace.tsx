/**
 * Preset-Marketplace (F1).
 *
 * Liste oeffentlicher Presets mit Genre-Filter, Suche, Sort, Pagination.
 * Karten-Klick oeffnet Detail-Modal mit Anwenden / In-Bibliothek-Kopieren /
 * Melden. Anwenden ueberschreibt den Editor-State; Routing landet im
 * Editor.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "react-oidc-context";
import { useLocation, useNavigate } from "react-router-dom";

import {
  ApiError,
  type MarketplaceDetail,
  type MarketplaceListItem,
  type PresetGenre,
} from "../api/client";
import { useApi } from "../api/use-api";
import { wireToMasks } from "../editor/maskSerializer";
import { useEditorStore } from "../editor/store";

import { ALL_GENRES, GENRE_LABEL } from "../editor/genreLabel";
import MarketplaceIntro from "./MarketplaceIntro";

export default function Marketplace() {
  const api = useApi();
  const navigate = useNavigate();
  const [genre, setGenre] = useState<PresetGenre | "">("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<"new" | "popular">("new");
  const [items, setItems] = useState<MarketplaceListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  // Initial true: zwischen Mount und erstem Fetch sehen wir sonst den
  // Empty-State faelschlich.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MarketplaceDetail | null>(null);

  // Debounce-Suche, damit jede Tastatur-Eingabe nicht das Backend trifft.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const reqIdRef = useRef(0);
  useEffect(() => {
    const reqId = ++reqIdRef.current;
    // Datenfetch beim Filter-/Sort-Wechsel — set-state-in-effect ist hier
    // beabsichtigt (Loading/Error-Synchronisation). Spaeter ggf. TanStack Query.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    api
      .listMarketplacePresets({
        genre: genre || undefined,
        q: debouncedQ || undefined,
        sort,
      })
      .then((res) => {
        if (reqId !== reqIdRef.current) return;
        setItems(res.items);
        setCursor(res.nextCursor);
      })
      .catch((err: unknown) => {
        if (reqId !== reqIdRef.current) return;
        setError(err instanceof Error ? err.message : "Laden fehlgeschlagen");
      })
      .finally(() => {
        if (reqId === reqIdRef.current) setLoading(false);
      });
  }, [api, genre, debouncedQ, sort]);

  const onLoadMore = useCallback(() => {
    if (!cursor) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    api
      .listMarketplacePresets({
        genre: genre || undefined,
        q: debouncedQ || undefined,
        sort,
        cursor,
      })
      .then((res) => {
        if (reqId !== reqIdRef.current) return;
        setItems((prev) => [...prev, ...res.items]);
        setCursor(res.nextCursor);
      })
      .catch((err: unknown) => {
        if (reqId !== reqIdRef.current) return;
        setError(err instanceof Error ? err.message : "Laden fehlgeschlagen");
      })
      .finally(() => {
        if (reqId === reqIdRef.current) setLoading(false);
      });
  }, [api, cursor, genre, debouncedQ, sort]);

  const openDetail = useCallback(
    async (id: string) => {
      try {
        const detail = await api.getMarketplacePreset(id);
        setSelected(detail);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Detail-Laden fehlgeschlagen");
      }
    },
    [api],
  );

  return (
    <section data-testid="page-marketplace" className="px-8 py-8 max-w-6xl mx-auto">
      <MarketplaceIntro lang="de" />
      <h2 className="text-3xl text-stone-100">Marketplace</h2>
      <p className="mt-2 text-sm text-stone-500">
        Öffentliche Presets aus der Community — anwenden, in eigene Bibliothek
        kopieren oder melden.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="marketplace-genre-all"
          onClick={() => setGenre("")}
          aria-pressed={genre === ""}
          className={genreBtn(genre === "")}
        >
          Alle
        </button>
        {ALL_GENRES.map((g) => (
          <button
            key={g}
            type="button"
            data-testid={`marketplace-genre-${g}`}
            onClick={() => setGenre(g)}
            aria-pressed={genre === g}
            className={genreBtn(genre === g)}
          >
            {GENRE_LABEL[g]}
          </button>
        ))}
        <div className="flex-1" />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "new" | "popular")}
          data-testid="marketplace-sort"
          className="bg-stone-900 border border-stone-700 text-stone-300 text-sm px-2 py-1.5"
        >
          <option value="new">Neu</option>
          <option value="popular">Beliebt</option>
        </select>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Suche..."
          data-testid="marketplace-search"
          className="bg-stone-900 border border-stone-700 text-stone-200 text-sm px-3 py-1.5 w-48"
        />
      </div>

      {error && (
        <div
          className="mt-4 px-3 py-2 bg-red-900/40 border border-red-800 text-red-200 text-sm"
          data-testid="marketplace-error"
        >
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((item) => (
          <MarketplaceCard
            key={item.id}
            item={item}
            onClick={() => void openDetail(item.id)}
          />
        ))}
        {items.length === 0 && loading && (
          <>
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                data-testid="marketplace-skeleton"
                className="bg-stone-900/70 border border-stone-800 overflow-hidden animate-pulse"
              >
                <div className="w-full aspect-square bg-stone-800/60" />
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-stone-800 rounded w-3/4" />
                  <div className="h-2 bg-stone-800/60 rounded w-1/2" />
                </div>
              </div>
            ))}
          </>
        )}
        {items.length === 0 && !loading && (
          <div
            className="col-span-full text-stone-500 text-sm py-12 text-center"
            data-testid="marketplace-empty"
          >
            Noch keine Presets in diesem Filter.
            {(genre || q) && (
              <button
                type="button"
                onClick={() => {
                  setGenre("");
                  setQ("");
                }}
                data-testid="marketplace-empty-reset"
                className="ml-2 underline text-amber-200 hover:text-amber-100"
              >
                Alle anzeigen
              </button>
            )}
          </div>
        )}
      </div>

      {cursor && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            data-testid="marketplace-load-more"
            className="px-6 py-2 text-xs uppercase tracking-[0.2em] border border-stone-700 text-stone-300 hover:border-amber-300/40 disabled:opacity-50"
          >
            {loading ? "Lade…" : "Mehr laden"}
          </button>
        </div>
      )}

      {selected && (
        <DetailModal
          detail={selected}
          onClose={() => setSelected(null)}
          onApplied={() => {
            void navigate("/editor");
          }}
        />
      )}
    </section>
  );
}

// Modul-Ebene statt im Marketplace-Body: sonst bekommt das Modal bei jedem
// Parent-Render eine neue Komponenten-Identitaet -> React unmountet/remountet
// es und verliert busy/feedback/reportReason (M4-Review-Finding).
function DetailModal({
  detail,
  onClose,
  onApplied,
}: {
  detail: MarketplaceDetail;
  onClose: () => void;
  onApplied: () => void;
}) {
    const api = useApi();
    const auth = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [busy, setBusy] = useState<"apply" | "fork" | "report" | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [reportReason, setReportReason] = useState("");
    const applyAdjustments = useEditorStore((s) => s.applyAdjustments);
    const applyMasks = useEditorStore((s) => s.applyMasks);

    // Browsen ist oeffentlich; Aktionen brauchen ein Konto. Anonyme User
    // werden zur Anmeldung geschickt (mit Rueck-Pfad wie in RequireAuth),
    // statt einen 401 zu provozieren.
    const requireLogin = (): boolean => {
      if (auth.isAuthenticated) return false;
      void navigate("/login", { state: { from: location } });
      return true;
    };

    const onApply = async () => {
      if (requireLogin()) return;
      // Schutz vor unbeabsichtigtem Verlust: wenn der User aktuell
      // an einem Bild arbeitet, vor dem Ueberschreiben nachfragen.
      const current = useEditorStore.getState();
      const dirty =
        current.masks.length > 0 ||
        Object.entries(current.adjustments).some(([k, v]) => {
          if (k === "hsl" || k === "toneCurve") return v !== null;
          return typeof v === "number" && Math.abs(v) > 1e-4;
        });
      if (dirty) {
        const ok = window.confirm(
          "Aktuelle Bearbeitung wird durch das Marketplace-Preset überschrieben. Fortfahren?",
        );
        if (!ok) return;
      }
      setBusy("apply");
      try {
        const res = await api.applyMarketplacePreset(detail.id);
        applyAdjustments(res.adjustments);
        applyMasks(wireToMasks(res.masks));
        onApplied();
      } catch (err) {
        setFeedback(err instanceof Error ? err.message : "Anwenden fehlgeschlagen");
      } finally {
        setBusy(null);
      }
    };

    const onFork = async () => {
      if (requireLogin()) return;
      setBusy("fork");
      try {
        await api.forkMarketplacePreset(detail.id);
        setFeedback("In deine Bibliothek kopiert.");
      } catch (err) {
        setFeedback(err instanceof Error ? err.message : "Kopieren fehlgeschlagen");
      } finally {
        setBusy(null);
      }
    };

    const onReport = async () => {
      if (requireLogin()) return;
      const reason = reportReason.trim();
      if (reason.length < 1) return;
      setBusy("report");
      try {
        await api.reportMarketplacePreset(detail.id, reason);
        setFeedback("Meldung gesendet — danke.");
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setFeedback("Du hast dieses Preset bereits gemeldet.");
        } else {
          setFeedback(err instanceof Error ? err.message : "Melden fehlgeschlagen");
        }
      } finally {
        setBusy(null);
      }
    };

    return (
      <div
        className="fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-4"
        onClick={onClose}
        data-testid="marketplace-detail-modal"
      >
        <div
          className="bg-stone-950 border border-stone-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {detail.previewUrl ? (
            <img
              src={detail.previewUrl}
              alt={detail.name}
              className="w-full h-64 object-contain bg-stone-900"
            />
          ) : (
            <div className="w-full h-64 bg-stone-900" />
          )}
          <div className="p-5 space-y-3 text-stone-300">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl text-stone-100">{detail.name}</h2>
                <p className="text-sm text-stone-500">
                  {detail.creatorHandle ? `@${detail.creatorHandle}` : "Anonym"}
                  {detail.genre ? ` · ${GENRE_LABEL[detail.genre]}` : ""}
                </p>
              </div>
              <span className="text-xs text-stone-500 tabular-nums">
                {detail.applyCount} Anwendungen
              </span>
            </div>
            {detail.description && (
              <p className="text-sm whitespace-pre-wrap">{detail.description}</p>
            )}
            {detail.creatorBio && (
              <p className="text-xs text-stone-500 italic">{detail.creatorBio}</p>
            )}

            {feedback && (
              <div className="text-xs text-amber-200">{feedback}</div>
            )}

            {!auth.isAuthenticated && (
              <p
                className="text-xs text-amber-200/80"
                data-testid="marketplace-anon-hint"
              >
                Melde dich an, um dieses Preset anzuwenden, zu kopieren oder zu
                melden.
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onApply()}
                data-testid="marketplace-apply"
                className="px-4 py-2 text-xs uppercase tracking-[0.2em] bg-amber-200/15 border border-amber-300 text-amber-200 hover:bg-amber-200/25 disabled:opacity-50"
              >
                Anwenden
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onFork()}
                data-testid="marketplace-fork"
                className="px-4 py-2 text-xs uppercase tracking-[0.2em] border border-stone-700 text-stone-300 hover:border-amber-300/40 disabled:opacity-50"
              >
                In meine Bibliothek
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs uppercase tracking-[0.2em] text-stone-500 hover:text-stone-300"
              >
                Schließen
              </button>
            </div>

            <details className="pt-2 text-xs">
              <summary className="cursor-pointer text-stone-500 hover:text-stone-300">
                Melden
              </summary>
              <div className="mt-2 space-y-2">
                <textarea
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Grund — Spam, Plagiat, NSFW…"
                  className="w-full bg-stone-900 border border-stone-700 text-stone-200 p-2"
                  data-testid="marketplace-report-reason"
                />
                <button
                  type="button"
                  disabled={busy !== null || reportReason.trim().length === 0}
                  onClick={() => void onReport()}
                  data-testid="marketplace-report-submit"
                  className="px-3 py-1 uppercase tracking-[0.2em] border border-red-900 text-red-300 hover:bg-red-900/20 disabled:opacity-50"
                >
                  Senden
                </button>
              </div>
            </details>
          </div>
        </div>
      </div>
    );
  }

function genreBtn(active: boolean): string {
  return `px-3 py-1.5 text-xs uppercase tracking-[0.2em] border ${
    active
      ? "border-amber-300/60 text-amber-200 bg-amber-200/10"
      : "border-stone-800 text-stone-400 hover:border-amber-300/30"
  }`;
}

function MarketplaceCard({
  item,
  onClick,
}: {
  item: MarketplaceListItem;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`marketplace-card-${item.id}`}
      className="text-left bg-stone-900/70 border border-stone-800 hover:border-amber-300/40 transition-colors overflow-hidden"
    >
      {item.previewUrl ? (
        <img
          src={item.previewUrl}
          alt={item.name}
          className="w-full aspect-square object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full aspect-square bg-stone-900" />
      )}
      <div className="p-3 space-y-1">
        <div className="text-stone-200 truncate" title={item.name}>
          {item.name}
        </div>
        <div className="flex items-center justify-between text-[11px] text-stone-500">
          <span>{item.creatorHandle ? `@${item.creatorHandle}` : "Anonym"}</span>
          <span className="tabular-nums">{item.applyCount}×</span>
        </div>
      </div>
    </button>
  );
}
