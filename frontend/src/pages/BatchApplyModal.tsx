import { useCallback, useEffect, useRef, useState } from "react";

import type { Preset } from "../api/client";
import { useApi } from "../api/use-api";
import StepCheckboxes from "../editor/StepCheckboxes";
import { defaultEnabledGroups } from "../editor/profileGroups";

interface Props {
  readonly imageIds: ReadonlyArray<string>;
  readonly onClose: () => void;
  readonly onApplied: (applied: number, total: number) => void;
}

export default function BatchApplyModal({ imageIds, onClose, onApplied }: Props) {
  const api = useApi();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Set<string>>(() => defaultEnabledGroups());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const list = await api.listPresets();
      if (mountedRef.current) setPresets(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Presets laden fehlgeschlagen");
      }
    }
  }, [api]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const toggleGroup = (key: string) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onApply = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.applyPresetBatch(selectedId, {
        imageIds: [...imageIds],
        groups: [...enabled],
      });
      if (!mountedRef.current) return;
      onApplied(res.applied, res.total);
      onClose();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Anwenden fehlgeschlagen");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <div
      data-testid="batch-apply-modal"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[380px] max-h-[80vh] flex flex-col bg-stone-900 border border-stone-700 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-stone-800 text-stone-200">
          Profil auf {imageIds.length}{" "}
          {imageIds.length === 1 ? "Bild" : "Bilder"} anwenden
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {error && (
            <p data-testid="batch-error" className="text-red-400 text-xs">
              {error}
            </p>
          )}
          <select
            data-testid="batch-preset-select"
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value || null)}
            className="w-full bg-stone-950 border border-stone-700 px-2 py-1 text-stone-200"
          >
            <option value="">Profil wählen…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {selectedId && <StepCheckboxes enabled={enabled} onToggle={toggleGroup} />}
        </div>
        <div className="px-4 py-3 border-t border-stone-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-stone-500 hover:text-stone-300"
          >
            Abbrechen
          </button>
          <button
            type="button"
            data-testid="batch-apply-confirm"
            onClick={() => void onApply()}
            disabled={busy || !selectedId || enabled.size === 0}
            className="px-3 py-1 text-[10px] uppercase tracking-[0.2em] bg-amber-200/20 border border-amber-300 text-amber-200 hover:bg-amber-200/30 disabled:opacity-40"
          >
            Anwenden
          </button>
        </div>
      </div>
    </div>
  );
}
