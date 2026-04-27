import { useCallback, useEffect, useState } from "react";

import { ApiError, type Preset } from "../api/client";
import { useApi } from "../api/use-api";
import { masksToWire, wireToMasks } from "./maskSerializer";
import { useEditorStore } from "./store";

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

  const adjustments = useEditorStore((s) => s.adjustments);
  const masks = useEditorStore((s) => s.masks);
  const applyAdjustments = useEditorStore((s) => s.applyAdjustments);
  const applyMasks = useEditorStore((s) => s.applyMasks);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listPresets();
      setPresets(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Liste laden fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [open, refresh]);

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
      if (loadedPresetId === id) onLoadedPresetIdChange(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Löschen fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name darf nicht leer sein.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const created = await api.createPreset({
        name: trimmed,
        adjustments,
        masks: masksToWire(masks),
      });
      onLoadedPresetIdChange(created.id);
      setName("");
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("Ein Preset mit diesem Namen existiert bereits.");
      } else {
        setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
      }
    } finally {
      setBusy(false);
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
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aktualisieren fehlgeschlagen");
    } finally {
      setBusy(false);
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
              {`„${loadedPreset.name}" überschreiben`}
            </button>
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
