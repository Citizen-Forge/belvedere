import { test } from "node:test";
import assert from "node:assert/strict";
import { LibraryRegistry } from "./registry.js";
import { coreLibrarySource } from "./config.js";

test("loads the bundled core library and resolves its roots and children", async () => {
  const registry = new LibraryRegistry();
  await registry.load([coreLibrarySource]);

  const roots = registry.listRoots();
  assert.deepEqual(
    roots.map((r) => r.id).sort(),
    ["core/cloud-provider", "core/hardware", "core/software"],
  );

  const hardwareChildren = registry.listChildren("core/hardware");
  assert.deepEqual(
    hardwareChildren.map((c) => c.id).sort(),
    ["core/laptop", "core/network-interface", "core/server", "core/switch"],
  );

  const server = registry.get("core/server");
  assert.equal(server.resolvedIcon, "server");
  assert.ok(server.resolvedAttributes.some((a) => a.key === "manufacturer"));
  assert.ok(server.resolvedAttributes.some((a) => a.key === "cpu"));
});
