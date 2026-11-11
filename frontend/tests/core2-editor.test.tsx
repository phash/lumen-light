import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImageEditState } from "../src/api/client";
import type { CanvasHandle } from "../src/editor/Canvas";
import { useEditorStore } from "../src/editor/store";

// --- Mocks -----------------------------------------------------------------

interface CanvasProps {
  readonly onError: (msg: string) => void;
  readonly onRecovered?: () => void;
}

const canvasState: {
  props: CanvasProps | null;
  loadFile: (file: File) => Promise<{ width: number; height: number } | null>;
} = {
  props: null,
  loadFile: () => Promise.resolve({ width: 100, height: 50 }),
};

vi.mock("../src/editor/Canvas", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/editor/Canvas")>();
  const FakeCanvas = forwardRef<CanvasHandle, CanvasProps>(function FakeCanvas(props, ref) {
    canvasState.props = props;
    useImperativeHandle(ref, () => ({
      loadFile: (file: File) => canvasState.loadFile(file),
      loadBitmap: () => undefined,
      loadRgb16: () => undefined,
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
  return { ...orig, isRawFile: () => Promise.resolve(false) };
});

vi.mock("../src/onboarding/state", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/onboarding/state")>();
  return { ...orig, getOnboardingState: () => "completed" as const };
});

const IMAGE_ID = "11111111-2222-3333-4444-555555555555";

const fakeApi = {
  listImages: vi.fn(),
  getImageUrl: vi.fn(),
  getImageEdit: vi.fn(),
  putImageEdit: vi.fn(),
  putImageThumbnail: vi.fn(),
  updateImage: vi.fn(),
  updateImages: vi.fn(),
  listPresets: vi.fn(),
};

vi.mock("../src/api/use-api", () => ({ useApi: () => fakeApi }));

// Import nach den Mocks.
const { default: Editor } = await import("../src/pages/Editor");
const { CONTEXT_LOST_MESSAGE } = await import("../src/editor/Canvas");

// --- Helpers ---------------------------------------------------------------

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function editOf(exposure: number): ImageEditState {
  return {
    adjustments: {
      ...useEditorStore.getState().adjustments,
      exposure,
    },
    masks: [],
    crop: null,
    straightenAngle: 0,
    lensCorrection: null,
    lensProfileId: null,
    manualLensOverride: false,
  };
}

function renderEditor(path = "/editor") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <nav>
        <Link to="/marketplace">Zum Markt</Link>
        <Link to="/editor">Editor</Link>
        <a href="/marketplace" target="_blank">Neuer Tab</a>
      </nav>
      <Routes>
        <Route path="/editor" element={<Editor />} />
        <Route path="/marketplace" element={<p>MARKET</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function dropFile(name = "b.jpg") {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: "image/jpeg" });
  const main = screen.getByTestId("page-editor").querySelector("main");
  if (!main) throw new Error("main fehlt");
  fireEvent.drop(main, { dataTransfer: { files: [file] } });
}

async function openLocalImage() {
  await act(async () => {
    dropFile();
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByTestId("editor-bypass")).toBeInTheDocument());
}

beforeEach(() => {
  useEditorStore.getState().resetForNewImage();
  canvasState.props = null;
  canvasState.loadFile = () => Promise.resolve({ width: 100, height: 50 });
  fakeApi.listImages.mockResolvedValue([
    { id: IMAGE_ID, originalFilename: "a.jpg", contentType: "image/jpeg" },
  ]);
  fakeApi.getImageUrl.mockResolvedValue({ url: "http://s3/a.jpg" });
  fakeApi.getImageEdit.mockResolvedValue(null);
  fakeApi.putImageEdit.mockResolvedValue(undefined);
  fakeApi.listPresets.mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// --- Tests -----------------------------------------------------------------

describe("Editor Lade-Generationen", () => {
  it("Bibliotheks-Load A wird von Datei B abgeloest -> A-Stand nicht angewendet", async () => {
    const edit = deferred<ImageEditState | null>();
    fakeApi.getImageEdit.mockReturnValue(edit.promise);
    renderEditor(`/editor?image=${IMAGE_ID}`);
    await waitFor(() => expect(fakeApi.getImageEdit).toHaveBeenCalled());
    await openLocalImage();
    await act(async () => {
      edit.resolve(editOf(0.9));
      await Promise.resolve();
    });
    expect(useEditorStore.getState().adjustments.exposure).toBe(0);
    // storedImageId leer -> kein Autosave-Hinweis gemountet, kein PUT.
    expect(screen.queryByTestId("autosave-status")).toBeNull();
    expect(fakeApi.putImageEdit).not.toHaveBeenCalled();
  });

  it("Fehler des abgeloesten Loads A wird nicht angezeigt", async () => {
    const edit = deferred<ImageEditState | null>();
    fakeApi.getImageEdit.mockReturnValue(edit.promise);
    renderEditor(`/editor?image=${IMAGE_ID}`);
    await waitFor(() => expect(fakeApi.getImageEdit).toHaveBeenCalled());
    await openLocalImage();
    await act(async () => {
      edit.reject(new Error("A kaputt"));
      await Promise.resolve();
    });
    expect(screen.queryByTestId("editor-error")).toBeNull();
  });

  it("libraryLoading wird beim Abloesen durch eine Datei zurueckgesetzt", async () => {
    const list = deferred<unknown[]>();
    fakeApi.listImages.mockReturnValue(list.promise);
    canvasState.loadFile = () => Promise.reject(new Error("B kaputt"));
    renderEditor(`/editor?image=${IMAGE_ID}`);
    await waitFor(() => expect(screen.getByTestId("editor-library-loading")).toBeInTheDocument());
    await act(async () => {
      dropFile();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("editor-error")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("editor-error-dismiss"));
    expect(screen.queryByTestId("editor-library-loading")).toBeNull();
  });
});

describe("Editor Verlassen-Schutz", () => {
  it("beforeunload: lokales Bild ohne Speicherung -> preventDefault", async () => {
    renderEditor();
    await openLocalImage();
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("beforeunload: gespeichertes Bibliotheksbild -> kein preventDefault", async () => {
    renderEditor(`/editor?image=${IMAGE_ID}`);
    await waitFor(() => expect(screen.getByTestId("autosave-status")).toBeInTheDocument());
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("In-App-Link mit lokalem Bild fragt nach, Abbrechen bleibt im Editor", async () => {
    renderEditor();
    await openLocalImage();
    fireEvent.click(screen.getByRole("link", { name: "Zum Markt" }));
    expect(screen.getByRole("dialog", { name: "Ungespeichertes Bild verwerfen?" })).toBeInTheDocument();
    expect(screen.queryByText("MARKET")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("page-editor")).toBeInTheDocument();
  });

  it("Verwerfen navigiert zum Link-Ziel", async () => {
    renderEditor();
    await openLocalImage();
    fireEvent.click(screen.getByRole("link", { name: "Zum Markt" }));
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }));
    expect(screen.getByText("MARKET")).toBeInTheDocument();
  });

  it("ohne Bild navigiert der Link direkt", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("link", { name: "Zum Markt" }));
    expect(screen.getByText("MARKET")).toBeInTheDocument();
  });

  it("Modifier-Klick, target=_blank und Link auf den Editor selbst fragen nicht", async () => {
    renderEditor();
    await openLocalImage();
    fireEvent.click(screen.getByRole("link", { name: "Zum Markt" }), { ctrlKey: true });
    fireEvent.click(screen.getByRole("link", { name: "Neuer Tab" }));
    fireEvent.click(screen.getByRole("link", { name: "Editor" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("gespeichertes Bild navigiert ohne Nachfrage", async () => {
    renderEditor(`/editor?image=${IMAGE_ID}`);
    await waitFor(() => expect(screen.getByTestId("autosave-status")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("link", { name: "Zum Markt" }));
    expect(screen.getByText("MARKET")).toBeInTheDocument();
  });
});

describe("Editor Viewport", () => {
  function wrapper(): HTMLElement {
    const el = screen.getByTestId("editor-canvas").parentElement;
    if (!el) throw new Error("wrapper fehlt");
    return el;
  }

  it("Shift+Pfeil verschiebt die Ansicht per Tastatur", async () => {
    renderEditor();
    await openLocalImage();
    const viewport = screen.getByRole("main", { name: "Bildansicht" });
    expect(viewport.tabIndex).toBe(0);
    fireEvent.keyDown(viewport, { key: "ArrowRight", shiftKey: true });
    expect(wrapper().style.transform).toContain("translate(40px, 0px)");
    fireEvent.keyDown(viewport, { key: "ArrowUp", shiftKey: true });
    expect(wrapper().style.transform).toContain("translate(40px, -40px)");
    // Ohne Shift: keine Verschiebung.
    fireEvent.keyDown(viewport, { key: "ArrowLeft" });
    expect(wrapper().style.transform).toContain("translate(40px, -40px)");
  });

  it("setzt --overlay-inv-zoom = 1/zoom am Transform-Wrapper", async () => {
    renderEditor();
    await openLocalImage();
    expect(wrapper().style.getPropertyValue("--overlay-inv-zoom")).toBe("1");
    fireEvent.keyDown(window, { key: "+" });
    expect(Number(wrapper().style.getPropertyValue("--overlay-inv-zoom"))).toBeCloseTo(0.8);
  });

  it("Layout nutzt dynamische Viewport-Hoehe", () => {
    renderEditor();
    expect(screen.getByTestId("page-editor").style.height).toContain("100dvh");
  });
});

describe("Editor Grafikkontext", () => {
  it("onRecovered loescht den Kontextverlust-Hinweis", async () => {
    renderEditor();
    await openLocalImage();
    act(() => {
      canvasState.props?.onError(CONTEXT_LOST_MESSAGE);
    });
    expect(screen.getByTestId("editor-error")).toHaveTextContent("Grafikkontext verloren");
    act(() => {
      canvasState.props?.onRecovered?.();
    });
    expect(screen.queryByTestId("editor-error")).toBeNull();
  });

  it("onRecovered laesst andere Fehler stehen", async () => {
    renderEditor();
    await openLocalImage();
    act(() => {
      canvasState.props?.onError("Anderer Fehler");
    });
    act(() => {
      canvasState.props?.onRecovered?.();
    });
    expect(screen.getByTestId("editor-error")).toHaveTextContent("Anderer Fehler");
  });
});
