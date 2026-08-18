import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../context.js";
import type { TypeRoot } from "../../library/types.js";

export function registerTypeRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/types", async (request) => {
    const { root } = request.query as { root?: TypeRoot };
    return ctx.registry.all().filter((type) => !root || type.root === root);
  });

  app.get("/api/types/roots", async (request) => {
    const { root } = request.query as { root?: TypeRoot };
    return ctx.registry.listRoots(root);
  });

  app.get("/api/types/:namespace/:slug", async (request) => {
    const { namespace, slug } = request.params as { namespace: string; slug: string };
    return ctx.registry.get(`${namespace}/${slug}`);
  });

  app.get("/api/types/:namespace/:slug/children", async (request) => {
    const { namespace, slug } = request.params as { namespace: string; slug: string };
    return ctx.registry.listChildren(`${namespace}/${slug}`);
  });
}
