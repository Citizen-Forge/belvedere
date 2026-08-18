import { test } from "node:test";
import assert from "node:assert/strict";
import { createRelationship, deleteRelationship, listAssetRelationships } from "./relationshipTools.js";
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
