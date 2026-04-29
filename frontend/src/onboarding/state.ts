/**
 * Persistenz-Layer fuer das Onboarding. localStorage ist hier ausreichend
 * (Pro-Browser, Pro-User), keine Server-Roundtrip-Notwendigkeit. Wir
 * versionieren mit `v1`, damit wir bei einem Re-Design alle alten
 * Markierungen invalidieren koennen.
 *
 * Drei Zustaende:
 *   completed: User hat die Tour bis zum Ende durchgeklickt
 *   dismissed: User hat „Spaeter" gewaehlt — wird auf der Account-Seite
 *              re-startbar, aber nicht automatisch erneut getriggert
 *   none:      Erst-Login — Welcome-Modal soll feuern
 */
const KEY = "lumen.onboarding.v1";

export type OnboardingState = "none" | "dismissed" | "completed";

interface StoredState {
  status: OnboardingState;
  completedAt?: number;
}

let cached: StoredState | null = null;

function read(): StoredState {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) {
      cached = { status: "none" };
      return cached;
    }
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    if (
      parsed &&
      (parsed.status === "none" ||
        parsed.status === "dismissed" ||
        parsed.status === "completed")
    ) {
      cached = { status: parsed.status, completedAt: parsed.completedAt };
      return cached;
    }
  } catch {
    /* localStorage in Test-Umgebungen flaky — Default */
  }
  cached = { status: "none" };
  return cached;
}

function write(next: StoredState): void {
  cached = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* SSR / Privatemode — best effort */
  }
}

export function getOnboardingState(): OnboardingState {
  return read().status;
}

export function markOnboardingDismissed(): void {
  write({ status: "dismissed" });
}

export function markOnboardingCompleted(): void {
  write({ status: "completed", completedAt: Date.now() });
}

export function resetOnboarding(): void {
  write({ status: "none" });
}
