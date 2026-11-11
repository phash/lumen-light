/**
 * H1b · Editor leitet RAWs je nach Bittiefe an Canvas.loadRgb16 (16 bit)
 * oder an den alten Bitmap-Pfad (8 bit, wenig Geraetespeicher).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CanvasHandle } from "../src/editor/Canvas";
import type { DecodeRawOptions, DecodedRaw } from "../src/editor/raw";
import { useEditorStore } from "../src/editor/store";

const loadRgb16 = vi.fn();
const loadBitmap = vi.fn();
const decodeRaw = vi.fn<(file: File, options?: DecodeRawOptions) => Promise<DecodedRaw>>();
const fakeBitmap = { width: 2, height: 1, close: vi.fn() } as unknown as ImageBitmap;

vi.mock("../src/editor/Canvas", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/editor/Canvas")>();
  const FakeCanvas = forwardRef<CanvasHandle, object>(function FakeCanvas(_props, ref) {
    useImperativeHandle(ref, () => ({
      loadFile: () => Promise.resolve(null),
      loadBitmap,
      loadRgb16,
      render: () => undefined,
      takeBypassSnapshot: () => null,
      exportFullResCanvas: () => null,
      renderThumbnail: () => null,
    }));
    return <canvas data-testid="editor-canvas" />;
  });
  return { ...orig, default: FakeCanvas };
});

vi.mock("../src/editor/raw", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/editor/raw")>();
  return {
    ...orig,
    isRawFile: () => Promise.resolve(true),
    decodeRaw: (file: File, options?: DecodeRawOptions) => decodeRaw(file, options),
    rgbToImageBitmap: () => Promise.resolve(fakeBitmap),
  };
});

vi.mock("../src/onboarding/state", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/onboarding/state")>();
  return { ...orig, getOnboardingState: () => "completed" as const };
});

const fakeApi = {
  listImages: vi.fn(),
  getImageUrl: vi.fn(),
  getImageEdit: vi.fn(),
  putImageEdit: vi.fn(),
  putImageThumbnail: vi.fn(),
  updateImage: vi.fn(),
  updateImages: vi.fn(),
  listPresets: vi.fn(() => Promise.resolve([])),
};

vi.mock("../src/api/use-api", () => ({ useApi: () => fakeApi }));

const { default: Editor } = await import("../src/pages/Editor");

function decoded(bits: 8 | 16): DecodedRaw {
  return {
    width: 2,
    height: 1,
    focalLen: null,
    cameraMake: null,
    cameraModel: null,
    pixels: bits === 16 ? { bits, rgb: new Uint16Array(6) } : { bits, rgb: new Uint8Array(6) },
  };
}

function dropRaw() {
  render(
    <MemoryRouter initialEntries={["/editor"]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
      </Routes>
    </MemoryRouter>,
  );
  const file = new File([new Uint8Array(16)], "x.arw");
  const main = screen.getByTestId("page-editor").querySelector("main");
  if (!main) throw new Error("main fehlt");
  fireEvent.drop(main, { dataTransfer: { files: [file] } });
}

describe("Editor RAW-Bittiefe", () => {
  beforeEach(() => {
    loadRgb16.mockClear();
    loadBitmap.mockClear();
    decodeRaw.mockReset();
    useEditorStore.getState().resetForNewImage();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "deviceMemory");
  });

  it("16 bit: Pixel gehen als Rgb16Image an loadRgb16", async () => {
    const d = decoded(16);
    decodeRaw.mockResolvedValue(d);
    dropRaw();
    await waitFor(() => expect(loadRgb16).toHaveBeenCalledTimes(1));
    expect(decodeRaw.mock.calls[0]?.[1]).toEqual({ bits: 16 });
    expect(loadRgb16).toHaveBeenCalledWith({
      kind: "rgb16",
      data: d.pixels.rgb,
      width: 2,
      height: 1,
    });
    expect(loadBitmap).not.toHaveBeenCalled();
  });

  it("deviceMemory < 4: 8-bit-Decode und Bitmap-Pfad", async () => {
    Object.defineProperty(navigator, "deviceMemory", { value: 2, configurable: true });
    decodeRaw.mockResolvedValue(decoded(8));
    dropRaw();
    await waitFor(() => expect(loadBitmap).toHaveBeenCalledTimes(1));
    expect(decodeRaw.mock.calls[0]?.[1]).toEqual({ bits: 8 });
    expect(loadBitmap).toHaveBeenCalledWith(fakeBitmap, 2, 1);
    expect(loadRgb16).not.toHaveBeenCalled();
  });
});
