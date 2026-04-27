// API-Client für das Lumen-Backend
// Ersetzt das PresetAPI-Stub im Frontend-Prototyp

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000/api/v1';

// ----- Types (manuell oder via openapi-typescript generiert) -----

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

export interface User {
  id: string;
  email: string;
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
}

// ----- Token-Speicher -----
// Access-Token im Memory (volatil, sicher gegen XSS-Persistenz).
// Refresh-Token nach Login wird zurückgegeben und ggf. in HttpOnly-Cookie gepackt
// (alternativ: localStorage, einfacher aber schwächer gegen XSS).

let accessToken: string | null = null;
let refreshToken: string | null = null;

export const auth = {
  getAccessToken: () => accessToken,
  setTokens: (pair: TokenPair) => {
    accessToken = pair.access_token;
    refreshToken = pair.refresh_token;
  },
  clear: () => {
    accessToken = null;
    refreshToken = null;
  },
};

// ----- Fetch-Wrapper mit Auto-Refresh -----

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  // Bei 401: Refresh versuchen, dann Request wiederholen
  if (res.status === 401 && refreshToken && !path.startsWith('/auth/')) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      headers.set('Authorization', `Bearer ${accessToken}`);
      res = await fetch(`${API_BASE}${path}`, { ...init, headers });
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? res.statusText, body.code);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;
    const pair: TokenPair = await res.json();
    auth.setTokens(pair);
    return true;
  } catch {
    return false;
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

// ----- API-Endpoints -----

export const AuthAPI = {
  register: (email: string, password: string) =>
    request<User>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  login: async (email: string, password: string) => {
    const pair = await request<TokenPair>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    auth.setTokens(pair);
    return pair;
  },
  logout: async () => {
    if (refreshToken) {
      await request('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
      }).catch(() => {});
    }
    auth.clear();
  },
  me: () => request<User>('/auth/me'),
};

export const PresetAPI = {
  list: () => request<Preset[]>('/presets'),
  create: (name: string, adjustments: Adjustments) =>
    request<Preset>('/presets', {
      method: 'POST',
      body: JSON.stringify({ name, adjustments }),
    }),
  update: (id: string, name: string, adjustments: Adjustments) =>
    request<Preset>(`/presets/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, adjustments }),
    }),
  remove: (id: string) =>
    request<void>(`/presets/${id}`, { method: 'DELETE' }),
};
