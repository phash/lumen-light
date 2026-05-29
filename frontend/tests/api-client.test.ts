import { describe, expect, it } from "vitest";

import { ApiError, createApiClient } from "../src/api/client";
import type { User as OidcUser } from "oidc-client-ts";

function urlString(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function makeFetchMock(
  status: number,
  body: unknown = {},
): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push({ url: urlString(input), init: init ?? {} });
    const response = new Response(
      status === 204 ? null : JSON.stringify(body),
      { status, headers: { "Content-Type": "application/json" } },
    );
    return Promise.resolve(response);
  };
  return { fetchImpl, calls };
}

describe("createApiClient", () => {
  it("setzt Authorization-Header wenn ein User vorhanden ist", async () => {
    const { fetchImpl, calls } = makeFetchMock(200, {
      id: "u",
      email: "a@b",
      createdAt: "x",
    });
    const client = createApiClient({
      baseUrl: "http://api.test/api/v1",
      getUser: () =>
        ({ access_token: "abc123" } as unknown as OidcUser),
      fetch: fetchImpl,
    });
    await client.me();

    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("Authorization")).toBe("Bearer abc123");
  });

  it("setzt keinen Authorization-Header wenn User null ist", async () => {
    const { fetchImpl, calls } = makeFetchMock(200, []);
    const client = createApiClient({
      baseUrl: "http://api.test/api/v1",
      getUser: () => null,
      fetch: fetchImpl,
    });
    await client.listPresets();

    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.has("Authorization")).toBe(false);
  });

  it("wirft ApiError mit detail bei 4xx", async () => {
    const { fetchImpl } = makeFetchMock(404, {
      detail: "nicht gefunden",
      code: "PRESET_NOT_FOUND",
    });
    const client = createApiClient({
      baseUrl: "http://api.test/api/v1",
      getUser: () => null,
      fetch: fetchImpl,
    });
    await expect(client.deletePreset("abc")).rejects.toMatchObject({
      status: 404,
      message: "nicht gefunden",
      code: "PRESET_NOT_FOUND",
    });
    await expect(client.deletePreset("abc")).rejects.toBeInstanceOf(ApiError);
  });

  it("liefert undefined bei 204 (z. B. DELETE)", async () => {
    const { fetchImpl } = makeFetchMock(204);
    const client = createApiClient({
      baseUrl: "http://api.test/api/v1",
      getUser: () => null,
      fetch: fetchImpl,
    });
    const result = await client.deletePreset("abc");
    expect(result).toBeUndefined();
  });

  it("getImageEdit liefert null bei 404 (kein gespeicherter Stand)", async () => {
    const { fetchImpl } = makeFetchMock(404, { detail: "Kein Stand." });
    const client = createApiClient({
      baseUrl: "http://api.test/api/v1",
      getUser: () => null,
      fetch: fetchImpl,
    });
    await expect(client.getImageEdit("img-1")).resolves.toBeNull();
  });

  it("getImageEdit reicht Nicht-404-Fehler durch", async () => {
    const { fetchImpl } = makeFetchMock(500, { detail: "boom" });
    const client = createApiClient({
      baseUrl: "http://api.test/api/v1",
      getUser: () => null,
      fetch: fetchImpl,
    });
    await expect(client.getImageEdit("img-1")).rejects.toBeInstanceOf(ApiError);
  });

  it("putImageEdit schickt PUT auf den Edit-Endpoint", async () => {
    const { fetchImpl, calls } = makeFetchMock(204);
    const client = createApiClient({
      baseUrl: "http://api.test/api/v1",
      getUser: () => null,
      fetch: fetchImpl,
    });
    await client.putImageEdit("img-1", {
      adjustments: {
        exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0,
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
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://api.test/api/v1/images/img-1/edit");
    expect(calls[0]!.init.method).toBe("PUT");
  });
});
