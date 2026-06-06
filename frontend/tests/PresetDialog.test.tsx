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
  listImages: Mock;
}

function makeFakeApi(presets: Preset[] = []): FakeApi {
  return {
    me: vi.fn(),
    deleteMe: vi.fn(),
    exportMe: vi.fn(),
    listPresets: vi.fn().mockResolvedValue(presets),
    createPreset: vi.fn(),
    updatePreset: vi.fn(),
    deletePreset: vi.fn().mockResolvedValue(undefined),
    listImages: vi.fn().mockResolvedValue([]),
    initUpload: vi.fn(),
    confirmUpload: vi.fn(),
    getImageUrl: vi.fn(),
    deleteImage: vi.fn(),
    getImageEdit: vi.fn(),
    putImageEdit: vi.fn(),
    listMarketplacePresets: vi.fn(),
    getMarketplacePreset: vi.fn(),
    applyMarketplacePreset: vi.fn(),
    forkMarketplacePreset: vi.fn(),
    reportMarketplacePreset: vi.fn(),
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    listPublishedPresets: vi.fn(),
    submitFeedback: vi.fn(),
    adminListUsers: vi.fn(),
    adminPatchUser: vi.fn(),
    adminStats: vi.fn(),
    adminListFeedback: vi.fn(),
    adminPatchFeedback: vi.fn(),
    applyPresetBatch: vi.fn(),
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
    geometry: null,
    visibility: "private",
    genre: null,
    description: null,
    previewImageId: null,
    publishedAt: null,
    applyCount: 0,
    reportCount: 0,
    createdAt: "x",
    updatedAt: "x",
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

  it("Anwenden merged die Default-Gruppen in den Store und schliesst den Dialog", async () => {
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
    // Neuer Flow: Anwenden oeffnet das Schritt-Panel, Bestaetigen merged.
    await userEvent.click(screen.getByTestId("preset-apply-a"));
    await userEvent.click(screen.getByTestId("apply-confirm"));

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

  // ---------- Apply-Panel Cancel + Import (neue Tests) ----------

  it("Apply-Panel oeffnen und Abbrechen wendet nicht an und schliesst nicht", async () => {
    const api = makeFakeApi([makePreset({ id: "a", name: "Neutral" })]);
    const { onClose } = renderDialog(api);
    await waitFor(() => screen.getByTestId("preset-item-a"));

    // Store-Zustand vor dem Apply merken
    const before = useEditorStore.getState().adjustments.contrast;

    await userEvent.click(screen.getByTestId("preset-apply-a"));
    expect(screen.getByTestId("apply-step-panel")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("apply-cancel"));

    expect(screen.queryByTestId("apply-step-panel")).not.toBeInTheDocument();
    expect(useEditorStore.getState().adjustments.contrast).toBe(before);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("YAML-Import Happy-Path: createPreset wird mit richtigem Namen aufgerufen", async () => {
    const api = makeFakeApi([]);
    api.createPreset = vi.fn().mockResolvedValue(
      makePreset({ id: "imported-1", name: "Importiert" }),
    );
    const { onLoadedPresetIdChange } = renderDialog(api);
    await waitFor(() => expect(api.listPresets).toHaveBeenCalled());

    const yaml = [
      "lumenProfile: 1",
      "name: Importiert",
      "adjustments: {}",
      "masks: []",
    ].join("\n");
    const file = new File([yaml], "p.yaml", { type: "application/yaml" });
    await userEvent.upload(screen.getByTestId("preset-import-input"), file);

    await waitFor(() => {
      expect(api.createPreset).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Importiert" }),
      );
    });
    expect(onLoadedPresetIdChange).toHaveBeenCalledWith("imported-1");
  });

  it("YAML-Import 409: Fehlermeldung 'existiert bereits'", async () => {
    const api = makeFakeApi([]);
    api.createPreset = vi.fn().mockRejectedValue(new ApiError(409, "duplicate"));
    renderDialog(api);
    await waitFor(() => expect(api.listPresets).toHaveBeenCalled());

    const yaml = [
      "lumenProfile: 1",
      "name: Importiert",
      "adjustments: {}",
      "masks: []",
    ].join("\n");
    const file = new File([yaml], "p.yaml", { type: "application/yaml" });
    await userEvent.upload(screen.getByTestId("preset-import-input"), file);

    await waitFor(() => {
      expect(screen.getByTestId("preset-error").textContent).toContain(
        "existiert bereits",
      );
    });
  });

  // ---------- Publish-Flow (F1) ----------

  it("Publish-Toggle aus = listImages wird NICHT aufgerufen", async () => {
    const api = makeFakeApi([]);
    renderDialog(api);
    await waitFor(() => expect(api.listPresets).toHaveBeenCalled());
    expect(api.listImages).not.toHaveBeenCalled();
  });

  it("Publish-Toggle an = listImages wird aufgerufen", async () => {
    const api = makeFakeApi([]);
    api.listImages = vi.fn().mockResolvedValue([]);
    renderDialog(api);
    await waitFor(() => expect(api.listPresets).toHaveBeenCalled());
    await userEvent.click(screen.getByTestId("preset-publish-toggle"));
    await waitFor(() => expect(api.listImages).toHaveBeenCalledWith("ready"));
  });

  it("Publish ohne Genre/Description/Preview zeigt Validierungsfehler", async () => {
    const api = makeFakeApi([]);
    api.listImages = vi.fn().mockResolvedValue([]);
    api.createPreset = vi.fn();
    renderDialog(api);
    await waitFor(() => expect(api.listPresets).toHaveBeenCalled());
    await userEvent.click(screen.getByTestId("preset-publish-toggle"));
    await userEvent.type(screen.getByTestId("preset-save-name"), "Pub");
    await userEvent.click(screen.getByTestId("preset-save-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("preset-error").textContent).toContain("Genre"),
    );
    expect(api.createPreset).not.toHaveBeenCalled();
  });

  it("Publish mit allen Pflichtfeldern sendet visibility=public + Felder", async () => {
    const api = makeFakeApi([]);
    api.listImages = vi.fn().mockResolvedValue([
      {
        id: "img-1",
        originalFilename: "cover.jpg",
        contentType: "image/jpeg",
        sizeBytes: 100,
        uploadState: "ready" as const,
        createdAt: "x",
        confirmedAt: "x",
      },
    ]);
    api.createPreset = vi.fn().mockResolvedValue(
      makePreset({ id: "new", name: "Public Look" }),
    );
    renderDialog(api);
    await waitFor(() => expect(api.listPresets).toHaveBeenCalled());

    await userEvent.click(screen.getByTestId("preset-publish-toggle"));
    await waitFor(() => expect(api.listImages).toHaveBeenCalled());

    await userEvent.selectOptions(
      screen.getByTestId("preset-publish-genre"),
      "portrait",
    );
    await userEvent.type(
      screen.getByTestId("preset-publish-description"),
      "Hauttoene wirken weicher und etwas waermer.",
    );
    // Preview-Picker ist ein Thumbnail-Grid mit Buttons pro Bild.
    await waitFor(() =>
      expect(
        screen.getByTestId("preset-publish-preview-img-1"),
      ).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByTestId("preset-publish-preview-img-1"));
    await userEvent.type(screen.getByTestId("preset-save-name"), "Public Look");
    await userEvent.click(screen.getByTestId("preset-save-confirm"));

    await waitFor(() => expect(api.createPreset).toHaveBeenCalledTimes(1));
    const calls = api.createPreset.mock.calls as Array<[PresetWritePayload]>;
    const payload = calls[0]![0];
    expect(payload.visibility).toBe("public");
    expect(payload.genre).toBe("portrait");
    expect(payload.description).toContain("Hauttoene");
    expect(payload.previewImageId).toBe("img-1");
  });
});
