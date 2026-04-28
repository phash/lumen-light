import { useEffect, useState } from "react";
import { useAuth } from "react-oidc-context";

import { useApi } from "../api/use-api";
import {
  ApiError,
  type MeExport,
  type Preset,
  type User,
} from "../api/client";
import {
  isFaceDetectionConsented,
  setFaceDetectionConsent,
} from "../editor/consent";

export default function Account() {
  const api = useApi();
  const auth = useAuth();
  const [me, setMe] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [profileDraft, setProfileDraft] = useState<{ handle: string; bio: string }>(
    { handle: "", bio: "" },
  );
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [published, setPublished] = useState<Preset[]>([]);
  const [faceConsent, setFaceConsent] = useState<boolean>(() =>
    isFaceDetectionConsented(),
  );

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

  useEffect(() => {
    let cancelled = false;
    void api
      .getProfile()
      .then((p) => {
        if (cancelled) return;
        setProfileDraft({ handle: p.handle ?? "", bio: p.bio ?? "" });
      })
      .catch(() => {
        /* Profil-Fehler nicht blockierend — Block ist optional. */
      });
    void api
      .listPublishedPresets()
      .then((list) => {
        if (!cancelled) setPublished(list);
      })
      .catch(() => {
        /* Empty bleibt OK. */
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const onProfileSave = async () => {
    setProfileFeedback(null);
    try {
      await api.updateProfile({
        handle: profileDraft.handle.trim() || null,
        bio: profileDraft.bio.trim() || null,
      });
      setProfileFeedback("Gespeichert.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setProfileFeedback("Dieser Handle ist bereits vergeben.");
      } else if (err instanceof ApiError && err.status === 422) {
        setProfileFeedback("Handle: 3–40 Zeichen, nur a-z 0-9 -.");
      } else {
        setProfileFeedback(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
      }
    }
  };

  const onUnpublish = async (presetId: string, name: string) => {
    // Loaded preset zurueckziehen via PUT mit visibility=private. Wir
    // muessen Adjustments + Masks mitschicken, also brauchen wir den
    // vollen Preset; published-list hat ihn schon.
    const p = published.find((x) => x.id === presetId);
    if (!p) return;
    try {
      await api.updatePreset(presetId, {
        name: p.name,
        adjustments: p.adjustments,
        masks: p.masks,
        visibility: "private",
      });
      setPublished((list) => list.filter((x) => x.id !== presetId));
    } catch (err) {
      setProfileFeedback(
        err instanceof Error ? `${name}: ${err.message}` : "Zurueckziehen fehlgeschlagen",
      );
    }
  };

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

      <div className="mt-8 space-y-8">
        <section data-testid="account-smart-suggestion">
          <h2 className="text-stone-300 italic">Smart-Preset-Vorschlag</h2>
          <p className="mt-1 text-sm text-stone-500">
            Beim Laden eines Bildes versucht Lumen, ein passendes Preset-
            Genre vorzuschlagen (Portrait, Landschaft, Sport…). Fuer die
            Portrait-Erkennung wird einmalig pro Browser-Profil ein
            Modell von Google&apos;s TensorFlow-CDN geladen — dabei werden
            deine IP-Adresse und User-Agent an Google in den USA
            uebermittelt. Die eigentliche Erkennung laeuft danach lokal
            in deinem Browser; Bilder verlassen deinen Rechner nicht.
            <span className="block mt-2 text-stone-400">
              Default ist deaktiviert. Mit dem Toggle gibst du
              ausdrueckliche Einwilligung im Sinne von Art. 49 Abs. 1
              lit. a DSGVO.
            </span>
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm text-stone-300 cursor-pointer">
            <input
              type="checkbox"
              checked={faceConsent}
              onChange={(e) => {
                setFaceConsent(e.target.checked);
                setFaceDetectionConsent(e.target.checked);
              }}
              data-testid="account-face-consent"
            />
            Smart-Preset mit Gesichtserkennung aktivieren
          </label>
        </section>

        <section data-testid="account-profile">
          <h2 className="text-stone-300 italic">Profil</h2>
          <p className="mt-1 text-sm text-stone-500">
            Handle und Bio werden im Marketplace bei deinen Presets angezeigt.
            Email bleibt privat.
          </p>
          <div className="mt-3 space-y-2 max-w-md">
            <label className="block text-xs text-stone-400">
              Handle (3–40 Zeichen, a–z 0–9 -)
              <input
                type="text"
                value={profileDraft.handle}
                onChange={(e) =>
                  setProfileDraft((s) => ({ ...s, handle: e.target.value }))
                }
                placeholder="anonyme_anna"
                maxLength={40}
                data-testid="account-handle"
                className="mt-1 w-full bg-stone-950 border border-stone-700 px-2 py-1 text-stone-200 text-sm"
              />
            </label>
            <label className="block text-xs text-stone-400">
              Bio (optional, max 280)
              <textarea
                value={profileDraft.bio}
                onChange={(e) =>
                  setProfileDraft((s) => ({ ...s, bio: e.target.value }))
                }
                rows={2}
                maxLength={280}
                data-testid="account-bio"
                className="mt-1 w-full bg-stone-950 border border-stone-700 px-2 py-1 text-stone-200 text-sm"
              />
            </label>
            {profileFeedback && (
              <p
                className="text-xs text-amber-200"
                data-testid="account-profile-feedback"
              >
                {profileFeedback}
              </p>
            )}
            <button
              type="button"
              onClick={() => void onProfileSave()}
              data-testid="account-profile-save"
              className="px-4 py-1.5 text-xs uppercase tracking-[0.2em] border border-amber-300/40 text-amber-200 hover:border-amber-300"
            >
              Profil speichern
            </button>
          </div>
        </section>

        <section data-testid="account-published">
          <h2 className="text-stone-300 italic">Meine veröffentlichten Presets</h2>
          {published.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">
              Du hast aktuell keine Presets im Marketplace.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-stone-800 text-sm">
              {published.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between py-2"
                  data-testid={`account-published-${p.id}`}
                >
                  <div className="min-w-0">
                    <div className="text-stone-200 truncate">{p.name}</div>
                    <div className="text-[10px] uppercase tracking-wider text-stone-500">
                      {p.genre ?? "–"} · {p.applyCount} Anwendungen
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onUnpublish(p.id, p.name)}
                    data-testid={`account-unpublish-${p.id}`}
                    className="text-xs uppercase tracking-[0.2em] text-stone-500 hover:text-red-400"
                  >
                    Zurückziehen
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

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
