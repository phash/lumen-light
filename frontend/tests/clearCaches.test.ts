import { afterEach, describe, expect, it, vi } from "vitest";

import { clearOfflineCaches } from "../src/auth/clearCaches";

describe("clearOfflineCaches", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loescht alle Cache-Storage-Eintraege", async () => {
    const del = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal("caches", {
      keys: vi.fn(() => Promise.resolve(["lumen-v1-runtime", "lumen-v2-runtime"])),
      delete: del,
    });
    await clearOfflineCaches();
    expect(del).toHaveBeenCalledWith("lumen-v1-runtime");
    expect(del).toHaveBeenCalledWith("lumen-v2-runtime");
  });

  it("wirft nicht ohne Cache-API", async () => {
    vi.stubGlobal("caches", undefined);
    await expect(clearOfflineCaches()).resolves.toBeUndefined();
  });

  it("wirft nicht wenn die Cache-API fehlschlaegt", async () => {
    vi.stubGlobal("caches", {
      keys: vi.fn(() => Promise.reject(new Error("SecurityError"))),
      delete: vi.fn(),
    });
    await expect(clearOfflineCaches()).resolves.toBeUndefined();
  });
});
