import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Driver } from "neo4j-driver";
import { setupTestDb } from "./testSupport.js";
import { AssetRepository } from "./assetRepository.js";
import { HostsCycleError, RelationshipRepository, SelfMembershipError } from "./relationshipRepository.js";

let driver: Driver | undefined;
let assets: AssetRepository;
let relationships: RelationshipRepository;
const createdIds: string[] = [];

before(async () => {
  ({ driver, assets, relationships } = await setupTestDb());
});

after(async () => {
  // Sequential, not Promise.all: these fixtures are relationship-connected to each other, and
  // concurrent DETACH DELETEs on nodes sharing an edge can hit Neo4j lock contention.
  if (assets) {
    for (const id of createdIds) {
      await assets.remove(id);
    }
  }
  await driver?.close();
});

async function makeAsset(typeId: string, name: string, layer: "physical" | "logical") {
  const asset = await assets.create({ typeId, name, attributeValues: {}, layer });
  createdIds.push(asset.id);
  return asset;
}

test("creates a HOSTS relationship and lists it from the source asset", async () => {
  const server = await makeAsset("core/server", "host-01", "physical");
  const os = await makeAsset("core/os", "ubuntu-24.04", "logical");

  await relationships.create(server.id, "HOSTS", os.id);

  const rels = await relationships.listFrom(server.id);
  assert.equal(rels.length, 1);
  assert.equal(rels[0].kind, "HOSTS");
  assert.equal(rels[0].toId, os.id);
});

test("stores relationship properties and returns them on listFrom", async () => {
  const client = await makeAsset("core/server", "client-01", "physical");
  const server = await makeAsset("core/server", "server-01", "physical");

  await relationships.create(client.id, "CONNECTS_TO", server.id, { port: 443, protocol: "https" });

  const rels = await relationships.listFrom(client.id);
  assert.equal(rels.length, 1);
  assert.deepEqual(rels[0].properties, { port: 443, protocol: "https" });
});

test("remove() deletes only the targeted relationship", async () => {
  const platform = await makeAsset("core/container-platform", "docker-01", "logical");
  const svcA = await makeAsset("core/database", "db-a", "logical");
  const svcB = await makeAsset("core/database", "db-b", "logical");

  await relationships.create(platform.id, "HOSTS", svcA.id);
  await relationships.create(platform.id, "HOSTS", svcB.id);

  await relationships.remove(platform.id, "HOSTS", svcA.id);

  const rels = await relationships.listFrom(platform.id);
  assert.equal(rels.length, 1);
  assert.equal(rels[0].toId, svcB.id);
});

test("create() rejects when either endpoint does not exist", async () => {
  const server = await makeAsset("core/server", "lonely-01", "physical");
  await assert.rejects(() =>
    relationships.create(server.id, "HOSTS", "00000000-0000-0000-0000-000000000000"),
  );
});

test("create() rejects a HOSTS self-loop", async () => {
  const server = await makeAsset("core/server", "self-host-01", "physical");
  await assert.rejects(() => relationships.create(server.id, "HOSTS", server.id), HostsCycleError);
});

test("create() rejects a HOSTS relationship that would close a transitive cycle", async () => {
  const a = await makeAsset("core/server", "cycle-a", "physical");
  const b = await makeAsset("core/component", "cycle-b", "physical");
  const c = await makeAsset("core/component", "cycle-c", "physical");

  await relationships.create(a.id, "HOSTS", b.id);
  await relationships.create(b.id, "HOSTS", c.id);

  // c already (transitively) hosted by a -> b -> c; c HOSTS a would close the loop.
  await assert.rejects(() => relationships.create(c.id, "HOSTS", a.id), HostsCycleError);

  // The existing a -> b -> c chain is untouched by the rejected attempt.
  const relsFromC = await relationships.listFrom(c.id);
  assert.equal(relsFromC.length, 0);
});

