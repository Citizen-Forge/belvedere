import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import neo4j, { type Driver } from "neo4j-driver";
import type { FastifyInstance } from "fastify";
import { buildContext, type AppContext } from "../context.js";
import { buildServer } from "./server.js";
import { coreLibrarySource } from "../library/config.js";

const uri = process.env.BELVEDERE_NEO4J_URI ?? "bolt://localhost:7687";
const auth = neo4j.auth.basic(
  process.env.BELVEDERE_NEO4J_USER ?? "neo4j",
  process.env.BELVEDERE_NEO4J_PASSWORD ?? "belvedere-dev",
);

let driver: Driver | undefined;
let ctx: AppContext;
let app: FastifyInstance;
const createdAssetIds: string[] = [];
const createdViewIds: string[] = [];

before(async () => {
  driver = neo4j.driver(uri, auth);
  ctx = await buildContext(driver);
  app = buildServer(ctx);
});

after(async () => {
  // Sequential: interconnected assets can hit Neo4j lock contention under concurrent DETACH
  // DELETEs, and swallowing that failure would silently leave an orphaned row instead of failing the run.
  if (ctx) {
    for (const id of createdAssetIds) {
      await ctx.assets.remove(id);
    }
    for (const id of createdViewIds) {
      await ctx.savedViews.remove(id).catch(() => undefined);
    }
  }
  if (app) await app.close();
  await driver?.close();
});

test("GET /api/types/roots returns the three system roots", async () => {
  const res = await app.inject({ method: "GET", url: "/api/types/roots" });
  assert.equal(res.statusCode, 200);
  const roots = res.json();
  assert.deepEqual(
    roots.map((r: { id: string }) => r.id).sort(),
    ["core/cloud-provider", "core/hardware", "core/software"],
  );
});

test("GET /api/types/:namespace/:slug returns a resolved type with inherited attributes", async () => {
  const res = await app.inject({ method: "GET", url: "/api/types/core/server" });
  assert.equal(res.statusCode, 200);
  const type = res.json();
  assert.equal(type.resolvedIcon, "server");
  assert.ok(type.resolvedAttributes.some((a: { key: string }) => a.key === "manufacturer"));
});

test("GET /api/types/:namespace/:slug 404s for an unknown type", async () => {
  const res = await app.inject({ method: "GET", url: "/api/types/core/does-not-exist" });
  assert.equal(res.statusCode, 404);
});

test("POST /api/assets creates an asset; GET and DELETE round-trip it", async () => {
  const createRes = await app.inject({
    method: "POST",
    url: "/api/assets",
    payload: { typeId: "core/server", name: "api-web-01", attributeValues: { cpu: "Xeon E5" } },
  });
  assert.equal(createRes.statusCode, 201);
  const asset = createRes.json();
  createdAssetIds.push(asset.id);
  assert.equal(asset.layer, "physical");

  const getRes = await app.inject({ method: "GET", url: `/api/assets/${asset.id}` });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.json().name, "api-web-01");

  const deleteRes = await app.inject({ method: "DELETE", url: `/api/assets/${asset.id}` });
  assert.equal(deleteRes.statusCode, 204);

  const afterDeleteRes = await app.inject({ method: "GET", url: `/api/assets/${asset.id}` });
  assert.equal(afterDeleteRes.statusCode, 404);
});

test("POST /api/assets 400s when attribute values don't match the resolved type", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/assets",
    payload: { typeId: "core/server", name: "bad", attributeValues: { formFactor: "not-a-real-option" } },
  });
  assert.equal(res.statusCode, 400);
});

test("POST relationships 404s when toId doesn't exist", async () => {
  const serverRes = await app.inject({
    method: "POST",
    url: "/api/assets",
    payload: { typeId: "core/server", name: "api-lonely-01" },
  });
  const server = serverRes.json();
  createdAssetIds.push(server.id);

  const res = await app.inject({
    method: "POST",
    url: `/api/assets/${server.id}/relationships`,
    payload: { kind: "HOSTS", toId: "00000000-0000-0000-0000-000000000000" },
  });
  assert.equal(res.statusCode, 404);
});

test("DELETE relationships 400s on an invalid kind rather than 500ing", async () => {
  const res = await app.inject({
    method: "DELETE",
    url: "/api/assets/some-id/relationships/NOT_A_REAL_KIND/other-id",
  });
  assert.equal(res.statusCode, 400);
});

test("relationship routes: create, list, and delete a HOSTS edge", async () => {
  const serverRes = await app.inject({
    method: "POST",
    url: "/api/assets",
    payload: { typeId: "core/server", name: "api-host-01" },
  });
  const osRes = await app.inject({
    method: "POST",
    url: "/api/assets",
    payload: { typeId: "core/os", name: "api-os-01" },
  });
  const server = serverRes.json();
  const os = osRes.json();
  createdAssetIds.push(server.id, os.id);

  const createRelRes = await app.inject({
    method: "POST",
    url: `/api/assets/${server.id}/relationships`,
    payload: { kind: "HOSTS", toId: os.id },
  });
  assert.equal(createRelRes.statusCode, 201);

  const listRes = await app.inject({ method: "GET", url: `/api/assets/${server.id}/relationships` });
  const rels = listRes.json();
  assert.equal(rels.length, 1);
  assert.equal(rels[0].toId, os.id);

  const deleteRelRes = await app.inject({
    method: "DELETE",
    url: `/api/assets/${server.id}/relationships/HOSTS/${os.id}`,
  });
  assert.equal(deleteRelRes.statusCode, 204);

  const listAfterRes = await app.inject({ method: "GET", url: `/api/assets/${server.id}/relationships` });
  assert.equal(listAfterRes.json().length, 0);
});

test("GET /api/libraries includes the seeded default source", async () => {
  const res = await app.inject({ method: "GET", url: "/api/libraries" });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().some((s: { id: string }) => s.id === "core"));
});

test("POST /api/libraries rolls back a source whose types collide with an existing one", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/libraries",
    payload: { id: "test-colliding-source", name: "Colliding", location: coreLibrarySource.location },
  });
  assert.equal(res.statusCode, 409);

  const listRes = await app.inject({ method: "GET", url: "/api/libraries" });
  assert.ok(!listRes.json().some((s: { id: string }) => s.id === "test-colliding-source"));
});

test("saved-view routes: create, list, get, and delete a view", async () => {
  const createRes = await app.inject({
    method: "POST",
    url: "/api/views",
    payload: {
      name: "Test rack layout",
      visibleAssetIds: ["asset-a", "asset-b"],
      nodePositions: { "asset-a": { x: 0, y: 0 }, "asset-b": { x: 150, y: 50 } },
    },
  });
  assert.equal(createRes.statusCode, 201);
  const view = createRes.json();
  createdViewIds.push(view.id);

  const listRes = await app.inject({ method: "GET", url: "/api/views" });
  assert.ok(listRes.json().some((v: { id: string }) => v.id === view.id));

  const getRes = await app.inject({ method: "GET", url: `/api/views/${view.id}` });
  assert.equal(getRes.statusCode, 200);
  assert.deepEqual(getRes.json().nodePositions, { "asset-a": { x: 0, y: 0 }, "asset-b": { x: 150, y: 50 } });

  const deleteRes = await app.inject({ method: "DELETE", url: `/api/views/${view.id}` });
  assert.equal(deleteRes.statusCode, 204);

  const afterDeleteRes = await app.inject({ method: "GET", url: `/api/views/${view.id}` });
  assert.equal(afterDeleteRes.statusCode, 404);
});
