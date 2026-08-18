import { loadLibrary } from "./loadLibrary.js";
import { resolveType } from "./resolveType.js";
import type { LibrarySource, ResolvedType, TypeRecord, TypeRoot } from "./types.js";

export class DuplicateTypeIdError extends Error {
  constructor(id: string, firstSourceId: string, secondSourceId: string) {
    super(
      firstSourceId === secondSourceId
        ? `Type id "${id}" is defined more than once within source "${firstSourceId}" — ` +
            "ids must be unique across every configured library source."
        : `Type id "${id}" is defined by both "${firstSourceId}" and "${secondSourceId}" — ` +
            "ids must be unique across every configured library source.",
    );
  }
}

/** Loads and indexes type definitions from one or more configured library sources. */
export class LibraryRegistry {
  private byId = new Map<string, TypeRecord>();
  private resolvedCache = new Map<string, ResolvedType>();

  async load(sources: LibrarySource[]): Promise<void> {
    const recordLists = await Promise.all(sources.map((source) => loadLibrary(source)));

    const byId = new Map<string, TypeRecord>();
    for (const records of recordLists) {
      for (const record of records) {
        const existing = byId.get(record.id);
        if (existing) {
          throw new DuplicateTypeIdError(record.id, existing.sourceId, record.sourceId);
        }
        byId.set(record.id, record);
      }
    }

    this.byId = byId;
    this.resolvedCache = new Map();
  }

  get(id: string): ResolvedType {
    const cached = this.resolvedCache.get(id);
    if (cached) return cached;
    const resolved = resolveType(id, this.byId);
    this.resolvedCache.set(id, resolved);
    return resolved;
  }

  listRoots(root?: TypeRoot): ResolvedType[] {
    return [...this.byId.values()]
      .filter((record) => record.extends === null && (!root || record.root === root))
      .map((record) => this.get(record.id));
  }

  listChildren(parentId: string): ResolvedType[] {
    return [...this.byId.values()]
      .filter((record) => record.extends === parentId)
      .map((record) => this.get(record.id));
  }

  all(): ResolvedType[] {
    return [...this.byId.keys()].map((id) => this.get(id));
  }
}
