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

  // An ancestor's exclusion (e.g. core/group dropping manufacturer/model) should stay dropped for
  // anything that extends it too, the same way its other attributes/icon inherit — but a *closer*
  // descendant redeclaring the key wins over a farther ancestor's exclusion, mirroring how
  // mergeAttributes already lets a closer attribute definition win over a farther one. Tracking
  // just "is this key excluded anywhere in the chain" plus "did the leaf itself redeclare it" (an
  // earlier version) isn't enough once a *middle* type does the redeclaring: a further descendant
  // with no attributes of its own would incorrectly lose the key again. So both are tracked as
  // "at what distance from the leaf (0) does this first happen", and whichever happens closer wins.
  const definedAtDistance = new Map<string, number>();
  const excludedAtDistance = new Map<string, number>();
  for (const attr of record.attributes) definedAtDistance.set(attr.key, 0);
  for (const key of record.excludeAttributes ?? []) excludedAtDistance.set(key, 0);

  const seen = new Set<string>([id]);
  let currentParentId = record.extends;
  let distance = 0;

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
    distance += 1;
    resolvedIcon = resolvedIcon ?? parent.icon;
    resolvedAttributes = mergeAttributes(resolvedAttributes, parent.attributes);
    for (const attr of parent.attributes) {
      if (!definedAtDistance.has(attr.key)) definedAtDistance.set(attr.key, distance);
    }
    for (const key of parent.excludeAttributes ?? []) {
      if (!excludedAtDistance.has(key)) excludedAtDistance.set(key, distance);
    }
    currentParentId = parent.extends;
  }

  if (excludedAtDistance.size > 0) {
    resolvedAttributes = resolvedAttributes.filter((attr) => {
      const excludedAt = excludedAtDistance.get(attr.key);
      if (excludedAt === undefined) return true;
      const definedAt = definedAtDistance.get(attr.key);
      return definedAt !== undefined && definedAt < excludedAt;
    });
  }

  return { ...record, resolvedIcon, resolvedAttributes, ancestry };
}
