import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  type Image,
  type Preset,
  type PresetGenre,
} from "../api/client";
import { useApi } from "../api/use-api";
import { masksToWire, wireToMasks } from "./maskSerializer";
import { useEditorStore } from "./store";

const GENRE_OPTIONS: ReadonlyArray<{ value: PresetGenre; label: string }> = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landschaft" },
  { value: "city", label: "Stadt" },
  { value: "nature", label: "Natur" },
  { value: "animals", label: "Tiere" },
  { value: "sports", label: "Sport" },
  { value: "blackandwhite", label: "Schwarzweiß" },
  { value: "other", label: "Sonstiges" },
];

interface PublishState {
  enabled: boolean;
  genre: PresetGenre | "";
  description: string;
  previewImageId: string;
}

function emptyPublishState(): PublishState {
  return { enabled: false, genre: "", description: "", previewImageId: "" };
}

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly loadedPresetId: string | null;
  readonly onLoadedPresetIdChange: (id: string | null) => void;
}

export default function PresetDialog({
  open,
  onClose,
  loadedPresetId,
  onLoadedPresetIdChange,
}: Props) {
  const api = useApi();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [publish, setPublish] = useState<PublishState>(emptyPublishState());
  const [images, setImages] = useState<Image[]>([]);
  // Pre-Signed-Download-URLs pro Bild — N+1 calls, akzeptabel fuer
  // <50 Bilder pro User. Empty-Map bis lazy-loaded.
  const [imageThumbs, setImageThumbs] = useState<Record<string, string>>({});

  const adjustments = useEditorStore((s) => s.adjustments);
  const masks = useEditorStore((s) => s.masks);
  const applyAdjustments = useEditorStore((s) => s.applyAdjustments);
  const applyMasks = useEditorStore((s) => s.applyMasks);

  // Mount-Guard: verhindert setState nach Unmount oder Close, wenn ein
  // langlaufender Network-Request noch antwortet.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listPresets();
      if (!mountedRef.current) return;
      setPresets(list);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Liste laden fehlgeschlagen");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!open) return;
    // refresh() ist async, set-state passiert erst nach await innerhalb
    // — der Mount-Guard fängt setState-after-unmount sauber ab.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [open, refresh]);

  // Bilder lazy laden — erst wenn der User Veroeffentlichen aktiviert,
  // damit der Listing-Endpoint nicht jedes Mal beim Open getroffen wird.
  // Anschliessend pro Bild eine Preview-URL holen (5-min TTL).
  useEffect(() => {
    if (!publish.enabled) return;
    if (images.length > 0) return;
    let cancelled = false;
    void api
      .listImages("ready")
      .then(async (list) => {
        if (cancelled || !mountedRef.current) return;
        setImages(list);
        const thumbs: Record<string, string> = {};
        await Promise.all(
          list.map(async (img) => {
            try {
              const u = await api.getImageUrl(img.id);
              thumbs[img.id] = u.url;
            } catch {
              /* Skip — Bild ohne Thumb wird im Grid als grauer Block gerendert. */
            }
          }),
        );
        if (!cancelled && mountedRef.current) setImageThumbs(thumbs);
      })
      .catch(() => {
        /* Liste leer lassen — Picker zeigt dann „keine Bilder". */
      });
    return () => {
      cancelled = true;
    };
  }, [api, publish.enabled, images.length]);

  const onLoad = (p: Preset) => {
    setError(null);
    applyAdjustments(p.adjustments);
    applyMasks(wireToMasks(p.masks));
    onLoadedPresetIdChange(p.id);
    onClose();
  };

  const onDelete = async (id: string) => {
    setError(null);
    setBusy(true);
    try {
      await api.deletePreset(id);
      if (!mountedRef.current) return;
      if (loadedPresetId === id) onLoadedPresetIdChange(null);
      await refresh();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Löschen fehlgeschlagen");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const validatePublish = (): string | null => {
    if (!publish.enabled) return null;
    if (publish.genre === "") return "Genre auswaehlen.";
    if (publish.description.trim().length < 10) return "Beschreibung mind. 10 Zeichen.";
    if (publish.description.length > 500) return "Beschreibung max. 500 Zeichen.";
    if (publish.previewImageId === "") return "Vorschaubild auswaehlen.";
    return null;
  };

  const onSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name darf nicht leer sein.");
      return;
    }
    const publishError = validatePublish();
    if (publishError) {
      setError(publishError);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const created = await api.createPreset({
        name: trimmed,
        adjustments,
        masks: masksToWire(masks),
        ...(publish.enabled
          ? {
              visibility: "public" as const,
              genre: publish.genre as PresetGenre,
              description: publish.description.trim(),
              previewImageId: publish.previewImageId,
            }
          : {}),
      });
      if (!mountedRef.current) return;
      onLoadedPresetIdChange(created.id);
      setName("");
      setPublish(emptyPublishState());
      await refresh();
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiError && err.status === 409) {
        setError("Ein Preset mit diesem Namen existiert bereits.");
      } else {
        setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const onUpdate = async () => {
    if (loadedPresetId === null) return;
    const current = presets.find((p) => p.id === loadedPresetId);
    if (!current) return;
    setError(null);
    setBusy(true);
    try {
      await api.updatePreset(loadedPresetId, {
        name: current.name,
        adjustments,
        masks: masksToWire(masks),
      });
      if (!mountedRef.current) return;
      await refresh();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Aktualisieren fehlgeschlagen");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  if (!open) return null;

  const loadedPreset =
    loadedPresetId !== null
      ? presets.find((p) => p.id === loadedPresetId) ?? null
      : null;

  return (
    <div
      data-testid="preset-dialog"
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[420px] max-h-[80vh] flex flex-col bg-stone-900 border border-stone-700 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between">
          <h2 className="text-stone-200">Presets</h2>
          <button
            type="button"
            data-testid="preset-close"
            onClick={onClose}
            className="text-stone-500 hover:text-stone-200"
            aria-label="Schliessen"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && (
            <p data-testid="preset-loading" className="text-stone-500 italic">
              Lade …
            </p>
          )}
          {!loading && presets.length === 0 && (
            <p className="text-stone-500 italic">Keine Presets gespeichert.</p>
          )}
          <ul data-testid="preset-list" className="divide-y divide-stone-800">
            {presets.map((p) => {
              const isLoaded = p.id === loadedPresetId;
              return (
                <li
                  key={p.id}
                  data-testid={`preset-item-${p.id}`}
                  data-loaded={isLoaded ? "true" : "false"}
                  className={`flex items-center justify-between py-2 ${
                    isLoaded ? "text-amber-200" : "text-stone-300"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate">{p.name}</div>
                    {p.masks.length > 0 && (
                      <div className="text-[10px] uppercase tracking-wider text-stone-500">
                        {p.masks.length} {p.masks.length === 1 ? "Maske" : "Masken"}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      data-testid={`preset-load-${p.id}`}
                      onClick={() => onLoad(p)}
                      disabled={busy}
                      className="text-amber-200 hover:text-amber-100 disabled:opacity-40"
                    >
                      Laden
                    </button>
                    <button
                      type="button"
                      data-testid={`preset-delete-${p.id}`}
                      onClick={() => void onDelete(p.id)}
                      disabled={busy}
                      className="text-stone-500 hover:text-red-400 disabled:opacity-40"
                    >
                      Löschen
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="px-4 py-3 border-t border-stone-800 space-y-3">
          {error && (
            <p data-testid="preset-error" className="text-red-400 text-xs">
              {error}
            </p>
          )}

          {loadedPreset && (
            <button
              type="button"
              data-testid="preset-update"
              onClick={() => void onUpdate()}
              disabled={busy}
              className="w-full py-1.5 text-[10px] uppercase tracking-[0.2em] text-amber-200 border border-amber-300/40 hover:border-amber-300 disabled:opacity-40"
            >
              {`„${loadedPreset.name}“ überschreiben`}
            </button>
          )}

          <label className="flex items-center gap-2 text-xs text-stone-300 cursor-pointer">
            <input
              type="checkbox"
              data-testid="preset-publish-toggle"
              checked={publish.enabled}
              onChange={(e) =>
                setPublish((s) => ({ ...s, enabled: e.target.checked }))
              }
            />
            Im Marketplace veröffentlichen
          </label>

          {publish.enabled && (
            <div className="space-y-2 border border-stone-800 px-3 py-2 bg-stone-950/50">
              <p className="text-[10px] text-stone-500">
                Vorschaubild, Beschreibung, Genre und dein Handle (sofern
                gesetzt) werden fuer alle eingeloggten Lumen-Nutzer
                sichtbar. Email bleibt privat.
              </p>
              <select
                value={publish.genre}
                onChange={(e) =>
                  setPublish((s) => ({
                    ...s,
                    genre: e.target.value as PresetGenre | "",
                  }))
                }
                data-testid="preset-publish-genre"
                className="w-full bg-stone-950 border border-stone-700 px-2 py-1 text-stone-200 text-sm"
              >
                <option value="">Genre wählen…</option>
                {GENRE_OPTIONS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
              <div>
                <textarea
                  value={publish.description}
                  onChange={(e) =>
                    setPublish((s) => ({ ...s, description: e.target.value }))
                  }
                  placeholder="Beschreibung (10–500 Zeichen)"
                  rows={3}
                  maxLength={500}
                  data-testid="preset-publish-description"
                  className="w-full bg-stone-950 border border-stone-700 px-2 py-1 text-stone-200 text-sm"
                />
                <div
                  className={`text-[10px] mt-0.5 text-right tabular-nums ${
                    publish.description.length < 10
                      ? "text-stone-500"
                      : "text-stone-400"
                  }`}
                  data-testid="preset-publish-description-counter"
                >
                  {publish.description.length} / 500
                  {publish.description.length < 10 && " (min 10)"}
                </div>
              </div>
              <div data-testid="preset-publish-preview">
                {images.length === 0 ? (
                  <p className="text-[11px] text-stone-500">
                    Erst ein Bild in der Bibliothek hochladen.
                  </p>
                ) : (
                  <>
                    <p className="text-[10px] text-stone-500 mb-1">
                      Vorschaubild wählen ({images.length} verfügbar)
                    </p>
                    <div className="grid grid-cols-4 gap-1.5 max-h-32 overflow-y-auto">
                      {images.map((img) => {
                        const isSelected = publish.previewImageId === img.id;
                        const thumb = imageThumbs[img.id];
                        return (
                          <button
                            key={img.id}
                            type="button"
                            onClick={() =>
                              setPublish((s) => ({
                                ...s,
                                previewImageId: img.id,
                              }))
                            }
                            data-testid={`preset-publish-preview-${img.id}`}
                            title={img.originalFilename}
                            className={`aspect-square overflow-hidden border-2 ${
                              isSelected
                                ? "border-amber-300"
                                : "border-stone-800 hover:border-amber-300/40"
                            }`}
                          >
                            {thumb ? (
                              <img
                                src={thumb}
                                alt={img.originalFilename}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-full h-full bg-stone-900" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              data-testid="preset-save-name"
              placeholder="Name für neues Preset"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onSave();
              }}
              className="flex-1 bg-stone-950 border border-stone-700 px-2 py-1 text-stone-200 text-sm"
            />
            <button
              type="button"
              data-testid="preset-save-confirm"
              onClick={() => void onSave()}
              disabled={busy || !name.trim()}
              className="px-3 py-1 text-[10px] uppercase tracking-[0.2em] bg-amber-200/20 border border-amber-300 text-amber-200 hover:bg-amber-200/30 disabled:opacity-40"
            >
              Speichern
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
