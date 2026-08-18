import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Driver } from "neo4j-driver";
import { setupTestDb } from "./testSupport.js";
import { AssetRepository } from "./assetRepository.js";
import { RelationshipRepository } from "./relationshipRepository.js";

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
