import { z } from "zod";

const attributeValue = z.union([z.string(), z.number(), z.boolean()]);

export const createAssetBodySchema = z.object({
  typeId: z.string().min(1),
  name: z.string().min(1),
  attributeValues: z.record(attributeValue).default({}),
});

export const relationshipKindSchema = z.enum(["HOSTS", "PROVIDES", "CONNECTS_TO"]);

export const createRelationshipBodySchema = z.object({
  kind: relationshipKindSchema,
  toId: z.string().min(1),
  properties: z.record(attributeValue).default({}),
});

export const addLibrarySourceBodySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "id must be lowercase letters, numbers, and hyphens"),
  name: z.string().min(1),
  location: z.string().min(1),
  ref: z.string().optional(),
});

const nodePosition = z.object({ x: z.number(), y: z.number() });

export const createSavedViewBodySchema = z.object({
  name: z.string().min(1),
  visibleAssetIds: z.array(z.string().min(1)),
  nodePositions: z.record(nodePosition),
});
