/**
 * H1: Prozessversion — Defaults, Parser, Merge, Store/Undo, Upgrade-Button.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Adjustments as WireAdjustments, ImageEditState } from "../src/api/client";
import {
  ADJUSTMENTS,
  CURRENT_PROCESS_VERSION,
  defaultAdjustments,
  normalizeProcessVersion,
} from "../src/editor/adjustments";
import EditorSidebar from "../src/editor/EditorSidebar";
import { defaultLensCorrection } from "../src/editor/lens";
import { mergeGroups } from "../src/editor/profileGroups";
import { parseProfileYaml, serializeProfileYaml } from "../src/editor/profileYaml";
import { useEditorStore } from "../src/editor/store";
import { defaultCropRect } from "../src/editor/transform";

/** Wire-Adjustments wie vor H1 gespeichert (ohne processVersion). */
function legacyAdjustments(over: Partial<WireAdjustments> = {}): Partial<WireAdjustments> {
  const { processVersion: _drop, ...rest } = defaultAdjustments();
  void _drop;
  return { ...rest, ...over };
}

function edit(adjustments: WireAdjustments): ImageEditState {
  return {
    adjustments,
    masks: [],
    crop: null,
    straightenAngle: 0,
    lensCorrection: null,
    lensProfileId: null,
    manualLensOverride: false,
  };
}

function resetStore(): void {
  useEditorStore.getState().resetForNewImage();
}

describe("Prozessversion · Defaults und Normalisierung", () => {
  it("defaultAdjustments liefert Version 2", () => {
    expect(defaultAdjustments().processVersion).toBe(2);
    expect(CURRENT_PROCESS_VERSION).toBe(2);
  });

  it("processVersion ist kein Slider", () => {
    expect(ADJUSTMENTS.map((a) => a.key as string)).not.toContain("processVersion");
  });

  it("fehlender oder unbekannter Wert wird zu 1", () => {
    expect(normalizeProcessVersion(undefined)).toBe(1);
    expect(normalizeProcessVersion(null)).toBe(1);
    expect(normalizeProcessVersion(3)).toBe(1);
    expect(normalizeProcessVersion("2")).toBe(1);
    expect(normalizeProcessVersion(1)).toBe(1);
    expect(normalizeProcessVersion(2)).toBe(2);
  });
});

describe("Prozessversion · Store", () => {
  beforeEach(resetStore);

  it("neues Bild und Alles-Zuruecksetzen starten auf Version 2", () => {
    expect(useEditorStore.getState().adjustments.processVersion).toBe(2);
    useEditorStore.setState({ adjustments: { ...defaultAdjustments(), processVersion: 1 } });
    useEditorStore.getState().resetAll();
    expect(useEditorStore.getState().adjustments.processVersion).toBe(2);
  });

  it("gespeicherter Edit-State ohne Feld laedt als Version 1", () => {
    useEditorStore.getState().applyEditState({
      adjustments: legacyAdjustments({ exposure: 0.4 }),
      masks: [],
      cropRect: defaultCropRect(),
      straightenAngle: 0,
      lensCorrection: defaultLensCorrection(),
      lensProfileId: null,
      manualLensOverride: false,
    });
    const adj = useEditorStore.getState().adjustments;
    expect(adj.processVersion).toBe(1);
    expect(adj.exposure).toBe(0.4);
  });

  it("gespeicherter Edit-State mit Version 2 bleibt 2", () => {
    useEditorStore.getState().applyEditState({
      adjustments: { ...defaultAdjustments(), processVersion: 2 },
      masks: [],
      cropRect: defaultCropRect(),
      straightenAngle: 0,
      lensCorrection: defaultLensCorrection(),
      lensProfileId: null,
      manualLensOverride: false,
    });
    expect(useEditorStore.getState().adjustments.processVersion).toBe(2);
  });

  it("Preset ohne Feld (applyAdjustments) setzt Version 1", () => {
    useEditorStore.getState().applyAdjustments(legacyAdjustments({ contrast: 0.2 }));
    expect(useEditorStore.getState().adjustments.processVersion).toBe(1);
    expect(useEditorStore.getState().adjustments.contrast).toBe(0.2);
  });

  it("Auto-Ton-Muster {...cur, ...delta} behaelt die aktuelle Version", () => {
    const cur = useEditorStore.getState().adjustments;
    useEditorStore.getState().applyAdjustments({ ...cur, exposure: 0.5 });
    expect(useEditorStore.getState().adjustments.processVersion).toBe(2);
  });

  it("setProcessVersion aendert nur das Feld und ist ein Undo-Schritt", () => {
    useEditorStore.setState({
      adjustments: { ...defaultAdjustments(), processVersion: 1, exposure: 0.7 },
      past: [],
      future: [],
    });
    useEditorStore.getState().setProcessVersion(2);
    expect(useEditorStore.getState().adjustments).toMatchObject({ processVersion: 2, exposure: 0.7 });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments).toMatchObject({ processVersion: 1, exposure: 0.7 });
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().adjustments.processVersion).toBe(2);
  });
});

