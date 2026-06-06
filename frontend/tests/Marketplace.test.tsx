import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, type Mock } from "vitest";

import * as useApiModule from "../src/api/use-api";
import type {
  ApiClient,
  MarketplaceDetail,
  MarketplaceList,
  MarketplaceListItem,
} from "../src/api/client";
import { defaultAdjustments } from "../src/editor/adjustments";
import Marketplace from "../src/pages/Marketplace";
import { makeFakeAuth, makeFakeUser, renderWithAuth } from "./test-utils";

interface FakeApi extends ApiClient {
  listMarketplacePresets: Mock;
  getMarketplacePreset: Mock;
  applyMarketplacePreset: Mock;
  forkMarketplacePreset: Mock;
  reportMarketplacePreset: Mock;
}

function makeFakeApi(): FakeApi {
  return {
    me: vi.fn(),
    deleteMe: vi.fn(),
    exportMe: vi.fn(),
    listPresets: vi.fn(),
    createPreset: vi.fn(),
    updatePreset: vi.fn(),
    deletePreset: vi.fn(),
    listImages: vi.fn(),
    initUpload: vi.fn(),
    confirmUpload: vi.fn(),
    getImageUrl: vi.fn(),
    deleteImage: vi.fn(),
    getImageEdit: vi.fn(),
    putImageEdit: vi.fn(),
    listMarketplacePresets: vi.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
    } satisfies MarketplaceList),
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

function makeItem(overrides: Partial<MarketplaceListItem> = {}): MarketplaceListItem {
  return {
    id: "p-1",
    name: "Warmer Look",
    genre: "portrait",
    description: "Hauttoene waermen",
    creatorHandle: "anna",
    applyCount: 12,
    publishedAt: "2026-04-28T00:00:00Z",
    previewUrl: null,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<MarketplaceDetail> = {}): MarketplaceDetail {
  return {
    ...makeItem(),
    creatorBio: null,
    ...overrides,
  };
}

function render(api: FakeApi) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue(api);
  return renderWithAuth(<Marketplace />, {
    auth: makeFakeAuth({ isAuthenticated: true, user: makeFakeUser() }),
    wrapper: (c) => <MemoryRouter>{c}</MemoryRouter>,
  });
}

describe("Marketplace", () => {
  it("zeigt Empty-State wenn keine Presets gelistet sind", async () => {
    render(makeFakeApi());
    await waitFor(() => {
      expect(screen.getByTestId("marketplace-empty")).toBeInTheDocument();
    });
  });

  it("rendert Karten aus dem Listing", async () => {
    const api = makeFakeApi();
    api.listMarketplacePresets.mockResolvedValue({
      items: [
        makeItem({ id: "p-a", name: "Look A" }),
        makeItem({ id: "p-b", name: "Look B" }),
      ],
      nextCursor: null,
    });
    render(api);
    await waitFor(() => {
      expect(screen.getByTestId("marketplace-card-p-a")).toBeInTheDocument();
      expect(screen.getByTestId("marketplace-card-p-b")).toBeInTheDocument();
    });
  });

  it("Genre-Filter ruft API mit genre-Parameter", async () => {
    const api = makeFakeApi();
    render(api);
    await waitFor(() => expect(api.listMarketplacePresets).toHaveBeenCalled());
    api.listMarketplacePresets.mockClear();
    await userEvent.click(screen.getByTestId("marketplace-genre-portrait"));
    await waitFor(() =>
      expect(api.listMarketplacePresets).toHaveBeenCalledWith(
        expect.objectContaining({ genre: "portrait" }),
      ),
    );
  });

  it("Card-Klick oeffnet Detail-Modal", async () => {
    const api = makeFakeApi();
    api.listMarketplacePresets.mockResolvedValue({
      items: [makeItem({ id: "p-x" })],
      nextCursor: null,
    });
    api.getMarketplacePreset.mockResolvedValue(makeDetail({ id: "p-x" }));
    render(api);
    await userEvent.click(await screen.findByTestId("marketplace-card-p-x"));
    await waitFor(() => {
      expect(screen.getByTestId("marketplace-detail-modal")).toBeInTheDocument();
    });
    expect(api.getMarketplacePreset).toHaveBeenCalledWith("p-x");
  });

  it("Apply ruft API + uebernimmt Adjustments", async () => {
    const api = makeFakeApi();
    api.listMarketplacePresets.mockResolvedValue({
      items: [makeItem({ id: "p-x" })],
      nextCursor: null,
    });
    api.getMarketplacePreset.mockResolvedValue(makeDetail({ id: "p-x" }));
    api.applyMarketplacePreset.mockResolvedValue({
      adjustments: { ...defaultAdjustments(), exposure: 1.5 },
      masks: [],
    });
    render(api);
    await userEvent.click(await screen.findByTestId("marketplace-card-p-x"));
    await userEvent.click(await screen.findByTestId("marketplace-apply"));
    await waitFor(() =>
      expect(api.applyMarketplacePreset).toHaveBeenCalledWith("p-x"),
    );
  });

  it("Fork ruft API + zeigt Feedback", async () => {
    const api = makeFakeApi();
    api.listMarketplacePresets.mockResolvedValue({
      items: [makeItem({ id: "p-x" })],
      nextCursor: null,
    });
    api.getMarketplacePreset.mockResolvedValue(makeDetail({ id: "p-x" }));
    api.forkMarketplacePreset.mockResolvedValue({});
    render(api);
    await userEvent.click(await screen.findByTestId("marketplace-card-p-x"));
    await userEvent.click(await screen.findByTestId("marketplace-fork"));
    await waitFor(() =>
      expect(api.forkMarketplacePreset).toHaveBeenCalledWith("p-x"),
    );
    expect(await screen.findByText(/In deine Bibliothek kopiert/)).toBeInTheDocument();
  });

  it("Report sendet reason an API", async () => {
    const api = makeFakeApi();
    api.listMarketplacePresets.mockResolvedValue({
      items: [makeItem({ id: "p-x" })],
      nextCursor: null,
    });
    api.getMarketplacePreset.mockResolvedValue(makeDetail({ id: "p-x" }));
    api.reportMarketplacePreset.mockResolvedValue(undefined);
    render(api);
    await userEvent.click(await screen.findByTestId("marketplace-card-p-x"));
    await userEvent.type(
      await screen.findByTestId("marketplace-report-reason"),
      "Spam",
    );
    await userEvent.click(screen.getByTestId("marketplace-report-submit"));
    await waitFor(() =>
      expect(api.reportMarketplacePreset).toHaveBeenCalledWith("p-x", "Spam"),
    );
  });

  it("Mehr-laden uebergibt Cursor", async () => {
    const api = makeFakeApi();
    api.listMarketplacePresets
      .mockResolvedValueOnce({
        items: [makeItem({ id: "p-1" })],
        nextCursor: "MTAw",
      })
      .mockResolvedValueOnce({
        items: [makeItem({ id: "p-2" })],
        nextCursor: null,
      });
    render(api);
    await screen.findByTestId("marketplace-card-p-1");
    await userEvent.click(screen.getByTestId("marketplace-load-more"));
    await waitFor(() =>
      expect(api.listMarketplacePresets).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: "MTAw" }),
      ),
    );
    expect(await screen.findByTestId("marketplace-card-p-2")).toBeInTheDocument();
  });
});

