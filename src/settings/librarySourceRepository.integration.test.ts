import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import neo4j, { type Driver } from "neo4j-driver";
import { applySettingsSchema } from "./schema.js";
import {
  LibrarySourceRepository,
  LibrarySourceNotFoundError,
  LibrarySourceAlreadyExistsError,
} from "./librarySourceRepository.js";

const uri = process.env.BELVEDERE_NEO4J_URI ?? "bolt://localhost:7687";
const auth = neo4j.auth.basic(
  process.env.BELVEDERE_NEO4J_USER ?? "neo4j",
  process.env.BELVEDERE_NEO4J_PASSWORD ?? "belvedere-dev",
);

let driver: Driver | undefined;
let repo: LibrarySourceRepository;
const createdIds: string[] = [];

before(async () => {
  driver = neo4j.driver(uri, auth);
  await applySettingsSchema(driver);
  repo = new LibrarySourceRepository(driver);
});

after(async () => {
  if (repo) {
    await Promise.all(
      createdIds.map((id) => repo.remove(id).catch(() => undefined /* already removed by a test */)),
    );
  }
  await driver?.close();
});

test("adds and lists a library source", async () => {
  const config = await repo.add({ id: "test-fixture-a", name: "Test Fixture A", location: "/tmp/fixture-a" });
  createdIds.push(config.id);

  assert.equal(config.isDefault, false);
  const all = await repo.list();
  const fetched = all.find((s) => s.id === "test-fixture-a");
  assert.ok(fetched);
  // Neo4j has no null property value — list() must normalize a missing `ref` back to null,
  // matching what add() returns in-process, rather than leaving it undefined.
  assert.equal(fetched.ref, null);
});

test("rejects adding a source with a duplicate id", async () => {
  const config = await repo.add({ id: "test-fixture-b", name: "B", location: "/tmp/fixture-b" });
  createdIds.push(config.id);

  await assert.rejects(
    () => repo.add({ id: "test-fixture-b", name: "B again", location: "/tmp/other" }),
    LibrarySourceAlreadyExistsError,
  );
});

test("remove() deletes the source; a second remove throws LibrarySourceNotFoundError", async () => {
  const config = await repo.add({ id: "test-fixture-c", name: "C", location: "/tmp/fixture-c" });

  await repo.remove(config.id);
  await assert.rejects(() => repo.remove(config.id), LibrarySourceNotFoundError);
});

test("seedDefaultIfEmpty is a no-op once any source exists", async () => {
  // Earlier tests in this file left sources in place (cleaned up in after()), so the store is non-empty here.
  const before = await repo.list();
  assert.ok(before.length > 0);

  await repo.seedDefaultIfEmpty({ id: "should-not-be-added", name: "x", location: "x" });

  const after = await repo.list();
  assert.equal(after.length, before.length);
});
