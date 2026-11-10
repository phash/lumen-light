import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { useApi } from "../api/use-api";
import type { FeedbackKind } from "../api/client";
import Modal from "./Modal";

interface Props {
  open: boolean;
  onClose: () => void;
}

const KIND_OPTIONS: ReadonlyArray<{ value: FeedbackKind; label: string }> = [
  { value: "bug", label: "Bug" },
  { value: "idea", label: "Idee" },
  { value: "other", label: "Sonstiges" },
];

export default function FeedbackDialog({ open, onClose }: Props) {
  const api = useApi();
  const location = useLocation();
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // Honeypot — bleibt leer
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  // "success" bleibt stehen, bis der User selbst schliesst — kein
  // Auto-Close mehr (war mit 1.2s zu schnell zum Lesen).
  const [feedbackTone, setFeedbackTone] = useState<"success" | "error">("error");
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  // Wir sind bewusst gegen setState-in-Effect (siehe react-hooks/set-state-
  // in-effect): wenn sich `open` aendert, geben wir der Komponente einen
  // neuen Key (siehe Header), wodurch der State auf seine Initialwerte
  // zurueckgesetzt wird — das ist die React-19-empfohlene Form fuer
  // "Reset bei jedem Re-Open".
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => messageRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  // Esc-Close, Focus-Trap und Fokus-Rueckgabe uebernimmt das Modal.

  if (!open) return null;

  const submit = async () => {
    const trimmed = message.trim();
    if (trimmed.length < 10) {
      setFeedbackTone("error");
      setFeedback("Bitte mindestens 10 Zeichen schreiben.");
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await api.submitFeedback({
        kind,
        message: trimmed,
        page: location.pathname || null,
        // Honeypot stets mitsenden (auch leer) — das Backend nutzt es,
        // gefuellte Werte werden silent verworfen.
        website,
      });
      setFeedbackTone("success");
      setFeedback("Danke — Feedback erhalten. Du kannst den Dialog jetzt schließen.");
      setMessage("");
    } catch (err) {
      setFeedbackTone("error");
      setFeedback(
        err instanceof Error ? err.message : "Senden fehlgeschlagen.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      cardTestId="feedback-dialog"
      labelledBy="feedback-dialog-title"
      backdropClassName="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4"
      cardClassName="w-full max-w-md bg-stone-900 border border-stone-700 text-sm outline-none"
    >
        <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between">
          <h2 id="feedback-dialog-title" className="text-stone-200">Feedback senden</h2>
          <button
            type="button"
            data-testid="feedback-close"
            onClick={onClose}
            aria-label="Schließen"
            className="text-stone-400 hover:text-stone-200"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="flex gap-2" role="group" aria-label="Art des Feedbacks">
            {KIND_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={kind === opt.value}
                onClick={() => setKind(opt.value)}
                data-testid={`feedback-kind-${opt.value}`}
                className={`flex-1 px-2 py-1.5 text-xs uppercase tracking-[0.2em] border ${
                  kind === opt.value
                    ? "border-amber-300 text-amber-200 bg-amber-200/10"
                    : "border-stone-700 text-stone-400 hover:border-amber-300/40"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <label htmlFor="feedback-message" className="sr-only">
            Nachricht
          </label>
          <textarea
            id="feedback-message"
            aria-describedby="feedback-message-counter"
            ref={messageRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            minLength={10}
            maxLength={2000}
            placeholder="Was ist dir aufgefallen? (10–2000 Zeichen)"
            data-testid="feedback-message"
            className="w-full bg-stone-950 border border-stone-700 px-2 py-1 text-stone-200"
          />

          <div
            id="feedback-message-counter"
            className="text-[11px] text-stone-400 text-right tabular-nums"
          >
            {message.trim().length} / 2000
          </div>

          {/* Honeypot — visuell + a11y versteckt, Bots fuellen es trotzdem.
              `tabIndex={-1}` und `autoComplete="off"` reduzieren Auto-Fill. */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "-9999px",
              top: "auto",
              width: "1px",
              height: "1px",
              overflow: "hidden",
            }}
          >
            <label>
              Webseite (bitte freilassen)
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                data-testid="feedback-honeypot"
              />
            </label>
          </div>

          {/* Live-Regionen immer im DOM, damit Screenreader Aenderungen ansagen. */}
          <div role="status">
            {feedback && feedbackTone === "success" && (
              <div data-testid="feedback-status" className="text-xs text-amber-200">
                {feedback}
              </div>
            )}
          </div>
          <div role="alert">
            {feedback && feedbackTone === "error" && (
              <div data-testid="feedback-status" className="text-xs text-red-400">
                {feedback}
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-stone-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-stone-400 hover:text-stone-200"
          >
            {feedbackTone === "success" && feedback ? "Schließen" : "Abbrechen"}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || message.trim().length < 10}
            data-testid="feedback-submit"
            className="px-4 py-1 text-[10px] uppercase tracking-[0.2em] bg-amber-200/20 border border-amber-300 text-amber-200 hover:bg-amber-200/30 disabled:opacity-40"
          >
            {busy ? "Senden …" : "Senden"}
          </button>
        </div>
    </Modal>
  );
}
