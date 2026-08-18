import { z } from "zod";

const attributeSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    dataType: z.enum(["string", "number", "boolean", "enum", "reference"]),
    unit: z.string().optional(),
    options: z.array(z.string()).optional(),
    required: z.boolean().optional(),
  })
  .refine((attr) => attr.dataType !== "enum" || (attr.options?.length ?? 0) > 0, {
    message: 'attributes with dataType "enum" must define a non-empty options array',
    path: ["options"],
  });

/** Validates the shape of one type YAML file, before sourceId is attached. */
export const typeFileSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/, "id must be '<namespace>/<slug>'"),
  name: z.string().min(1),
  root: z.enum(["hardware", "software", "cloud-provider"]),
  extends: z.string().nullable(),
  icon: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  version: z.string().min(1),
  attributes: z.array(attributeSchema).default([]),
});

export type TypeFileInput = z.infer<typeof typeFileSchema>;
