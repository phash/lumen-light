import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type ImageEditState } from "../src/api/client";
import { AutosaveIndicator, useEditAutosave } from "../src/pages/Editor";

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

type Put = (id: string, s: ImageEditState, o?: { keepalive?: boolean }) => Promise<void>;
type Props = { id: string | null; state: ImageEditState | null };

interface Deferred {
  resolve: () => void;
  reject: (err: unknown) => void;
}

/** PUT-Mock, dessen Requests einzeln von aussen aufgeloest werden. */
function deferredPut() {
  const calls: Deferred[] = [];
  const fn = vi.fn<Put>(
    () =>
      new Promise<void>((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
  );
  return { fn, calls };
}

function hidePage() {
  const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  spy.mockRestore();
}

describe("useEditAutosave Robustheit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Backoff-Folge 2000, 5000, 10000, 30000, 30000", async () => {
    const putImageEdit = vi.fn<Put>().mockRejectedValue(new Error("offline"));
    const st = editState(0.1);
    renderHook(() => useEditAutosave({ putImageEdit }, "img-1", st));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(putImageEdit).toHaveBeenCalledTimes(1);
    const delays = [2000, 5000, 10000, 30000, 30000];
    for (let i = 0; i < delays.length; i++) {
      const d = delays[i]!;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(d - 1);
      });
      expect(putImageEdit).toHaveBeenCalledTimes(i + 1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(putImageEdit).toHaveBeenCalledTimes(i + 2);
    }
  });

  it("Status bleibt error waehrend der Retries bis zum Erfolg", async () => {
    const { fn, calls } = deferredPut();
    const st = editState(0.1);
    const { result } = renderHook(() => useEditAutosave({ putImageEdit: fn }, "img-1", st));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    await act(async () => {
      calls[0]!.reject(new Error("offline"));
      await Promise.resolve();
    });
    expect(result.current.status).toBe("error");
    // Retry laeuft -> Status darf nicht auf saving springen.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("error");
    await act(async () => {
      calls[1]!.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("saved");
  });

  it("Indicator-Text bleibt waehrend der Retries unveraendert", async () => {
    const putImageEdit = vi.fn<Put>().mockRejectedValue(new Error("offline"));
    const st = editState(0.1);
    function Probe() {
      const { status, reason } = useEditAutosave({ putImageEdit }, "img-1", st);
      return <AutosaveIndicator status={status} reason={reason} />;
    }
    render(<Probe />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    const el = screen.getByTestId("autosave-status");
    const texts = new Set<string>([el.textContent ?? ""]);
    const observer = new MutationObserver(() => texts.add(el.textContent ?? ""));
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000 + 5000 + 10000);
    });
    observer.disconnect();
    texts.add(el.textContent ?? "");
    expect(putImageEdit).toHaveBeenCalledTimes(4);
    expect(texts.size).toBe(1);
    expect([...texts][0]).toMatch(/Nicht gespeichert/);
  });

  it("permanenter 4xx -> kein Retry, Hinweis mit Grund", async () => {
    const putImageEdit = vi
      .fn<Put>()
      .mockRejectedValue(new ApiError(404, "Bild nicht gefunden"));
    const st = editState(0.1);
    function Probe() {
      const { status, reason } = useEditAutosave({ putImageEdit }, "img-1", st);
      return <AutosaveIndicator status={status} reason={reason} />;
    }
    render(<Probe />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(putImageEdit).toHaveBeenCalledTimes(1);
    const text = screen.getByTestId("autosave-status").textContent ?? "";
    expect(text).toMatch(/Nicht gespeichert/);
    expect(text).toMatch(/Bild nicht gefunden/);
    expect(text).not.toMatch(/erneuter Versuch/);
  });

  it("408 und 429 werden wiederholt", async () => {
    for (const code of [408, 429]) {
      const putImageEdit = vi
        .fn<Put>()
        .mockRejectedValueOnce(new ApiError(code, "spaeter"))
        .mockResolvedValue(undefined);
      const st = editState(0.1);
      const { result, unmount } = renderHook(() =>
        useEditAutosave({ putImageEdit }, "img-1", st),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1200 + 2000);
      });
      expect(putImageEdit).toHaveBeenCalledTimes(2);
      expect(result.current.status).toBe("saved");
      unmount();
    }
  });

  it("nur ein Request gleichzeitig, danach der neueste Stand", async () => {
    const { fn, calls } = deferredPut();
    const { rerender } = renderHook((p: Props) => useEditAutosave({ putImageEdit: fn }, p.id, p.state), {
      initialProps: { id: "img-1", state: editState(0.1) },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    rerender({ id: "img-1", state: editState(0.2) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    rerender({ id: "img-1", state: editState(0.3) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    // Erster Request haengt noch -> kein zweiter parallel.
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => {
      calls[0]!.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("img-1", editState(0.3));
  });

  it("neuer Stand waehrend fehlschlagendem Request: kein Fehler, neuer Stand wird gesendet", async () => {
    const { fn, calls } = deferredPut();
    const { result, rerender } = renderHook(
      (p: Props) => useEditAutosave({ putImageEdit: fn }, p.id, p.state),
      { initialProps: { id: "img-1", state: editState(0.1) } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    rerender({ id: "img-1", state: editState(0.5) });
    await act(async () => {
      calls[0]!.reject(new Error("offline"));
      await Promise.resolve();
    });
    expect(result.current.status).not.toBe("error");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("img-1", editState(0.5));
  });

  it("Fehler fuer Bild A nach Wechsel zu B setzt keinen Fehler bei B", async () => {
    const { fn, calls } = deferredPut();
    const { result, rerender } = renderHook(
      (p: Props) => useEditAutosave({ putImageEdit: fn }, p.id, p.state),
      { initialProps: { id: "img-a", state: editState(0.1) } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    rerender({ id: "img-b", state: editState(0.2) });
    await act(async () => {
      calls[0]!.reject(new Error("offline"));
      await Promise.resolve();
    });
    expect(result.current.status).not.toBe("error");
    // Kein Retry fuer A.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1199);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("visibilitychange hidden: fehlgeschlagener Flush behaelt Stand und wiederholt", async () => {
    const putImageEdit = vi
      .fn<Put>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const st = editState(0.7);
    const { result } = renderHook(() => useEditAutosave({ putImageEdit }, "img-1", st));
    hidePage();
    expect(putImageEdit).toHaveBeenCalledTimes(1);
    expect(putImageEdit).toHaveBeenLastCalledWith("img-1", st, { keepalive: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("error");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(putImageEdit).toHaveBeenCalledTimes(2);
    expect(putImageEdit).toHaveBeenLastCalledWith("img-1", st);
    expect(result.current.status).toBe("saved");
  });

  it("visibilitychange hidden: erfolgreicher Flush -> kein weiterer PUT", async () => {
    const putImageEdit = vi.fn<Put>().mockResolvedValue(undefined);
    const st = editState(0.7);
    renderHook(() => useEditAutosave({ putImageEdit }, "img-1", st));
    hidePage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(putImageEdit).toHaveBeenCalledTimes(1);
  });
});
