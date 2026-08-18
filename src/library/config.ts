import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LibrarySource } from "./types.js";

const GITHUB_URL = "https://github.com/Citizen-Forge/belvedere-library.git";

// Prefer the sibling checkout when this repo is cloned alongside belvedere-library (this
// project's own dev setup) — it's instant and works offline, unlike a real git fetch. A real
// install without that sibling present falls back to the published repo.
const siblingLibraryPath = fileURLToPath(new URL("../../../belvedere-library", import.meta.url));
const defaultLocation = existsSync(siblingLibraryPath) ? `file://${siblingLibraryPath}` : GITHUB_URL;

export const coreLibrarySource: LibrarySource = {
  id: "core",
  name: "Belvedere Library",
  location: defaultLocation,
};

/** Sources loaded on a fresh install; users add more via Settings → Libraries. */
export const defaultLibrarySources: LibrarySource[] = [coreLibrarySource];
