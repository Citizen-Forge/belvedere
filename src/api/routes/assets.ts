import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../context.js";
import type { Asset } from "../../instances/types.js";
import { createAssetBodySchema } from "../schemas.js";

export function registerAssetRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/assets", async (request, reply) => {
    const body = createAssetBodySchema.parse(request.body);
    const asset = await ctx.assetService.createAsset(body);
    reply.code(201);
    return asset;
  });

  app.get("/api/assets", async (request) => {
    const { typeId, layer } = request.query as { typeId?: string; layer?: Asset["layer"] };
    return ctx.assets.list({ typeId, layer });
  });

  app.get("/api/assets/:id", async (request) => {
    const { id } = request.params as { id: string };
    return ctx.assets.get(id);
  });

  app.delete("/api/assets/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await ctx.assets.remove(id);
    reply.code(204);
  });
}
