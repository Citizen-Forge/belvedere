import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRelationship,
  deleteRelationship,
  listAssetRelationships,
  listGroupMembers,
  listConnections,
} from "./relationshipTools.js";
import type { api } from "../apiClient.js";

function fakeApi(overrides: Partial<typeof api>): typeof api {
  return overrides as typeof api;
}

test("listAssetRelationships passes the asset id through", async () => {
  let receivedId: string | undefined;
  const api = fakeApi({
    listRelationships: async (assetId) => {
      receivedId = assetId;
      return [];
    },
  });

  await listAssetRelationships({ assetId: "asset-1" }, api);
  assert.equal(receivedId, "asset-1");
});

test("listGroupMembers queries incoming MEMBER_OF edges via listMembers, not listRelationships", async () => {
  let receivedId: string | undefined;
  const api = fakeApi({
    listMembers: async (assetId) => {
      receivedId = assetId;
      return [{ fromId: "gpu-1", kind: "MEMBER_OF", toId: "group-1", properties: {} }];
    },
  });

  const result = await listGroupMembers({ assetId: "group-1" }, api);
  assert.equal(receivedId, "group-1");
  assert.deepEqual(result, [{ fromId: "gpu-1", kind: "MEMBER_OF", toId: "group-1", properties: {} }]);
});

test("listConnections queries CONNECTS_TO from either side via listConnections, not listRelationships", async () => {
  let receivedId: string | undefined;
  const api = fakeApi({
    listConnections: async (assetId) => {
      receivedId = assetId;
      return [{ fromId: "switch-1", kind: "CONNECTS_TO", toId: "nic-1", properties: { notes: "port 3" } }];
    },
  });

  const result = await listConnections({ assetId: "nic-1" }, api);
  assert.equal(receivedId, "nic-1");
  assert.deepEqual(result, [
    { fromId: "switch-1", kind: "CONNECTS_TO", toId: "nic-1", properties: { notes: "port 3" } },
  ]);
});

test("createRelationship forwards fromId/kind/toId/properties", async () => {
  let received: unknown[] = [];
  const api = fakeApi({
    createRelationship: async (fromId, kind, toId, properties) => {
      received = [fromId, kind, toId, properties];
      return { fromId, kind, toId, properties: properties ?? {} } as never;
    },
  });

  await createRelationship({ fromId: "a", kind: "HOSTS", toId: "b", properties: { note: "x" } }, api);
  assert.deepEqual(received, ["a", "HOSTS", "b", { note: "x" }]);
});

test("deleteRelationship calls the API client and reports what was deleted", async () => {
  let received: unknown[] = [];
  const api = fakeApi({
    deleteRelationship: async (fromId, kind, toId) => {
      received = [fromId, kind, toId];
    },
  });

  const result = await deleteRelationship({ fromId: "a", kind: "CONNECTS_TO", toId: "b" }, api);
  assert.deepEqual(received, ["a", "CONNECTS_TO", "b"]);
  assert.deepEqual(result, { deleted: { fromId: "a", kind: "CONNECTS_TO", toId: "b" } });
});
