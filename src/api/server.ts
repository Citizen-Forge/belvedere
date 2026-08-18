import Fastify, { type FastifyInstance } from "fastify";
import FastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import type { AppContext } from "../context.js";
import { statusForError } from "./errors.js";
import { registerTypeRoutes } from "./routes/types.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerRelationshipRoutes } from "./routes/relationships.js";
import { registerLibraryRoutes } from "./routes/libraries.js";
import { registerViewRoutes } from "./routes/views.js";

export interface BuildServerOptions {
  /** Absolute path to the built frontend (web/dist). Omit in tests — there's nothing to serve. */
  staticDir?: string;
}

export function buildServer(ctx: AppContext, options: BuildServerOptions = {}): FastifyInstance {
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

  // Keeps the {error, message} shape uniform for every 404, including ones @fastify/static's
  // wildcard route falls through to (a typo'd path, not an existing static file) — otherwise those
  // get Fastify's differently-shaped default 404 body instead of matching every other error here.
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: "NotFound", message: `Route ${request.method}:${request.url} not found` });
  });

  registerTypeRoutes(app, ctx);
  registerAssetRoutes(app, ctx);
  registerRelationshipRoutes(app, ctx);
  registerLibraryRoutes(app, ctx);
  registerViewRoutes(app, ctx);

  // Registered after the API routes: @fastify/static only serves files that actually exist on
  // disk, so it can't shadow /api/* even registered as a catch-all root prefix.
  if (options.staticDir) {
    app.register(FastifyStatic, { root: options.staticDir });
  }

  return app;
}
