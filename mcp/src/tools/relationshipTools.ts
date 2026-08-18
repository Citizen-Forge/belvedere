import { z } from "zod";
import type { api } from "../apiClient.js";

type Api = typeof api;

const attributeValue = z.union([z.string(), z.number(), z.boolean()]);
const relationshipKind = z
  .enum(["HOSTS", "PROVIDES", "CONNECTS_TO"])
  .describe(
    "HOSTS: fromId runs/contains toId (server hosts OS, OS hosts container platform, platform hosts a port). " +
      "PROVIDES: fromId offers a capability distinct from containment. " +
      "CONNECTS_TO: a topology edge — physical cabling or a logical client/server connection — not containment.",
  );

export const listAssetRelationshipsSchema = z.object({
  assetId: z.string().describe("List relationships originating from this asset (it is the 'from' side)."),
});

export function listAssetRelationships(input: z.infer<typeof listAssetRelationshipsSchema>, api: Api) {
  return api.listRelationships(input.assetId);
}

export const createRelationshipSchema = z.object({
  fromId: z.string().describe("Source asset id."),
  kind: relationshipKind,
  toId: z.string().describe("Target asset id."),
  properties: z.record(attributeValue).optional().describe("Optional free-form properties on the edge itself, e.g. { switchPort: 3 }."),
});

export function createRelationship(input: z.infer<typeof createRelationshipSchema>, api: Api) {
  return api.createRelationship(input.fromId, input.kind, input.toId, input.properties);
}

export const deleteRelationshipSchema = z.object({
  fromId: z.string(),
  kind: relationshipKind,
  toId: z.string(),
});

export async function deleteRelationship(input: z.infer<typeof deleteRelationshipSchema>, api: Api) {
  await api.deleteRelationship(input.fromId, input.kind, input.toId);
  return { deleted: { fromId: input.fromId, kind: input.kind, toId: input.toId } };
}
