import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useApi } from "../api/use-api";
import type { Image, ImageMetaPatch } from "../api/client";
import { uploadImage } from "../api/upload";
import ShortcutCheatsheet from "../editor/ShortcutCheatsheet";
import { FILE_PICKER_ACCEPT } from "../editor/raw";
import { getSingleKeyShortcutsEnabled } from "../editor/shortcutPrefs";
import { thumbnailFromFile } from "../editor/thumbnail";
import { TITLE_SUFFIX, usePageMeta } from "../hooks/usePageMeta";
import { useFocusRequest } from "../hooks/useFocusRequest";
import CompareView from "../library/CompareView";
import FilterBar, {
  DEFAULT_FILTER,
  isFilterActive,
  toListQuery,
  type LibraryFilter,
} from "../library/FilterBar";
import ImageActions from "../library/ImageActions";
import ImageThumb from "../library/ImageThumb";
import LibraryGrid from "../library/LibraryGrid";
import { filterFromParams, filterToParams } from "../library/filterUrl";
import Loupe from "../library/Loupe";
import { ColorLabelPicker, FlagButtons, StarRating } from "../library/MetaControls";
import { isShortcutBlocked, libraryKeyAction } from "../library/libraryKeys";
import { announcePatch, metaOf, type ImageMeta } from "../library/meta";
import { getLibraryView, setLibraryView, type LibraryView } from "../library/viewPrefs";
import BatchApplyModal from "./BatchApplyModal";

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`;
}

function withMeta(image: Image, meta: Partial<ImageMeta>): Image {
  return { ...image, ...meta };
}

export default function Library() {
  usePageMeta(`Bibliothek${TITLE_SUFFIX}`);
  const api = useApi();
  const navigate = useNavigate();
  const requestFocus = useFocusRequest();
  const [images, setImages] = useState<Image[]>([]);
  // Erst nach dem ersten Laden zwischen "leer" und "laedt" unterscheiden.
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [stripExif, setStripExif] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Zweistufiges Loeschen: erst Klick auf „Löschen" merkt sich die ID, der
  // zweite Klick auf das bestaetigende „Löschen" loescht tatsaechlich. Schuetzt vor
  // Fehlklick — das Original im Cloud-Speicher ist unwiderruflich weg.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Nur Ladefehler bieten „Erneut versuchen" an (Upload/Delete nicht).
  const [loadFailed, setLoadFailed] = useState(false);
  // H2b/H2d: Filter/Sortierung (serverseitig) leben in der URL, damit
  // Neuladen und Zurueck aus dem Editor sie behalten; Ansicht (gemerkt) nicht.
  const [searchParams, setSearchParams] = useSearchParams();
  const paramsKey = searchParams.toString();
  const filter = useMemo(() => filterFromParams(new URLSearchParams(paramsKey)), [paramsKey]);
  // replace: Filterklicks fuellen den Verlauf nicht; die URL des Eintrags
  // traegt den Stand trotzdem (Zurueck aus dem Editor landet darauf).
  const setFilter = (next: LibraryFilter) =>
    setSearchParams((prev) => filterToParams(next, prev), { replace: true });
  const [view, setView] = useState<LibraryView>(() => getLibraryView());
  // aria-live-Ansage; `n` erzwingt eine neue Ansage bei gleichem Text.
  const [announcement, setAnnouncement] = useState<{ text: string; n: number }>({
    text: "",
    n: 0,
  });
  // H2c: Lupe (Start-Bild), Vergleich und Tastenkuerzel-Hilfe.
  const [loupeId, setLoupeId] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Nur die juengste Liste gewinnt (schnelles Umschalten der Filter).
  const loadSeq = useRef(0);
  // Optimistische Updates: letzter vom Server bestaetigter Stand pro Bild
  // (Ziel eines Rollbacks) und die juengste laufende Aenderung pro Bild —
  // aeltere Antworten/Fehler duerfen eine neuere Aenderung nicht ueberschreiben.
  const confirmedMeta = useRef(new Map<string, ImageMeta>());
  const latestChange = useRef(new Map<string, number>());
  const changeSeq = useRef(0);

  const announce = (text: string) => setAnnouncement((a) => ({ text, n: a.n + 1 }));

  const toggleSelected = (id: string) => {
    setToast(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const refresh = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const list = await api.listImages("ready", toListQuery(filter));
      if (seq !== loadSeq.current) return;
      for (const img of list) confirmedMeta.current.set(img.id, metaOf(img));
      setImages(list);
      // Auswahl bleibt eine Teilmenge des Sichtbaren: Batch-Aktionen sollen
      // keine weggefilterten Bilder treffen.
      const visible = new Set(list.map((i) => i.id));
      setSelected((prev) => {
        const next = new Set([...prev].filter((id) => visible.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
      setLoadFailed(false);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(err instanceof Error ? err.message : "Liste laden fehlgeschlagen");
      setLoadFailed(true);
    } finally {
      if (seq === loadSeq.current) setLoaded(true);
    }
  }, [api, filter]);

  useEffect(() => {
    // Daten beim Mount und bei Filterwechsel laden — set-state-in-effect
    // ist hier explizit beabsichtigt (Datenfetch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const changeView = (next: LibraryView) => {
    setLibraryView(next);
    setView(next);
  };

  /** H2b: Bewertung/Label/Markierung optimistisch setzen; bei Fehler auf
   *  den letzten bestaetigten Stand zurueck. Bilder, die nach der Aenderung
   *  nicht mehr zum Filter passen, bleiben bis zum naechsten Laden sichtbar
   *  (kein Wegspringen unter dem Cursor). */
  const changeMeta = async (ids: readonly string[], patch: ImageMetaPatch) => {
    if (ids.length === 0) return;
    const seq = ++changeSeq.current;
    const idSet = new Set(ids);
    for (const id of ids) latestChange.current.set(id, seq);
    const isLatest = (id: string) => latestChange.current.get(id) === seq;
    setError(null);
    setImages((prev) => prev.map((img) => (idSet.has(img.id) ? withMeta(img, patch) : img)));
    announce(announcePatch(patch, ids.length));
    try {
      const [first] = ids;
      const updated =
        ids.length === 1 && first !== undefined
          ? [await api.updateImage(first, patch)]
          : await api.updateImages(ids, patch);
      const byId = new Map(updated.map((u) => [u.id, metaOf(u)]));
      for (const [id, meta] of byId) confirmedMeta.current.set(id, meta);
      setImages((prev) =>
        prev.map((img) => {
          const meta = byId.get(img.id);
          return meta && isLatest(img.id) ? withMeta(img, meta) : img;
        }),
      );
    } catch (err) {
      setImages((prev) =>
        prev.map((img) => {
          const old = confirmedMeta.current.get(img.id);
          return idSet.has(img.id) && old && isLatest(img.id) ? withMeta(img, old) : img;
        }),
      );
      const reason = err instanceof Error ? err.message : "Unbekannter Fehler";
      setError(`Änderung nicht gespeichert: ${reason}`);
      announce("Änderung nicht gespeichert");
    }
  };

  const onFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadImage(api, file, { stripExif });
      // H2a: Vorschaubild best effort — ein Fehler hier laesst den Upload
      // gelingen, die Zeile zeigt dann den Platzhalter.
      try {
        const thumb = await thumbnailFromFile(file);
        if (thumb) await api.putImageThumbnail(uploaded.id, thumb);
      } catch {
        // Platzhalter bis zum ersten Oeffnen im Editor.
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (id: string) => {
    setError(null);
    setConfirmDeleteId(null);
    // Fokus-Ziel nach dem Entfernen: naechstes Bild, sonst vorheriges,
    // sonst die Ueberschrift — sonst landet der Fokus im Body.
    const idx = images.findIndex((i) => i.id === id);
    const neighbor = images[idx + 1] ?? images[idx - 1];
    try {
      await api.deleteImage(id);
      requestFocus(neighbor ? `image-delete-${neighbor.id}` : "library-heading");
      await refresh();
    } catch (err) {
      requestFocus(`image-delete-${id}`);
      setError(err instanceof Error ? err.message : "Löschen fehlgeschlagen");
    }
  };

  const askDelete = (id: string) => {
    setError(null);
    setConfirmDeleteId(id);
  };
  const cancelDelete = (id: string) => {
    setConfirmDeleteId(null);
    requestFocus(`image-delete-${id}`);
  };
  const openInEditor = (id: string) => void navigate(`/editor?image=${id}`);

  /** H2c: Lupe schliessen — Fokus auf die Kachel (Raster) bzw. den
   *  Lupen-Button (Liste) des zuletzt gezeigten Bildes. */
  const closeLoupe = (currentId: string) => {
    setLoupeId(null);
    requestFocus(view === "grid" ? `image-tile-${currentId}` : `image-loupe-${currentId}`);
  };

  // Vergleich: genau zwei ausgewaehlte Bilder in Anzeige-Reihenfolge.
  const comparePair = images.filter((i) => selected.has(i.id));
  const pair: readonly [Image, Image] | null =
    comparePair.length === 2 && comparePair[0] && comparePair[1]
      ? [comparePair[0], comparePair[1]]
      : null;

  /** H2c: Einzeltasten auf einer Raster-Kachel. true = verarbeitet. */
  const onTileKey = (image: Image, event: KeyboardEvent<HTMLElement>): boolean => {
    if (!getSingleKeyShortcutsEnabled()) return false;
    if (isShortcutBlocked(event.target, document)) return false;
    const action = libraryKeyAction(event);
    switch (action?.kind) {
      case "meta":
        void changeMeta([image.id], action.patch);
        return true;
      case "loupe":
        setLoupeId(image.id);
        return true;
      case "editor":
        openInEditor(image.id);
        return true;
      case "compare":
        if (pair) setCompareOpen(true);
        else announce("Zum Vergleichen genau zwei Bilder auswählen");
        return true;
      case "help":
        setHelpOpen(true);
        return true;
      default:
        return false;
    }
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void onFile(file);
  };

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void onFile(file);
    event.target.value = "";
  };

  const overlayOpen = loupeId !== null || (compareOpen && pair !== null);
  const liveRegion = (
    <div
      data-testid="library-announce"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      <span key={announcement.n}>{announcement.text}</span>
    </div>
  );

  const filtered = isFilterActive(filter);
  const showFilterBar = loaded && (images.length > 0 || filtered);
  const selectedIds = [...selected];

  return (
    <section data-testid="page-library" className="px-4 py-8 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 data-testid="library-heading" tabIndex={-1} className="text-3xl outline-none">
          Bibliothek
        </h1>
        {/* H2c: Tastenkuerzel-Hilfe (auch per „?" auf einer Kachel). */}
        <button
          type="button"
          data-testid="library-shortcuts-open"
          onClick={() => setHelpOpen(true)}
          className="flex items-center gap-2 text-xs text-stone-400 hover:text-amber-200"
        >
          <kbd
            aria-hidden="true"
            className="border border-stone-700 bg-stone-950 px-1.5 font-mono text-stone-300"
          >
            ?
          </kbd>
          Tastenkürzel
        </button>
      </div>
      <p className="mt-2 max-w-prose text-stone-400">
        Optionaler Cloud-Speicher: Bilder hier hochladen, um sie auf einem zweiten
        Gerät weiterzubearbeiten. Originale laufen direkt vom Browser zum
        Storage; nur kleine Vorschaubilder gehen zum Neu-Kodieren (ohne
        Metadaten) über den Server.
      </p>

      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="mt-6 border border-dashed border-stone-700 p-6 text-stone-500 sm:p-8"
        data-testid="upload-dropzone"
      >
        <p>Bild hierhin ziehen oder</p>
        {/* sr-only statt hidden: Input bleibt per Tab erreichbar, der
            Fokus-Ring wird ueber focus-within am Label sichtbar. */}
        <label className="mt-2 inline-block cursor-pointer text-amber-200 hover:underline focus-within:outline focus-within:outline-2 focus-within:outline-amber-300">
          Datei wählen
          <input
            type="file"
            accept={FILE_PICKER_ACCEPT}
            className="sr-only"
            onChange={onPick}
            data-testid="upload-input"
          />
        </label>
        <label className="mt-3 flex items-center gap-2 text-xs text-stone-400">
          <input
            type="checkbox"
            data-testid="upload-strip-exif"
            checked={stripExif}
            onChange={(e) => setStripExif(e.target.checked)}
            className="accent-amber-300"
          />
          EXIF/GPS aus JPEG entfernen (RAW behält Metadaten)
        </label>
        {uploading && (
          <p data-testid="upload-pending" role="status" className="mt-2 text-amber-200/80">
            Wird hochgeladen …
          </p>
        )}
      </div>

      {error && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p data-testid="library-error" role="alert" className="text-red-400">
            {error}
          </p>
          {loadFailed && (
            <button
              type="button"
              data-testid="library-retry"
              onClick={() => void refresh()}
              className="text-xs uppercase tracking-[0.2em] border border-stone-700 px-3 py-1 text-stone-200 hover:border-amber-300/40 hover:text-amber-200"
            >
              Erneut versuchen
            </button>
          )}
        </div>
      )}

      {/* H2b: Ansage fuer Bewertungs-/Label-/Markierungs-Aenderungen.
          Waehrend Lupe/Vergleich offen sind, lebt sie im Dialog (aria-modal
          blendet den Rest der Seite fuer Screenreader aus). */}
      {!overlayOpen && liveRegion}

      {showFilterBar && (
        <FilterBar filter={filter} onChange={setFilter} view={view} onViewChange={changeView} />
      )}

      {images.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <button
            type="button"
            data-testid="batch-apply-open"
            onClick={() => { setToast(null); setBatchOpen(true); }}
            disabled={selected.size === 0}
            className="text-amber-200 hover:underline disabled:opacity-40 disabled:no-underline"
          >
            Preset anwenden ({selected.size})
          </button>
          <button
            type="button"
            data-testid="compare-open"
            onClick={() => setCompareOpen(true)}
            disabled={pair === null}
            title={pair ? "Die zwei ausgewählten Bilder vergleichen (C)" : "Genau zwei Bilder auswählen"}
            className="text-amber-200 hover:underline disabled:opacity-40 disabled:no-underline"
          >
            Vergleichen
          </button>
          {selected.size > 0 && (
            <div
              role="group"
              aria-label={`Auswahl (${selected.size}) bewerten`}
              data-testid="batch-meta"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-l border-stone-700 pl-4"
            >
              <span className="text-xs text-stone-400">Auswahl:</span>
              <StarRating
                value={null}
                testId="batch"
                showClear
                onChange={(p) => void changeMeta(selectedIds, p)}
              />
              <FlagButtons
                value={null}
                testId="batch"
                showNone
                onChange={(p) => void changeMeta(selectedIds, p)}
              />
              <ColorLabelPicker
                value={undefined}
                testId="batch"
                menuBelow
                triggerLabel="Farblabel für Auswahl"
                onChange={(p) => void changeMeta(selectedIds, p)}
              />
              <button
                type="button"
                data-testid="batch-clear-selection"
                onClick={() => setSelected(new Set())}
                className="text-xs text-stone-400 hover:text-stone-200"
              >
                Auswahl aufheben
              </button>
            </div>
          )}
          <span role="status" className="text-stone-400">
            {toast && <span data-testid="batch-toast">{toast}</span>}
          </span>
        </div>
      )}

      {!loaded && (
        <p data-testid="library-loading" role="status" className="mt-6 py-3 text-stone-400 italic">
          Lädt …
        </p>
      )}
      {loaded && images.length === 0 && !error && (
        filtered ? (
          <div data-testid="library-filter-empty" className="mt-6 py-6 text-stone-400">
            <p>Keine Bilder passen zu diesem Filter.</p>
            <button
              type="button"
              data-testid="library-filter-empty-reset"
              onClick={() => setFilter({ ...DEFAULT_FILTER, sort: filter.sort })}
              className="mt-2 text-amber-200 hover:underline"
            >
              Filter zurücksetzen
            </button>
          </div>
        ) : (
          <p className="mt-6 py-3 text-stone-400 italic">Noch keine Bilder hochgeladen.</p>
        )
      )}

      {view === "grid" ? (
        images.length > 0 && (
          <LibraryGrid
            images={images}
            selected={selected}
            confirmDeleteId={confirmDeleteId}
            onToggleSelect={toggleSelected}
            onMetaChange={(id, p) => void changeMeta([id], p)}
            onOpen={openInEditor}
            onLoupe={setLoupeId}
            onTileKey={onTileKey}
            onAskDelete={askDelete}
            onConfirmDelete={(id) => void onDelete(id)}
            onCancelDelete={cancelDelete}
          />
        )
      ) : (
        <ul className="mt-6 divide-y divide-stone-800" data-testid="image-list">
          {images.map((img) => {
            const meta = metaOf(img);
            const tid = `row-${img.id}`;
            return (
              <li
                key={img.id}
                data-testid={`image-row-${img.id}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    data-testid={`image-select-${img.id}`}
                    checked={selected.has(img.id)}
                    onChange={() => toggleSelected(img.id)}
                    aria-label={`„${img.originalFilename}“ auswählen`}
                    className="accent-amber-300"
                  />
                  <ImageThumb
                    key={img.thumbUrl ?? "none"}
                    id={img.id}
                    url={img.thumbUrl ?? null}
                    contentType={img.contentType}
                    dimmed={meta.flag === "reject"}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-stone-200">{img.originalFilename}</div>
                    <div className="text-xs text-stone-400">
                      {formatSize(img.sizeBytes)} · {img.contentType}
                    </div>
                  </div>
                </div>
                <div className="flex items-center">
                  <StarRating
                    value={meta.rating}
                    testId={tid}
                    onChange={(p) => void changeMeta([img.id], p)}
                  />
                  <FlagButtons
                    value={meta.flag}
                    testId={tid}
                    onChange={(p) => void changeMeta([img.id], p)}
                  />
                  <ColorLabelPicker
                    value={meta.colorLabel}
                    testId={tid}
                    onChange={(p) => void changeMeta([img.id], p)}
                  />
                </div>
                <ImageActions
                  image={img}
                  confirming={confirmDeleteId === img.id}
                  onOpen={() => openInEditor(img.id)}
                  onLoupe={() => setLoupeId(img.id)}
                  onAskDelete={() => askDelete(img.id)}
                  onConfirmDelete={() => void onDelete(img.id)}
                  onCancelDelete={() => cancelDelete(img.id)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {loupeId !== null && (
        <Loupe
          images={images}
          startId={loupeId}
          onClose={closeLoupe}
          onMetaChange={(id, p) => void changeMeta([id], p)}
          onOpenEditor={openInEditor}
          announce={announce}
          liveRegion={liveRegion}
        />
      )}
      {compareOpen && pair && (
        <CompareView
          images={pair}
          onClose={() => setCompareOpen(false)}
          onMetaChange={(id, p) => void changeMeta([id], p)}
          onOpenEditor={openInEditor}
          liveRegion={liveRegion}
        />
      )}
      <ShortcutCheatsheet open={helpOpen} onClose={() => setHelpOpen(false)} context="library" />
      {batchOpen && (
        <BatchApplyModal
          imageIds={selectedIds}
          onClose={() => setBatchOpen(false)}
          onApplied={(applied, total) => {
            setToast(`${applied} von ${total} angewendet`);
            setSelected(new Set());
          }}
        />
      )}
    </section>
  );
}
