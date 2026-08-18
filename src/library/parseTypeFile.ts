import { parse as parseYaml } from "yaml";
import { typeFileSchema } from "./schema.js";
import type { TypeRecord } from "./types.js";

export class TypeFileParseError extends Error {
  constructor(
    public readonly filePath: string,
    cause: unknown,
  ) {
    super(`Failed to parse type file ${filePath}: ${String(cause)}`);
  }
}

export function parseTypeFile(filePath: string, raw: string, sourceId: string): TypeRecord {
  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (cause) {
    throw new TypeFileParseError(filePath, cause);
  }

  const result = typeFileSchema.safeParse(data);
  if (!result.success) {
    throw new TypeFileParseError(filePath, result.error);
  }

  return { ...result.data, sourceId };
}
