import type { Driver } from "neo4j-driver";
import { withSession } from "../db.js";
import type { Relationship, RelationshipKind } from "./types.js";

export class RelationshipEndpointNotFoundError extends Error {
  constructor(fromId: string, toId: string) {
    super(`Cannot create relationship: asset ${fromId} or ${toId} does not exist`);
  }
}

export class HostsCycleError extends Error {
  constructor(fromId: string, toId: string) {
    super(
      `Cannot create HOSTS ${fromId} -> ${toId}: ${toId} already (transitively) hosts ${fromId}, ` +
        "which would create a cycle",
    );
  }
}

export class SelfMembershipError extends Error {
  constructor(assetId: string) {
    super(`Cannot create MEMBER_OF ${assetId} -> ${assetId}: an asset cannot be a member of itself`);
  }
}

// Neo4j relationship types can't be parameterized, so each kind maps to a
// literal, exhaustively-checked Cypher fragment rather than interpolating
// caller input directly.
function cypherRelForKind(kind: RelationshipKind): string {
  switch (kind) {
    case "HOSTS":
      return "HOSTS";
    case "PROVIDES":
      return "PROVIDES";
    case "CONNECTS_TO":
      return "CONNECTS_TO";
    case "MEMBER_OF":
      return "MEMBER_OF";
    default: {
      // Compile-time exhaustiveness check: fails to typecheck if a RelationshipKind
      // variant is ever added without a case above (tsconfig doesn't set
      // noImplicitReturns, so the switch alone can't guarantee this).
      const exhaustive: never = kind;
      throw new Error(`Unhandled relationship kind: ${String(exhaustive)}`);
    }
  }
}

export class RelationshipRepository {
  constructor(private readonly driver: Driver) {}

  async create(
    fromId: string,
    kind: RelationshipKind,
    toId: string,
    properties: Relationship["properties"] = {},
  ): Promise<Relationship> {
    // HOSTS specifically drives the graph UI's containment/expand-collapse model (see
    // ARCHITECTURE.md) — a cycle in it makes every asset on the cycle permanently invisible
    // there (each is only ever revealed by expanding its HOSTS parent, and every member's parent
    // is another cycle member). PROVIDES/CONNECTS_TO have no such containment semantics, so this
    // check is HOSTS-only, not a general graph-wide acyclicity rule.
    if (kind === "HOSTS") {
      if (fromId === toId) throw new HostsCycleError(fromId, toId);
      await this.assertNoHostsCycle(fromId, toId);
    }
    // MEMBER_OF has no containment semantics, so it doesn't need HOSTS's transitive-cycle check —
    // but a self-loop is still nonsensical (an asset can't be a member of itself) and the UI's own
    // guard against it (filtering the join picker) is client-side only.
    if (kind === "MEMBER_OF" && fromId === toId) {
      throw new SelfMembershipError(fromId);
    }

    const relType = cypherRelForKind(kind);
    await withSession(this.driver, async (session) => {
      const result = await session.run(
        `MATCH (from:Asset {id: $fromId}), (to:Asset {id: $toId})
         MERGE (from)-[r:${relType}]->(to)
         SET r.properties = $properties
         RETURN from, to`,
        { fromId, toId, properties: JSON.stringify(properties) },
      );
      if (result.records.length === 0) {
        throw new RelationshipEndpointNotFoundError(fromId, toId);
      }
    });

    return { fromId, kind, toId, properties };
  }

  async listFrom(assetId: string): Promise<Relationship[]> {
    return withSession(this.driver, async (session) => {
      const result = await session.run(
        `MATCH (from:Asset {id: $assetId})-[r:HOSTS|PROVIDES|CONNECTS_TO|MEMBER_OF]->(to:Asset)
         RETURN type(r) AS kind, to.id AS toId, r.properties AS properties`,
        { assetId },
      );
      return result.records.map((record) => ({
        fromId: assetId,
        kind: record.get("kind") as RelationshipKind,
        toId: record.get("toId") as string,
        properties: JSON.parse(record.get("properties") ?? "{}"),
      }));
    });
  }

  // The reverse of listFrom, restricted to MEMBER_OF: who tagged themselves as
  // a member of this asset (expected to usually be a group). Needed because
  // membership is stored on the member (member -[MEMBER_OF]-> group), so
  // discovering a group's members means querying incoming edges, not outgoing.
  async listMembers(assetId: string): Promise<Relationship[]> {
    return withSession(this.driver, async (session) => {
      const result = await session.run(
        `MATCH (member:Asset)-[r:MEMBER_OF]->(to:Asset {id: $assetId})
         RETURN member.id AS fromId, r.properties AS properties`,
        { assetId },
      );
      return result.records.map((record) => ({
        fromId: record.get("fromId") as string,
        kind: "MEMBER_OF" as RelationshipKind,
        toId: assetId,
        properties: JSON.parse(record.get("properties") ?? "{}"),
      }));
    });
  }

  // CONNECTS_TO is a topology edge (a cable, a logical link) with no privileged direction — unlike
  // HOSTS's containment or MEMBER_OF's membership, "which side is fromId" carries no real meaning,
  // so callers shouldn't have to know or care which way a given connection happens to be stored.
  // Matches CONNECTS_TO in *either* direction from assetId (undirected Cypher pattern), returning
  // each edge's actual stored fromId/toId as-is so callers that do need it (e.g. to remove the
  // exact edge) still have it.
  async listConnections(assetId: string): Promise<Relationship[]> {
    return withSession(this.driver, async (session) => {
      const result = await session.run(
        `MATCH (a:Asset {id: $assetId})-[r:CONNECTS_TO]-(b:Asset)
         RETURN startNode(r).id AS fromId, endNode(r).id AS toId, r.properties AS properties`,
        { assetId },
      );
      return result.records.map((record) => ({
        fromId: record.get("fromId") as string,
        kind: "CONNECTS_TO" as RelationshipKind,
        toId: record.get("toId") as string,
        properties: JSON.parse(record.get("properties") ?? "{}"),
      }));
    });
  }

  async remove(fromId: string, kind: RelationshipKind, toId: string): Promise<void> {
    const relType = cypherRelForKind(kind);
    await withSession(this.driver, (session) =>
      session.run(
        `MATCH (from:Asset {id: $fromId})-[r:${relType}]->(to:Asset {id: $toId}) DELETE r`,
        { fromId, toId },
      ),
    );
  }

  private async assertNoHostsCycle(fromId: string, toId: string): Promise<void> {
    await withSession(this.driver, async (session) => {
      const result = await session.run(
        `MATCH (to:Asset {id: $toId})-[:HOSTS*]->(from:Asset {id: $fromId}) RETURN count(*) > 0 AS wouldCycle`,
        { fromId, toId },
      );
      if (result.records[0]?.get("wouldCycle")) {
        throw new HostsCycleError(fromId, toId);
      }
    });
  }
}
