import { z } from "zod";
import type { api } from "../apiClient.js";

type Api = typeof api;

const attributeValue = z.union([z.string(), z.number(), z.boolean()]);
const relationshipKind = z
  .enum(["HOSTS", "PROVIDES", "CONNECTS_TO", "MEMBER_OF"])
  .describe(
    "HOSTS: fromId runs/contains toId (server hosts OS, OS hosts container platform, platform hosts a port). " +
      "PROVIDES: fromId offers a capability distinct from containment. " +
      "CONNECTS_TO: a topology edge — physical cabling or a logical client/server connection — not containment. " +
      "MEMBER_OF: fromId tags itself into a group (toId), independent of and additional to any HOSTS " +
      "relationship it already has — e.g. a GPU stays HOSTS'd by its real server AND can be MEMBER_OF " +
      "a 'GPUs' group under that server, or a free-floating cross-cutting group with no HOSTS parent at all. " +
      "Many-to-many: an asset can be MEMBER_OF several groups at once.",
  );

export const listAssetRelationshipsSchema = z.object({
  assetId: z.string().describe("List relationships originating from this asset (it is the 'from' side)."),
});

export function listAssetRelationships(input: z.infer<typeof listAssetRelationshipsSchema>, api: Api) {
  return api.listRelationships(input.assetId);
}

export const listGroupMembersSchema = z.object({
  assetId: z
    .string()
    .describe(
      "List assets tagged MEMBER_OF this asset (it is the 'to' side) — the reverse of " +
        "list_asset_relationships. Use this on a group to discover its members, since membership " +
        "is stored on the member, not the group.",
    ),
});

export function listGroupMembers(input: z.infer<typeof listGroupMembersSchema>, api: Api) {
  return api.listMembers(input.assetId);
}

export const listConnectionsSchema = z.object({
  assetId: z
    .string()
    .describe(
      "List CONNECTS_TO relationships involving this asset, from *either* side — unlike " +
        "list_asset_relationships (outgoing only) or list_group_members (incoming only), a " +
        "topology edge has no privileged direction, so a connection shows up here regardless of " +
        "which asset happens to be the relationship's stored 'from' side.",
    ),
});

export function listConnections(input: z.infer<typeof listConnectionsSchema>, api: Api) {
  return api.listConnections(input.assetId);
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
