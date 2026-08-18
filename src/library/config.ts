import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { LibrarySource } from "./types.js";

// Points at the sibling checkout until belvedere-library has a published git remote.
const bundledLibraryPath = join(fileURLToPath(new URL("../../../belvedere-library", import.meta.url)));

export const coreLibrarySource: LibrarySource = {
  id: "core",
  name: "Belvedere Library",
  location: `file://${bundledLibraryPath}`,
};

/** Sources loaded on a fresh install; users add more via Settings → Libraries. */
export const defaultLibrarySources: LibrarySource[] = [coreLibrarySource];
