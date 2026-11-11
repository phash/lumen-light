/**
 * H1b · Canvas.loadRgb16: Live-Vorschau verkleinert, Export und
 * Kontext-Wiederherstellung nutzen dieselbe 16-bit-Quelle.
 */
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CanvasHandle } from "../src/editor/Canvas";
import type { Rgb16Image } from "../src/editor/rawPixels";
import { useEditorStore } from "../src/editor/store";

interface FakeRendererInstance {
  readonly loadImage: ReturnType<typeof vi.fn>;
  sourcePrecision: string;
}

const instances: FakeRendererInstance[] = [];

vi.mock("../src/editor/webgl", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/editor/webgl")>();
  class FakeRenderer {
    imageWidth = 0;
    imageHeight = 0;
    maxDimension = 16384;
    sourcePrecision = "float16";
    private loaded = false;
    readonly loadImage = vi.fn((_img: unknown, w: number, h: number) => {
      this.imageWidth = w;
      this.imageHeight = h;
      this.loaded = true;
    });
    readonly render = vi.fn();
    readonly release = vi.fn();
    readonly dispose = vi.fn();
    constructor() {
      instances.push(this);
    }
    hasImage(): boolean {
      return this.loaded;
    }
  }
  return { ...orig, Renderer: FakeRenderer };
});

const { default: Canvas } = await import("../src/editor/Canvas");

function rgb16(width: number, height: number): Rgb16Image {
  return { kind: "rgb16", data: new Uint16Array(width * height * 3), width, height };
}

describe("Canvas.loadRgb16", () => {
  beforeEach(() => {
    instances.length = 0;
    useEditorStore.getState().resetForNewImage();
  });

  function mount() {
    const ref = createRef<CanvasHandle>();
    const utils = render(
      <Canvas ref={ref} onTick={() => undefined} onError={() => undefined} cropMode={false} />,
    );
    return { ref, ...utils };
  }

  it("laedt die Vorschau auf 1600 px Breite und markiert die Praezision", () => {
    const { ref, getByTestId } = mount();
    const img = rgb16(6000, 4000);
    act(() => {
      ref.current?.loadRgb16(img);
    });
    const live = instances[0]!;
    expect(live.loadImage).toHaveBeenCalledWith(img, 1600, 1067);
    expect(getByTestId("editor-canvas").dataset.sourcePrecision).toBe("float16");
  });

  it("8-bit-Rueckfall des Renderers wird am Canvas sichtbar", () => {
    const { ref, getByTestId } = mount();
    instances[0]!.sourcePrecision = "8bit";
    act(() => {
      ref.current?.loadRgb16(rgb16(100, 50));
    });
    expect(getByTestId("editor-canvas").dataset.sourcePrecision).toBe("8bit");
  });

  it("Full-Res-Export laedt dieselbe 16-bit-Quelle in voller Groesse", () => {
    const { ref } = mount();
    const img = rgb16(6000, 4000);
    act(() => {
      ref.current?.loadRgb16(img);
    });
    const res = ref.current?.exportFullResCanvas();
    expect(res).not.toBeNull();
    const exporter = instances[1]!;
    expect(exporter.loadImage).toHaveBeenCalledWith(img, 6000, 4000);
    expect(res?.downscaledFrom).toBeNull();
  });
});
