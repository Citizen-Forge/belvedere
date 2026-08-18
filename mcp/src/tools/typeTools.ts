import { z } from "zod";
import type { api } from "../apiClient.js";

type Api = typeof api;

export const listTypeRootsSchema = z.object({
  root: z
    .enum(["hardware", "software", "cloud-provider"])
    .optional()
    .describe("Restrict to one of the three system roots; omit to list all three."),
});

export function listTypeRoots(input: z.infer<typeof listTypeRootsSchema>, api: Api) {
  return api.listRootTypes(input.root);
}

export const getTypeSchema = z.object({
  id: z.string().describe('Type id, e.g. "core/server".'),
});

export function getType(input: z.infer<typeof getTypeSchema>, api: Api) {
  return api.getType(input.id);
}

export const listTypeChildrenSchema = z.object({
  id: z.string().describe('Parent type id, e.g. "core/hardware" or "core/component".'),
});

export function listTypeChildren(input: z.infer<typeof listTypeChildrenSchema>, api: Api) {
  return api.listChildTypes(input.id);
}

export const listLibrariesSchema = z.object({});

export function listLibraries(_input: z.infer<typeof listLibrariesSchema>, api: Api) {
  return api.listLibraries();
}
