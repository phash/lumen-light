import { useCallback, useEffect, useState } from "react";

import { useApi } from "../api/use-api";
import type { Image } from "../api/client";
import { uploadImage } from "../api/upload";

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
  const api = useApi();
  const [images, setImages] = useState<Image[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setImages(await api.listImages("ready"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Liste laden fehlgeschlagen");
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
      await uploadImage(api, file);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (id: string) => {
    setError(null);
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
        <label className="mt-2 inline-block cursor-pointer text-amber-200 hover:underline">
          Datei wählen
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPick}
            data-testid="upload-input"
          />
        </label>
        {uploading && (
          <p data-testid="upload-pending" className="mt-2 text-amber-200/80">
            Wird hochgeladen …
          </p>
        )}
      </div>

      {error && (
        <p data-testid="library-error" className="mt-4 text-red-400">
          {error}
        </p>
      )}

      <ul className="mt-6 divide-y divide-stone-800" data-testid="image-list">
        {images.length === 0 && (
          <li className="py-3 text-stone-500 italic">Noch keine Bilder hochgeladen.</li>
        )}
        {images.map((img) => (
          <li
            key={img.id}
            data-testid={`image-row-${img.id}`}
            className="flex items-center justify-between py-3"
          >
            <div>
              <div className="text-stone-200">{img.original_filename}</div>
              <div className="text-xs text-stone-500">
                {formatSize(img.size_bytes)} · {img.content_type}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void onDelete(img.id)}
              className="text-stone-500 hover:text-red-400"
            >
              Löschen
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