describe("Marketplace ohne Login (public browse)", () => {
  function renderAnon(api: FakeApi) {
    vi.spyOn(useApiModule, "useApi").mockReturnValue(api);
    return renderWithAuth(
      <Routes>
        <Route path="/marketplace" element={<Marketplace />} />
        <Route path="/login" element={<div data-testid="login-page">login</div>} />
      </Routes>,
      {
        auth: makeFakeAuth({ isAuthenticated: false, user: null }),
        wrapper: (c) => (
          <MemoryRouter initialEntries={["/marketplace"]}>{c}</MemoryRouter>
        ),
      },
    );
  }

  it("Browsen + Detail funktionieren ohne Login", async () => {
    const api = makeFakeApi();
    api.listMarketplacePresets.mockResolvedValue({
      items: [makeItem({ id: "p-x" })],
      nextCursor: null,
    });
    api.getMarketplacePreset.mockResolvedValue(makeDetail({ id: "p-x" }));
    renderAnon(api);
    await userEvent.click(await screen.findByTestId("marketplace-card-p-x"));
    expect(await screen.findByTestId("marketplace-detail-modal")).toBeInTheDocument();
  });

  it("Anwenden ohne Login leitet zur Login-Seite, ohne die gated API zu rufen", async () => {
    const api = makeFakeApi();
    api.listMarketplacePresets.mockResolvedValue({
      items: [makeItem({ id: "p-x" })],
      nextCursor: null,
    });
    api.getMarketplacePreset.mockResolvedValue(makeDetail({ id: "p-x" }));
    renderAnon(api);
    await userEvent.click(await screen.findByTestId("marketplace-card-p-x"));
    await userEvent.click(await screen.findByTestId("marketplace-apply"));
    expect(api.applyMarketplacePreset).not.toHaveBeenCalled();
    expect(await screen.findByTestId("login-page")).toBeInTheDocument();
  });

  it("Fork ohne Login leitet zur Login-Seite, ohne die gated API zu rufen", async () => {
    const api = makeFakeApi();
    api.listMarketplacePresets.mockResolvedValue({
      items: [makeItem({ id: "p-x" })],
      nextCursor: null,
    });
    api.getMarketplacePreset.mockResolvedValue(makeDetail({ id: "p-x" }));
    renderAnon(api);
    await userEvent.click(await screen.findByTestId("marketplace-card-p-x"));
    await userEvent.click(await screen.findByTestId("marketplace-fork"));
    expect(api.forkMarketplacePreset).not.toHaveBeenCalled();
    expect(await screen.findByTestId("login-page")).toBeInTheDocument();
  });

  it("Melden ohne Login leitet zur Login-Seite, ohne die gated API zu rufen", async () => {
    const api = makeFakeApi();
    api.listMarketplacePresets.mockResolvedValue({
      items: [makeItem({ id: "p-x" })],
      nextCursor: null,
    });
    api.getMarketplacePreset.mockResolvedValue(makeDetail({ id: "p-x" }));
    renderAnon(api);
    await userEvent.click(await screen.findByTestId("marketplace-card-p-x"));
    await userEvent.type(
      await screen.findByTestId("marketplace-report-reason"),
      "Spam",
    );
    await userEvent.click(screen.getByTestId("marketplace-report-submit"));
    expect(api.reportMarketplacePreset).not.toHaveBeenCalled();
    expect(await screen.findByTestId("login-page")).toBeInTheDocument();
  });

  it("zeigt anonymen Nutzern einen Anmelde-Hinweis im Detail-Modal", async () => {
    const api = makeFakeApi();
    api.listMarketplacePresets.mockResolvedValue({
      items: [makeItem({ id: "p-x" })],
      nextCursor: null,
    });
    api.getMarketplacePreset.mockResolvedValue(makeDetail({ id: "p-x" }));
    renderAnon(api);
    await userEvent.click(await screen.findByTestId("marketplace-card-p-x"));
    expect(await screen.findByTestId("marketplace-anon-hint")).toBeInTheDocument();
  });
});
