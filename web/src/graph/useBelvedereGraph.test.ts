import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useBelvedereGraph } from "./useBelvedereGraph";
import type { Asset, Relationship, ResolvedType } from "../api/types";

vi.mock("../api/client", () => ({
  api: {
    listAssets: vi.fn(),
    listRelationships: vi.fn(),
    getAsset: vi.fn(),
    getType: vi.fn(),
  },
}));

import { api } from "../api/client";

const server: Asset = {
  id: "server-1",
  typeId: "core/server",
  name: "web-01",
  layer: "physical",
  attributeValues: {},
  createdAt: "",
  updatedAt: "",
};

const os: Asset = {
  id: "os-1",
  typeId: "core/os",
  name: "ubuntu",
  layer: "logical",
  attributeValues: {},
  createdAt: "",
  updatedAt: "",
};

function resolvedType(id: string): ResolvedType {
  return {
    id,
    name: id,
    root: "hardware",
    extends: null,
    icon: null,
    description: null,
    resolvedIcon: null,
    resolvedAttributes: [],
    ancestry: [],
  };
}

const hostsRelationship: Relationship = { fromId: "server-1", kind: "HOSTS", toId: "os-1", properties: {} };

const aSwitch: Asset = {
  id: "switch-1",
  typeId: "core/switch",
  name: "switch-01",
  layer: "physical",
  attributeValues: {},
  createdAt: "",
  updatedAt: "",
};

const connectsToSwitch: Relationship = {
  fromId: "server-1",
  kind: "CONNECTS_TO",
  toId: "switch-1",
  properties: {},
};

function disk(id: string): Asset {
  return {
    id,
    typeId: "core/disk",
    name: id,
    layer: "physical",
    attributeValues: {},
    createdAt: "",
    updatedAt: "",
  };
}

describe("useBelvedereGraph", () => {
  it("loads the physical overview on mount", async () => {
    vi.mocked(api.listAssets).mockResolvedValue([server]);
    vi.mocked(api.listRelationships).mockResolvedValue([]);
    vi.mocked(api.getType).mockResolvedValue(resolvedType("core/server"));

    const { result } = renderHook(() => useBelvedereGraph());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.nodes.map((n) => n.id)).toEqual(["server-1"]);
  });

  it("expand() adds the hosted node and does not get wiped by resolving a not-yet-cached type", async () => {
    // Regression test: resolving `core/os` for the first time during expand() must not re-trigger
    // the mount effect and reset the graph back to just the physical overview. This happened when
    // the type cache lived in useState (see useBelvedereGraph.ts) instead of a ref.
    vi.mocked(api.listAssets).mockResolvedValue([server]);
    vi.mocked(api.listRelationships).mockImplementation(async (assetId: string) =>
      assetId === "server-1" ? [hostsRelationship] : [],
    );
    vi.mocked(api.getAsset).mockResolvedValue(os);
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.expand("server-1");

    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["os-1", "server-1"]);
    });
    expect(result.current.edges.some((e) => e.source === "server-1" && e.target === "os-1")).toBe(true);
  });

  it("collapsing a node removes only what it revealed, not pre-existing overview nodes it's also connected to", async () => {
    // Regression test: expand() used to record expandedFrom parentage for every relationship
    // target, including ones already on the canvas (e.g. an overview node the expanded node has a
    // CONNECTS_TO edge to). Collapsing would then delete that pre-existing node too.
    vi.mocked(api.listAssets).mockResolvedValue([server, aSwitch]);
    vi.mocked(api.listRelationships).mockImplementation(async (assetId: string) =>
      assetId === "server-1" ? [connectsToSwitch, hostsRelationship] : [],
    );
    vi.mocked(api.getAsset).mockImplementation(async (id: string) =>
      id === "switch-1" ? aSwitch : os,
    );
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["server-1", "switch-1"]);

    await result.current.expand("server-1");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["os-1", "server-1", "switch-1"]);
    });

    // expand() again on an already-expanded node collapses it.
    await result.current.expand("server-1");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["server-1", "switch-1"]);
    });
    expect(result.current.edges.some((e) => e.source === "server-1" && e.target === "switch-1")).toBe(true);
  });

  it("attachHostedChild adds a HOSTS child at a distinct position and collapse() removes it", async () => {
    vi.mocked(api.listAssets).mockResolvedValue([server]);
    vi.mocked(api.listRelationships).mockResolvedValue([]);
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.attachHostedChild("server-1", disk("disk-1"));
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["disk-1", "server-1"]);
    });
    await result.current.attachHostedChild("server-1", disk("disk-2"));
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["disk-1", "disk-2", "server-1"]);
    });

    // Regression guard: each sibling gets its own position under the parent, not one derived
    // from the total node count on the whole canvas (which would put them on top of each other
    // here, since the canvas only ever has 1-3 nodes in this test).
    const disk1 = result.current.nodes.find((n) => n.id === "disk-1")!;
    const disk2 = result.current.nodes.find((n) => n.id === "disk-2")!;
    expect(disk1.position).not.toEqual(disk2.position);

    const serverNode = result.current.nodes.find((n) => n.id === "server-1")!;
    expect(serverNode.data.expanded).toBe(true);

    // expand() on an already-expanded node collapses it (there's no separate public collapse()).
    await result.current.expand("server-1");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id)).toEqual(["server-1"]);
    });
  });
});
