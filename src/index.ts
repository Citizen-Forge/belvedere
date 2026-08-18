import { existsSync } from "node:fs";
import { buildContext } from "./context.js";
import { buildServer } from "./api/server.js";

const port = Number(process.env.PORT ?? 3000);
const staticDirEnv = process.env.STATIC_DIR;
const staticDir = staticDirEnv && existsSync(staticDirEnv) ? staticDirEnv : undefined;

const ctx = await buildContext();
const app = buildServer(ctx, { staticDir });

await app.listen({ port, host: "0.0.0.0" });
console.log(`Belvedere listening on :${port}${staticDir ? ` (serving frontend from ${staticDir})` : ""}`);
