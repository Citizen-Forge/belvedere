import { test } from "node:test";
import assert from "node:assert/strict";
import { createAsset, deleteAsset, getAsset, listAssets } from "./assetTools.js";
import type { api } from "../apiClient.js";

function fakeApi(overrides: Partial<typeof api>): typeof api {
  return overrides as typeof api;
}

test("listAssets forwards typeId/layer filters", async () => {
  let received: unknown;
  const api = fakeApi({
    listAssets: async (filter) => {
      received = filter;
      return [];
    },
  });

  await listAssets({ typeId: "core/server", layer: "physical" }, api);
  assert.deepEqual(received, { typeId: "core/server", layer: "physical" });
});

test("getAsset passes the id through", async () => {
  const api = fakeApi({
    getAsset: async (id) => ({ id }) as never,
  });

  const result = await getAsset({ id: "asset-1" }, api);
  assert.equal((result as { id: string }).id, "asset-1");
});

test("createAsset forwards typeId/name/attributeValues", async () => {
  let received: unknown;
  const api = fakeApi({
    createAsset: async (input) => {
      received = input;
      return { id: "new-1", ...input } as never;
    },
  });

  await createAsset({ typeId: "core/disk", name: "disk-1", attributeValues: { mediaType: "hdd" } }, api);
  assert.deepEqual(received, { typeId: "core/disk", name: "disk-1", attributeValues: { mediaType: "hdd" } });
});

test("deleteAsset calls the API client and reports what was deleted", async () => {
  let deletedId: string | undefined;
  const api = fakeApi({
    deleteAsset: async (id) => {
      deletedId = id;
    },
  });

  const result = await deleteAsset({ id: "asset-1" }, api);
  assert.equal(deletedId, "asset-1");
  assert.deepEqual(result, { deleted: "asset-1" });
});
