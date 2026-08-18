import type { LibrarySource } from "../library/types.js";

/** A user-configured library source, persisted across restarts. `ref` is stored as null (not undefined) since Neo4j has no concept of an absent-vs-undefined property. */
export interface LibrarySourceConfig {
  id: string;
  name: string;
  location: string;
  ref: string | null;
  isDefault: boolean;
  addedAt: string;
}

export interface NewLibrarySourceConfig {
  id: string;
  name: string;
  location: string;
  ref?: string;
}

export function toLibrarySource(config: LibrarySourceConfig): LibrarySource {
  return {
    id: config.id,
    name: config.name,
    location: config.location,
    ref: config.ref ?? undefined,
  };
}
