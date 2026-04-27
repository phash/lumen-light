import type { User as OidcUser } from "oidc-client-ts";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface User {
  id: string;
  email: string;
  created_at: string;
}

export interface Adjustments {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  vibrance: number;
  saturation: number;
}

export interface Preset {
  id: string;
  name: string;
  adjustments: Adjustments;
  created_at: string;
  updated_at: string;
}

export type GetUserFn = () => OidcUser | null | undefined;

export interface ApiClient {
  me(): Promise<User>;
  listPresets(): Promise<Preset[]>;
  createPreset(name: string, adjustments: Adjustments): Promise<Preset>;
  updatePreset(id: string, name: string, adjustments: Adjustments): Promise<Preset>;
  deletePreset(id: string): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  getUser: GetUserFn;
  fetch?: typeof fetch;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const user = options.getUser();
    if (user?.access_token) {
      headers.set("Authorization", `Bearer ${user.access_token}`);
    }
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetchImpl(`${base}${path}`, { ...init, headers });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({
        detail: res.statusText,
      }))) as { detail?: string; code?: string };
      throw new ApiError(res.status, body.detail ?? res.statusText, body.code);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  return {
    me: () => request<User>("/auth/me"),
    listPresets: () => request<Preset[]>("/presets"),
    createPreset: (name, adjustments) =>
      request<Preset>("/presets", {
        method: "POST",
        body: JSON.stringify({ name, adjustments }),
      }),
    updatePreset: (id, name, adjustments) =>
      request<Preset>(`/presets/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name, adjustments }),
      }),
    deletePreset: (id) =>
      request<void>(`/presets/${id}`, { method: "DELETE" }),
  };
}
