import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Image, ImageEditState } from "../src/api/client";
import { useThumbnailUploader } from "../src/editor/useThumbnailUploader";
import { useEditAutosave } from "../src/pages/Editor";

type PutThumb = (id: string, jpeg: Blob) => Promise<Image>;

function fakeCanvas(): HTMLCanvasElement {
  return {
    toBlob: (cb: BlobCallback) => cb(new Blob([new Uint8Array(4)], { type: "image/jpeg" })),
  } as unknown as HTMLCanvasElement;
}

function setup(initialId: string | null = "img-1") {
  const putImageThumbnail = vi.fn<PutThumb>().mockResolvedValue({} as Image);
  const capture = vi.fn(() => fakeCanvas());
  let now = 0;
  const hook = renderHook(
    ({ id }: { id: string | null }) =>
      useThumbnailUploader({ putImageThumbnail }, capture, id, {
        intervalMs: 10_000,
        now: () => now,
      }),
    { initialProps: { id: initialId } },
  );
  const advance = async (ms: number) => {
    now += ms;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  return { hook, putImageThumbnail, capture, advance };
}

describe("useThumbnailUploader", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("laedt nach erfolgreichem Save hoch und drosselt weitere", async () => {
    const { hook, putImageThumbnail, advance } = setup();
    act(() => hook.result.current.notifySaved("img-1"));
    await advance(0);
    expect(putImageThumbnail).toHaveBeenCalledTimes(1);
    expect(putImageThumbnail.mock.calls[0]![0]).toBe("img-1");
    expect(putImageThumbnail.mock.calls[0]![1]).toBeInstanceOf(Blob);

    act(() => hook.result.current.notifySaved("img-1"));
    act(() => hook.result.current.notifySaved("img-1"));
    await advance(5000);
    expect(putImageThumbnail).toHaveBeenCalledTimes(1);
    await advance(5000);
    expect(putImageThumbnail).toHaveBeenCalledTimes(2);
  });

  it("beim Verlassen des Editors wird ein ausstehender Upload gesendet", async () => {
    const { hook, putImageThumbnail, advance } = setup();
    act(() => hook.result.current.markDirty("img-1"));
    expect(putImageThumbnail).not.toHaveBeenCalled();
    hook.unmount();
    await advance(0);
    expect(putImageThumbnail).toHaveBeenCalledTimes(1);
  });

  it("ohne Aenderung kein Upload beim Verlassen", async () => {
    const { hook, putImageThumbnail, advance } = setup();
    hook.unmount();
    await advance(20_000);
    expect(putImageThumbnail).not.toHaveBeenCalled();
  });

  it("Bildwechsel: flushCurrent laedt fuer das bisherige Bild hoch", async () => {
    const { hook, putImageThumbnail, capture, advance } = setup();
    act(() => hook.result.current.notifySaved("img-1"));
    act(() => hook.result.current.notifySaved("img-1"));
    act(() => hook.result.current.flushCurrent());
    await advance(0);
    expect(putImageThumbnail).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("verspaeteter Timer fuer ein anderes Bild verfaellt", async () => {
    const { hook, putImageThumbnail, capture, advance } = setup();
    act(() => hook.result.current.notifySaved("img-1"));
    act(() => hook.result.current.notifySaved("img-1"));
    hook.rerender({ id: "img-2" });
    await advance(20_000);
    expect(putImageThumbnail).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("Upload-Fehler bleiben still", async () => {
    const { hook, putImageThumbnail, advance } = setup();
    putImageThumbnail.mockRejectedValue(new Error("offline"));
    act(() => hook.result.current.notifySaved("img-1"));
    await advance(0);
    expect(putImageThumbnail).toHaveBeenCalledTimes(1);
  });

  it("ohne Canvas-Bild kein Upload", async () => {
    const { hook, putImageThumbnail, capture, advance } = setup();
    capture.mockReturnValue(null as unknown as HTMLCanvasElement);
    act(() => hook.result.current.notifySaved("img-1"));
    await advance(0);
    expect(putImageThumbnail).not.toHaveBeenCalled();
  });
});

function editState(exposure: number): ImageEditState {
  return {
    adjustments: {
      exposure, contrast: 0, highlights: 0, shadows: 0, whites: 0,
      blacks: 0, temperature: 0, tint: 0, vibrance: 0, saturation: 0,
      sharpness: 0, noiseReduction: 0, highlightRecovery: 0, localContrast: 0,
      hsl: null, toneCurve: null,
    },
    masks: [],
    crop: null,
    straightenAngle: 0,
    lensCorrection: null,
    lensProfileId: null,
    manualLensOverride: false,
  };
}

describe("useEditAutosave onSaved", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("meldet erfolgreiche Saves, aber keine fehlgeschlagenen", async () => {
    const putImageEdit = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error("x"));
    const onSaved = vi.fn();
    const { rerender } = renderHook(
      ({ st }: { st: ImageEditState }) => useEditAutosave({ putImageEdit }, "img-1", st, onSaved),
      { initialProps: { st: editState(0.1) } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith("img-1");
    rerender({ st: editState(0.2) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(putImageEdit).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
