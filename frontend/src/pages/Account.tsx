import { useEffect, useState } from "react";
import { useAuth } from "react-oidc-context";

import { useApi } from "../api/use-api";
import type { MeExport, User } from "../api/client";

export default function Account() {
  const api = useApi();
  const auth = useAuth();
  const [me, setMe] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((m) => {
        if (!cancelled) setMe(m);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Konto laden fehlgeschlagen");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const onExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const data: MeExport = await api.exportMe();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lumen-export-${data.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteMe();
      // Logout, damit das Token weg ist und der naechste Login JIT-frisch ist.
      await auth.signoutRedirect();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Loeschen fehlgeschlagen");
    }
  };

  return (
    <section data-testid="page-account" className="p-8 max-w-2xl">
      <h1 className="text-3xl">Account</h1>
      {me && (
        <p className="mt-2 text-stone-400">
          Eingeloggt als <span className="text-stone-200">{me.email}</span>
        </p>
      )}

      {error && (
        <p data-testid="account-error" className="mt-4 text-red-400 text-sm">
          {error}
        </p>
      )}

      <div className="mt-8 space-y-6">
        <section>
          <h2 className="text-stone-300 italic">Daten exportieren</h2>
          <p className="mt-1 text-sm text-stone-500">
            Eine JSON-Datei mit allen deinen Presets, Bildmetadaten und
            Pre-Signed-Download-URLs. Erfuellt DSGVO Art. 15 + 20.
          </p>
          <button
            type="button"
            data-testid="account-export"
            onClick={() => void onExport()}
            disabled={busy}
            className="mt-3 px-4 py-2 text-xs uppercase tracking-[0.2em] border border-amber-300/40 text-amber-200 hover:border-amber-300 disabled:opacity-40"
          >
            JSON herunterladen
          </button>
        </section>

        <section>
          <h2 className="text-stone-300 italic">Account löschen</h2>
          <p className="mt-1 text-sm text-stone-500">
            Entfernt alle deine Presets, Bilder und Metadaten dauerhaft.
            Der Keycloak-Account selbst bleibt — kannst du im
            Account-Self-Service-UI separat schließen.
          </p>
          {!confirmDelete ? (
            <button
              type="button"
              data-testid="account-delete-trigger"
              onClick={() => setConfirmDelete(true)}
              className="mt-3 px-4 py-2 text-xs uppercase tracking-[0.2em] border border-stone-700 text-stone-400 hover:border-red-400 hover:text-red-400"
            >
              Account-Daten löschen …
            </button>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-red-400">
                Wirklich alle Daten loeschen? Das laesst sich nicht rueckgaengig machen.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="account-delete-confirm"
                  onClick={() => void onDelete()}
                  disabled={busy}
                  className="px-4 py-2 text-xs uppercase tracking-[0.2em] bg-red-500/20 border border-red-500 text-red-300 hover:bg-red-500/30 disabled:opacity-40"
                >
                  {busy ? "Loesche…" : "Ja, alles loeschen"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-4 py-2 text-xs uppercase tracking-[0.2em] text-stone-400"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
