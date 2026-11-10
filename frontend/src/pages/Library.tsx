import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useApi } from "../api/use-api";
import type { Image } from "../api/client";
import { uploadImage } from "../api/upload";
import AutoFocusButton from "../components/AutoFocusButton";
import { FILE_PICKER_ACCEPT } from "../editor/raw";
import { TITLE_SUFFIX, usePageMeta } from "../hooks/usePageMeta";
import { useFocusRequest } from "../hooks/useFocusRequest";
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
  // zweite Klick auf „Wirklich löschen?" loescht tatsaechlich. Schuetzt vor
  // Fehlklick — das Original im Cloud-Speicher ist unwiderruflich weg.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
    try {
      setImages(await api.listImages("ready"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Liste laden fehlgeschlagen");
    } finally {
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    // Daten beim Mount laden — set-state-in-effect ist hier explizit
    // beabsichtigt (Datenfetch). Spaeter ggf. via TanStack Query.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const onFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      await uploadImage(api, file, { stripExif });
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
    try {
      await api.deleteImage(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Löschen fehlgeschlagen");
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

  return (
    <section data-testid="page-library" className="p-8">
      <h1 className="text-3xl">Bibliothek</h1>
      <p className="mt-2 text-stone-400">
        Optionaler Cloud-Speicher: Bilder hier hochladen, um sie auf einem zweiten
        Gerät weiterzubearbeiten. Pixel laufen direkt vom Browser zum Storage —
        nichts geht ungefragt zum Server.
      </p>

      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="mt-6 border border-dashed border-stone-700 p-8 text-stone-500"
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
        <p data-testid="library-error" role="alert" className="mt-4 text-red-400">
          {error}
        </p>
      )}

      {images.length > 0 && (
        <div className="mt-6 flex items-center gap-4 text-sm">
          <button
            type="button"
            data-testid="batch-apply-open"
            onClick={() => { setToast(null); setBatchOpen(true); }}
            disabled={selected.size === 0}
            className="text-amber-200 hover:underline disabled:opacity-40 disabled:no-underline"
          >
            Preset anwenden ({selected.size})
          </button>
          <span role="status" className="text-stone-400">
            {toast && <span data-testid="batch-toast">{toast}</span>}
          </span>
        </div>
      )}

      <ul className="mt-6 divide-y divide-stone-800" data-testid="image-list">
        {!loaded && (
          <li data-testid="library-loading" role="status" className="py-3 text-stone-400 italic">
            Lädt …
          </li>
        )}
        {loaded && images.length === 0 && !error && (
          <li className="py-3 text-stone-400 italic">Noch keine Bilder hochgeladen.</li>
        )}
        {images.map((img) => (
          <li
            key={img.id}
            data-testid={`image-row-${img.id}`}
            className="flex items-center justify-between py-3"
          >
            <input
              type="checkbox"
              data-testid={`image-select-${img.id}`}
              checked={selected.has(img.id)}
              onChange={() => toggleSelected(img.id)}
              aria-label={`„${img.originalFilename}“ auswählen`}
              className="accent-amber-300 mr-3"
            />
            <div>
              <div className="text-stone-200">{img.originalFilename}</div>
              <div className="text-xs text-stone-400">
                {formatSize(img.sizeBytes)} · {img.contentType}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button
                type="button"
                data-testid={`image-edit-${img.id}`}
                onClick={() => void navigate(`/editor?image=${img.id}`)}
                className="text-amber-200 hover:underline"
              >
                Im Editor öffnen
              </button>
              {confirmDeleteId === img.id ? (
                <span className="flex items-center gap-2">
                  <AutoFocusButton
                    data-testid={`image-delete-confirm-${img.id}`}
                    onClick={() => void onDelete(img.id)}
                    className="text-red-400 hover:text-red-300"
                  >
                    Wirklich löschen?
                  </AutoFocusButton>
                  <button
                    type="button"
                    data-testid={`image-delete-cancel-${img.id}`}
                    onClick={() => {
                      setConfirmDeleteId(null);
                      requestFocus(`image-delete-${img.id}`);
                    }}
                    className="text-stone-400 hover:text-stone-200"
                  >
                    Abbrechen
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  data-testid={`image-delete-${img.id}`}
                  aria-label={`„${img.originalFilename}“ löschen`}
                  onClick={() => { setError(null); setConfirmDeleteId(img.id); }}
                  className="text-stone-400 hover:text-red-400"
                >
                  Löschen
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {batchOpen && (
        <BatchApplyModal
          imageIds={[...selected]}
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
