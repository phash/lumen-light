import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImageEditState } from "../src/api/client";
import { AutosaveIndicator, useEditAutosave } from "../src/pages/Editor";

function editState(exposure: number): ImageEditState {
  return {
    adjustments: {
      exposure, contrast: 0, highlights: 0, shadows: 0, whites: 0,
      blacks: 0, temperature: 0, tint: 0, vibrance: 0, saturation: 0,
      sharpness: 0, noiseReduction: 0, highlightRecovery: 0, localContrast: 0,
      processVersion: 2, hsl: null, toneCurve: null,
    },
    masks: [],
    crop: null,
    straightenAngle: 0,
    lensCorrection: null,
    lensProfileId: null,
    manualLensOverride: false,
  };
}

type Props = { id: string | null; state: ImageEditState | null };

describe("useEditAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Burst von Aenderungen -> genau ein PUT nach 1200 ms mit letztem Stand", async () => {
    const putImageEdit = vi.fn(() => Promise.resolve());
    const api = { putImageEdit };
    const { rerender } = renderHook((p: Props) => useEditAutosave(api, p.id, p.state), {
      initialProps: { id: "img-1", state: editState(0.1) },
    });
    for (let i = 2; i <= 6; i++) {
      act(() => {
      vi.advanceTimersByTime(200);
    });
      rerender({ id: "img-1", state: editState(i / 10) });
    }
    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(putImageEdit).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(putImageEdit).toHaveBeenCalledTimes(1);
    expect(putImageEdit).toHaveBeenCalledWith("img-1", editState(0.6));
  });

  it("flusht ausstehende Aenderung beim Unmount per keepalive", () => {
    const putImageEdit = vi.fn(() => Promise.resolve());
    const api = { putImageEdit };
    const { rerender, unmount } = renderHook(
      (p: Props) => useEditAutosave(api, p.id, p.state),
      { initialProps: { id: "img-1", state: editState(0.1) } },
    );
    rerender({ id: "img-1", state: editState(0.3) });
    unmount();
    expect(putImageEdit).toHaveBeenCalledTimes(1);
    expect(putImageEdit).toHaveBeenCalledWith("img-1", editState(0.3), { keepalive: true });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(putImageEdit).toHaveBeenCalledTimes(1);
  });

  it("flusht bei pagehide und visibilitychange hidden", () => {
    const putImageEdit = vi.fn(() => Promise.resolve());
    const api = { putImageEdit };
    const { rerender } = renderHook((p: Props) => useEditAutosave(api, p.id, p.state), {
      initialProps: { id: "img-1", state: editState(0.1) },
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(putImageEdit).toHaveBeenCalledTimes(1);
    expect(putImageEdit).toHaveBeenLastCalledWith("img-1", editState(0.1), { keepalive: true });

    rerender({ id: "img-1", state: editState(0.2) });
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    spy.mockRestore();
    expect(putImageEdit).toHaveBeenCalledTimes(2);
    expect(putImageEdit).toHaveBeenLastCalledWith("img-1", editState(0.2), { keepalive: true });
  });

  it("kein PUT ohne Bild-ID", () => {
    const putImageEdit = vi.fn(() => Promise.resolve());
    const st = editState(0.1);
    renderHook(() => useEditAutosave({ putImageEdit }, null, st));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(putImageEdit).not.toHaveBeenCalled();
  });

  it("Fehler -> Status error und Retry mit Backoff", async () => {
    const putImageEdit = vi
      .fn<(id: string, s: ImageEditState, o?: { keepalive?: boolean }) => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const api = { putImageEdit };
    // Stabile Referenz wie im Editor (useMemo) — sonst startet jedes Render neu.
    const st = editState(0.4);
    const { result } = renderHook(() => useEditAutosave(api, "img-1", st));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(result.current.status).toBe("error");
    expect(putImageEdit).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(putImageEdit).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(putImageEdit).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("saved");
  });
});

describe("AutosaveIndicator", () => {
  it("zeigt Hinweis bei Fehler mit role=status", () => {
    render(<AutosaveIndicator status="error" />);
    const el = screen.getByTestId("autosave-status");
    expect(el.getAttribute("role")).toBe("status");
    expect(el.textContent).toMatch(/Nicht gespeichert/);
  });

  it("bleibt im Normalzustand leer (Live-Region bleibt gemountet)", () => {
    render(<AutosaveIndicator status="saved" />);
    expect(screen.getByTestId("autosave-status").textContent).toBe("");
  });
});
