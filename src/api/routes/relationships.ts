import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../context.js";
import { createRelationshipBodySchema, relationshipKindSchema } from "../schemas.js";

export function registerRelationshipRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/assets/:id/relationships", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = createRelationshipBodySchema.parse(request.body);
    const relationship = await ctx.relationships.create(id, body.kind, body.toId, body.properties);
    reply.code(201);
    return relationship;
  });

  app.get("/api/assets/:id/relationships", async (request) => {
    const { id } = request.params as { id: string };
    return ctx.relationships.listFrom(id);
  });

  // Reverse of the above, restricted to MEMBER_OF: who has tagged themselves
  // as a member of this asset (used to reveal a group's members on expand).
  app.get("/api/assets/:id/members", async (request) => {
    const { id } = request.params as { id: string };
    return ctx.relationships.listMembers(id);
  });

  app.delete("/api/assets/:id/relationships/:kind/:toId", async (request, reply) => {
    const { id, kind: rawKind, toId } = request.params as {
      id: string;
      kind: string;
      toId: string;
    };
    const kind = relationshipKindSchema.parse(rawKind);
    await ctx.relationships.remove(id, kind, toId);
    reply.code(204);
  });
}
