import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../context.js";
import { toLibrarySource } from "../../settings/types.js";
import { addLibrarySourceBodySchema } from "../schemas.js";

async function reloadRegistry(ctx: AppContext): Promise<void> {
  const sources = await ctx.librarySources.list();
  await ctx.registry.load(sources.map(toLibrarySource));
}

export function registerLibraryRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/libraries", async () => ctx.librarySources.list());

  app.post("/api/libraries", async (request, reply) => {
    const body = addLibrarySourceBodySchema.parse(request.body);
    const config = await ctx.librarySources.add(body);

    try {
      await reloadRegistry(ctx);
    } catch (cause) {
      // Roll back: don't leave a persisted source that can't actually be loaded.
      await ctx.librarySources.remove(config.id);
      await reloadRegistry(ctx);
      throw cause;
    }

    reply.code(201);
    return config;
  });

  app.delete("/api/libraries/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await ctx.librarySources.remove(id);
    await reloadRegistry(ctx);
    reply.code(204);
  });
}
