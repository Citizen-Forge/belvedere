import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Driver } from "neo4j-driver";
import { setupTestDb } from "./testSupport.js";
import { AssetRepository, AssetNotFoundError } from "./assetRepository.js";

let driver: Driver | undefined;
let assets: AssetRepository;
const createdIds: string[] = [];

before(async () => {
  ({ driver, assets } = await setupTestDb());
});

after(async () => {
  // Scoped cleanup: only the rows this file created, not a blanket wipe of the database.
  // Sequential, not Promise.all: avoids Neo4j lock contention if fixtures ever become
  // relationship-connected (see relationshipRepository.integration.test.ts for where this bit us).
  if (assets) {
    for (const id of createdIds) {
      await assets.remove(id);
    }
  }
  await driver?.close();
});

test("creates and retrieves an asset with its attribute values intact", async () => {
  const asset = await assets.create({
    typeId: "core/server",
    name: "web-01",
    attributeValues: { cpu: "Xeon E5", ramGb: 64 },
    layer: "physical",
  });
  createdIds.push(asset.id);

  const fetched = await assets.get(asset.id);
  assert.equal(fetched.name, "web-01");
  assert.deepEqual(fetched.attributeValues, { cpu: "Xeon E5", ramGb: 64 });
  assert.equal(fetched.layer, "physical");
});

test("lists assets filtered by typeId and layer", async () => {
  const server = await assets.create({
    typeId: "core/server",
    name: "web-02",
    attributeValues: {},
    layer: "physical",
  });
  const laptop = await assets.create({
    typeId: "core/laptop",
    name: "dev-laptop",
    attributeValues: {},
    layer: "logical",
  });
  createdIds.push(server.id, laptop.id);

  const servers = await assets.list({ typeId: "core/server" });
  assert.ok(servers.some((a) => a.id === server.id));
  assert.ok(!servers.some((a) => a.id === laptop.id));

  const logical = await assets.list({ layer: "logical" });
  assert.ok(logical.some((a) => a.id === laptop.id));
  assert.ok(!logical.some((a) => a.id === server.id));
});

test("get() throws AssetNotFoundError for an unknown id", async () => {
  await assert.rejects(() => assets.get("00000000-0000-0000-0000-000000000000"), AssetNotFoundError);
});

test("remove() deletes the asset", async () => {
  const asset = await assets.create({
    typeId: "core/server",
    name: "temp",
    attributeValues: {},
    layer: "physical",
  });

  await assets.remove(asset.id);
  await assert.rejects(() => assets.get(asset.id), AssetNotFoundError);
});
