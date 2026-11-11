import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import OnboardingTour from "../onboarding/OnboardingTour";
import { getOnboardingState } from "../onboarding/state";

import { ApiError, type ApiClient, type ImageEditState } from "../api/client";
import { useApi } from "../api/use-api";
import Modal from "../components/Modal";
import { CONTEXT_LOST_MESSAGE, type CanvasHandle, type FullResExport } from "../editor/Canvas";
import EditorBanners from "../editor/EditorBanners";
import EditorOverlayCanvas from "../editor/EditorOverlayCanvas";
import EditorSidebar from "../editor/EditorSidebar";
import EditorToolbar from "../editor/EditorToolbar";
import {
  type ExportFormat,
  downloadBlob,
  exportCanvas,
  suggestFilename,
} from "../editor/export";
import ExportDialog from "../editor/ExportDialog";
import { defaultLensCorrection } from "../editor/lens";
import { findLensProfile, profileToCorrection } from "../editor/lensProfile";
import { masksToWire, wireToMasks } from "../editor/maskSerializer";
import {
  type LinearMaskInstance,
  MAX_LINEAR_MASKS,
  MAX_RADIAL_MASKS,
  type MaskInstance,
  type RadialMaskInstance,
} from "../editor/mask";
import PresetDialog from "../editor/PresetDialog";
import ShortcutCheatsheet from "../editor/ShortcutCheatsheet";
import { CURRENT_PROCESS_VERSION } from "../editor/adjustments";
import { analyze, computeAutoTone, computeAutoWb } from "../editor/autoAdjust";
import { analyzeCanvasStraightenAngle } from "../editor/autoStraighten";
import { detectFacesSafe } from "../editor/faceDetector";
import { FILE_PICKER_ACCEPT, decodeRaw, isRawFile, rgbToImageBitmap } from "../editor/raw";
import { type Genre, suggestGenre } from "../editor/suggestPreset";
import { selectedMask, useEditorStore } from "../editor/store";
import { type AspectRatio, defaultCropRect } from "../editor/transform";
import { useKeyboardShortcuts } from "../editor/useKeyboardShortcuts";
import { TITLE_SUFFIX, usePageMeta } from "../hooks/usePageMeta";

function countByType(
  masks: ReadonlyArray<MaskInstance>,
  type: "linear" | "radial",
): number {
  let n = 0;
  for (const m of masks) if (m.type === type) n++;
  return n;
}

/** Pan-Schritt fuer Shift+Pfeiltasten (Tastatur-Alternative zum Drag). */
const KEYBOARD_PAN_STEP = 40;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AutosaveStatus = "idle" | "saving" | "saved" | "error" | "failed";

/** Debounce des Autosaves: ein Slider-Drag erzeugt genau einen PUT. */
export const AUTOSAVE_DEBOUNCE_MS = 1200;
/** Backoff fuer fehlgeschlagene Saves; letzter Wert wird wiederholt. */
const AUTOSAVE_RETRY_MS = [2000, 5000, 10000, 30000] as const;

interface PendingSave {
  readonly id: string;
  readonly state: ImageEditState;
}

interface AutosaveView {
  /** Bild, fuer das der Status gilt — anderes Bild -> "idle". */
  readonly id: string | null;
  readonly status: AutosaveStatus;
  readonly reason: string | null;
}

/** 4xx ausser 408/429 ist permanent: ein Retry wuerde nur dasselbe liefern. */
export function isPermanentSaveError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 408 &&
    err.status !== 429
  );
}

/**
 * C1: debounced Autosave des Bearbeitungsstands. Haelt den letzten
 * ungespeicherten Stand in einem Ref, damit er beim Unmount, bei pagehide
 * und bei visibilitychange=hidden per fetch-keepalive noch rausgeht.
 *
 * - Es laeuft immer hoechstens ein Request; danach geht der neueste
 *   ausstehende Stand raus (keine Out-of-Order-Saves).
 * - Transiente Fehler werden mit Backoff wiederholt, der Status bleibt
 *   dabei "error" (keine wiederholte Screenreader-Ansage).
 * - Permanente 4xx (ausser 408/429) -> "failed" mit Grund, kein Retry.
 * - visibilitychange=hidden verwirft den Stand erst nach Erfolg;
 *   pagehide/Unmount/Bildwechsel senden ein letztes Mal und verwerfen.
 *
 * imageId/state = null -> nichts speichern (ausstehender Stand wird
 * verworfen; Aufrufer flusht vorher, wenn er ihn behalten will).
 */
