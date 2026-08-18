import { randomUUID } from "node:crypto";
import type { Driver } from "neo4j-driver";
import { withSession } from "../db.js";
import type { NewSavedView, SavedView } from "./types.js";

export class SavedViewNotFoundError extends Error {
  constructor(id: string) {
    super(`No saved view with id ${id}`);
  }
}

export class SavedViewRepository {
  constructor(private readonly driver: Driver) {}

  async create(input: NewSavedView): Promise<SavedView> {
    const now = new Date().toISOString();
    const view: SavedView = {
      id: randomUUID(),
      name: input.name,
      visibleAssetIds: input.visibleAssetIds,
      nodePositions: input.nodePositions,
      createdAt: now,
      updatedAt: now,
    };

    await withSession(this.driver, (session) =>
      session.run(
        `CREATE (v:SavedView {
           id: $id, name: $name, visibleAssetIds: $visibleAssetIds,
           nodePositions: $nodePositions, createdAt: $createdAt, updatedAt: $updatedAt
         })`,
        { ...view, nodePositions: JSON.stringify(view.nodePositions) },
      ),
    );

    return view;
  }

  async list(): Promise<SavedView[]> {
    return withSession(this.driver, async (session) => {
      const result = await session.run(`MATCH (v:SavedView) RETURN v ORDER BY v.createdAt`);
      return result.records.map((record) => toView(record.get("v").properties));
    });
  }

  async get(id: string): Promise<SavedView> {
    return withSession(this.driver, async (session) => {
      const result = await session.run(`MATCH (v:SavedView {id: $id}) RETURN v`, { id });
      if (result.records.length === 0) throw new SavedViewNotFoundError(id);
      return toView(result.records[0].get("v").properties);
    });
  }

  async remove(id: string): Promise<void> {
    await withSession(this.driver, async (session) => {
      const result = await session.run(
        `MATCH (v:SavedView {id: $id}) DETACH DELETE v RETURN count(v) AS deleted`,
        { id },
      );
      if (result.records[0].get("deleted").toNumber() === 0) throw new SavedViewNotFoundError(id);
    });
  }
}

function toView(properties: Record<string, unknown>): SavedView {
  return {
    id: properties.id as string,
    name: properties.name as string,
    visibleAssetIds: properties.visibleAssetIds as string[],
    nodePositions: JSON.parse(properties.nodePositions as string),
    createdAt: properties.createdAt as string,
    updatedAt: properties.updatedAt as string,
  };
}
