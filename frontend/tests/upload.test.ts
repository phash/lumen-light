import { describe, expect, it, vi, type Mock } from "vitest";

import type { ApiClient, Image, ImageInit } from "../src/api/client";
import { uploadImage } from "../src/api/upload";

interface FakeApi extends ApiClient {
  initUpload: Mock;
  confirmUpload: Mock;
}

function makeFakeApi(): FakeApi {
  return {
    me: vi.fn(),
    listPresets: vi.fn(),
    createPreset: vi.fn(),
    updatePreset: vi.fn(),
    deletePreset: vi.fn(),
    listImages: vi.fn(),
    initUpload: vi.fn(),
    confirmUpload: vi.fn(),
    getImageUrl: vi.fn(),
    deleteImage: vi.fn(),
  };
}

const fakeFile = new File([new Uint8Array([1, 2, 3, 4])], "photo.jpg", {
  type: "image/jpeg",
});

describe("uploadImage", () => {
  it("init -> PUT to presigned -> confirm", async () => {
    const api = makeFakeApi();
    const init: ImageInit = {
      id: "img-1",
      upload_url: "https://garage.local/bucket/key",
      expires_in: 900,
    };
    const confirmed: Image = {
      id: "img-1",
      original_filename: "photo.jpg",
      content_type: "image/jpeg",
      size_bytes: 4,
      upload_state: "ready",
      created_at: "now",
      confirmed_at: "now",
    };
    api.initUpload.mockResolvedValue(init);
    api.confirmUpload.mockResolvedValue(confirmed);

    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );

    const result = await uploadImage(api, fakeFile, {
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(api.initUpload).toHaveBeenCalledWith("photo.jpg", "image/jpeg", 4);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://garage.local/bucket/key",
      expect.objectContaining({ method: "PUT", body: fakeFile }),
    );
    expect(api.confirmUpload).toHaveBeenCalledWith("img-1");
    expect(result).toEqual(confirmed);
  });

  it("wirft bei S3-PUT-Fehler", async () => {
    const api = makeFakeApi();
    api.initUpload.mockResolvedValue({
      id: "img-1",
      upload_url: "u",
      expires_in: 900,
    } satisfies ImageInit);
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 403, statusText: "Forbidden" })),
    );

    await expect(
      uploadImage(api, fakeFile, { fetch: fetchMock as unknown as typeof fetch }),
    ).rejects.toThrow(/Upload nach S3 fehlgeschlagen/);
    expect(api.confirmUpload).not.toHaveBeenCalled();
  });

  it("propagiert init-Fehler vom Backend", async () => {
    const api = makeFakeApi();
    api.initUpload.mockRejectedValue(new Error("size_bytes ueber Maximum"));
    const fetchMock = vi.fn();

    await expect(
      uploadImage(api, fakeFile, { fetch: fetchMock as unknown as typeof fetch }),
    ).rejects.toThrow("size_bytes ueber Maximum");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
