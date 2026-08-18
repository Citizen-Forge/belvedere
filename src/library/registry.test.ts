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
    ["core/component", "core/laptop", "core/server", "core/switch"],
  );

  const serverChildren = registry.listChildren("core/server");
  assert.deepEqual(serverChildren.map((c) => c.id).sort(), ["core/generic-server"]);

  // Disks/CPUs/NICs live under core/component, not as peers of core/server — they're things you
  // add *inside* a device, never a standalone top-level asset in their own right.
  const componentChildren = registry.listChildren("core/component");
  assert.deepEqual(
    componentChildren.map((c) => c.id).sort(),
    ["core/cpu", "core/disk", "core/network-interface"],
  );

  const server = registry.get("core/server");
  assert.equal(server.resolvedIcon, "server");
  assert.ok(server.resolvedAttributes.some((a) => a.key === "manufacturer"));
  assert.ok(server.resolvedAttributes.some((a) => a.key === "cpu"));

  const genericServer = registry.get("core/generic-server");
  assert.equal(genericServer.resolvedIcon, "server");
  assert.ok(genericServer.resolvedAttributes.some((a) => a.key === "cpu")); // inherited from core/server
  assert.ok(genericServer.resolvedAttributes.some((a) => a.key === "motherboard")); // own
});
