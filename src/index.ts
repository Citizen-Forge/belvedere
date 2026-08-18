import { buildContext } from "./context.js";
import { buildServer } from "./api/server.js";

const port = Number(process.env.PORT ?? 3000);

const ctx = await buildContext();
const app = buildServer(ctx);

await app.listen({ port, host: "0.0.0.0" });
console.log(`Belvedere listening on :${port}`);