test("MEMBER_OF is many-to-many and listMembers() returns it from the group's side, not the member's", async () => {
  const server = await makeAsset("core/generic-server", "member-server-01", "physical");
  const gpu1 = await makeAsset("core/gpu", "member-gpu-01", "physical");
  const gpu2 = await makeAsset("core/gpu", "member-gpu-02", "physical");
  const localGroup = await makeAsset("core/group", "member-local-gpus", "physical");
  const globalGroup = await makeAsset("core/group", "member-all-gpus", "physical");

  // Both GPUs stay HOSTS-connected to the server (ground truth) *and* are tagged into a group
  // hosted by that same server, *and* gpu1 is additionally tagged into a second, unrelated,
  // free-floating group with no HOSTS parent at all.
  await relationships.create(server.id, "HOSTS", gpu1.id);
  await relationships.create(server.id, "HOSTS", gpu2.id);
  await relationships.create(server.id, "HOSTS", localGroup.id);
  await relationships.create(gpu1.id, "MEMBER_OF", localGroup.id);
  await relationships.create(gpu2.id, "MEMBER_OF", localGroup.id);
  await relationships.create(gpu1.id, "MEMBER_OF", globalGroup.id);

  const localMembers = await relationships.listMembers(localGroup.id);
  assert.deepEqual(
    localMembers.map((r) => r.fromId).sort(),
    [gpu1.id, gpu2.id].sort(),
  );

  const globalMembers = await relationships.listMembers(globalGroup.id);
  assert.deepEqual(globalMembers.map((r) => r.fromId), [gpu1.id]);

  // MEMBER_OF is additive, not exclusive: gpu1 is still HOSTS-connected to the server directly,
  // regardless of also being a member of two different groups.
  const relsFromServer = await relationships.listFrom(server.id);
  assert.ok(relsFromServer.some((r) => r.kind === "HOSTS" && r.toId === gpu1.id));

  // listFrom on a member surfaces its outgoing MEMBER_OF edges too (e.g. "part of groups" shown
  // when inspecting that asset).
  const relsFromGpu1 = await relationships.listFrom(gpu1.id);
  assert.deepEqual(
    relsFromGpu1.filter((r) => r.kind === "MEMBER_OF").map((r) => r.toId).sort(),
    [localGroup.id, globalGroup.id].sort(),
  );
});

test("create() rejects a MEMBER_OF self-loop, unlike HOSTS it has no transitive-cycle check otherwise", async () => {
  const groupA = await makeAsset("core/group", "member-self-a", "physical");
  const groupB = await makeAsset("core/group", "member-self-b", "physical");

  await assert.rejects(() => relationships.create(groupA.id, "MEMBER_OF", groupA.id), SelfMembershipError);

  // Groups being MEMBER_OF each other (not self) is allowed — MEMBER_OF has no acyclicity rule
  // beyond the self-loop guard, since (unlike HOSTS) it never hides anything from the UI.
  await relationships.create(groupA.id, "MEMBER_OF", groupB.id);
  await relationships.create(groupB.id, "MEMBER_OF", groupA.id);
  const relsFromA = await relationships.listFrom(groupA.id);
  assert.ok(relsFromA.some((r) => r.kind === "MEMBER_OF" && r.toId === groupB.id));
});

test("create() still allows a non-HOSTS relationship between assets already HOSTS-connected", async () => {
  // The cycle check is HOSTS-specific — CONNECTS_TO/PROVIDES have no containment semantics, so a
  // "cycle" in those kinds isn't actually a problem (e.g. two peers both HOSTS'd by a third asset
  // can legitimately CONNECTS_TO each other).
  const parent = await makeAsset("core/server", "parent-01", "physical");
  const child = await makeAsset("core/component", "child-01", "physical");
  await relationships.create(parent.id, "HOSTS", child.id);

  await relationships.create(child.id, "CONNECTS_TO", parent.id);
  const relsFromChild = await relationships.listFrom(child.id);
  assert.ok(relsFromChild.some((r) => r.kind === "CONNECTS_TO" && r.toId === parent.id));
});
