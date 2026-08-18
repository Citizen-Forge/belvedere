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