export function useEditAutosave(
  api: Pick<ApiClient, "putImageEdit">,
  imageId: string | null,
  state: ImageEditState | null,
): { status: AutosaveStatus; reason: string | null; flush: () => void } {
  const [view, setView] = useState<AutosaveView>({ id: null, status: "idle", reason: null });
  const apiRef = useRef(api);
  useLayoutEffect(() => {
    apiRef.current = api;
  });
  const pendingRef = useRef<PendingSave | null>(null);
  const inFlightRef = useRef<PendingSave | null>(null);
  const timerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const mountedRef = useRef(false);
  // Selbstreferenz fuer Retry/Nachsenden (send ruft sich indirekt erneut).
  const sendRef = useRef<(entry: PendingSave, keepalive: boolean) => void>(() => undefined);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  /** Nach Abschluss eines Requests: neueren ausstehenden Stand senden,
   *  sofern nicht noch dessen Debounce-/Retry-Timer laeuft. */
  const sendNext = useCallback(() => {
    const next = pendingRef.current;
    if (!next || !mountedRef.current || timerRef.current !== null) return;
    sendRef.current(next, false);
  }, []);

  const send = useCallback(
    (entry: PendingSave, keepalive: boolean): void => {
      // Veralteter Timer (Stand inzwischen ersetzt/verworfen) -> nichts tun.
      if (pendingRef.current !== entry) return;
      // A4: Request laeuft noch -> nach dessen Ende kommt sendNext.
      if (inFlightRef.current) return;
      clearTimer();
      inFlightRef.current = entry;
      // A5: im Fehlerzustand bleibt der Status stehen, bis ein Save klappt.
      if (mountedRef.current) {
        setView((v) =>
          v.id === entry.id && (v.status === "error" || v.status === "failed")
            ? v
            : { id: entry.id, status: "saving", reason: null },
        );
      }
      const req = keepalive
        ? apiRef.current.putImageEdit(entry.id, entry.state, { keepalive: true })
        : apiRef.current.putImageEdit(entry.id, entry.state);
      req
        .then(() => {
          inFlightRef.current = null;
          attemptRef.current = 0;
          if (pendingRef.current === entry) pendingRef.current = null;
          if (!mountedRef.current) return;
          const done = pendingRef.current === null;
          setView({ id: entry.id, status: done ? "saved" : "saving", reason: null });
          sendNext();
        })
        .catch((err: unknown) => {
          inFlightRef.current = null;
          if (!mountedRef.current) return;
          // A2: Stand wurde ersetzt (neuere Aenderung oder anderes Bild) ->
          // kein Fehler fuer den aktuellen Stand, ggf. neuesten senden.
          if (pendingRef.current !== entry) {
            sendNext();
            return;
          }
          if (isPermanentSaveError(err)) {
            // A3: kein Retry — ein erneuter Versuch liefert denselben Fehler.
            pendingRef.current = null;
            setView({
              id: entry.id,
              status: "failed",
              reason: err instanceof Error ? err.message : null,
            });
            return;
          }
          setView((v) =>
            v.id === entry.id && v.status === "error"
              ? v
              : { id: entry.id, status: "error", reason: null },
          );
          const idx = Math.min(attemptRef.current, AUTOSAVE_RETRY_MS.length - 1);
          attemptRef.current += 1;
          clearTimer();
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            sendRef.current(entry, false);
          }, AUTOSAVE_RETRY_MS[idx]);
        });
    },
    [clearTimer, sendNext],
  );
  useLayoutEffect(() => {
    sendRef.current = send;
  }, [send]);

  /** Letzte Chance (pagehide, Unmount, Bildwechsel): keepalive senden und
   *  den Stand verwerfen — danach kann niemand mehr wiederholen. */
  const flush = useCallback(() => {
    const entry = pendingRef.current;
    if (!entry) return;
    clearTimer();
    pendingRef.current = null;
    // keepalive: Request ueberlebt das Entladen der Seite.
    void apiRef.current
      .putImageEdit(entry.id, entry.state, { keepalive: true })
      .catch(() => undefined);
  }, [clearTimer]);

  /** A1: Tab im Hintergrund — Seite lebt evtl. weiter. Stand bleibt
   *  ausstehend, bis der Request klappt; Fehler -> normaler Retry. */
  const flushSoft = useCallback(() => {
    const entry = pendingRef.current;
    if (!entry) return;
    // Laufender Request: danach sendet sendNext den neuesten Stand.
    if (inFlightRef.current) return;
    clearTimer();
    send(entry, true);
  }, [clearTimer, send]);

  useEffect(() => {
    if (!imageId || !state) {
      pendingRef.current = null;
      clearTimer();
      return;
    }
    const entry: PendingSave = { id: imageId, state };
    pendingRef.current = entry;
    attemptRef.current = 0;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      send(entry, false);
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [imageId, state, send, clearTimer]);

  useEffect(() => {
    mountedRef.current = true;
    const onPageHide = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushSoft();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      mountedRef.current = false;
      flush();
    };
  }, [flush, flushSoft]);

  const current = view.id !== null && view.id === imageId;
  return {
    status: current ? view.status : "idle",
    reason: current ? view.reason : null,
    flush,
  };
}

/** Dezenter Hinweis, wenn der Autosave fehlschlaegt. Live-Region bleibt
 *  gemountet, damit Screenreader die Text-Aenderung ansagen. Position:
 *  unten links ueber der Toolbar (--editor-toolbar-clearance), damit weder
 *  der mobile Regler-Toggle (oben rechts) noch die Kamera-Info verdeckt
 *  werden. */
export function AutosaveIndicator({
  status,
  reason = null,
}: {
  readonly status: AutosaveStatus;
  readonly reason?: string | null;
}) {
  const failed = status === "error" || status === "failed";
  const text =
    status === "failed"
      ? `Nicht gespeichert – ${reason ?? "Server hat den Stand abgelehnt"}`
      : status === "error"
        ? "Nicht gespeichert – erneuter Versuch …"
        : "";
  return (
    <div
      role="status"
      data-testid="autosave-status"
      className={
        failed
          ? "absolute left-2 sm:left-6 z-20 max-w-[calc(100%-1rem)] px-3 py-1.5 text-xs bg-red-950/90 border border-red-700 text-red-100 pointer-events-none"
          : "sr-only"
      }
      style={
        failed
          ? { bottom: "calc(var(--editor-toolbar-clearance, 4.5rem) + 0.5rem)" }
          : undefined
      }
    >
      {text}
    </div>
  );
}

