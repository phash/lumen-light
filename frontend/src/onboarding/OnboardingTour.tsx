import { useCallback, useEffect, useMemo, useState } from "react";

import {
  markOnboardingCompleted,
  markOnboardingDismissed,
} from "./state";
import { ONBOARDING_STEPS, type OnboardingStep } from "./steps";

interface Props {
  /**
   * Aufgerufen, wenn der User die Tour beendet — egal ob durch Skip oder
   * durch Vollstaendiges Durchklicken. Parent unmountet die Tour danach
   * (kein `open`-Prop noetig — frische Mount = frischer State).
   */
  onClose: () => void;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8;

function getRect(testId: string): TargetRect | null {
  const el = document.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`,
  );
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top - PADDING,
    left: r.left - PADDING,
    width: r.width + 2 * PADDING,
    height: r.height + 2 * PADDING,
  };
}

/**
 * Tour-Komponente — zeigt entweder ein zentriertes Modal (welcome / done)
 * oder ein Spotlight-Overlay mit Tooltip-Karte. Spotlight nutzt einen
 * grossen `box-shadow` als „Loch im schwarzen Vorhang", damit wir kein
 * SVG-Cutout brauchen.
 */
export default function OnboardingTour({ onClose }: Props) {
  const [stepIdx, setStepIdx] = useState(0);
  // `tick` triggert Re-Render fuer DOM-Messungen (Spotlight-Rect +
  // waitForTestId-Polling). Wir setzen es per Polling-Interval und auf
  // window-resize — das ersetzt einen separaten setState-in-effect-Pfad.
  const [tick, setTick] = useState(0);

  const step: OnboardingStep | undefined = ONBOARDING_STEPS[stepIdx];

  // Single Polling-Loop fuer Re-Layout + Wait-Detection. 250ms reicht
  // fuer „menschliche Wahrnehmung", erzeugt aber keine ueberhitze CPU.
  // Resize-Listener bumped denselben tick fuer sofortige Anpassung.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 250);
    const onResize = () => setTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Derived: Spotlight-Rect (re-evaluated on every tick / step change).
  // Calling `getRect` waehrend des Renders ist OK — wir fuehren keine
  // DOM-Mutation aus, nur Layout-Read. Voids React-Warnings.
  const rect = useMemo<TargetRect | null>(() => {
    void tick;
    if (!step || step.kind !== "spotlight" || !step.target) return null;
    return getRect(step.target);
  }, [step, tick]);

  // Derived: blockt der Weiter-Button auf eine User-Aktion (z.B. „Bild
  // laden" → Histogramm muss erscheinen)?
  const waitingFor = useMemo<string | null>(() => {
    void tick;
    const target = step?.waitForTestId;
    if (!target) return null;
    return document.querySelector(`[data-testid="${target}"]`) ? null : target;
  }, [step, tick]);


  const handleSkip = useCallback(() => {
    markOnboardingDismissed();
    onClose();
  }, [onClose]);

  const handleDone = useCallback(() => {
    markOnboardingCompleted();
    onClose();
  }, [onClose]);

  const handleNext = useCallback(() => {
    if (stepIdx >= ONBOARDING_STEPS.length - 1) {
      handleDone();
      return;
    }
    setStepIdx((i) => i + 1);
  }, [stepIdx, handleDone]);

  const handlePrev = useCallback(() => {
    setStepIdx((i) => Math.max(0, i - 1));
  }, []);

  const tooltipPos = useMemo(() => {
    if (!step || step.kind !== "spotlight") return null;
    const TOOLTIP_W = 320;
    const TOOLTIP_H = 200; // grobe Schaetzung, reicht fuer das Centering
    if (!rect) {
      // Target nicht (mehr) im DOM — Tooltip mittig auf den Viewport
      // pinnen, damit der User nicht ohne Erklaerung dasitzt.
      const w = typeof window !== "undefined" ? window.innerWidth : 1024;
      const h = typeof window !== "undefined" ? window.innerHeight : 768;
      return {
        top: h / 2 - TOOLTIP_H / 2,
        left: w / 2 - TOOLTIP_W / 2,
      };
    }
    const placement = step.placement ?? "bottom";
    const GAP = 12;
    if (placement === "bottom") {
      return {
        top: clampY(rect.top + rect.height + GAP, TOOLTIP_H),
        left: clampX(rect.left + rect.width / 2 - TOOLTIP_W / 2, TOOLTIP_W),
      };
    }
    if (placement === "top") {
      // top-placement: Tooltip-Bottom = rect.top - GAP. Wir wollen auch
      // hier gegen Viewport-Top clampen (translateY=-100% verschiebt
      // dann nach oben aus der angegebenen Position).
      return {
        top: Math.max(TOOLTIP_H + 16, rect.top - GAP - 1),
        left: clampX(rect.left + rect.width / 2 - TOOLTIP_W / 2, TOOLTIP_W),
        translateY: "-100%",
      };
    }
    if (placement === "left") {
      return {
        top: rect.top + rect.height / 2,
        left: rect.left - GAP,
        translateX: "-100%",
        translateY: "-50%",
      };
    }
    return {
      top: rect.top + rect.height / 2,
      left: rect.left + rect.width + GAP,
      translateY: "-50%",
    };
  }, [rect, step]);

  if (!open || !step) return null;

  return (
    <div
      data-testid="onboarding-tour"
      className="fixed inset-0 z-50 pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      {step.kind === "modal" ? (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-4 pointer-events-auto">
          <div
            data-testid="onboarding-modal"
            className="w-full max-w-md bg-stone-900 border border-stone-700 p-6 text-stone-200"
          >
            <h2 id="onboarding-title" className="text-xl text-amber-200">
              {step.title}
            </h2>
            <p className="mt-3 text-sm text-stone-300 whitespace-pre-line">
              {step.body}
            </p>
            <div className="mt-6 flex items-center justify-between text-xs">
              <ProgressDots index={stepIdx} />
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="onboarding-skip"
                  onClick={handleSkip}
                  className="px-3 py-1.5 uppercase tracking-[0.2em] text-stone-500 hover:text-stone-300"
                >
                  Spaeter
                </button>
                <button
                  type="button"
                  data-testid={
                    stepIdx === ONBOARDING_STEPS.length - 1
                      ? "onboarding-done"
                      : "onboarding-next"
                  }
                  onClick={handleNext}
                  className="px-4 py-1.5 uppercase tracking-[0.2em] bg-amber-200/20 border border-amber-300 text-amber-200 hover:bg-amber-200/30"
                >
                  {stepIdx === 0
                    ? "Tour starten"
                    : stepIdx === ONBOARDING_STEPS.length - 1
                      ? "Loslegen"
                      : "Weiter"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Spotlight-Vorhang: schwarzer Schatten um das hervorgehobene
              Element herum. Wenn das Target nicht mehr existiert (z.B.
              Sidebar collapsed), zeigen wir einen abgedunkelten
              Vollbild-Overlay als Fallback. */}
          {rect ? (
            <div
              data-testid="onboarding-spotlight"
              className="absolute pointer-events-none transition-all duration-150"
              style={{
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.7)",
                borderRadius: 6,
                outline: "2px solid rgba(252, 211, 77, 0.6)",
              }}
            />
          ) : (
            <div className="absolute inset-0 bg-black/70 pointer-events-none" />
          )}

          {tooltipPos && (
            <div
              data-testid="onboarding-tooltip"
              className="absolute pointer-events-auto w-[320px] bg-stone-900 border border-stone-700 p-4 text-stone-200 shadow-2xl"
              style={{
                top: tooltipPos.top,
                left: tooltipPos.left,
                transform: composeTransform(tooltipPos),
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <h3
                  id="onboarding-title"
                  className="text-amber-200 text-sm uppercase tracking-[0.2em]"
                >
                  {step.title}
                </h3>
                <button
                  type="button"
                  data-testid="onboarding-skip"
                  onClick={handleSkip}
                  aria-label="Tour ueberspringen"
                  className="text-stone-500 hover:text-stone-200 -mt-1 -mr-1 px-1"
                >
                  ✕
                </button>
              </div>
              <p className="mt-2 text-sm text-stone-300">{step.body}</p>
              {waitingFor && (
                <p
                  data-testid="onboarding-waiting"
                  className="mt-2 text-xs text-stone-500 italic"
                >
                  Warte auf den naechsten Schritt …
                </p>
              )}
              <div className="mt-4 flex items-center justify-between">
                <ProgressDots index={stepIdx} />
                <div className="flex gap-2 text-xs">
                  {stepIdx > 0 && (
                    <button
                      type="button"
                      data-testid="onboarding-prev"
                      onClick={handlePrev}
                      className="px-2 py-1 uppercase tracking-[0.2em] text-stone-400 hover:text-stone-200"
                    >
                      Zurueck
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="onboarding-next"
                    onClick={handleNext}
                    disabled={waitingFor !== null}
                    className="px-3 py-1 uppercase tracking-[0.2em] bg-amber-200/20 border border-amber-300 text-amber-200 hover:bg-amber-200/30 disabled:opacity-40"
                  >
                    Weiter
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ProgressDots({ index }: { index: number }) {
  return (
    <div
      data-testid="onboarding-progress"
      className="flex gap-1.5"
      aria-label={`Schritt ${index + 1} von ${ONBOARDING_STEPS.length}`}
    >
      {ONBOARDING_STEPS.map((_, i) => (
        <span
          key={i}
          className={`block h-1.5 w-4 rounded-sm ${
            i === index
              ? "bg-amber-300"
              : i < index
                ? "bg-amber-200/50"
                : "bg-stone-700"
          }`}
        />
      ))}
    </div>
  );
}

function clampX(left: number, width: number): number {
  const max = window.innerWidth - width - 16;
  return Math.max(16, Math.min(left, max));
}

function clampY(top: number, height: number): number {
  const max = window.innerHeight - height - 16;
  return Math.max(16, Math.min(top, max));
}

function composeTransform(pos: {
  translateX?: string;
  translateY?: string;
}): string {
  const parts: string[] = [];
  if (pos.translateX) parts.push(`translateX(${pos.translateX})`);
  if (pos.translateY) parts.push(`translateY(${pos.translateY})`);
  return parts.join(" ");
}
