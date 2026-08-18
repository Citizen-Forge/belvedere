import { z } from "zod";
import type { api } from "../apiClient.js";

type Api = typeof api;

const attributeValue = z.union([z.string(), z.number(), z.boolean()]);

export const listAssetsSchema = z.object({
  typeId: z.string().optional().describe('Filter to instances of one exact type, e.g. "core/server".'),
  layer: z.enum(["physical", "logical"]).optional().describe("Filter by layer."),
});

export function listAssets(input: z.infer<typeof listAssetsSchema>, api: Api) {
  return api.listAssets(input);
}

export const getAssetSchema = z.object({
  id: z.string().describe("Asset id."),
});

export function getAsset(input: z.infer<typeof getAssetSchema>, api: Api) {
  return api.getAsset(input.id);
}

export const createAssetSchema = z.object({
  typeId: z
    .string()
    .describe('Id of the type to instantiate, e.g. "core/generic-server" — look it up first with get_type or list_type_children if unsure what attributes it takes.'),
  name: z.string().min(1).describe("Human-readable name for this instance."),
  attributeValues: z
    .record(attributeValue)
    .default({})
    .describe("Values for the type's resolved attributes (inherited + own). Unknown keys are rejected."),
});

export function createAsset(input: z.infer<typeof createAssetSchema>, api: Api) {
  return api.createAsset(input);
}

export const deleteAssetSchema = z.object({
  id: z.string().describe("Asset id to delete. Also removes its relationships."),
});

export async function deleteAsset(input: z.infer<typeof deleteAssetSchema>, api: Api) {
  await api.deleteAsset(input.id);
  return { deleted: input.id };
}