describe("Prozessversion · mergeGroups", () => {
  const base = edit({ ...defaultAdjustments(), processVersion: 2 });
  const preset = edit({ ...defaultAdjustments(), processVersion: 1, contrast: 0.4 });

  it("uebernimmt die Version nur mit Ton-Gruppe", () => {
    expect(mergeGroups(base, preset, new Set(["tone"])).adjustments.processVersion).toBe(1);
    expect(mergeGroups(base, preset, new Set(["color", "hsl"])).adjustments.processVersion).toBe(2);
  });

  it("Profil ohne Feld zaehlt mit Ton-Gruppe als Version 1", () => {
    const legacy = edit(legacyAdjustments() as WireAdjustments);
    expect(mergeGroups(base, legacy, new Set(["tone"])).adjustments.processVersion).toBe(1);
  });

  it("applyProfileGroups im Store normalisiert und ist undobar", () => {
    resetStore();
    useEditorStore.getState().applyProfileGroups(preset, new Set(["tone"]));
    expect(useEditorStore.getState().adjustments.processVersion).toBe(1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.processVersion).toBe(2);
  });
});

describe("Prozessversion · YAML-Profil", () => {
  it("Round-Trip erhaelt Version 2", () => {
    const text = serializeProfileYaml({
      name: "PV2",
      adjustments: { ...defaultAdjustments(), processVersion: 2 },
      masks: [],
    });
    expect(text).toContain("lumenProfile: 1");
    expect(parseProfileYaml(text).adjustments.processVersion).toBe(2);
  });

  it("Profil ohne Feld wird als Version 1 gelesen", () => {
    const parsed = parseProfileYaml("lumenProfile: 1\nname: alt\nadjustments:\n  exposure: 0.2\n");
    expect(parsed.adjustments.processVersion).toBe(1);
    expect(parsed.adjustments.exposure).toBe(0.2);
  });

  it("ungueltige Version wird abgelehnt", () => {
    expect(() =>
      parseProfileYaml("lumenProfile: 1\nname: x\nadjustments:\n  processVersion: 3\n"),
    ).toThrow(/Prozessversion/);
  });
});

describe("Prozessversion · Upgrade-Button in der Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  /** Sidebar am echten Store, damit Klick + Undo end-to-end laufen. */
  function Harness() {
    const adjustments = useEditorStore((s) => s.adjustments);
    const setProcessVersion = useEditorStore((s) => s.setProcessVersion);
    const fn = vi.fn();
    return (
      <EditorSidebar
        canvasElement={null}
        tick={0}
        aspect="free"
        onAspectChange={fn}
        straightenAngle={0}
        onStraightenChange={fn}
        onAutoStraighten={fn}
        onResetGeometry={fn}
        masks={[]}
        selectedMaskId={null}
        selected={null}
        onSelectMask={fn}
        onRemoveMask={fn}
        onLocalAdjust={fn}
        onMaskFeather={fn}
        onRemoveSelectedMask={fn}
        lensCorrection={defaultLensCorrection()}
        lensProfileId={null}
        manualLensOverride={false}
        onLensCorrectionChange={fn}
        adjustments={adjustments}
        onAdjustment={fn}
        onHslChange={fn}
        onHslReset={fn}
        onToneCurveSetPoint={fn}
        onToneCurveAddPoint={() => null}
        onToneCurveRemovePoint={fn}
        onToneCurveReset={fn}
        onUpgradeProcessVersion={() => setProcessVersion(CURRENT_PROCESS_VERSION)}
        onResetAll={fn}
      />
    );
  }

  it("bei Version 2 kein Hinweis und kein Button", () => {
    render(<Harness />);
    expect(screen.queryByTestId("process-version-upgrade")).toBeNull();
    expect(screen.queryByText(/Prozessversion 1/)).toBeNull();
  });

  it("bei Version 1 sichtbar; Klick setzt Version 2, Undo stellt 1 wieder her", async () => {
    useEditorStore.setState({
      adjustments: { ...defaultAdjustments(), processVersion: 1, shadows: 0.3 },
      past: [],
      future: [],
    });
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText("Bearbeitet mit Prozessversion 1")).toBeInTheDocument();
    const button = screen.getByTestId("process-version-upgrade");
    expect(button).toHaveTextContent("Auf Version 2 aktualisieren");

    await user.click(button);
    expect(useEditorStore.getState().adjustments.processVersion).toBe(2);
    expect(useEditorStore.getState().adjustments.shadows).toBe(0.3);
    expect(screen.queryByTestId("process-version-upgrade")).toBeNull();

    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().adjustments.processVersion).toBe(1);
    expect(screen.getByTestId("process-version-upgrade")).toBeInTheDocument();
  });
});
