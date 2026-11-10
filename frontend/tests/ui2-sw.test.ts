import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";

const SW_SOURCE = readFileSync(resolve(__dirname, "../public/sw.js"), "utf8");
const ORIGIN = "https://lumen.example";

interface FakeResponse {
  readonly ok: boolean;
  readonly type: string;
  readonly body: string;
  clone(): FakeResponse;
}

function fakeResponse(body: string): FakeResponse {
  const res: FakeResponse = { ok: true, type: "basic", body, clone: () => res };
  return res;
}

type Listener = (event: unknown) => void;

/** Laedt sw.js in einen vm-Kontext mit Fake-self/caches/fetch. */
function loadSw(initialCaches: string[] = []) {
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, Map<string, FakeResponse>>();
  for (const name of initialCaches) stores.set(name, new Map());

  const keyOf = (k: unknown): string =>
    typeof k === "string" ? k : (k as { url: string }).url;

  const caches = {
    keys: vi.fn(() => Promise.resolve([...stores.keys()])),
    delete: vi.fn((name: string) => Promise.resolve(stores.delete(name))),
    open: vi.fn((name: string) => {
      let store = stores.get(name);
      if (!store) {
        store = new Map();
        stores.set(name, store);
      }
      const s = store;
      return Promise.resolve({
        match: (k: unknown) => Promise.resolve(s.get(keyOf(k))),
        put: (k: unknown, v: FakeResponse) => {
          s.set(keyOf(k), v);
          return Promise.resolve();
        },
      });
    }),
  };
  const fetchMock = vi.fn((req: { url: string }) =>
    Promise.resolve(fakeResponse(`net:${req.url}`)),
  );
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: vi.fn(() => Promise.resolve()),
    clients: { claim: vi.fn(() => Promise.resolve()) },
  };
  runInNewContext(SW_SOURCE, { self, caches, fetch: fetchMock, URL, Response, console });

  const dispatchFetch = async (
    path: string,
    mode: "navigate" | "no-cors" = "no-cors",
    method = "GET",
  ) => {
    // Holder-Objekt: TS verengt eine im Callback gesetzte let-Variable sonst auf null.
    const box: { responded: Promise<unknown> | null } = { responded: null };
    const event = {
      request: {
        method,
        url: path.startsWith("http") ? path : `${ORIGIN}${path}`,
        mode,
      },
      respondWith: (p: Promise<unknown>) => {
        box.responded = p;
      },
    };
    listeners.get("fetch")?.(event);
    const handled = box.responded !== null;
    if (box.responded) await box.responded;
    // Hintergrund-cache.put abwarten.
    await new Promise((r) => setTimeout(r, 0));
    return handled;
  };

  const dispatchActivate = async () => {
    const box: { waited: Promise<unknown> | null } = { waited: null };
    listeners.get("activate")?.({
      waitUntil: (p: Promise<unknown>) => {
        box.waited = p;
      },
    });
    if (box.waited) await box.waited;
  };

  const storedKeys = (): string[] =>
    [...stores.values()].flatMap((s) => [...s.keys()]);

  return { dispatchFetch, dispatchActivate, stores, storedKeys, fetchMock, self };
}

describe("Service-Worker sw.js", () => {
  let sw: ReturnType<typeof loadSw>;
  beforeEach(() => {
    sw = loadSw();
  });

  it("OIDC-Callback mit ?code= wird nicht behandelt und nichts gespeichert", async () => {
    const handled = await sw.dispatchFetch("/callback?code=abc&state=xyz", "navigate");
    expect(handled).toBe(false);
    expect(sw.storedKeys()).toEqual([]);
  });

  it("Navigation /editor?image=X wird unter /index.html gespeichert", async () => {
    const handled = await sw.dispatchFetch("/editor?image=secret-id", "navigate");
    expect(handled).toBe(true);
    const keys = sw.storedKeys();
    expect(keys).toEqual(["/index.html"]);
    expect(keys.join()).not.toContain("secret-id");
  });

  it.each([
    "/api/v1/me",
    "/auth/realms/lumen/protocol/openid-connect/token",
    "/lumen-images/u1/originals/x.jpg",
    "/config.js",
    "/assets/x.jpg?X-Amz-Signature=deadbeef",
  ])("%s wird nicht behandelt", async (path) => {
    const handled = await sw.dispatchFetch(path);
    expect(handled).toBe(false);
    expect(sw.storedKeys()).toEqual([]);
  });

  it("Fremd-Origin wird nicht behandelt", async () => {
    const handled = await sw.dispatchFetch("https://cdn.example/lib.js");
    expect(handled).toBe(false);
    expect(sw.fetchMock).not.toHaveBeenCalled();
  });

  it("POST wird nicht behandelt", async () => {
    const handled = await sw.dispatchFetch("/assets/a.js", "no-cors", "POST");
    expect(handled).toBe(false);
  });

  it("statische Assets werden per Stale-While-Revalidate gecacht", async () => {
    await sw.dispatchFetch("/assets/index-abc.js");
    expect(sw.storedKeys()).toEqual([`${ORIGIN}/assets/index-abc.js`]);
  });

  it("activate loescht Caches ohne aktuelles Versions-Praefix", async () => {
    const s = loadSw(["lumen-v1-runtime", "lumen-v2-runtime", "lumen-v3-runtime", "other"]);
    await s.dispatchActivate();
    expect([...s.stores.keys()]).toEqual(["lumen-v3-runtime"]);
    expect(s.self.clients.claim).toHaveBeenCalled();
  });
});
