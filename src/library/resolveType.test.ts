import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveType, TypeResolutionError } from "./resolveType.js";
import type { TypeRecord } from "./types.js";

function record(overrides: Partial<TypeRecord> & Pick<TypeRecord, "id" | "extends">): TypeRecord {
  return {
    name: overrides.id,
    root: "hardware",
    icon: null,
    description: null,
    attributes: [],
    version: "0.1.0",
    sourceId: "test",
    ...overrides,
  };
}

test("inherits icon from the nearest ancestor that sets one", () => {
  const byId = new Map([
    ["core/hardware", record({ id: "core/hardware", extends: null, icon: "hardware" })],
    ["core/server", record({ id: "core/server", extends: "core/hardware", icon: null })],
  ]);

  const resolved = resolveType("core/server", byId);
  assert.equal(resolved.resolvedIcon, "hardware");
});

test("a type's own icon takes priority over an inherited one", () => {
  const byId = new Map([
    ["core/hardware", record({ id: "core/hardware", extends: null, icon: "hardware" })],
    ["core/server", record({ id: "core/server", extends: "core/hardware", icon: "server" })],
  ]);

  assert.equal(resolveType("core/server", byId).resolvedIcon, "server");
});

test("merges attributes down the chain, child overriding same-key parent attributes", () => {
  const byId = new Map([
    [
      "core/hardware",
      record({
        id: "core/hardware",
        extends: null,
        attributes: [
          { key: "manufacturer", label: "Manufacturer", dataType: "string" },
          { key: "model", label: "Model", dataType: "string" },
        ],
      }),
    ],
    [
      "core/server",
      record({
        id: "core/server",
        extends: "core/hardware",
        attributes: [{ key: "model", label: "Server model", dataType: "string" }],
      }),
    ],
  ]);

  const resolved = resolveType("core/server", byId);
  const byKey = Object.fromEntries(resolved.resolvedAttributes.map((a) => [a.key, a]));
  assert.equal(byKey.manufacturer.label, "Manufacturer");
  assert.equal(byKey.model.label, "Server model");
});

test("excludeAttributes drops inherited keys the type doesn't want, without needing an override", () => {
  const byId = new Map([
    [
      "core/hardware",
      record({
        id: "core/hardware",
        extends: null,
        attributes: [
          { key: "manufacturer", label: "Manufacturer", dataType: "string" },
          { key: "model", label: "Model", dataType: "string" },
        ],
      }),
    ],
    [
      "core/group",
      record({
        id: "core/group",
        extends: "core/hardware",
        attributes: [{ key: "notes", label: "Notes", dataType: "string" }],
        excludeAttributes: ["manufacturer", "model"],
      }),
    ],
  ]);

  const resolved = resolveType("core/group", byId);
  const keys = resolved.resolvedAttributes.map((a) => a.key).sort();
  assert.deepEqual(keys, ["notes"]);
});

test("excludeAttributes propagates to anything that extends the excluding type, like icon/attributes do", () => {
  const byId = new Map([
    [
      "core/hardware",
      record({
        id: "core/hardware",
        extends: null,
        attributes: [{ key: "manufacturer", label: "Manufacturer", dataType: "string" }],
      }),
    ],
    [
      "core/group",
      record({ id: "core/group", extends: "core/hardware", excludeAttributes: ["manufacturer"] }),
    ],
    // Doesn't redeclare manufacturer — the exclusion it inherited from core/group should stay in
    // effect, the same way it would inherit any other attribute or icon core/group set.
    ["core/specialized-group", record({ id: "core/specialized-group", extends: "core/group" })],
    // Does redeclare it — an explicit own attribute always wins over an inherited exclusion,
    // exactly like it already wins over an inherited attribute value.
    [
      "core/branded-group",
      record({
        id: "core/branded-group",
        extends: "core/group",
        attributes: [{ key: "manufacturer", label: "Manufacturer", dataType: "string" }],
      }),
    ],
  ]);

  assert.ok(!resolveType("core/specialized-group", byId).resolvedAttributes.some((a) => a.key === "manufacturer"));
  assert.ok(resolveType("core/branded-group", byId).resolvedAttributes.some((a) => a.key === "manufacturer"));
});

test("a middle ancestor's redeclaration survives a further descendant that adds no attributes of its own", () => {
  // Regression case: an earlier version of the exclusion logic only checked the *resolved* type's
  // own attributes for a redeclaration, missing one made by a type in between it and the excluder.
  const byId = new Map([
    [
      "core/hardware",
      record({
        id: "core/hardware",
        extends: null,
        attributes: [{ key: "manufacturer", label: "Manufacturer", dataType: "string" }],
      }),
    ],
    [
      "core/group",
      record({ id: "core/group", extends: "core/hardware", excludeAttributes: ["manufacturer"] }),
    ],
    [
      "core/branded-group",
      record({
        id: "core/branded-group",
        extends: "core/group",
        attributes: [{ key: "manufacturer", label: "Manufacturer", dataType: "string" }],
      }),
    ],
    // Extends branded-group, not group directly, and redeclares nothing itself — it should still
    // inherit branded-group's redeclared manufacturer, closer than core/group's exclusion.
    [
      "core/premium-branded-group",
      record({ id: "core/premium-branded-group", extends: "core/branded-group" }),
    ],
  ]);

  assert.ok(
    resolveType("core/premium-branded-group", byId).resolvedAttributes.some((a) => a.key === "manufacturer"),
  );
});

test("throws on an unknown parent id", () => {
  const byId = new Map([
    ["core/server", record({ id: "core/server", extends: "core/does-not-exist" })],
  ]);
  assert.throws(() => resolveType("core/server", byId), TypeResolutionError);
});

test("throws on a cycle", () => {
  const byId = new Map([
    ["a", record({ id: "a", extends: "b" })],
    ["b", record({ id: "b", extends: "a" })],
  ]);
  assert.throws(() => resolveType("a", byId), TypeResolutionError);
});
