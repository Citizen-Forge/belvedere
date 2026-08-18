import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkoutSource } from "./gitSource.js";
import { parseTypeFile } from "./parseTypeFile.js";
import type { LibrarySource, TypeRecord } from "./types.js";

async function findYamlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Checks out a library source and parses every type file it contains. */
export async function loadLibrary(source: LibrarySource): Promise<TypeRecord[]> {
  const checkoutDir = await checkoutSource(source);
  const typesDir = join(checkoutDir, "types");
  const files = await findYamlFiles(typesDir);

  return Promise.all(
    files.map(async (filePath) => {
      const raw = await readFile(filePath, "utf-8");
      return parseTypeFile(filePath, raw, source.id);
    }),
  );
}
