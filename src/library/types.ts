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
