import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PresetDialog from "../src/editor/PresetDialog";
import * as useApiModule from "../src/api/use-api";
import {
  ApiError,
  type ApiClient,
  type Preset,
  type PresetWritePayload,
} from "../src/api/client";
import { defaultAdjustments } from "../src/editor/adjustments";
import { useEditorStore } from "../src/editor/store";
import { defaultLensCorrection } from "../src/editor/lens";
import { defaultCropRect } from "../src/editor/transform";
import { makeFakeAuth, makeFakeUser, renderWithAuth } from "./test-utils";

interface FakeApi extends ApiClient {
  listPresets: Mock;
  createPreset: Mock;
  updatePreset: Mock;
  deletePreset: Mock;
}

function makeFakeApi(presets: Preset[] = []): FakeApi {
  return {
    me: vi.fn(),
    listPresets: vi.fn().mockResolvedValue(presets),
    createPreset: vi.fn(),
    updatePreset: vi.fn(),
    deletePreset: vi.fn().mockResolvedValue(undefined),
    listImages: vi.fn(),
    initUpload: vi.fn(),
    confirmUpload: vi.fn(),
    getImageUrl: vi.fn(),
    deleteImage: vi.fn(),
  };
}

const ZERO_ADJ = defaultAdjustments();
const ZERO_LOCAL_ADJ = {
  exposure: 0, contrast: 0, saturation: 0, temperature: 0,
};

function makePreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: "p-1",
    name: "Mein Look",
    adjustments: ZERO_ADJ,
    masks: [],
    created_at: "x",
    updated_at: "x",
    ...overrides,
  };
}

interface RenderOptions {
  presets?: Preset[];
  loadedPresetId?: string | null;
}

function renderDialog(api: FakeApi, opts: RenderOptions = {}) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue(api);
  const onClose = vi.fn();
  const onLoadedPresetIdChange = vi.fn();
  const utils = renderWithAuth(
    <PresetDialog
      open
      onClose={onClose}
      loadedPresetId={opts.loadedPresetId ?? null}
      onLoadedPresetIdChange={onLoadedPresetIdChange}
    />,
    {
      auth: makeFakeAuth({ isAuthenticated: true, user: makeFakeUser() }),
    },
  );
  return { ...utils, onClose, onLoadedPresetIdChange };
}

