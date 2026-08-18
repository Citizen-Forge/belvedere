import { test } from "node:test";
import assert from "node:assert/strict";
import { getType, listLibraries, listTypeChildren, listTypeRoots } from "./typeTools.js";
import type { api } from "../apiClient.js";

function fakeApi(overrides: Partial<typeof api>): typeof api {
  return overrides as typeof api;
}

test("listTypeRoots forwards the root filter to the API client", async () => {
  let receivedRoot: string | undefined;
  const api = fakeApi({
    listRootTypes: async (root) => {
      receivedRoot = root;
      return [];
    },
  });

  await listTypeRoots({ root: "hardware" }, api);
  assert.equal(receivedRoot, "hardware");
});

test("getType passes the type id through", async () => {
  let receivedId: string | undefined;
  const api = fakeApi({
    getType: async (id) => {
      receivedId = id;
      return { id } as never;
    },
  });

  const result = await getType({ id: "core/server" }, api);
  assert.equal(receivedId, "core/server");
  assert.equal((result as { id: string }).id, "core/server");
});

test("listTypeChildren passes the parent id through", async () => {
  let receivedId: string | undefined;
  const api = fakeApi({
    listChildTypes: async (id) => {
      receivedId = id;
      return [];
    },
  });

  await listTypeChildren({ id: "core/component" }, api);
  assert.equal(receivedId, "core/component");
});

test("listLibraries calls the API client with no arguments", async () => {
  let called = false;
  const api = fakeApi({
    listLibraries: async () => {
      called = true;
      return [];
    },
  });

  await listLibraries({}, api);
  assert.equal(called, true);
});