export default function Editor() {
  usePageMeta(`Editor${TITLE_SUFFIX}`);
  const canvasHandleRef = useRef<CanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [hasImage, setHasImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [originalFilename, setOriginalFilename] = useState("lumen-export");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("jpeg");
  const [exportQuality, setExportQuality] = useState(0.92);
  const [exportWidth, setExportWidth] = useState<number | "native">("native");
  const [exporting, setExporting] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [cameraInfo, setCameraInfo] = useState<string | null>(null);
  // Auto-Start der Tour, wenn der User noch nie eine Entscheidung
  // getroffen hat. Lazy-init: kein Effect, kein Re-Render-Cascade.
  // `dismissed` und `completed` blocken die Tour; der User kann sie aber
  // im Account-Bereich wieder anwerfen.
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => getOnboardingState() === "none",
  );
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [aspect, setAspect] = useState<AspectRatio>("free");
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [loadedPresetId, setLoadedPresetId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [suggestedGenre, setSuggestedGenre] = useState<Genre | null>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [compareSnapshot, setCompareSnapshot] = useState<string | null>(null);
  const [splitX, setSplitX] = useState(0.5);
  const api = useApi();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panDragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  // Multi-Touch: aktive Pointer mit aktueller Position. Sobald Map.size==2,
  // wechselt Pan in Pinch-Zoom-Modus. pinchRef speichert Start-Distanz +
  // Anker, sodass das Bild „unter den Fingern" bleibt.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<
    | {
        baseDistance: number;
        baseZoom: number;
        anchorX: number; // Mittelpunkt der zwei Touches in Viewport-zentrierten Koordinaten
        anchorY: number;
        basePanX: number;
        basePanY: number;
      }
    | null
  >(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [wbPickerActive, setWbPickerActive] = useState(false);
  // C1: aus der Bibliothek geoeffnetes Bild (?image=<id>) -> Autosave-Ziel.
  const [searchParams, setSearchParams] = useSearchParams();
  // Nur UUIDs akzeptieren: der Wert landet in API-Pfaden (Path-Steering).
  const rawImageParam = searchParams.get("image");
  const storedImageIdParam =
    rawImageParam && UUID_RE.test(rawImageParam) ? rawImageParam : null;
  const [storedImageId, setStoredImageId] = useState<string | null>(null);
  // Laedt gerade ein Bild aus der Bibliothek (?image=) -> Ladeanzeige statt Dropzone.
  const [libraryLoading, setLibraryLoading] = useState(false);
  const loadedImageRef = useRef<string | null>(null);
  // M6: Lade-Generation — jeder neue Ladevorgang erhoeht sie; aeltere,
  // spaeter fertige Loads erkennen sich daran als veraltet.
  const loadGenRef = useRef(0);
  // L14: Canvas als Ref, damit async Callbacks nie einen veralteten
  // (null-)State aus einer frueheren Render-Closure sehen.
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const suggestionTimerRef = useRef<number | null>(null);

  const adjustments = useEditorStore((s) => s.adjustments);
  const setAdjustment = useEditorStore((s) => s.setAdjustment);
  const resetAll = useEditorStore((s) => s.resetAll);
  const setHslChannel = useEditorStore((s) => s.setHslChannel);
  const resetHsl = useEditorStore((s) => s.resetHsl);
  const setToneCurvePoint = useEditorStore((s) => s.setToneCurvePoint);
  const addToneCurvePoint = useEditorStore((s) => s.addToneCurvePoint);
  const removeToneCurvePoint = useEditorStore((s) => s.removeToneCurvePoint);
  const resetToneCurve = useEditorStore((s) => s.resetToneCurve);
  const setProcessVersion = useEditorStore((s) => s.setProcessVersion);
  const upgradeProcessVersion = useCallback(
    () => setProcessVersion(CURRENT_PROCESS_VERSION),
    [setProcessVersion],
  );
  const bypass = useEditorStore((s) => s.bypass);
  const setBypass = useEditorStore((s) => s.setBypass);
  const cropRect = useEditorStore((s) => s.cropRect);
  const setCropRect = useEditorStore((s) => s.setCropRect);
  const straightenAngle = useEditorStore((s) => s.straightenAngle);
  const setStraightenAngle = useEditorStore((s) => s.setStraightenAngle);
  const resetGeometry = useEditorStore((s) => s.resetGeometry);
  const lensCorrection = useEditorStore((s) => s.lensCorrection);
  const setLensCorrection = useEditorStore((s) => s.setLensCorrection);
  const lensProfileId = useEditorStore((s) => s.lensProfileId);
  const manualLensOverride = useEditorStore((s) => s.manualLensOverride);
  const setLensProfile = useEditorStore((s) => s.setLensProfile);

  const masks = useEditorStore((s) => s.masks);
  const selectedMaskId = useEditorStore((s) => s.selectedMaskId);
  const addLinearMask = useEditorStore((s) => s.addLinearMask);
  const addRadialMask = useEditorStore((s) => s.addRadialMask);
  const removeMask = useEditorStore((s) => s.removeMask);
  const selectMask = useEditorStore((s) => s.selectMask);
  const setLinearMaskPoint = useEditorStore((s) => s.setLinearMaskPoint);
  const setRadialMaskCenter = useEditorStore((s) => s.setRadialMaskCenter);
  const setRadialMaskRadii = useEditorStore((s) => s.setRadialMaskRadii);
  const setMaskFeather = useEditorStore((s) => s.setMaskFeather);
  const setMaskLocalAdjustment = useEditorStore((s) => s.setMaskLocalAdjustment);
  const removeSelectedMask = useEditorStore((s) => s.removeSelectedMask);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);

  const selected = useEditorStore(selectedMask);
  const linearCount = countByType(masks, "linear");
  const radialCount = countByType(masks, "radial");
  const canAddLinear = linearCount < MAX_LINEAR_MASKS;
  const canAddRadial = radialCount < MAX_RADIAL_MASKS;

  const imageAspect = imageDims ? imageDims.width / imageDims.height : 1;

  const onTick = useCallback(() => setTick((t) => t + 1), []);
  const onCanvasError = useCallback((msg: string) => setError(msg), []);
  // C1: nach webglcontextrestored nur den Kontextverlust-Hinweis entfernen,
  // andere Fehlermeldungen bleiben stehen.
  const onCanvasRecovered = useCallback(
    () => setError((e) => (e === CONTEXT_LOST_MESSAGE ? null : e)),
    [],
  );
  const onCanvasMount = useCallback((c: HTMLCanvasElement) => {
    canvasElementRef.current = c;
    setCanvasElement(c);
  }, []);

  const runSuggestion = useCallback(async (focal: number | null, gen: number): Promise<void> => {
    const c = canvasElementRef.current;
    if (!c || gen !== loadGenRef.current) return;
    const stats = analyze(c);
    if (!stats) return;
    // Face-Detection laeuft async und langsamer (lazy-load + Inference)
    // — schicken wir parallel los und warten kurz, bevor wir die
    // Heuristik kombinieren. Bei jedem Fehler liefert detectFacesSafe
    // eine leere Liste, sodass die Suggestion nicht blockiert.
    const faces = await detectFacesSafe(c);
    // Inzwischen anderes Bild geladen -> Vorschlag waere fuers falsche Bild.
    if (gen !== loadGenRef.current) return;
    const genre = suggestGenre({
      focalLen: focal,
      meanR: stats.meanR,
      meanG: stats.meanG,
      meanB: stats.meanB,
      p500: stats.p500,
      faceCount: faces.length,
    });
    if (genre) setSuggestedGenre(genre);
  }, []);

  const clearSuggestionTimer = useCallback(() => {
    if (suggestionTimerRef.current !== null) {
      window.clearTimeout(suggestionTimerRef.current);
      suggestionTimerRef.current = null;
    }
  }, []);

  // Smart-Preset-Suggestion einen Render-Tick nach dem Laden (Canvas muss
  // das neue Bild zeigen). Timer wird bei Bildwechsel/Unmount gecancelt.
  const scheduleSuggestion = useCallback(
    (focal: number | null, gen: number) => {
      clearSuggestionTimer();
      suggestionTimerRef.current = window.setTimeout(() => {
        suggestionTimerRef.current = null;
        void runSuggestion(focal, gen);
      }, 100);
    },
    [clearSuggestionTimer, runSuggestion],
  );

  // C1: Autosave-Ziel + Stand. editState ist memoisiert, damit der
  // Debounce nur bei echten Aenderungen neu startet.
  const editState = useMemo<ImageEditState | null>(
    () =>
      hasImage
        ? {
            adjustments,
            masks: masksToWire(masks),
            crop: cropRect,
            straightenAngle,
            lensCorrection,
            lensProfileId,
            manualLensOverride,
          }
        : null,
    [
      hasImage,
      adjustments,
      masks,
      cropRect,
      straightenAngle,
      lensCorrection,
      lensProfileId,
      manualLensOverride,
    ],
  );
  const autosave = useEditAutosave(api, storedImageId, editState);
  const flushAutosave = autosave.flush;

  /** Startet einen neuen Ladevorgang: neue Generation, ausstehenden
   *  Autosave des alten Bildes sichern, Autosave-Ziel loesen, Store und
   *  UI-Zustand komplett zuruecksetzen (H3: Bild B erbt nichts von A). */
  const beginLoad = useCallback(
    (filename: string): number => {
      const gen = ++loadGenRef.current;
      flushAutosave();
      setStoredImageId(null);
      clearSuggestionTimer();
      useEditorStore.getState().resetForNewImage();
      setError(null);
      setOriginalFilename(filename);
      setCameraInfo(null);
      setImageDims(null);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setWbPickerActive(false);
      setCropMode(false);
      setLoadedPresetId(null);
      setSuggestedGenre(null);
      setSuggestionDismissed(false);
      setCompareSnapshot(null);
      // E1: ein abgeloester Bibliotheks-Load setzt das Flag nicht mehr zurueck.
      setLibraryLoading(false);
      return gen;
    },
    [flushAutosave, clearSuggestionTimer],
  );

  /** Dekodiert die Datei und laedt sie ins Canvas. Liefert true, wenn das
   *  Bild geladen wurde UND dieser Load noch der aktuelle ist. */
  const loadIntoCanvas = useCallback(
    async (file: File, gen: number): Promise<boolean> => {
      const isCurrent = () => gen === loadGenRef.current;
      try {
        const isRaw = await isRawFile(file);
        if (!isCurrent()) return false;
        if (isRaw) {
          setDecoding(true);
          const decoded = await decodeRaw(file);
          if (!isCurrent()) return false;
          const bitmap = await rgbToImageBitmap(decoded.rgb, decoded.width, decoded.height);
          if (!isCurrent()) {
            bitmap.close();
            return false;
          }
          const handle = canvasHandleRef.current;
          if (!handle) {
            bitmap.close();
            throw new Error("Renderer nicht initialisiert");
          }
          handle.loadBitmap(bitmap, decoded.width, decoded.height);
          setImageDims({ width: decoded.width, height: decoded.height });
          if (decoded.cameraMake || decoded.cameraModel) {
            setCameraInfo(
              [decoded.cameraMake, decoded.cameraModel].filter(Boolean).join(" "),
            );
          }

          // Lens-Profil-Auto-Detection: matches setzen die Slider und
          // markieren das Profil als 'auto'.
          const lookup = findLensProfile(
            decoded.cameraMake,
            decoded.cameraModel,
            decoded.focalLen,
          );
          if (lookup.profile) {
            setLensCorrection(profileToCorrection(lookup.profile), "auto");
            setLensProfile(lookup.profile.id);
          }

          // Smart-Preset-Suggestion fuer RAW-Bilder: nutzt EXIF-Brennweite
          // + Histogramm-Mittelwerte.
          scheduleSuggestion(decoded.focalLen, gen);
        } else {
          // loadFile liefert die Dimensionen direkt zurueck — kein Auslesen des
          // (beim Auto-Load evtl. noch nicht gemounteten) canvasElement-State (L4).
          const dims = await canvasHandleRef.current?.loadFile(file, isCurrent);
          if (!isCurrent()) return false;
          if (dims) setImageDims(dims);
          // JPEG/PNG-Pfad: keine EXIF-Brennweite, aber Face-Detection kann
          // Portraits trotzdem erkennen.
          scheduleSuggestion(null, gen);
        }
        setHasImage(true);
        return true;
      } catch (err) {
        if (isCurrent()) {
          setError(err instanceof Error ? err.message : "Bild konnte nicht geladen werden");
        }
        return false;
      } finally {
        if (isCurrent()) setDecoding(false);
      }
    },
    [setLensCorrection, setLensProfile, scheduleSuggestion],
  );

  /** Lokale Datei oeffnen (Picker, Drop, Beispielbild). H2: loest das
   *  Autosave-Ziel und entfernt ?image, sonst wuerde der Stand der lokalen
   *  Datei den gespeicherten Stand des Bibliotheksbildes ueberschreiben. */
  const onFile = useCallback(
    async (file: File): Promise<void> => {
      const gen = beginLoad(file.name);
      setSearchParams(
        (prev) => {
          if (!prev.has("image")) return prev;
          const next = new URLSearchParams(prev);
          next.delete("image");
          return next;
        },
        { replace: true },
      );
      await loadIntoCanvas(file, gen);
    },
    [beginLoad, loadIntoCanvas, setSearchParams],
  );

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void onFile(file);
    event.target.value = "";
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void onFile(file);
  };

  const triggerFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const triggerExport = useCallback(() => {
    if (hasImage) setExportOpen(true);
  }, [hasImage]);

  const doExport = async () => {
    setExporting(true);
    let full: FullResExport | null = null;
    try {
      // C2: Voll-Aufloesungs-Export — das Original wird offscreen durch die
      // Pipeline gerendert (Live-Vorschau bleibt gedeckelt). Fallback auf die
      // Live-Canvas, falls kein WebGL-Export-Context verfuegbar ist (jsdom/Tests).
      // Im try: ein Render-Fehler landet als Meldung statt als unhandled rejection.
      full = canvasHandleRef.current?.exportFullResCanvas?.() ?? null;
      const source = full?.canvas ?? canvasElement;
      if (!source) return;
      // M10: Quelle ueberschreitet die GPU-Grenzen -> verkleinert exportiert.
      // Nur melden, wenn der User mehr Pixel wollte, als jetzt herauskommen.
      if (
        full?.downscaledFrom &&
        (exportWidth === "native" || exportWidth > full.canvas.width)
      ) {
        setError(
          `Export auf ${full.canvas.width} × ${full.canvas.height} px verkleinert – die Grafikkarte dieses Geräts unterstützt keine größere Ausgabe.`,
        );
      }
      const blob = await exportCanvas(source, {
        format: exportFormat,
        quality: exportQuality,
        width: exportWidth === "native" ? undefined : exportWidth,
      });
      downloadBlob(blob, suggestFilename(originalFilename, exportFormat));
      setExportOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export fehlgeschlagen");
    } finally {
      full?.dispose();
      setExporting(false);
    }
  };

  const toggleCropMode = useCallback(() => {
    if (hasImage) setCropMode((m) => !m);
  }, [hasImage]);

  const togglePresetDialog = useCallback(() => {
    if (hasImage) setPresetDialogOpen((v) => !v);
  }, [hasImage]);

  const onApplySuggestion = useCallback(async (genre: Genre) => {
    setSuggestedGenre(null);
    setSuggestionDismissed(true);
    try {
      const list = await api.listPresets();
      const preset = list.find((p) => p.name === genre);
      if (!preset) {
        // Das nach Genre benannte Default-Preset existiert nicht mehr (vom
        // User umbenannt/geloescht). Statt stillem No-op den User informieren.
        setError(
          `Vorgeschlagenes Preset „${genre}" nicht gefunden — vermutlich umbenannt oder gelöscht.`,
        );
        return;
      }
      useEditorStore.getState().applyAdjustments(preset.adjustments);
      setLoadedPresetId(preset.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preset-Vorschlag laden fehlgeschlagen");
    }
  }, [api]);

  const onToggleCompare = useCallback(() => {
    if (compareSnapshot) {
      setCompareSnapshot(null);
      return;
    }
    // Kein Snapshot ohne fertig dekodiertes Bild — sonst erwischt der
    // Bypass-Snapshot ein leeres Canvas (Race beim schnellen Klick waehrend
    // des Decodings).
    if (!hasImage || decoding) return;
    const url = canvasHandleRef.current?.takeBypassSnapshot?.();
    if (url) {
      setCompareSnapshot(url);
      setSplitX(0.5);
    }
  }, [compareSnapshot, hasImage, decoding]);

  const onAutoTone = useCallback(() => {
    if (!canvasElement) return;
    const stats = analyze(canvasElement);
    if (!stats) return;
    const cur = useEditorStore.getState().adjustments;
    const delta = computeAutoTone(stats, cur);
    useEditorStore.getState().applyAdjustments({ ...cur, ...delta });
  }, [canvasElement]);

  const onAutoWb = useCallback(() => {
    if (!canvasElement) return;
    const stats = analyze(canvasElement);
    if (!stats) return;
    const cur = useEditorStore.getState().adjustments;
    const delta = computeAutoWb(stats, cur);
    useEditorStore.getState().applyAdjustments({ ...cur, ...delta });
  }, [canvasElement]);

  const onAutoStraighten = useCallback(() => {
    if (!canvasElement) return;
    const result = analyzeCanvasStraightenAngle(canvasElement);
    if (!result) return;
    // Confidence-Schwelle vermeidet Noise-Snaps bei abstrakten Bildern.
    if (result.confidence < 0.15) return;
    // Analysiert wird die bereits gedrehte Vorschau -> Ergebnis ist die
    // Rest-Neigung und wird zum aktuellen Winkel addiert (sonst toggelt
    // wiederholtes Klicken zwischen zwei Werten).
    const current = useEditorStore.getState().straightenAngle;
    setStraightenAngle(current + result.angleRad);
  }, [canvasElement, setStraightenAngle]);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLElement>) => {
      if (!hasImage) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const next = Math.max(0.1, Math.min(10, zoom * factor));
      // Anker am Mauszeiger: pan so anpassen, dass der Punkt unter dem
      // Cursor an seiner Stelle bleibt.
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) {
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const ratio = next / zoom;
        setPan({
          x: cx - (cx - pan.x) * ratio,
          y: cy - (cy - pan.y) * ratio,
        });
      }
      setZoom(next);
    },
    [hasImage, zoom, pan],
  );

  const onViewportPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!hasImage) return;
      if (cropMode) return;
      if (wbPickerActive) return;
      // Buttons / Inputs / Selects: keine Pan-Aktion (Klick darf
      // weiterlaufen). Mask-Handles haben bereits stopPropagation.
      const target = e.target as HTMLElement | null;
      if (target?.closest("button, input, select, textarea, label, a")) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* jsdom */
      }
      // Bei zwei Pointern: Pinch-Modus. Pan abbrechen.
      if (pointersRef.current.size === 2) {
        const [a, b] = Array.from(pointersRef.current.values());
        if (!a || !b) return;
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const cx = (a.x + b.x) / 2 - rect.left - rect.width / 2;
        const cy = (a.y + b.y) / 2 - rect.top - rect.height / 2;
        pinchRef.current = {
          baseDistance: Math.max(1, Math.hypot(dx, dy)),
          baseZoom: zoom,
          anchorX: cx,
          anchorY: cy,
          basePanX: pan.x,
          basePanY: pan.y,
        };
        panDragRef.current = null;
        setIsPanning(false);
        return;
      }
      // Erster Pointer: Pan starten.
      panDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      setIsPanning(true);
    },
    [hasImage, cropMode, wbPickerActive, pan, zoom],
  );

  const onViewportPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Pointer-Position in der Map updaten (auch wenn nicht im Capture).
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      const pinch = pinchRef.current;
      if (pinch && pointersRef.current.size >= 2) {
        const [a, b] = Array.from(pointersRef.current.values());
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const ratio = dist / pinch.baseDistance;
        const next = Math.max(0.1, Math.min(10, pinch.baseZoom * ratio));
        const r = next / pinch.baseZoom;
        // Anker-Logik analog zum Wheel-Zoom: der Punkt unter dem
        // Pinch-Mittelpunkt soll an seiner Stelle bleiben.
        setPan({
          x: pinch.anchorX - (pinch.anchorX - pinch.basePanX) * r,
          y: pinch.anchorY - (pinch.anchorY - pinch.basePanY) * r,
        });
        setZoom(next);
        return;
      }
      const drag = panDragRef.current;
      if (!drag) return;
      setPan({
        x: drag.panX + (e.clientX - drag.startX),
        y: drag.panY + (e.clientY - drag.startY),
      });
    },
    [],
  );

  const onViewportPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(e.pointerId);
      // Wenn Pinch-Modus laeuft und jetzt < 2 Pointer: Pinch beenden.
      if (pinchRef.current && pointersRef.current.size < 2) {
        pinchRef.current = null;
      }
      // Wenn jetzt noch genau 1 Pointer aktiv ist: Pan-Drag wieder
      // aufgreifen (User loest einen von zwei Fingern).
      if (pointersRef.current.size === 1 && !panDragRef.current) {
        const [remaining] = Array.from(pointersRef.current.values());
        if (remaining) {
          panDragRef.current = {
            startX: remaining.x,
            startY: remaining.y,
            panX: pan.x,
            panY: pan.y,
          };
          setIsPanning(true);
        }
      }
      if (pointersRef.current.size === 0) {
        panDragRef.current = null;
        setIsPanning(false);
      }
    },
    [pan],
  );

  // E4: Pan per Tastatur (Shift+Pfeil) bei fokussierter Bildansicht.
  // Overlay-Handles stoppen ihre eigenen Pfeil-Nudges per stopPropagation.
  const onViewportKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (!hasImage || !e.shiftKey || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || t.closest('input, select, textarea, [role="slider"]'))
      ) {
        return;
      }
      let dx = 0;
      let dy = 0;
      if (e.key === "ArrowLeft") dx = -KEYBOARD_PAN_STEP;
      else if (e.key === "ArrowRight") dx = KEYBOARD_PAN_STEP;
      else if (e.key === "ArrowUp") dy = -KEYBOARD_PAN_STEP;
      else if (e.key === "ArrowDown") dy = KEYBOARD_PAN_STEP;
      else return;
      e.preventDefault();
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    },
    [hasImage],
  );

  const onCanvasClickForWb = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!wbPickerActive || !canvasElement) return;
      const rect = canvasElement.getBoundingClientRect();
      const xs = (e.clientX - rect.left) / rect.width;
      const ys = (e.clientY - rect.top) / rect.height;
      if (xs < 0 || xs > 1 || ys < 0 || ys > 1) return;
      const px = Math.max(0, Math.min(canvasElement.width - 1, Math.floor(xs * canvasElement.width)));
      const py = Math.max(0, Math.min(canvasElement.height - 1, Math.floor(ys * canvasElement.height)));
      try {
        const off = new OffscreenCanvas(1, 1);
        const ctx = off.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(canvasElement, px, py, 1, 1, 0, 0, 1, 1);
        const data = ctx.getImageData(0, 0, 1, 1).data;
        const r = data[0]! / 255;
        const g = data[1]! / 255;
        const b = data[2]! / 255;
        // Korrektur in zwei Schritten:
        //   ΔtempK = (B - R) / (B + R)  (gleicht R/B aus)
        //   ΔtintK = ((R+B)/2 / G) - 1  (gleicht G gegen mean an)
        // Werte werden zu den aktuellen Slidern addiert und geklemmt.
        const sumRb = Math.max(0.001, r + b);
        const dTempK = (b - r) / sumRb;
        const rEff = r * (1 + dTempK);
        const bEff = b * (1 - dTempK);
        const meanRb = (rEff + bEff) / 2;
        const dTintK = meanRb / Math.max(0.001, g) - 1;
        const dTempSlider = dTempK / 0.4;
        const dTintSlider = dTintK / 0.3;
        const cur = useEditorStore.getState().adjustments;
        useEditorStore.getState().setAdjustment("temperature", cur.temperature + dTempSlider);
        useEditorStore.getState().setAdjustment("tint", cur.tint + dTintSlider);
      } catch {
        /* readback failed — no-op */
      }
      setWbPickerActive(false);
    },
    [wbPickerActive, canvasElement],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      if (!hasImage) return;
      const next = Math.max(0.1, Math.min(10, zoom * factor));
      const ratio = next / zoom;
      // Zoom um die Viewport-Mitte: Pan proportional mitskalieren.
      setPan((p) => ({ x: p.x * ratio, y: p.y * ratio }));
      setZoom(next);
    },
    [hasImage, zoom],
  );

  // Hook haelt die Callbacks per Ref -> neues Objekt-Literal pro Render ist ok.
  useKeyboardShortcuts({
    onResetAll: resetAll,
    onExport: triggerExport,
    onOpenFile: triggerFileDialog,
    onToggleCrop: toggleCropMode,
    onTogglePresets: togglePresetDialog,
    onShowHelp: () => setHelpOpen(true),
    onUndo: undo,
    onRedo: redo,
    setBypass,
    onEscape: () => {
      if (wbPickerActive) setWbPickerActive(false);
      else if (cropMode) setCropMode(false);
    },
    onZoomIn: () => zoomBy(1.25),
    onZoomOut: () => zoomBy(1 / 1.25),
  });

  // L14/M6: beim Unmount laufende Loads entwerten + Suggestion-Timer stoppen.
  // loadedImageRef zuruecksetzen, damit ein StrictMode-Remount neu laedt.
  useEffect(
    () => () => {
      loadGenRef.current += 1;
      loadedImageRef.current = null;
      clearSuggestionTimer();
    },
    [clearSuggestionTimer],
  );

  // UI-15: lokal geoeffnetes (nicht gespeichertes) Bild vor versehentlichem
  // Schliessen/Neuladen schuetzen. Die App nutzt BrowserRouter (kein Data
  // Router) -> useBlocker fuer In-App-Navigation ist nicht verfuegbar.
  useEffect(() => {
    if (!hasImage || storedImageId) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy-Browser brauchen returnValue fuer den Bestaetigungsdialog.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasImage, storedImageId]);

  // E3: In-App-Navigation (Header, Toolbar-Link "Marketplace") wuerde das
  // lokale Bild ebenfalls verwerfen. Ohne Data Router (useBlocker) fangen
  // wir Klicks auf interne Links in der Capture-Phase ab — vor dem
  // onClick von <Link> — und fragen per Dialog nach.
  const navigate = useNavigate();
  const { pathname: currentPath } = useLocation();
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const navGuardActive = hasImage && !storedImageId;
  useEffect(() => {
    if (!navGuardActive) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!(e.target instanceof Element)) return;
      const a = e.target.closest<HTMLAnchorElement>('a[href^="/"]');
      if (!a) return;
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download")) return;
      const href = a.getAttribute("href") ?? "";
      // "//host/..." ist protokoll-relativ = extern.
      if (href.startsWith("//")) return;
      const url = new URL(href, window.location.origin);
      // Link auf den Editor selbst: Komponente bleibt gemountet.
      if (url.pathname === currentPath) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingNav(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [navGuardActive, currentPath]);
  const cancelPendingNav = useCallback(() => setPendingNav(null), []);
  const confirmPendingNav = useCallback(() => {
    if (pendingNav === null) return;
    setPendingNav(null);
    void navigate(pendingNav);
  }, [navigate, pendingNav]);

  // E2: Hoehe = sichtbarer Viewport (100dvh, mobil ohne Browser-Leisten)
  // minus tatsaechlicher Oberkante (Header-Hoehe variiert, z.B. Umbruch).
  // Direkt am DOM gesetzt: kein setState im Effect, kein Re-Render.
  const sectionRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const update = () => {
      const top = Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY));
      el.style.setProperty("--editor-top", `${top}px`);
    };
    update();
    window.addEventListener("resize", update);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    const header = el.parentElement?.previousElementSibling;
    if (ro && header) ro.observe(header);
    return () => {
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, []);

  // A6: Abstand Unterkante -> Oberkante der Toolbar (sie bricht mobil um),
  // damit der Autosave-Hinweis darueber sitzt statt sie zu verdecken.
  const toolbarSlotRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const main = viewportRef.current;
    const toolbar = toolbarSlotRef.current?.firstElementChild;
    if (!main || !(toolbar instanceof HTMLElement)) return;
    const update = () => {
      const clearance = Math.max(0, main.clientHeight - toolbar.offsetTop);
      main.style.setProperty("--editor-toolbar-clearance", `${clearance}px`);
    };
    update();
    window.addEventListener("resize", update);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(toolbar);
    ro?.observe(main);
    return () => {
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, [hasImage]);

  // C1: Bild aus der Bibliothek laden und gespeicherten Stand anwenden.
  // Jeder Schritt prueft die Lade-Generation (M6) — ein inzwischen
  // gestarteter anderer Load gewinnt.
  const loadFromLibrary = useCallback(
    async (id: string): Promise<void> => {
      // Erst nach einem Tick: alle setState-Calls laufen async (kein
      // set-state-in-effect im aufrufenden Effect).
      await Promise.resolve();
      const gen = beginLoad("lumen-export");
      const isCurrent = () => gen === loadGenRef.current;
      setLibraryLoading(true);
      try {
        const meta = (await api.listImages("all")).find((i) => i.id === id);
        if (!isCurrent()) return;
        if (!meta) throw new Error("Bild nicht gefunden");
        setOriginalFilename(meta.originalFilename);
        const { url } = await api.getImageUrl(id);
        if (!isCurrent()) return;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error("Bild konnte nicht geladen werden");
        const blob = await resp.blob();
        if (!isCurrent()) return;
        const file = new File([blob], meta.originalFilename, {
          type: meta.contentType || blob.type,
        });
        const loaded = await loadIntoCanvas(file, gen);
        if (!loaded || !isCurrent()) return;
        // Gespeicherten Stand wiederherstellen (Multi-Device-Resume); 404 -> null.
        // null = frischer Start: Store ist seit beginLoad bereits zurueckgesetzt.
        const edit = await api.getImageEdit(id);
        if (!isCurrent()) return;
        if (edit) {
          useEditorStore.getState().applyEditState({
            adjustments: edit.adjustments,
            masks: wireToMasks(edit.masks),
            cropRect: edit.crop ?? defaultCropRect(),
            straightenAngle: edit.straightenAngle,
            lensCorrection: edit.lensCorrection ?? defaultLensCorrection(),
            lensProfileId: edit.lensProfileId,
            manualLensOverride: edit.manualLensOverride,
          });
        }
        setStoredImageId(id);
      } catch (err) {
        if (!isCurrent()) return;
        setError(
          err instanceof Error ? err.message : "Bild konnte nicht geladen werden",
        );
      } finally {
        if (isCurrent()) setLibraryLoading(false);
      }
    },
    [api, beginLoad, loadIntoCanvas],
  );

  // Ref-Guard laedt jedes Bild nur einmal. Ohne ?image wird der Guard
  // geloest, damit ein spaeteres Wieder-Oeffnen desselben Bildes laedt.
  useEffect(() => {
    const id = storedImageIdParam;
    if (!id) {
      loadedImageRef.current = null;
      return;
    }
    if (loadedImageRef.current === id) return;
    loadedImageRef.current = id;
    void loadFromLibrary(id);
  }, [storedImageIdParam, loadFromLibrary]);

  const selectedLinear: LinearMaskInstance | null =
    selected && selected.type === "linear" ? selected : null;
  const selectedRadial: RadialMaskInstance | null =
    selected && selected.type === "radial" ? selected : null;

  return (
    <section
      ref={sectionRef}
      data-testid="page-editor"
      className="flex overflow-hidden"
      style={{ height: "calc(100dvh - var(--editor-top, 3rem))" }}
    >
      <main
        ref={viewportRef}
        aria-label="Bildansicht"
        tabIndex={hasImage ? 0 : undefined}
        onKeyDown={onViewportKeyDown}
        className="flex-1 min-w-0 min-h-0 relative flex items-center justify-center bg-stone-950 overflow-hidden p-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300"
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onWheel={onWheel}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        onPointerCancel={onViewportPointerUp}
        onClick={onCanvasClickForWb}
        style={{
          cursor: wbPickerActive
            ? "crosshair"
            : isPanning
              ? "grabbing"
              : hasImage && !cropMode
                ? "grab"
                : "default",
          // Browser-Default-Touch-Gesten (Scroll, Pinch-zoom-Page) aus —
          // wir uebernehmen Pinch + Pan selbst via Pointer-Events.
          touchAction: hasImage ? "none" : "auto",
        }}
      >
        <EditorOverlayCanvas
          canvasHandleRef={canvasHandleRef}
          onTick={onTick}
          onError={onCanvasError}
          onRecovered={onCanvasRecovered}
          onCanvasMount={onCanvasMount}
          pan={pan}
          zoom={zoom}
          isPanning={isPanning}
          hasImage={hasImage}
          cropMode={cropMode}
          cropRect={cropRect}
          aspect={aspect}
          imageAspect={imageAspect}
          onCropChange={setCropRect}
          selectedLinear={selectedLinear}
          selectedRadial={selectedRadial}
          onLinearMaskPoint={setLinearMaskPoint}
          onRadialMaskCenter={setRadialMaskCenter}
          onRadialMaskRadii={setRadialMaskRadii}
          compareSnapshot={compareSnapshot}
          splitX={splitX}
          onSplitChange={setSplitX}
          straightenAngle={straightenAngle}
        />

        <input
          ref={fileInputRef}
          data-testid="editor-file-input"
          type="file"
          accept={FILE_PICKER_ACCEPT}
          className="hidden"
          onChange={onPick}
        />

        {!hasImage && !error && libraryLoading && (
          <div
            role="status"
            data-testid="editor-library-loading"
            className="absolute inset-8 flex items-center justify-center text-stone-400 text-lg"
          >
            Bild wird geladen …
          </div>
        )}

        {!hasImage && !error && !libraryLoading && (
          <div className="absolute inset-8 flex flex-col items-center justify-center text-stone-500 pointer-events-none gap-4 border-2 border-dashed border-stone-800 rounded-lg">
            <svg
              className="w-12 h-12 text-stone-700"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="text-xl">Bild hierhin ziehen</span>
            <div className="flex gap-3 pointer-events-auto">
              <button
                type="button"
                data-testid="editor-load-sample"
                onClick={() => {
                  void (async () => {
                    try {
                      const resp = await fetch("/sample.jpg");
                      if (!resp.ok) throw new Error("Sample-Bild nicht erreichbar");
                      const blob = await resp.blob();
                      const file = new File([blob], "sample.jpg", { type: "image/jpeg" });
                      await onFile(file);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Sample-Load fehlgeschlagen");
                    }
                  })();
                }}
                className="px-4 py-2 text-xs uppercase tracking-[0.2em] bg-amber-200/15 border border-amber-300 text-amber-200 hover:bg-amber-200/25"
              >
                Beispielbild laden
              </button>
              <button
                type="button"
                onClick={triggerFileDialog}
                className="px-4 py-2 text-xs uppercase tracking-[0.2em] border border-stone-700 text-stone-300 hover:border-amber-300/40"
              >
                Datei wählen
              </button>
            </div>
          </div>
        )}

        {storedImageId && (
          <AutosaveIndicator status={autosave.status} reason={autosave.reason} />
        )}

        <EditorBanners
          error={error}
          onErrorDismiss={() => setError(null)}
          decoding={decoding}
          cameraInfo={cameraInfo}
          suggestedGenre={suggestedGenre}
          suggestionDismissed={suggestionDismissed}
          onApplySuggestion={(g) => void onApplySuggestion(g)}
          onDismissSuggestion={() => setSuggestionDismissed(true)}
        />

        {/* display:contents — Toolbar bleibt relativ zu <main> positioniert,
            der Slot dient nur zum Messen (A6). */}
        <div ref={toolbarSlotRef} className="contents">
        {hasImage && (
          <EditorToolbar
            bypass={bypass}
            onBypassDown={() => setBypass(true)}
            onBypassUp={() => setBypass(false)}
            cropMode={cropMode}
            onToggleCrop={toggleCropMode}
            onAutoTone={onAutoTone}
            onAutoWb={onAutoWb}
            compareActive={compareSnapshot !== null}
            onToggleCompare={onToggleCompare}
            wbPickerActive={wbPickerActive}
            onToggleWbPicker={() => setWbPickerActive((v) => !v)}
            zoom={zoom}
            canResetView={!(zoom === 1 && pan.x === 0 && pan.y === 0)}
            onResetView={resetView}
            canUndo={canUndo}
            onUndo={undo}
            canRedo={canRedo}
            onRedo={redo}
            canAddLinear={canAddLinear}
            onAddLinear={() => addLinearMask()}
            canAddRadial={canAddRadial}
            onAddRadial={() => addRadialMask()}
            onShowHelp={() => setHelpOpen(true)}
            onShowPresets={() => setPresetDialogOpen(true)}
            onExport={triggerExport}
          />
        )}
        </div>

        {presetDialogOpen && (
          <PresetDialog
            open={presetDialogOpen}
            onClose={() => setPresetDialogOpen(false)}
            loadedPresetId={loadedPresetId}
            onLoadedPresetIdChange={setLoadedPresetId}
          />
        )}

        <ShortcutCheatsheet open={helpOpen} onClose={() => setHelpOpen(false)} />

        {exportOpen && (
          <ExportDialog
            canvasWidth={imageDims?.width ?? canvasElement?.width ?? 0}
            format={exportFormat}
            onFormatChange={setExportFormat}
            quality={exportQuality}
            onQualityChange={setExportQuality}
            width={exportWidth}
            onWidthChange={setExportWidth}
            exporting={exporting}
            onConfirm={() => void doExport()}
            onCancel={() => setExportOpen(false)}
          />
        )}
      </main>

      <EditorSidebar
        canvasElement={canvasElement}
        tick={tick}
        aspect={aspect}
        onAspectChange={setAspect}
        straightenAngle={straightenAngle}
        onStraightenChange={setStraightenAngle}
        onAutoStraighten={onAutoStraighten}
        onResetGeometry={resetGeometry}
        masks={masks}
        selectedMaskId={selectedMaskId}
        selected={selected}
        onSelectMask={selectMask}
        onRemoveMask={removeMask}
        onLocalAdjust={setMaskLocalAdjustment}
        onMaskFeather={setMaskFeather}
        onRemoveSelectedMask={removeSelectedMask}
        lensCorrection={lensCorrection}
        lensProfileId={lensProfileId}
        manualLensOverride={manualLensOverride}
        onLensCorrectionChange={setLensCorrection}
        adjustments={adjustments}
        onAdjustment={setAdjustment}
        onHslChange={setHslChannel}
        onHslReset={resetHsl}
        onToneCurveSetPoint={setToneCurvePoint}
        onToneCurveAddPoint={addToneCurvePoint}
        onToneCurveRemovePoint={removeToneCurvePoint}
        onToneCurveReset={resetToneCurve}
        onUpgradeProcessVersion={upgradeProcessVersion}
        onResetAll={resetAll}
      />

      {onboardingOpen && (
        <OnboardingTour onClose={() => setOnboardingOpen(false)} />
      )}

      {pendingNav !== null && (
        <Modal
          onClose={cancelPendingNav}
          labelledBy="editor-discard-title"
          testId="editor-discard-backdrop"
          cardTestId="editor-discard-dialog"
          cardClassName="w-full max-w-sm bg-stone-900 border border-stone-700 text-sm p-5 outline-none"
        >
          <h2 id="editor-discard-title" className="text-base text-stone-100 mb-2">
            Ungespeichertes Bild verwerfen?
          </h2>
          <p className="text-stone-400 mb-5">
            Das Bild ist nur lokal geöffnet und nicht in deiner Bibliothek gespeichert.
            Beim Verlassen gehen Bild und Bearbeitung verloren.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              data-testid="editor-discard-cancel"
              onClick={cancelPendingNav}
              className="px-4 py-2 text-xs uppercase tracking-[0.2em] border border-stone-700 text-stone-300 hover:border-amber-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              Abbrechen
            </button>
            <button
              type="button"
              data-testid="editor-discard-confirm"
              onClick={confirmPendingNav}
              className="px-4 py-2 text-xs uppercase tracking-[0.2em] bg-red-950/60 border border-red-700 text-red-100 hover:bg-red-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              Verwerfen
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