describe("PresetDialog", () => {
  beforeEach(() => {
    useEditorStore.setState({
      adjustments: defaultAdjustments(),
      bypass: false,
      cropRect: defaultCropRect(),
      straightenAngle: 0,
      lensCorrection: defaultLensCorrection(),
      lensProfileId: null,
      manualLensOverride: false,
      masks: [],
      selectedMaskId: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ladet die Liste beim Oeffnen und zeigt Eintraege", async () => {
    const api = makeFakeApi([
      makePreset({ id: "a", name: "Neutral" }),
      makePreset({ id: "b", name: "Punchy" }),
    ]);
    renderDialog(api);
    await waitFor(() => {
      expect(api.listPresets).toHaveBeenCalled();
    });
    expect(screen.getByTestId("preset-item-a")).toBeInTheDocument();
    expect(screen.getByTestId("preset-item-b")).toBeInTheDocument();
    expect(screen.getByText("Neutral")).toBeInTheDocument();
    expect(screen.getByText("Punchy")).toBeInTheDocument();
  });

  it("zeigt Empty-State wenn keine Presets existieren", async () => {
    renderDialog(makeFakeApi([]));
    await waitFor(() => {
      expect(screen.getByText("Keine Presets gespeichert.")).toBeInTheDocument();
    });
  });

  it("Laden ruft applyAdjustments + applyMasks und schliesst den Dialog", async () => {
    const linearWire = {
      type: "linear" as const,
      mask: { p1: { u: 0, v: 0 }, p2: { u: 1, v: 1 }, feather: 0.4 },
      localAdj: { ...ZERO_LOCAL_ADJ, exposure: 1.5 },
    };
    const api = makeFakeApi([
      makePreset({
        id: "a",
        name: "Mit Maske",
        adjustments: { ...ZERO_ADJ, contrast: 0.4 },
        masks: [linearWire],
      }),
    ]);
    const { onClose, onLoadedPresetIdChange } = renderDialog(api);
    await waitFor(() => screen.getByTestId("preset-item-a"));
    await userEvent.click(screen.getByTestId("preset-load-a"));

    const s = useEditorStore.getState();
    expect(s.adjustments.contrast).toBe(0.4);
    expect(s.masks).toHaveLength(1);
    expect(s.masks[0]!.type).toBe("linear");
    if (s.masks[0]!.type === "linear") {
      expect(s.masks[0]!.localAdj.exposure).toBe(1.5);
    }
    expect(onLoadedPresetIdChange).toHaveBeenCalledWith("a");
    expect(onClose).toHaveBeenCalled();
  });

  it("Speichern ruft createPreset mit aktuellem Store-State", async () => {
    const api = makeFakeApi([]);
    api.createPreset = vi.fn().mockResolvedValue(
      makePreset({ id: "new", name: "Mein Look" }),
    );
    const { onLoadedPresetIdChange } = renderDialog(api);
    await waitFor(() => expect(api.listPresets).toHaveBeenCalled());

    // State praeparieren
    act(() => {
      useEditorStore.getState().setAdjustment("exposure", 0.5);
      useEditorStore.getState().addLinearMask();
    });

    await userEvent.type(screen.getByTestId("preset-save-name"), "Mein Look");
    await userEvent.click(screen.getByTestId("preset-save-confirm"));

    await waitFor(() => expect(api.createPreset).toHaveBeenCalledTimes(1));
    const calls = api.createPreset.mock.calls as Array<[PresetWritePayload]>;
    const payload = calls[0]![0];
    expect(payload.name).toBe("Mein Look");
    expect(payload.adjustments.exposure).toBe(0.5);
    expect(payload.masks).toHaveLength(1);
    expect(payload.masks?.[0]?.type).toBe("linear");
    expect(onLoadedPresetIdChange).toHaveBeenCalledWith("new");
  });

  it("Speichern: 409 zeigt Fehlermeldung 'bereits vergeben'", async () => {
    const api = makeFakeApi([]);
    api.createPreset = vi
      .fn()
      .mockRejectedValue(new ApiError(409, "duplicate"));
    renderDialog(api);
    await waitFor(() => expect(api.listPresets).toHaveBeenCalled());

    await userEvent.type(screen.getByTestId("preset-save-name"), "Punchy");
    await userEvent.click(screen.getByTestId("preset-save-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("preset-error").textContent).toContain(
        "bereits",
      );
    });
  });

  it("Speichern-Button ist disabled bei leerem Namen", async () => {
    renderDialog(makeFakeApi([]));
    await waitFor(() => {
      expect(screen.getByTestId("preset-save-confirm")).toBeDisabled();
    });
  });

  it("Loeschen ruft deletePreset und refresht Liste", async () => {
    const api = makeFakeApi([makePreset({ id: "x", name: "ToDelete" })]);
    renderDialog(api);
    await waitFor(() => screen.getByTestId("preset-item-x"));

    await userEvent.click(screen.getByTestId("preset-delete-x"));

    expect(api.deletePreset).toHaveBeenCalledWith("x");
    await waitFor(() => expect(api.listPresets).toHaveBeenCalledTimes(2));
  });

  it("Loeschen des aktiven Presets cleart loadedPresetId", async () => {
    const api = makeFakeApi([makePreset({ id: "active" })]);
    const { onLoadedPresetIdChange } = renderDialog(api, {
      loadedPresetId: "active",
    });
    await waitFor(() => screen.getByTestId("preset-item-active"));

    await userEvent.click(screen.getByTestId("preset-delete-active"));

    expect(onLoadedPresetIdChange).toHaveBeenCalledWith(null);
  });

  it("Aktualisieren-Button erscheint nur wenn ein Preset geladen ist und ruft updatePreset", async () => {
    const api = makeFakeApi([
      makePreset({ id: "a", name: "Active Look" }),
      makePreset({ id: "b", name: "Other" }),
    ]);
    api.updatePreset = vi.fn().mockResolvedValue(makePreset({ id: "a" }));
    renderDialog(api, { loadedPresetId: "a" });
    await waitFor(() => screen.getByTestId("preset-item-a"));

    await userEvent.click(screen.getByTestId("preset-update"));

    expect(api.updatePreset).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({ name: "Active Look" }),
    );
  });

  it("Aktualisieren-Button fehlt ohne loadedPresetId", async () => {
    renderDialog(makeFakeApi([makePreset({ id: "a" })]));
    await waitFor(() => screen.getByTestId("preset-item-a"));
    expect(screen.queryByTestId("preset-update")).not.toBeInTheDocument();
  });

  it("Schliessen ueber Backdrop-Klick", async () => {
    const { onClose } = renderDialog(makeFakeApi([]));
    await waitFor(() => expect(screen.getByTestId("preset-dialog")).toBeInTheDocument());
    // Backdrop = das Wurzelelement; Klick darauf schliesst
    await userEvent.click(screen.getByTestId("preset-dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  it("Schliessen ueber ✕-Button", async () => {
    const { onClose } = renderDialog(makeFakeApi([]));
    await waitFor(() => expect(screen.getByTestId("preset-close")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("preset-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("zeigt Mask-Anzahl in der Liste", async () => {
    const api = makeFakeApi([
      makePreset({
        id: "x",
        name: "Mit Masken",
        masks: [
          { type: "linear", mask: { p1: { u: 0, v: 0 }, p2: { u: 1, v: 1 }, feather: 0.4 }, localAdj: ZERO_LOCAL_ADJ },
          { type: "radial", mask: { center: { u: 0.5, v: 0.5 }, rx: 0.25, ry: 0.25, feather: 0.4 }, localAdj: ZERO_LOCAL_ADJ },
        ],
      }),
    ]);
    renderDialog(api);
    await waitFor(() => screen.getByTestId("preset-item-x"));
    expect(screen.getByText("2 Masken")).toBeInTheDocument();
  });

  it("zeigt Singular bei genau 1 Maske", async () => {
    const api = makeFakeApi([
      makePreset({
        id: "y",
        masks: [
          { type: "linear", mask: { p1: { u: 0, v: 0 }, p2: { u: 1, v: 1 }, feather: 0.4 }, localAdj: ZERO_LOCAL_ADJ },
        ],
      }),
    ]);
    renderDialog(api);
    await waitFor(() => screen.getByTestId("preset-item-y"));
    expect(screen.getByText("1 Maske")).toBeInTheDocument();
  });
});
