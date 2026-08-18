import { fileURLToPath } from "node:url";
import type { Driver } from "neo4j-driver";
import { applySchemaFile } from "../db.js";

const schemaPath = fileURLToPath(new URL("./schema.cypher", import.meta.url));

export function applyInstanceSchema(driver: Driver): Promise<void> {
  return applySchemaFile(driver, schemaPath);
}
