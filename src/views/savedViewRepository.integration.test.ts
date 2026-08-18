import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import neo4j, { type Driver } from "neo4j-driver";
import { applyViewsSchema } from "./schema.js";
import { SavedViewRepository, SavedViewNotFoundError } from "./savedViewRepository.js";

const uri = process.env.BELVEDERE_NEO4J_URI ?? "bolt://localhost:7687";
const auth = neo4j.auth.basic(
  process.env.BELVEDERE_NEO4J_USER ?? "neo4j",
  process.env.BELVEDERE_NEO4J_PASSWORD ?? "belvedere-dev",
);

let driver: Driver | undefined;
let repo: SavedViewRepository;
const createdIds: string[] = [];

before(async () => {
  driver = neo4j.driver(uri, auth);
  await applyViewsSchema(driver);
  repo = new SavedViewRepository(driver);
});

after(async () => {
  if (repo) {
    for (const id of createdIds) {
      await repo.remove(id).catch(() => undefined);
    }
  }
  await driver?.close();
});

test("creates a view and reads it back with positions intact", async () => {
  const view = await repo.create({
    name: "Rack overview",
    visibleAssetIds: ["a", "b"],
    nodePositions: { a: { x: 0, y: 0 }, b: { x: 100, y: 40 } },
  });
  createdIds.push(view.id);

  const fetched = await repo.get(view.id);
  assert.equal(fetched.name, "Rack overview");
  assert.deepEqual(fetched.visibleAssetIds, ["a", "b"]);
  assert.deepEqual(fetched.nodePositions, { a: { x: 0, y: 0 }, b: { x: 100, y: 40 } });
});

test("lists created views", async () => {
  const view = await repo.create({ name: "List test", visibleAssetIds: [], nodePositions: {} });
  createdIds.push(view.id);

  const all = await repo.list();
  assert.ok(all.some((v) => v.id === view.id));
});

test("remove() deletes the view; get() then throws SavedViewNotFoundError", async () => {
  const view = await repo.create({ name: "Temp", visibleAssetIds: [], nodePositions: {} });

  await repo.remove(view.id);
  await assert.rejects(() => repo.get(view.id), SavedViewNotFoundError);
});
