import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CanvasHandle } from "../src/editor/Canvas";
import { useEditorStore } from "../src/editor/store";

interface FakeRendererInstance {
  readonly loadImage: ReturnType<typeof vi.fn>;
  readonly render: ReturnType<typeof vi.fn>;
}

const instances: FakeRendererInstance[] = [];

vi.mock("../src/editor/webgl", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/editor/webgl")>();
  class FakeRenderer {
    imageWidth = 0;
    imageHeight = 0;
    maxDimension = 4096;
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

const { default: Canvas, CONTEXT_LOST_MESSAGE } = await import("../src/editor/Canvas");

function fakeBitmap(): ImageBitmap {
  const bitmap: ImageBitmap = { width: 200, height: 100, close: vi.fn() };
  return bitmap;
}

describe("Canvas WebGL-Kontextverlust", () => {
  beforeEach(() => {
    instances.length = 0;
    useEditorStore.getState().resetForNewImage();
  });

  it("contextlost -> onError + Rendern stoppt; restored -> neu aufgebaut + onRecovered", () => {
    const onError = vi.fn();
    const onRecovered = vi.fn();
    const ref = createRef<CanvasHandle>();
    const { getByTestId } = render(
      <Canvas
        ref={ref}
        onTick={() => undefined}
        onError={onError}
        onRecovered={onRecovered}
        cropMode={false}
      />,
    );
    expect(instances).toHaveLength(1);
    act(() => {
      ref.current?.loadBitmap(fakeBitmap(), 200, 100);
    });
    const first = instances[0]!;
    const rendersBefore = first.render.mock.calls.length;
    expect(rendersBefore).toBeGreaterThan(0);

    const canvas = getByTestId("editor-canvas");
    const lost = new Event("webglcontextlost", { cancelable: true });
    act(() => {
      canvas.dispatchEvent(lost);
    });
    expect(lost.defaultPrevented).toBe(true);
    expect(onError).toHaveBeenCalledWith(CONTEXT_LOST_MESSAGE);

    // Store-Aenderung waehrend Kontextverlust: kein Render mehr.
    act(() => {
      useEditorStore.getState().setAdjustment("exposure", 0.5);
      ref.current?.render();
    });
    expect(first.render.mock.calls.length).toBe(rendersBefore);
    expect(instances).toHaveLength(1);

    act(() => {
      canvas.dispatchEvent(new Event("webglcontextrestored"));
    });
    expect(instances).toHaveLength(2);
    const second = instances[1]!;
    expect(second.loadImage).toHaveBeenCalledTimes(1);
    expect(second.render).toHaveBeenCalled();
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });
});
