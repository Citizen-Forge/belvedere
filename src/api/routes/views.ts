import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../context.js";
import { createSavedViewBodySchema } from "../schemas.js";

export function registerViewRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/views", async (request, reply) => {
    const body = createSavedViewBodySchema.parse(request.body);
    const view = await ctx.savedViews.create(body);
    reply.code(201);
    return view;
  });

  app.get("/api/views", async () => ctx.savedViews.list());

  app.get("/api/views/:id", async (request) => {
    const { id } = request.params as { id: string };
    return ctx.savedViews.get(id);
  });

  app.delete("/api/views/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await ctx.savedViews.remove(id);
    reply.code(204);
  });
}
