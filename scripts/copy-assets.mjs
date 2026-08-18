// tsc only emits .ts -> .js; non-TS runtime assets (schema.cypher files) need copying separately.
import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const entries = await readdir("src", { recursive: true, withFileTypes: true });

for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".cypher")) continue;
  const src = join(entry.parentPath, entry.name);
  const dest = join("dist", src.slice("src".length + 1));
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest);
}
