import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import * as useApiModule from "../src/api/use-api";
import { ApiError, type ApiClient, type Preset } from "../src/api/client";
import { defaultAdjustments } from "../src/editor/adjustments";
import BatchApplyModal from "../src/pages/BatchApplyModal";
import { makeFakeAuth, makeFakeUser, renderWithAuth } from "./test-utils";

interface FakeApi {
  listPresets: Mock;
  applyPresetBatch: Mock;
}

function makePreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: "p-1",
    name: "Warm",
    adjustments: defaultAdjustments(),
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

function renderModal(api: FakeApi, imageIds: string[] = ["img-1", "img-2"]) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue(api as unknown as ApiClient);
  const onClose = vi.fn();
  const onApplied = vi.fn();
  renderWithAuth(
    <BatchApplyModal imageIds={imageIds} onClose={onClose} onApplied={onApplied} />,
    { auth: makeFakeAuth({ isAuthenticated: true, user: makeFakeUser() }) },
  );
  return { onClose, onApplied };
}

async function pickPreset() {
  const select = await screen.findByTestId("batch-preset-select");
  await screen.findByRole("option", { name: "Warm" });
  await userEvent.selectOptions(select, "p-1");
}

describe("BatchApplyModal", () => {
  afterEach(() => vi.restoreAllMocks());

  it("crop und lens sind standardmaessig nicht angehakt", async () => {
    const api: FakeApi = {
      listPresets: vi.fn().mockResolvedValue([makePreset()]),
      applyPresetBatch: vi.fn(),
    };
    renderModal(api);
    await pickPreset();
    expect(screen.getByTestId("step-crop")).not.toBeChecked();
    expect(screen.getByTestId("step-lens")).not.toBeChecked();
    expect(screen.getByTestId("step-tone")).toBeChecked();
  });

  it("Preset-Auswahl hat ein zugaengliches Label", async () => {
    const api: FakeApi = {
      listPresets: vi.fn().mockResolvedValue([makePreset()]),
      applyPresetBatch: vi.fn(),
    };
    renderModal(api);
    expect(await screen.findByLabelText("Preset")).toBeInTheDocument();
  });

  it("Submit sendet groups und imageIds und meldet applied/total", async () => {
    const api: FakeApi = {
      listPresets: vi.fn().mockResolvedValue([makePreset()]),
      applyPresetBatch: vi.fn().mockResolvedValue({ applied: 2, total: 2 }),
    };
    const { onApplied, onClose } = renderModal(api);
    await pickPreset();
    await userEvent.click(screen.getByTestId("batch-apply-confirm"));
    await waitFor(() => expect(api.applyPresetBatch).toHaveBeenCalledTimes(1));
    const [id, payload] = api.applyPresetBatch.mock.calls[0] as [
      string,
      { imageIds: string[]; groups: string[] },
    ];
    expect(id).toBe("p-1");
    expect(payload.imageIds).toEqual(["img-1", "img-2"]);
    expect(payload.groups).toContain("tone");
    expect(payload.groups).not.toContain("crop");
    expect(payload.groups).not.toContain("lens");
    expect(onApplied).toHaveBeenCalledWith(2, 2);
    expect(onClose).toHaveBeenCalled();
  });

  it("400-Fehler wird als Alert angezeigt und Modal bleibt offen", async () => {
    const api: FakeApi = {
      listPresets: vi.fn().mockResolvedValue([makePreset()]),
      applyPresetBatch: vi
        .fn()
        .mockRejectedValue(new ApiError(400, "Ungueltige Gruppen")),
    };
    const { onApplied, onClose } = renderModal(api);
    await pickPreset();
    await userEvent.click(screen.getByTestId("batch-apply-confirm"));
    const err = await screen.findByTestId("batch-error");
    expect(err).toHaveAttribute("role", "alert");
    expect(err.textContent).not.toBe("");
    expect(onApplied).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
