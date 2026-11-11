import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  THUMBNAIL_MAX_BYTES,
  createThumbnailScheduler,
  drawThumbnail,
  encodeThumbnail,
  fitLongEdge,
  flipToRotation,
  thumbnailSize,
} from "../src/editor/thumbnail";

describe("fitLongEdge", () => {
  it("Querformat wird auf 1600 lange Kante verkleinert", () => {
    expect(fitLongEdge(6000, 4000, 1600)).toEqual({ width: 1600, height: 1067 });
  });

  it("Hochformat behaelt das Seitenverhaeltnis", () => {
    expect(fitLongEdge(3000, 4500, 1600)).toEqual({ width: 1067, height: 1600 });
  });

  it("kleine Bilder werden nicht hochskaliert", () => {
    expect(fitLongEdge(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("extreme Panoramen behalten mindestens 1 px", () => {
    expect(fitLongEdge(100000, 10, 1600)).toEqual({ width: 1600, height: 1 });
  });

  it("ungueltige Groessen liefern 1x1", () => {
    expect(fitLongEdge(0, 100, 1600)).toEqual({ width: 1, height: 1 });
    expect(fitLongEdge(Number.NaN, 100, 1600)).toEqual({ width: 1, height: 1 });
  });
});

describe("flipToRotation / thumbnailSize", () => {
  it("LibRaw-flip wird auf Drehung im Uhrzeigersinn abgebildet", () => {
    expect(flipToRotation(0)).toBe(0);
    expect(flipToRotation(3)).toBe(180);
    expect(flipToRotation(5)).toBe(270);
    expect(flipToRotation(6)).toBe(90);
    expect(flipToRotation(42)).toBe(0);
  });

  it("90 Grad tauscht Breite und Hoehe", () => {
    expect(thumbnailSize(6000, 4000, 90)).toEqual({ width: 1067, height: 1600 });
    expect(thumbnailSize(6000, 4000, 180)).toEqual({ width: 1600, height: 1067 });
  });
});

function fakeCtx() {
  return {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    translate: vi.fn(),
    rotate: vi.fn(),
    drawImage: vi.fn(),
  };
}

describe("drawThumbnail", () => {
  afterEach(() => vi.restoreAllMocks());

  it("zeichnet gedreht in ein Canvas der Zielgroesse", () => {
    const ctx = fakeCtx();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as unknown as never,
    );
    const src = {} as CanvasImageSource;
    const canvas = drawThumbnail(src, 6000, 4000, 90);
    expect(canvas.width).toBe(1067);
    expect(canvas.height).toBe(1600);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    // Vor der Drehung: Breite/Hoehe vertauscht gezeichnet.
    expect(ctx.drawImage).toHaveBeenCalledWith(src, -800, -533.5, 1600, 1067);
    expect(ctx.imageSmoothingQuality).toBe("high");
  });

  it("ohne 2D-Kontext wirft es", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(() => drawThumbnail({} as CanvasImageSource, 10, 10)).toThrow();
  });
});

function canvasWithSizes(sizeFor: (q: number) => number | null) {
  const qualities: number[] = [];
  const canvas = {
    toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => {
      expect(type).toBe("image/jpeg");
      qualities.push(q);
      const size = sizeFor(q);
      cb(size === null ? null : new Blob([new Uint8Array(size)], { type }));
    },
  } as unknown as HTMLCanvasElement;
  return { canvas, qualities };
}

describe("encodeThumbnail", () => {
  it("nutzt JPEG mit Qualitaet 0.85", async () => {
    const { canvas, qualities } = canvasWithSizes(() => 1000);
    const blob = await encodeThumbnail(canvas);
    expect(blob?.size).toBe(1000);
    expect(qualities).toEqual([0.85]);
  });

  it("senkt die Qualitaet, bis die Server-Grenze passt", async () => {
    const { canvas, qualities } = canvasWithSizes((q) =>
      q > 0.6 ? THUMBNAIL_MAX_BYTES + 1 : 5000,
    );
    const blob = await encodeThumbnail(canvas);
    expect(blob?.size).toBe(5000);
    expect(qualities).toEqual([0.85, 0.7, 0.5]);
  });

  it("liefert null, wenn nichts unter die Grenze passt", async () => {
    const { canvas } = canvasWithSizes(() => THUMBNAIL_MAX_BYTES + 1);
    expect(await encodeThumbnail(canvas)).toBeNull();
  });

  it("liefert null, wenn der Browser nicht kodieren kann", async () => {
    const { canvas } = canvasWithSizes(() => null);
    expect(await encodeThumbnail(canvas)).toBeNull();
  });
});

describe("createThumbnailScheduler", () => {
  let clock = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
  });
  afterEach(() => vi.useRealTimers());

  function make() {
    const run = vi.fn<(id: string) => void>();
    const s = createThumbnailScheduler({ intervalMs: 10_000, now: () => clock }, run);
    const advance = (ms: number) => {
      clock += ms;
      vi.advanceTimersByTime(ms);
    };
    return { s, run, advance };
  }

  it("erster Save laedt sofort hoch", () => {
    const { s, run } = make();
    s.notifySaved("a");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("a");
  });

  it("weitere Saves im Intervall ergeben genau einen nachlaufenden Upload", () => {
    const { s, run, advance } = make();
    s.notifySaved("a");
    advance(2000);
    s.notifySaved("a");
    advance(3000);
    s.notifySaved("a");
    expect(run).toHaveBeenCalledTimes(1);
    advance(4999);
    expect(run).toHaveBeenCalledTimes(1);
    advance(1);
    expect(run).toHaveBeenCalledTimes(2);
    advance(60_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("hoechstens ein Upload pro 10 s auch bei Dauer-Saves", () => {
    const { s, run, advance } = make();
    for (let t = 0; t < 60_000; t += 1000) {
      s.notifySaved("a");
      advance(1000);
    }
    expect(run.mock.calls.length).toBeLessThanOrEqual(7);
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it("Bilder werden unabhaengig gedrosselt", () => {
    const { s, run } = make();
    s.notifySaved("a");
    s.notifySaved("b");
    expect(run.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
  });

  it("flush laedt ausstehenden Stand sofort hoch und stoppt den Timer", () => {
    const { s, run, advance } = make();
    s.notifySaved("a");
    s.notifySaved("a");
    s.flush("a");
    expect(run).toHaveBeenCalledTimes(2);
    advance(20_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("flush ohne Aenderung tut nichts", () => {
    const { s, run } = make();
    s.flush("a");
    s.notifySaved("a");
    s.flush("a");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("markDirty sorgt fuer Upload beim Verlassen", () => {
    const { s, run } = make();
    s.markDirty("a");
    expect(run).not.toHaveBeenCalled();
    s.flush("a");
    expect(run).toHaveBeenCalledWith("a");
  });

  it("dispose verwirft den nachlaufenden Upload", () => {
    const { s, run, advance } = make();
    s.notifySaved("a");
    s.notifySaved("a");
    s.dispose();
    advance(20_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("setRunner ersetzt die ausfuehrende Funktion", () => {
    const { s, run } = make();
    const other = vi.fn<(id: string) => void>();
    s.setRunner(other);
    s.notifySaved("a");
    expect(run).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledWith("a");
  });
});
