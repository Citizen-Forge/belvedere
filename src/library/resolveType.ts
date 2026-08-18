import type { AttributeDefinition, ResolvedType, TypeRecord } from "./types.js";

export class TypeResolutionError extends Error {}

function mergeAttributes(
  ownAttributes: AttributeDefinition[],
  inheritedAttributes: AttributeDefinition[],
): AttributeDefinition[] {
  const byKey = new Map(inheritedAttributes.map((attr) => [attr.key, attr]));
  for (const attr of ownAttributes) byKey.set(attr.key, attr);
  return [...byKey.values()];
}

/**
 * Resolves a type's inherited icon and attributes by walking its `extends`
 * chain up to the root. Throws on a missing parent or a cycle.
 */
export function resolveType(id: string, byId: Map<string, TypeRecord>): ResolvedType {
  const record = byId.get(id);
  if (!record) throw new TypeResolutionError(`Unknown type id: ${id}`);

  const ancestry: string[] = [];
  let resolvedIcon = record.icon;
  let resolvedAttributes: AttributeDefinition[] = record.attributes;

  const seen = new Set<string>([id]);
  let currentParentId = record.extends;

  while (currentParentId !== null) {
    if (seen.has(currentParentId)) {
      throw new TypeResolutionError(`Cycle detected in type hierarchy at ${currentParentId}`);
    }
    const parent = byId.get(currentParentId);
    if (!parent) {
      throw new TypeResolutionError(`Type ${id} extends unknown type ${currentParentId}`);
    }

    seen.add(currentParentId);
    ancestry.push(currentParentId);
    resolvedIcon = resolvedIcon ?? parent.icon;
    resolvedAttributes = mergeAttributes(resolvedAttributes, parent.attributes);
    currentParentId = parent.extends;
  }

  return { ...record, resolvedIcon, resolvedAttributes, ancestry };
}
