import type { AttributeDefinition, ResolvedType } from "../library/types.js";
import type { AttributeValue } from "./types.js";

export class AttributeValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid attribute values: ${issues.join("; ")}`);
  }
}

function issueFor(def: AttributeDefinition, value: AttributeValue): string | null {
  switch (def.dataType) {
    case "string":
    case "reference":
      return typeof value === "string" ? null : `"${def.key}" must be a string`;
    case "number":
      return typeof value === "number" ? null : `"${def.key}" must be a number`;
    case "boolean":
      return typeof value === "boolean" ? null : `"${def.key}" must be a boolean`;
    case "enum":
      return typeof value === "string" && def.options?.includes(value)
        ? null
        : `"${def.key}" must be one of: ${def.options?.join(", ")}`;
  }
}

/** Validates instance attribute values against a resolved type's merged attribute schema. */
export function validateAttributes(
  resolvedType: Pick<ResolvedType, "resolvedAttributes">,
  values: Record<string, AttributeValue>,
): void {
  const issues: string[] = [];

  for (const def of resolvedType.resolvedAttributes) {
    const value = values[def.key];
    if (value === undefined) {
      if (def.required) issues.push(`"${def.key}" is required`);
      continue;
    }
    const issue = issueFor(def, value);
    if (issue) issues.push(issue);
  }

  const knownKeys = new Set(resolvedType.resolvedAttributes.map((def) => def.key));
  for (const key of Object.keys(values)) {
    if (!knownKeys.has(key)) issues.push(`"${key}" is not a recognized attribute for this type`);
  }

  if (issues.length > 0) throw new AttributeValidationError(issues);
}
