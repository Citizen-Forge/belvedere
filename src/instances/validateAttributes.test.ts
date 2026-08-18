import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAttributes, AttributeValidationError } from "./validateAttributes.js";
import type { AttributeDefinition } from "../library/types.js";

const serverAttributes: AttributeDefinition[] = [
  { key: "cpu", label: "CPU", dataType: "string", required: true },
  { key: "ramGb", label: "RAM", dataType: "number" },
  { key: "formFactor", label: "Form factor", dataType: "enum", options: ["rack", "tower"] },
];

test("accepts values matching the schema", () => {
  assert.doesNotThrow(() =>
    validateAttributes(
      { resolvedAttributes: serverAttributes },
      { cpu: "Xeon E5", ramGb: 64, formFactor: "rack" },
    ),
  );
});

test("rejects a missing required attribute", () => {
  assert.throws(
    () => validateAttributes({ resolvedAttributes: serverAttributes }, { ramGb: 64 }),
    AttributeValidationError,
  );
});

test("rejects a value of the wrong type", () => {
  assert.throws(
    () =>
      validateAttributes(
        { resolvedAttributes: serverAttributes },
        { cpu: "Xeon E5", ramGb: "lots" as unknown as number },
      ),
    AttributeValidationError,
  );
});

test("rejects an enum value outside its options", () => {
  assert.throws(
    () =>
      validateAttributes(
        { resolvedAttributes: serverAttributes },
        { cpu: "Xeon E5", formFactor: "blade" },
      ),
    AttributeValidationError,
  );
});

test("rejects an attribute key not declared on the type", () => {
  assert.throws(
    () =>
      validateAttributes(
        { resolvedAttributes: serverAttributes },
        { cpu: "Xeon E5", unknownKey: "x" },
      ),
    AttributeValidationError,
  );
});
