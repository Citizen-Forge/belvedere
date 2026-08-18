#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { api, ApiError } from "./apiClient.js";
import {
  getType,
  getTypeSchema,
  listLibraries,
  listLibrariesSchema,
  listTypeChildren,
  listTypeChildrenSchema,
  listTypeRoots,
  listTypeRootsSchema,
} from "./tools/typeTools.js";
import {
  createAsset,
  createAssetSchema,
  deleteAsset,
  deleteAssetSchema,
  getAsset,
  getAssetSchema,
  listAssets,
  listAssetsSchema,
} from "./tools/assetTools.js";
import {
  createRelationship,
  createRelationshipSchema,
  deleteRelationship,
  deleteRelationshipSchema,
  listAssetRelationships,
  listAssetRelationshipsSchema,
} from "./tools/relationshipTools.js";

const server = new McpServer({ name: "belvedere", version: "0.1.0" });

/**
 * Wraps a pure tool handler as an MCP tool callback: runs it, JSON-serializes the result as text,
 * and turns a thrown ApiError into an MCP error result instead of crashing the server process.
 * Deliberately untyped on `input` here — each call site below passes a handler (e.g.
 * `(input) => listTypeRoots(input, api)`) whose own parameter type already comes from that
 * handler's schema, and `registerTool`'s own generics type-check the callback against the exact
 * `inputSchema` passed alongside it. Trying to also make this wrapper generic over the schema
 * shape fights TypeScript's inference (the schema can't be inferred from a contravariant callback
 * parameter) without adding any real safety beyond what those two already provide.
 */
function toolCallback(handler: (input: any) => Promise<unknown> | unknown) {
  return async (args: any) => {
    try {
      const result = await handler(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (cause) {
      const message = cause instanceof ApiError ? `${cause.status}: ${cause.message}` : String(cause);
      return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
    }
  };
}

server.registerTool(
  "list_type_roots",
  {
    description: "List the type catalog's root(s): hardware, software, cloud-provider. Start here to browse what can be instantiated.",
    inputSchema: listTypeRootsSchema.shape,
  },
  toolCallback((input) => listTypeRoots(input, api)),
);

server.registerTool(
  "get_type",
  {
    description: "Get a type's full resolved definition — inherited + own attributes, icon, ancestry.",
    inputSchema: getTypeSchema.shape,
  },
  toolCallback((input) => getType(input, api)),
);

server.registerTool(
  "list_type_children",
  {
    description: "List the direct child types of a type, for browsing the inheritance tree (e.g. children of core/component are core/cpu, core/disk, core/network-interface).",
    inputSchema: listTypeChildrenSchema.shape,
  },
  toolCallback((input) => listTypeChildren(input, api)),
);

server.registerTool(
  "list_libraries",
  {
    description: "List configured type-library sources (the default plus any user-added ones).",
    inputSchema: listLibrariesSchema.shape,
  },
  toolCallback((input) => listLibraries(input, api)),
);

server.registerTool(
  "list_assets",
  {
    description: "List existing asset instances, optionally filtered by exact type or layer (physical/logical).",
    inputSchema: listAssetsSchema.shape,
  },
  toolCallback((input) => listAssets(input, api)),
);

server.registerTool(
  "get_asset",
  {
    description: "Get one asset instance by id, including its attribute values.",
    inputSchema: getAssetSchema.shape,
  },
  toolCallback((input) => getAsset(input, api)),
);

server.registerTool(
  "create_asset",
  {
    description: "Create a new asset instance of a given type. Look the type up first (get_type) to know which attributes it accepts — unrecognized attribute keys are rejected.",
    inputSchema: createAssetSchema.shape,
  },
  toolCallback((input) => createAsset(input, api)),
);

server.registerTool(
  "delete_asset",
  {
    description: "Delete an asset instance and all its relationships.",
    inputSchema: deleteAssetSchema.shape,
  },
  toolCallback((input) => deleteAsset(input, api)),
);

server.registerTool(
  "list_asset_relationships",
  {
    description: "List relationships originating from an asset (HOSTS/PROVIDES/CONNECTS_TO edges where it's the source).",
    inputSchema: listAssetRelationshipsSchema.shape,
  },
  toolCallback((input) => listAssetRelationships(input, api)),
);

server.registerTool(
  "create_relationship",
  {
    description: "Connect two existing assets with a typed relationship (HOSTS/PROVIDES/CONNECTS_TO). Both assets must already exist — create them first.",
    inputSchema: createRelationshipSchema.shape,
  },
  toolCallback((input) => createRelationship(input, api)),
);

server.registerTool(
  "delete_relationship",
  {
    description: "Remove a specific relationship between two assets.",
    inputSchema: deleteRelationshipSchema.shape,
  },
  toolCallback((input) => deleteRelationship(input, api)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
