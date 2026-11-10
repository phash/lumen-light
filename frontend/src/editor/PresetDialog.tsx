import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  type Image,
  type ImageEditState,
  type Preset,
  type PresetGenre,
  type PresetGeometryWire,
} from "../api/client";
import { useApi } from "../api/use-api";
import AutoFocusButton from "../components/AutoFocusButton";
import Modal from "../components/Modal";
import { useFocusRequest } from "../hooks/useFocusRequest";
import StepCheckboxes from "./StepCheckboxes";
import { masksToWire } from "./maskSerializer";
import { defaultEnabledGroups } from "./profileGroups";
import { parseProfileYaml, serializeProfileYaml } from "./profileYaml";
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

interface ApplyStepPanelProps {
  readonly preset: Preset;
  readonly enabledGroups: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/**
 * Verschachtelter Schritt-Dialog "Preset anwenden". Eigene Dialog-Rolle,
 * Fokus beim Mount, Escape schliesst nur dieses Panel — der Listener
 * haengt in der Capture-Phase am window und laeuft damit VOR dem
 * document-Listener des umgebenden Modals.
 */
function ApplyStepPanel({
  preset,
  enabledGroups,
  onToggle,
  onCancel,
  onConfirm,
}: ApplyStepPanelProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const card = cardRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = card?.querySelector<HTMLElement>("input, button");
    (first ?? card)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previouslyFocused?.focus();
    };
  }, [onCancel]);

  return (
    <div
      data-testid="apply-step-panel"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-step-title"
        tabIndex={-1}
        className="w-full max-w-[320px] bg-stone-900 border border-stone-700 p-4 space-y-3 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="apply-step-title" className="text-stone-200 text-sm">
          {`„${preset.name}“ anwenden`}
        </h3>
        <StepCheckboxes enabled={enabledGroups} onToggle={onToggle} />
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            data-testid="apply-cancel"
            onClick={onCancel}
            className="text-xs text-stone-400 hover:text-stone-200"
          >
            Abbrechen
          </button>
          <button
            type="button"
            data-testid="apply-confirm"
            onClick={onConfirm}
            disabled={enabledGroups.size === 0}
            className="px-3 py-1 text-[10px] uppercase tracking-[0.2em] bg-amber-200/20 border border-amber-300 text-amber-200 hover:bg-amber-200/30 disabled:opacity-40"
          >
            Anwenden
          </button>
        </div>
      </div>
    </div>
  );
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
  const requestFocus = useFocusRequest();
  const [presets, setPresets] = useState<Preset[]>([]);
  // Zweistufiges Loeschen (Fehlklick-Schutz), analog zur Bibliothek.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
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
  const applyProfileGroups = useEditorStore((s) => s.applyProfileGroups);
  const cropRect = useEditorStore((s) => s.cropRect);
  const straightenAngle = useEditorStore((s) => s.straightenAngle);
  const lensCorrection = useEditorStore((s) => s.lensCorrection);
  const lensProfileId = useEditorStore((s) => s.lensProfileId);
  const manualLensOverride = useEditorStore((s) => s.manualLensOverride);

  // Anwenden-Flow: ausgewaehltes Preset + angehakte Schritt-Gruppen.
  const [applyTarget, setApplyTarget] = useState<Preset | null>(null);
  const [enabledGroups, setEnabledGroups] = useState<Set<string>>(() =>
    defaultEnabledGroups(),
  );

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

  // Aktuelle Editor-Geometrie als Wire-Objekt (zum Speichern in ein Preset).
  const currentGeometry = (): PresetGeometryWire => ({
    crop: cropRect,
    straightenAngle,
    lensCorrection,
    lensProfileId,
    manualLensOverride,
  });

  const onPickApply = (p: Preset) => {
    setError(null);
    setEnabledGroups(defaultEnabledGroups());
    setApplyTarget(p);
  };

  const toggleGroup = (key: string) => {
    setEnabledGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onApplyConfirm = () => {
    if (!applyTarget) return;
    const profile: ImageEditState = {
      adjustments: applyTarget.adjustments,
      masks: applyTarget.masks,
      crop: applyTarget.geometry?.crop ?? null,
      straightenAngle: applyTarget.geometry?.straightenAngle ?? 0,
      lensCorrection: applyTarget.geometry?.lensCorrection ?? null,
      lensProfileId: applyTarget.geometry?.lensProfileId ?? null,
      manualLensOverride: applyTarget.geometry?.manualLensOverride ?? false,
    };
    applyProfileGroups(profile, enabledGroups);
    onLoadedPresetIdChange(applyTarget.id);
    setApplyTarget(null);
    onClose();
  };

  const onExportYaml = (p: Preset) => {
    const text = serializeProfileYaml({
      name: p.name,
      adjustments: p.adjustments,
      masks: p.masks,
      geometry: p.geometry,
    });
    const blob = new Blob([text], { type: "application/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.name.replace(/[^\w.-]+/g, "_")}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportYaml = async (file: File) => {
    setError(null);
    // Datei-Groesse vor dem Lesen begrenzen: ein Profil ist wenige KB; eine
    // riesige YAML wuerde nur den Tab beim Parsen einfrieren.
    if (file.size > 256 * 1024) {
      setError("Datei zu groß (max. 256 KB für ein Profil).");
      return;
    }
    setBusy(true);
    try {
      const parsed = parseProfileYaml(await file.text());
      const created = await api.createPreset({
        name: parsed.name,
        adjustments: parsed.adjustments,
        masks: parsed.masks,
        geometry: parsed.geometry ?? null,
      });
      if (!mountedRef.current) return;
      onLoadedPresetIdChange(created.id);
      await refresh();
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiError && err.status === 409) {
        setError("Ein Preset mit diesem Namen existiert bereits.");
      } else {
        setError(err instanceof Error ? err.message : "Import fehlgeschlagen");
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    setError(null);
    setConfirmDeleteId(null);
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
    if (publish.genre === "") return "Genre auswählen.";
    if (publish.description.trim().length < 10) return "Beschreibung mind. 10 Zeichen.";
    if (publish.description.length > 500) return "Beschreibung max. 500 Zeichen.";
    if (publish.previewImageId === "") return "Vorschaubild auswählen.";
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
        geometry: currentGeometry(),
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
        geometry: currentGeometry(),
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

  const closeApplyPanel = useCallback(() => setApplyTarget(null), []);

  if (!open) return null;

  const loadedPreset =
    loadedPresetId !== null
      ? presets.find((p) => p.id === loadedPresetId) ?? null
      : null;

  return (
    <Modal
      onClose={onClose}
      testId="preset-dialog"
      labelledBy="preset-dialog-title"
      backdropClassName="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
      cardClassName="relative w-full max-w-[420px] max-h-[80vh] flex flex-col bg-stone-900 border border-stone-700 text-sm"
    >
        <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between">
          <h2 id="preset-dialog-title" className="text-stone-200">Presets</h2>
          <button
            type="button"
            data-testid="preset-close"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-200"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && (
            <p data-testid="preset-loading" role="status" className="text-stone-400 italic">
              Lädt …
            </p>
          )}
          {!loading && presets.length === 0 && (
            <p className="text-stone-400 italic">Keine Presets gespeichert.</p>
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
                      <div className="text-[10px] uppercase tracking-wider text-stone-400">
                        {p.masks.length} {p.masks.length === 1 ? "Maske" : "Masken"}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      data-testid={`preset-apply-${p.id}`}
                      onClick={() => onPickApply(p)}
                      disabled={busy}
                      className="text-amber-200 hover:text-amber-100 disabled:opacity-40"
                    >
                      Anwenden
                    </button>
                    <button
                      type="button"
                      data-testid={`preset-export-${p.id}`}
                      onClick={() => onExportYaml(p)}
                      disabled={busy}
                      className="text-stone-400 hover:text-stone-200 disabled:opacity-40"
                    >
                      YAML
                    </button>
                    {confirmDeleteId === p.id ? (
                      <span className="flex flex-wrap items-center justify-end gap-2">
                        {p.visibility === "public" && (
                          <span
                            data-testid={`preset-delete-public-warning-${p.id}`}
                            className="basis-full text-right text-[11px] text-amber-200"
                          >
                            Öffentlich im Marketplace — wird auch dort entfernt.
                          </span>
                        )}
                        <AutoFocusButton
                          data-testid={`preset-delete-confirm-${p.id}`}
                          onClick={() => void onDelete(p.id)}
                          disabled={busy}
                          className="text-red-400 hover:text-red-300 disabled:opacity-40"
                        >
                          Wirklich löschen?
                        </AutoFocusButton>
                        <button
                          type="button"
                          data-testid={`preset-delete-cancel-${p.id}`}
                          onClick={() => {
                            setConfirmDeleteId(null);
                            requestFocus(`preset-delete-${p.id}`);
                          }}
                          className="text-stone-400 hover:text-stone-200"
                        >
                          Abbrechen
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        data-testid={`preset-delete-${p.id}`}
                        aria-label={`„${p.name}“ löschen`}
                        onClick={() => {
                          setError(null);
                          setConfirmDeleteId(p.id);
                        }}
                        disabled={busy}
                        className="text-stone-400 hover:text-red-400 disabled:opacity-40"
                      >
                        Löschen
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="px-4 py-3 border-t border-stone-800 space-y-3">
          {error && (
            <p data-testid="preset-error" role="alert" className="text-red-400 text-xs">
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
              <p className="text-xs text-stone-400">
                Vorschaubild, Beschreibung, Genre sowie dein Handle und deine
                Bio (sofern gesetzt) werden <strong>öffentlich sichtbar — auch
                für nicht angemeldete Besucher und Suchmaschinen/KI-Crawler</strong>.
                E-Mail bleibt privat. Wähle ein Vorschaubild, das keine
                erkennbaren Dritten ohne deren Einwilligung zeigt.
              </p>
              <label htmlFor="preset-publish-genre" className="sr-only">
                Genre
              </label>
              <select
                id="preset-publish-genre"
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
                <option value="">Genre wählen …</option>
                {GENRE_OPTIONS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
              <div>
                <label htmlFor="preset-publish-description" className="sr-only">
                  Beschreibung
                </label>
                <textarea
                  id="preset-publish-description"
                  aria-describedby="preset-publish-description-counter"
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
                  id="preset-publish-description-counter"
                  className={`text-[10px] mt-0.5 text-right tabular-nums ${
                    publish.description.length < 10
                      ? "text-amber-200/80"
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
                  <p className="text-[11px] text-stone-400">
                    Erst ein Bild in der Bibliothek hochladen.
                  </p>
                ) : (
                  <>
                    <p className="text-[11px] text-stone-400 mb-1">
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
                            aria-pressed={isSelected}
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

          <label className="block text-[10px] uppercase tracking-[0.2em] text-stone-400 hover:text-stone-200 cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-amber-300">
            YAML importieren
            <input
              type="file"
              accept=".yaml,.yml,application/yaml,text/yaml"
              data-testid="preset-import-input"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImportYaml(f);
                e.target.value = "";
              }}
            />
          </label>

          <div className="flex gap-2">
            <input
              type="text"
              data-testid="preset-save-name"
              aria-label="Name für neues Preset"
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

        {applyTarget && (
          <ApplyStepPanel
            preset={applyTarget}
            enabledGroups={enabledGroups}
            onToggle={toggleGroup}
            onCancel={closeApplyPanel}
            onConfirm={onApplyConfirm}
          />
        )}
    </Modal>
  );
}
