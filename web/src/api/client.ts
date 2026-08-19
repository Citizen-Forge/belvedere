import type {
  Asset,
  AssetLayer,
  NewSavedView,
  Relationship,
  RelationshipKind,
  ResolvedType,
  SavedView,
  TypeRoot,
} from "./types";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only set Content-Type when there's actually a body — Fastify's JSON body parser rejects a
  // bodyless request (e.g. DELETE) that declares application/json with nothing to parse.
  const headers = init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers;
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  listRootTypes: (root?: TypeRoot) =>
    request<ResolvedType[]>(`/api/types/roots${root ? `?root=${root}` : ""}`),
  getType: (id: string) => request<ResolvedType>(`/api/types/${id}`),
  listChildTypes: (id: string) => request<ResolvedType[]>(`/api/types/${id}/children`),

  listAssets: (filter?: { typeId?: string; layer?: AssetLayer }) => {
    const params = new URLSearchParams();
    if (filter?.typeId) params.set("typeId", filter.typeId);
    if (filter?.layer) params.set("layer", filter.layer);
    const query = params.toString();
    return request<Asset[]>(`/api/assets${query ? `?${query}` : ""}`);
  },
  getAsset: (id: string) => request<Asset>(`/api/assets/${id}`),
  createAsset: (input: { typeId: string; name: string; attributeValues: Record<string, unknown> }) =>
    request<Asset>("/api/assets", { method: "POST", body: JSON.stringify(input) }),
  deleteAsset: (id: string) => request<void>(`/api/assets/${id}`, { method: "DELETE" }),

  listRelationships: (assetId: string) => request<Relationship[]>(`/api/assets/${assetId}/relationships`),
  // Incoming MEMBER_OF only — who has tagged themselves into this asset (expected to usually be a
  // group). Reverse direction from listRelationships, which is outgoing-only.
  listMembers: (assetId: string) => request<Relationship[]>(`/api/assets/${assetId}/members`),
  createRelationship: (
    fromId: string,
    kind: RelationshipKind,
    toId: string,
    properties?: Record<string, unknown>,
  ) =>
    request<Relationship>(`/api/assets/${fromId}/relationships`, {
      method: "POST",
      body: JSON.stringify({ kind, toId, properties }),
    }),

  listViews: () => request<SavedView[]>("/api/views"),
  getView: (id: string) => request<SavedView>(`/api/views/${id}`),
  createView: (input: NewSavedView) =>
    request<SavedView>("/api/views", { method: "POST", body: JSON.stringify(input) }),
  deleteView: (id: string) => request<void>(`/api/views/${id}`, { method: "DELETE" }),
};
