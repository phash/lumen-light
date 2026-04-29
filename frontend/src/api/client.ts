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
  createdAt: string;
}

export interface HslAxisWire {
  red: number;
  orange: number;
  yellow: number;
  green: number;
  aqua: number;
  blue: number;
  violet: number;
  magenta: number;
}

export interface HslAdjustmentsWire {
  hue: HslAxisWire;
  saturation: HslAxisWire;
  luminance: HslAxisWire;
}

export interface ToneCurveWire {
  points: ReadonlyArray<{ x: number; y: number }>;
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
  sharpness: number;
  noiseReduction: number;
  hsl: HslAdjustmentsWire | null;
  toneCurve: ToneCurveWire | null;
}

export interface PresetMaskLocalAdjustments {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
}

export interface PresetMaskLinearGeometry {
  p1: { u: number; v: number };
  p2: { u: number; v: number };
  feather: number;
}

export interface PresetMaskRadialGeometry {
  center: { u: number; v: number };
  rx: number;
  ry: number;
  feather: number;
}

export interface PresetMaskLinear {
  type: "linear";
  mask: PresetMaskLinearGeometry;
  localAdj: PresetMaskLocalAdjustments;
}

export interface PresetMaskRadial {
  type: "radial";
  mask: PresetMaskRadialGeometry;
  localAdj: PresetMaskLocalAdjustments;
}

export type PresetMask = PresetMaskLinear | PresetMaskRadial;

export type PresetVisibility = "private" | "public";

export type PresetGenre =
  | "portrait"
  | "landscape"
  | "city"
  | "nature"
  | "animals"
  | "sports"
  | "blackandwhite"
  | "other";

export interface Preset {
  id: string;
  name: string;
  adjustments: Adjustments;
  masks: PresetMask[];
  visibility: PresetVisibility;
  genre: PresetGenre | null;
  description: string | null;
  previewImageId: string | null;
  publishedAt: string | null;
  applyCount: number;
  reportCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PresetWritePayload {
  name: string;
  adjustments: Adjustments;
  masks?: PresetMask[];
  visibility?: PresetVisibility;
  genre?: PresetGenre | null;
  description?: string | null;
  previewImageId?: string | null;
}

export type UploadState = "pending" | "ready" | "failed";

export interface Image {
  id: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number | null;
  uploadState: UploadState;
  createdAt: string;
  confirmedAt: string | null;
}

export interface ImageInit {
  id: string;
  uploadUrl: string;
  expiresIn: number;
}

export interface ImageUrl {
  url: string;
  expiresIn: number;
}

export type GetUserFn = () => OidcUser | null | undefined;

export type ImageStateFilter = "ready" | "pending" | "all";

export interface MeExport {
  id: string;
  email: string;
  createdAt: string;
  presets: Preset[];
  images: Array<Image & { downloadUrl: string; downloadUrlExpiresIn: number }>;
}

export interface MarketplaceListItem {
  id: string;
  name: string;
  genre: PresetGenre | null;
  description: string | null;
  creatorHandle: string | null;
  applyCount: number;
  publishedAt: string;
  previewUrl: string | null;
}

export interface MarketplaceList {
  items: MarketplaceListItem[];
  nextCursor: string | null;
}

export interface MarketplaceDetail extends MarketplaceListItem {
  creatorBio: string | null;
}

export interface MarketplaceApply {
  adjustments: Adjustments;
  masks: PresetMask[];
}

export interface Profile {
  id: string;
  handle: string | null;
  bio: string | null;
}

export interface ProfilePayload {
  handle?: string | null;
  bio?: string | null;
}

export interface MarketplaceListQuery {
  genre?: PresetGenre;
  q?: string;
  sort?: "new" | "popular";
  cursor?: string;
  limit?: number;
}

export interface ApiClient {
  me(): Promise<User>;
  deleteMe(): Promise<void>;
  exportMe(): Promise<MeExport>;
  listPresets(): Promise<Preset[]>;
  createPreset(payload: PresetWritePayload): Promise<Preset>;
  updatePreset(id: string, payload: PresetWritePayload): Promise<Preset>;
  deletePreset(id: string): Promise<void>;

  listImages(state?: ImageStateFilter): Promise<Image[]>;
  initUpload(filename: string, contentType: string, sizeBytes: number): Promise<ImageInit>;
  confirmUpload(id: string): Promise<Image>;
  getImageUrl(id: string): Promise<ImageUrl>;
  deleteImage(id: string): Promise<void>;

  listMarketplacePresets(query?: MarketplaceListQuery): Promise<MarketplaceList>;
  getMarketplacePreset(id: string): Promise<MarketplaceDetail>;
  applyMarketplacePreset(id: string): Promise<MarketplaceApply>;
  forkMarketplacePreset(id: string): Promise<Preset>;
  reportMarketplacePreset(id: string, reason: string): Promise<void>;

  getProfile(): Promise<Profile>;
  updateProfile(payload: ProfilePayload): Promise<Profile>;
  listPublishedPresets(): Promise<Preset[]>;

