import { randomUUID } from "node:crypto";
import type { Driver } from "neo4j-driver";
import { withSession } from "../db.js";
import type { Asset, NewAsset } from "./types.js";

export class AssetNotFoundError extends Error {
  constructor(id: string) {
    super(`No asset with id ${id}`);
  }
}

export class AssetRepository {
  constructor(private readonly driver: Driver) {}

  async create(input: NewAsset & Pick<Asset, "layer">): Promise<Asset> {
    const now = new Date().toISOString();
    const asset: Asset = {
      id: randomUUID(),
      typeId: input.typeId,
      name: input.name,
      layer: input.layer,
      attributeValues: input.attributeValues,
      createdAt: now,
      updatedAt: now,
    };

    await withSession(this.driver, (session) =>
      session.run(
        `CREATE (a:Asset {
           id: $id, typeId: $typeId, name: $name, layer: $layer,
           attributeValues: $attributeValues, createdAt: $createdAt, updatedAt: $updatedAt
         })`,
        { ...asset, attributeValues: JSON.stringify(asset.attributeValues) },
      ),
    );

    return asset;
  }

  async get(id: string): Promise<Asset> {
    return withSession(this.driver, async (session) => {
      const result = await session.run(`MATCH (a:Asset {id: $id}) RETURN a`, { id });
      if (result.records.length === 0) throw new AssetNotFoundError(id);
      return toAsset(result.records[0].get("a").properties);
    });
  }

  async list(filter?: { typeId?: string; layer?: Asset["layer"] }): Promise<Asset[]> {
    return withSession(this.driver, async (session) => {
      const result = await session.run(
        `MATCH (a:Asset)
         WHERE ($typeId IS NULL OR a.typeId = $typeId)
           AND ($layer IS NULL OR a.layer = $layer)
         RETURN a`,
        { typeId: filter?.typeId ?? null, layer: filter?.layer ?? null },
      );
      return result.records.map((record) => toAsset(record.get("a").properties));
    });
  }

  async remove(id: string): Promise<void> {
    await withSession(this.driver, (session) =>
      session.run(`MATCH (a:Asset {id: $id}) DETACH DELETE a`, { id }),
    );
  }
}

function toAsset(properties: Record<string, unknown>): Asset {
  return {
    id: properties.id as string,
    typeId: properties.typeId as string,
    name: properties.name as string,
    layer: properties.layer as Asset["layer"],
    attributeValues: JSON.parse(properties.attributeValues as string),
    createdAt: properties.createdAt as string,
    updatedAt: properties.updatedAt as string,
  };
}
