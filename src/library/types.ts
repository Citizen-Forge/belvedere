export type TypeRoot = "hardware" | "software" | "cloud-provider";

export type AttributeDataType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "reference";

export interface AttributeDefinition {
  key: string;
  label: string;
  dataType: AttributeDataType;
  unit?: string;
  options?: string[]; // for dataType "enum"
  required?: boolean;
}

/** A single type file's own contribution — no inherited fields resolved yet. */
export interface TypeRecord {
  id: string; // "<namespace>/<slug>", e.g. "core/server"
  name: string;
  root: TypeRoot;
  extends: string | null; // parent type id; null only for the three root types
  icon: string | null;
  description: string | null;
  attributes: AttributeDefinition[];
  /**
   * Keys of *inherited* attributes to drop from this type's resolved set — e.g. core/group
   * extends core/hardware (every type must extend one of the three roots) but has no real
   * manufacturer/model of its own, so it excludes them rather than showing them unset. Propagates
   * to anything that further extends this type, the same way attributes/icon inherit — a subtype
   * (at any depth) that wants an excluded key back just redeclares it in its own `attributes`,
   * which wins over the exclusion as long as it's closer to the resolved type than whichever
   * ancestor excluded it (see resolveType.ts).
   */
  excludeAttributes?: string[];
  version: string;
  sourceId: string; // which configured LibrarySource this record came from
}

/** A type with inheritance resolved: icon and attributes merged down the `extends` chain. */
export interface ResolvedType extends TypeRecord {
  resolvedIcon: string | null;
  resolvedAttributes: AttributeDefinition[];
  ancestry: string[]; // ids from immediate parent up to root, closest first
}

/** A configured source Belvedere loads type definitions from. */
export interface LibrarySource {
  id: string; // stable local identifier, e.g. "core"
  name: string;
  /** A git remote URL, or a "file://" / bare local path for dev use. */
  location: string;
  ref?: string; // branch, tag, or commit; defaults to the remote's default branch
}