  // Feedback (user-facing)
  submitFeedback(payload: FeedbackPayload): Promise<{ id: string | null }>;

  // Admin
  adminListUsers(): Promise<AdminUser[]>;
  adminPatchUser(id: string, isDisabled: boolean): Promise<AdminUser>;
  adminStats(): Promise<AdminStats>;
  adminListFeedback(status?: AdminFeedbackStatus): Promise<AdminFeedback[]>;
  adminPatchFeedback(id: string, payload: AdminFeedbackPatch): Promise<AdminFeedback>;
}

export type FeedbackKind = "bug" | "idea" | "other";
export type AdminFeedbackStatus = "new" | "triaged" | "closed";

export interface FeedbackPayload {
  kind: FeedbackKind;
  message: string;
  page?: string | null;
  /** Honeypot — UI laesst leer, Bots fuellen. Wird vom Backend silent
   *  verworfen, falls nicht-leer. */
  website?: string;
}

export interface AdminUser {
  id: string;
  email: string;
  handle: string | null;
  isDisabled: boolean;
  presetCount: number;
  publishedPresetCount: number;
  imageCount: number;
  feedbackCount: number;
  createdAt: string;
}

export interface AdminStats {
  userCount: number;
  userDisabledCount: number;
  presetCount: number;
  presetPublishedCount: number;
  imageCount: number;
  feedbackOpenCount: number;
  reportOpenCount: number;
}

export interface AdminFeedback {
  id: string;
  userId: string | null;
  userEmail: string | null;
  kind: FeedbackKind;
  message: string;
  page: string | null;
  status: AdminFeedbackStatus;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminFeedbackPatch {
  status?: AdminFeedbackStatus;
  adminNotes?: string | null;
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
    deleteMe: () => request<void>("/auth/me", { method: "DELETE" }),
    exportMe: () => request<MeExport>("/auth/me/export"),
    listPresets: () => request<Preset[]>("/presets"),
    createPreset: (payload) =>
      request<Preset>("/presets", {
        method: "POST",
        body: JSON.stringify({ masks: [], ...payload }),
      }),
    updatePreset: (id, payload) =>
      request<Preset>(`/presets/${id}`, {
        method: "PUT",
        body: JSON.stringify({ masks: [], ...payload }),
      }),
    deletePreset: (id) =>
      request<void>(`/presets/${id}`, { method: "DELETE" }),

    listImages: (state = "ready") =>
      request<Image[]>(`/images?state=${state}`),
    initUpload: (filename, contentType, sizeBytes) =>
      request<ImageInit>("/images", {
        method: "POST",
        body: JSON.stringify({ filename, contentType, sizeBytes }),
      }),
    confirmUpload: (id) =>
      request<Image>(`/images/${id}/confirm`, { method: "POST" }),
    getImageUrl: (id) => request<ImageUrl>(`/images/${id}/url`),
    deleteImage: (id) =>
      request<void>(`/images/${id}`, { method: "DELETE" }),

    listMarketplacePresets: (query = {}) => {
      const p = new URLSearchParams();
      if (query.genre) p.set("genre", query.genre);
      if (query.q) p.set("q", query.q);
      if (query.sort) p.set("sort", query.sort);
      if (query.cursor) p.set("cursor", query.cursor);
      if (query.limit !== undefined) p.set("limit", String(query.limit));
      const qs = p.toString();
      return request<MarketplaceList>(
        `/marketplace/presets${qs ? `?${qs}` : ""}`,
      );
    },
    getMarketplacePreset: (id) =>
      request<MarketplaceDetail>(`/marketplace/presets/${id}`),
    applyMarketplacePreset: (id) =>
      request<MarketplaceApply>(`/marketplace/presets/${id}/apply`, {
        method: "POST",
      }),
    forkMarketplacePreset: (id) =>
      request<Preset>(`/marketplace/presets/${id}/fork`, { method: "POST" }),
    reportMarketplacePreset: (id, reason) =>
      request<void>(`/marketplace/presets/${id}/report`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),

    getProfile: () => request<Profile>("/auth/me/profile"),
    updateProfile: (payload) =>
      request<Profile>("/auth/me/profile", {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    listPublishedPresets: () => request<Preset[]>("/auth/me/published-presets"),

    submitFeedback: (payload) =>
      request<{ id: string | null }>("/feedback", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    adminListUsers: () => request<AdminUser[]>("/admin/users"),
    adminPatchUser: (id, isDisabled) =>
      request<AdminUser>(`/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isDisabled }),
      }),
    adminStats: () => request<AdminStats>("/admin/stats"),
    adminListFeedback: (status) => {
      const qs = status ? `?status_filter=${status}` : "";
      return request<AdminFeedback[]>(`/admin/feedback${qs}`);
    },
    adminPatchFeedback: (id, payload) =>
      request<AdminFeedback>(`/admin/feedback/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
  };
}
