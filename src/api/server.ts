import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppContext } from "../context.js";
import { statusForError } from "./errors.js";
import { registerTypeRoutes } from "./routes/types.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerRelationshipRoutes } from "./routes/relationships.js";
import { registerLibraryRoutes } from "./routes/libraries.js";
import { registerViewRoutes } from "./routes/views.js";

export function buildServer(ctx: AppContext): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({ error: "ValidationError", issues: error.issues });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name : "Error";
    // Fastify's own errors (bad JSON body, etc.) carry a statusCode already — trust it over our
    // domain-error mapping, which only knows about errors this app's own code throws.
    const nativeStatus = typeof (error as { statusCode?: number }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : undefined;
    reply.code(nativeStatus ?? statusForError(error)).send({ error: name, message });
  });

  registerTypeRoutes(app, ctx);
  registerAssetRoutes(app, ctx);
  registerRelationshipRoutes(app, ctx);
  registerLibraryRoutes(app, ctx);
  registerViewRoutes(app, ctx);

  return app;
}
