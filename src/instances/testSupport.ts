import neo4j, { type Driver } from "neo4j-driver";
import { applyInstanceSchema } from "./schema.js";
import { AssetRepository } from "./assetRepository.js";
import { RelationshipRepository } from "./relationshipRepository.js";

const uri = process.env.BELVEDERE_NEO4J_URI ?? "bolt://localhost:7687";
const user = process.env.BELVEDERE_NEO4J_USER ?? "neo4j";
const password = process.env.BELVEDERE_NEO4J_PASSWORD ?? "belvedere-dev";

/** A fresh driver + repositories for integration tests, schema already applied. Caller closes the driver. */
export async function setupTestDb(): Promise<{
  driver: Driver;
  assets: AssetRepository;
  relationships: RelationshipRepository;
}> {
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  await applyInstanceSchema(driver);
  return { driver, assets: new AssetRepository(driver), relationships: new RelationshipRepository(driver) };
}
