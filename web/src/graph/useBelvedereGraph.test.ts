import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useBelvedereGraph } from "./useBelvedereGraph";
import type { Asset, Relationship, ResolvedType } from "../api/types";

vi.mock("../api/client", () => ({
  api: {
    listAssets: vi.fn(),
    listRelationships: vi.fn(),
    listMembers: vi.fn(),
    getAsset: vi.fn(),
    getType: vi.fn(),
    createRelationship: vi.fn(),
    deleteRelationship: vi.fn(),
    deleteAsset: vi.fn(),
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
  beforeEach(() => {
    // Every test that calls expand() exercises the outgoing-relationships path; only the
    // group-membership tests below care about incoming MEMBER_OF edges, so default it to none.
    vi.mocked(api.listMembers).mockResolvedValue([]);
  });

  it("loads the physical overview on mount", async () => {
    vi.mocked(api.listAssets).mockResolvedValue([server]);
    vi.mocked(api.listRelationships).mockResolvedValue([]);
    vi.mocked(api.getType).mockResolvedValue(resolvedType("core/server"));

    const { result } = renderHook(() => useBelvedereGraph());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.nodes.map((n) => n.id)).toEqual(["server-1"]);
  });

  it("excludes physical HOSTS children (e.g. disks) from the overview, revealing them only on expand", async () => {
    // Regression test: a disk is physical layer, same as its server — the overview used to load
    // every physical asset unconditionally, so hardware components were permanently visible
    // regardless of whether their parent was expanded or collapsed. Only a logical child (the OS
    // in the sibling test above) actually toggled, which looked like expand/collapse was broken
    // for hardware specifically. The disk here must behave the same way the OS does.
    const physicalDisk = disk("disk-1");
    vi.mocked(api.listAssets).mockResolvedValue([server, physicalDisk]);
    vi.mocked(api.listRelationships).mockImplementation(async (assetId: string) =>
      assetId === "server-1" ? [{ fromId: "server-1", kind: "HOSTS", toId: "disk-1", properties: {} }] : [],
    );
    vi.mocked(api.getAsset).mockResolvedValue(physicalDisk);
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.nodes.map((n) => n.id)).toEqual(["server-1"]);

    await result.current.expand("server-1");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["disk-1", "server-1"]);
    });

    await result.current.expand("server-1");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id)).toEqual(["server-1"]);
    });
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

  function group(id: string): Asset {
    return {
      id,
      typeId: "core/group",
      name: id,
      layer: "physical",
      attributeValues: {},
      createdAt: "",
      updatedAt: "",
    };
  }

  it("expand() on a group reveals assets tagged MEMBER_OF it, even though the group has no outgoing relationships of its own", async () => {
    // Membership is stored on the member (member -MEMBER_OF-> group), not the group, so
    // discovering a group's members means reading incoming edges — the reverse direction from
    // every other relationship kind expand() already handles.
    const gpuGroup = group("group-1");
    const gpu1 = disk("gpu-1");
    const gpu2 = disk("gpu-2");
    vi.mocked(api.listAssets).mockResolvedValue([gpuGroup]);
    vi.mocked(api.listRelationships).mockResolvedValue([]);
    vi.mocked(api.listMembers).mockImplementation(async (assetId: string) =>
      assetId === "group-1"
        ? [
            { fromId: "gpu-1", kind: "MEMBER_OF", toId: "group-1", properties: {} },
            { fromId: "gpu-2", kind: "MEMBER_OF", toId: "group-1", properties: {} },
          ]
        : [],
    );
    vi.mocked(api.getAsset).mockImplementation(async (id: string) => (id === "gpu-1" ? gpu1 : gpu2));
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.nodes.map((n) => n.id)).toEqual(["group-1"]);

    await result.current.expand("group-1");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["gpu-1", "gpu-2", "group-1"]);
    });
    expect(result.current.edges.some((e) => e.source === "gpu-1" && e.target === "group-1")).toBe(true);
  });

  it("expand() hides a HOSTS child that's MEMBER_OF a sibling group under the same parent, showing only the group", async () => {
    // The exact scenario reported: unraid HOSTS a "Disks" group AND HOSTS disk3/parity directly
    // (ground truth, unchanged) — but disk3/parity are *also* MEMBER_OF that same "Disks" group.
    // Expanding unraid should surface only the group (plus any loose disk not in any group), not
    // the group *and* the grouped disks redundantly. The grouped disks are still reachable by
    // separately expanding the group itself.
    const unraid = server;
    const disksGroup = group("group-disks");
    const disk3 = disk("disk-3");
    const parity = disk("disk-parity");
    const looseDisk = disk("disk-loose");

    vi.mocked(api.listAssets).mockResolvedValue([unraid]);
    vi.mocked(api.listRelationships).mockImplementation(async (assetId: string) => {
      if (assetId === "server-1") {
        return [
          { fromId: "server-1", kind: "HOSTS", toId: "group-disks", properties: {} },
          { fromId: "server-1", kind: "HOSTS", toId: "disk-3", properties: {} },
          { fromId: "server-1", kind: "HOSTS", toId: "disk-parity", properties: {} },
          { fromId: "server-1", kind: "HOSTS", toId: "disk-loose", properties: {} },
        ];
      }
      if (assetId === "disk-3" || assetId === "disk-parity") {
        return [{ fromId: assetId, kind: "MEMBER_OF", toId: "group-disks", properties: {} }];
      }
      return [];
    });
    vi.mocked(api.listMembers).mockResolvedValue([]);
    vi.mocked(api.getAsset).mockImplementation(async (id: string) => {
      if (id === "group-disks") return disksGroup;
      if (id === "disk-3") return disk3;
      if (id === "disk-parity") return parity;
      return looseDisk;
    });
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.expand("server-1");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual([
        "disk-loose",
        "group-disks",
        "server-1",
      ]);
    });
    // No direct edge from unraid to either grouped disk — the group is what represents them here.
    expect(result.current.edges.some((e) => e.source === "server-1" && e.target === "disk-3")).toBe(false);
    expect(
      result.current.edges.some((e) => e.source === "server-1" && e.target === "disk-parity"),
    ).toBe(false);

    // Expanding the group itself still reveals the grouped disks (via their MEMBER_OF tag).
    vi.mocked(api.listMembers).mockImplementation(async (assetId: string) =>
      assetId === "group-disks"
        ? [
            { fromId: "disk-3", kind: "MEMBER_OF", toId: "group-disks", properties: {} },
            { fromId: "disk-parity", kind: "MEMBER_OF", toId: "group-disks", properties: {} },
          ]
        : [],
    );
    await result.current.expand("group-disks");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual([
        "disk-3",
        "disk-loose",
        "disk-parity",
        "group-disks",
        "server-1",
      ]);
    });
  });

  it("expand() hides a HOSTS child that's MEMBER_OF a *nested* group, not just a direct sibling group", async () => {
    // Extends the test above: unraid -HOSTS-> "Disks" -HOSTS-> "Array" (a group nested inside
    // another group), and disk3 is a direct HOSTS child of unraid (ground truth — it's really
    // plugged into unraid) that's separately MEMBER_OF "Array", two HOSTS-hops below unraid.
    // disk3 must stay hidden from BOTH expand("unraid") and expand("Disks") — "Array" is what
    // actually represents it; only expand("Array") should reveal it.
    const unraid = server;
    const disksGroup = group("group-disks");
    const arrayGroup = group("group-array");
    const disk3 = disk("disk-3");

    vi.mocked(api.listAssets).mockResolvedValue([unraid]);
    vi.mocked(api.listRelationships).mockImplementation(async (assetId: string) => {
      if (assetId === "server-1") {
        return [
          { fromId: "server-1", kind: "HOSTS", toId: "group-disks", properties: {} },
          { fromId: "server-1", kind: "HOSTS", toId: "disk-3", properties: {} },
        ];
      }
      if (assetId === "group-disks") {
        return [{ fromId: "group-disks", kind: "HOSTS", toId: "group-array", properties: {} }];
      }
      if (assetId === "disk-3") {
        return [{ fromId: "disk-3", kind: "MEMBER_OF", toId: "group-array", properties: {} }];
      }
      return [];
    });
    vi.mocked(api.listMembers).mockImplementation(async (assetId: string) =>
      assetId === "group-array"
        ? [{ fromId: "disk-3", kind: "MEMBER_OF", toId: "group-array", properties: {} }]
        : [],
    );
    vi.mocked(api.getAsset).mockImplementation(async (id: string) => {
      if (id === "group-disks") return disksGroup;
      if (id === "group-array") return arrayGroup;
      return disk3;
    });
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Expanding unraid shows only "Disks" — disk3 is hidden even though it's unraid's own direct
    // HOSTS child, because it's transitively represented by "Array" nested under "Disks".
    await result.current.expand("server-1");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["group-disks", "server-1"]);
    });

    // Expanding "Disks" reveals "Array" (its own HOSTS child) but still not disk3 — "Disks" isn't
    // what disk3 is actually a member of.
    await result.current.expand("group-disks");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual([
        "group-array",
        "group-disks",
        "server-1",
      ]);
    });

    // Only expanding "Array" itself reveals disk3.
    await result.current.expand("group-array");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual([
        "disk-3",
        "group-array",
        "group-disks",
        "server-1",
      ]);
    });
  });

  it("collapsing a node that revealed a group via its own outgoing MEMBER_OF tag does not delete that group or its already-revealed members", async () => {
    // Regression test: expand() used to record expandedFrom for *every* newly-revealed node
    // regardless of relationship kind. A NAS tagged MEMBER_OF a "Storage" group would reveal that
    // group as if the NAS owned it, so collapsing the NAS later cascaded into deleting the group
    // (and anything already revealed under it) even though the group exists independently — the
    // exact invariant joinGroup's own doc comment establishes must hold.
    const nas = server;
    const storageGroup = group("group-storage");
    const diskInGroup = disk("disk-in-group");
    vi.mocked(api.listAssets).mockResolvedValue([nas]);
    vi.mocked(api.listRelationships).mockImplementation(async (assetId: string) => {
      if (assetId === "server-1") {
        return [{ fromId: "server-1", kind: "MEMBER_OF", toId: "group-storage", properties: {} }];
      }
      return [];
    });
    vi.mocked(api.listMembers).mockImplementation(async (assetId: string) =>
      assetId === "group-storage"
        ? [{ fromId: "disk-in-group", kind: "MEMBER_OF", toId: "group-storage", properties: {} }]
        : [],
    );
    vi.mocked(api.getAsset).mockImplementation(async (id: string) =>
      id === "group-storage" ? storageGroup : diskInGroup,
    );
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Expand the NAS: reveals the group via its own outgoing MEMBER_OF tag.
    await result.current.expand("server-1");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["group-storage", "server-1"]);
    });

    // Expand the group itself: reveals its member via listMembers.
    await result.current.expand("group-storage");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual([
        "disk-in-group",
        "group-storage",
        "server-1",
      ]);
    });

    // Collapse the NAS (toggle expand again) — the group and its member must survive, since the
    // group's presence is additive (MEMBER_OF), not owned by the NAS's expanded state. collapse()
    // only ever removes *descendants*, never the toggled node itself, so server-1 stays too.
    await result.current.expand("server-1");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual([
        "disk-in-group",
        "group-storage",
        "server-1",
      ]);
    });

    // But the group's *own* collapse still hides its members — that's the actual
    // collapsible-groups behavior, unaffected by this fix.
    await result.current.expand("group-storage");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["group-storage", "server-1"]);
    });
  });

  it("joinGroup tags an existing asset onto an existing group without disturbing its HOSTS parent", async () => {
    const gpuGroup = group("group-1");
    vi.mocked(api.listAssets).mockResolvedValue([server]);
    vi.mocked(api.listRelationships).mockResolvedValue([]);
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));
    vi.mocked(api.createRelationship).mockResolvedValue({
      fromId: "server-1",
      kind: "MEMBER_OF",
      toId: "group-1",
      properties: {},
    });

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.joinGroup(server, gpuGroup);

    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["group-1", "server-1"]);
    });
    expect(api.createRelationship).toHaveBeenCalledWith("server-1", "MEMBER_OF", "group-1", undefined);
    expect(result.current.edges.some((e) => e.source === "server-1" && e.target === "group-1")).toBe(true);

    // Membership is additive, not containment: collapsing (toggling expand on) the member must
    // not delete the group it joined, unlike a real HOSTS child.
    const serverNode = result.current.nodes.find((n) => n.id === "server-1")!;
    expect(serverNode.data.expanded).toBe(false);
  });

  it("joinGroup adds the member to the canvas too when it isn't already visible (the group's own 'add existing asset' flow)", async () => {
    // Regression test: the inspector's group-side "Members" picker can add any existing asset in
    // the whole inventory, not just ones already on screen — e.g. one still hidden as an
    // unexpanded HOSTS child elsewhere. joinGroup used to only ever place the *group* on canvas if
    // missing, assuming the member (the selected node) was always already visible — true for the
    // "asset joins a group" direction, false for this reverse direction.
    const gpuGroup = group("group-1");
    const hiddenDisk = disk("hidden-disk-1");
    vi.mocked(api.listAssets).mockResolvedValue([gpuGroup]);
    vi.mocked(api.listRelationships).mockResolvedValue([]);
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));
    vi.mocked(api.createRelationship).mockResolvedValue({
      fromId: "hidden-disk-1",
      kind: "MEMBER_OF",
      toId: "group-1",
      properties: {},
    });

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.nodes.map((n) => n.id)).toEqual(["group-1"]);

    await result.current.joinGroup(hiddenDisk, gpuGroup);

    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["group-1", "hidden-disk-1"]);
    });
    expect(api.createRelationship).toHaveBeenCalledWith("hidden-disk-1", "MEMBER_OF", "group-1", undefined);
    expect(
      result.current.edges.some((e) => e.source === "hidden-disk-1" && e.target === "group-1"),
    ).toBe(true);
  });

  it("leaveGroup removes only the MEMBER_OF edge, leaving both nodes and any other edges untouched", async () => {
    const gpuGroup = group("group-1");
    const gpu1 = disk("gpu-1");
    vi.mocked(api.listAssets).mockResolvedValue([server]);
    vi.mocked(api.listRelationships).mockImplementation(async (assetId: string) =>
      assetId === "server-1" ? [{ fromId: "server-1", kind: "HOSTS", toId: "gpu-1", properties: {} }] : [],
    );
    vi.mocked(api.getAsset).mockResolvedValue(gpu1);
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));
    vi.mocked(api.createRelationship).mockResolvedValue({
      fromId: "gpu-1",
      kind: "MEMBER_OF",
      toId: "group-1",
      properties: {},
    });
    vi.mocked(api.deleteRelationship).mockResolvedValue(undefined);

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Reveal gpu-1 as a real HOSTS child first, then also tag it into the group.
    await result.current.expand("server-1");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["gpu-1", "server-1"]);
    });
    await result.current.joinGroup(gpu1, gpuGroup);
    await waitFor(() => {
      expect(result.current.edges.some((e) => e.source === "gpu-1" && e.target === "group-1")).toBe(true);
    });

    await result.current.leaveGroup(gpu1, gpuGroup);

    expect(api.deleteRelationship).toHaveBeenCalledWith("gpu-1", "MEMBER_OF", "group-1");
    await waitFor(() => {
      expect(result.current.edges.some((e) => e.source === "gpu-1" && e.target === "group-1")).toBe(false);
    });
    // The real HOSTS edge/nodes are untouched — leaveGroup never deletes anything but the tag.
    expect(result.current.edges.some((e) => e.source === "server-1" && e.target === "gpu-1")).toBe(true);
    expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["group-1", "gpu-1", "server-1"].sort());
  });

  it("leaveGroup clears the member's stale expandedFrom entry when it was revealed by expanding the group itself", async () => {
    // Distinct from the test above (which joins via joinGroup, deliberately expandedFrom-less):
    // a member revealed by *expanding the group* gets normal expandedFrom bookkeeping (that's the
    // actual collapsible-groups mechanic — see expand()'s doc comment). Without this cleanup,
    // leaving the group would remove the MEMBER_OF edge but leave the member still tracked as the
    // group's expandedFrom child, so a later collapse of the group would wrongly sweep it away too.
    const gpuGroup = group("group-1");
    const gpu1 = disk("gpu-1");
    const gpu2 = disk("gpu-2");
    vi.mocked(api.listAssets).mockResolvedValue([gpuGroup]);
    vi.mocked(api.listRelationships).mockResolvedValue([]);
    vi.mocked(api.listMembers).mockImplementation(async (assetId: string) =>
      assetId === "group-1"
        ? [
            { fromId: "gpu-1", kind: "MEMBER_OF", toId: "group-1", properties: {} },
            { fromId: "gpu-2", kind: "MEMBER_OF", toId: "group-1", properties: {} },
          ]
        : [],
    );
    vi.mocked(api.getAsset).mockImplementation(async (id: string) => (id === "gpu-1" ? gpu1 : gpu2));
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));
    vi.mocked(api.deleteRelationship).mockResolvedValue(undefined);

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.expand("group-1");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["gpu-1", "gpu-2", "group-1"]);
    });

    // gpu-1 leaves; gpu-2 stays a member (so the group's "expanded" badge is still accurate —
    // something's still revealed from it).
    await result.current.leaveGroup(gpu1, gpuGroup);
    await waitFor(() => {
      expect(result.current.edges.some((e) => e.source === "gpu-1" && e.target === "group-1")).toBe(false);
    });
    expect(result.current.nodes.find((n) => n.id === "group-1")?.data.expanded).toBe(true);

    // Collapsing the group (toggling expand again) removes gpu-2 (still its real expandedFrom
    // child) but must leave gpu-1 alone — leaveGroup already untracked it, even though it was
    // originally revealed via this same group's expand.
    await result.current.expand("group-1");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["gpu-1", "group-1"]);
    });
  });

  it("unhost removes only the HOSTS edge (e.g. un-nesting a group from another group), leaving both nodes and clearing the stale expandedFrom entry", async () => {
    // The reported gap: a group nested under another group via "+ Add hosted group" is HOSTS-
    // connected, not MEMBER_OF, so it never showed up in the parent's "Members" list (MEMBER_OF
    // only) and had no way to be un-nested short of deleting it outright.
    const drives = group("group-drives");
    const array = group("group-array");
    vi.mocked(api.listAssets).mockResolvedValue([drives]);
    vi.mocked(api.listRelationships).mockImplementation(async (assetId: string) =>
      assetId === "group-drives"
        ? [{ fromId: "group-drives", kind: "HOSTS", toId: "group-array", properties: {} }]
        : [],
    );
    vi.mocked(api.getAsset).mockResolvedValue(array);
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));
    vi.mocked(api.deleteRelationship).mockResolvedValue(undefined);

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.expand("group-drives");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["group-array", "group-drives"]);
    });

    await result.current.unhost(drives, array);

    expect(api.deleteRelationship).toHaveBeenCalledWith("group-drives", "HOSTS", "group-array");
    await waitFor(() => {
      expect(
        result.current.edges.some((e) => e.source === "group-drives" && e.target === "group-array"),
      ).toBe(false);
    });
    // Un-hosting doesn't delete either node — just the containment edge.
    expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["group-array", "group-drives"]);

    // Collapsing Drives afterward must not sweep Array away too — it's no longer actually hosted
    // by Drives, so it shouldn't be treated as Drives' descendant for collapse purposes anymore.
    await result.current.expand("group-drives");
    expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["group-array", "group-drives"]);
  });

  it("deleteAsset removes the node, every edge touching it, and its expandedFrom descendants — but not anything else", async () => {
    const drives = group("group-drives");
    const array = group("group-array");
    const unrelated = disk("disk-unrelated");
    vi.mocked(api.listAssets).mockResolvedValue([drives, unrelated]);
    vi.mocked(api.listRelationships).mockImplementation(async (assetId: string) =>
      assetId === "group-drives"
        ? [{ fromId: "group-drives", kind: "HOSTS", toId: "group-array", properties: {} }]
        : [],
    );
    vi.mocked(api.getAsset).mockResolvedValue(array);
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));
    vi.mocked(api.deleteAsset).mockResolvedValue(undefined);

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["disk-unrelated", "group-drives"]);

    // Expand Drives (revealing Array, a real expandedFrom descendant) and select it.
    await result.current.expand("group-drives");
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual([
        "disk-unrelated",
        "group-array",
        "group-drives",
      ]);
    });
    result.current.select("group-drives");
    await waitFor(() => expect(result.current.selectedAssetId).toBe("group-drives"));

    await result.current.deleteAsset("group-drives");

    expect(api.deleteAsset).toHaveBeenCalledWith("group-drives");
    await waitFor(() => {
      // Drives and its only-ever-visible-via-Drives child (Array) are both gone; the unrelated
      // top-level disk is untouched.
      expect(result.current.nodes.map((n) => n.id)).toEqual(["disk-unrelated"]);
    });
    expect(result.current.edges.some((e) => e.source === "group-drives" || e.target === "group-drives")).toBe(
      false,
    );
    // The inspector panel closes itself — the deleted node can no longer be the selection.
    expect(result.current.selectedAssetId).toBeNull();
  });

  it("connectAssets creates a CONNECTS_TO link with notes and places either side on canvas if missing", async () => {
    const nic = disk("nic-1"); // stand-in asset, type doesn't matter for this test
    const switch1 = disk("switch-1");
    vi.mocked(api.listAssets).mockResolvedValue([nic]);
    vi.mocked(api.listRelationships).mockResolvedValue([]);
    vi.mocked(api.listMembers).mockResolvedValue([]);
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));
    vi.mocked(api.createRelationship).mockResolvedValue({
      fromId: "nic-1",
      kind: "CONNECTS_TO",
      toId: "switch-1",
      properties: { notes: "switch port 3" },
    });

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.nodes.map((n) => n.id)).toEqual(["nic-1"]);

    await result.current.connectAssets(nic, switch1, { notes: "switch port 3" });

    expect(api.createRelationship).toHaveBeenCalledWith("nic-1", "CONNECTS_TO", "switch-1", {
      notes: "switch port 3",
    });
    await waitFor(() => {
      expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["nic-1", "switch-1"]);
    });
    const edge = result.current.edges.find((e) => e.source === "nic-1" && e.target === "switch-1");
    // The notes show right on the canvas edge, not just in the inspector's Connections list.
    expect(edge?.label).toBe("CONNECTS_TO: switch port 3");
  });

  it("connectAssets called again for the same pair updates the edge in place (editing a connection's notes)", async () => {
    const nic = disk("nic-1");
    const switch1 = disk("switch-1");
    vi.mocked(api.listAssets).mockResolvedValue([nic, switch1]);
    vi.mocked(api.listRelationships).mockResolvedValue([]);
    vi.mocked(api.listMembers).mockResolvedValue([]);
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));
    vi.mocked(api.createRelationship).mockResolvedValue({
      fromId: "nic-1",
      kind: "CONNECTS_TO",
      toId: "switch-1",
      properties: {},
    });

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.connectAssets(nic, switch1, { notes: "switch port 3" });
    await waitFor(() => {
      expect(
        result.current.edges.find((e) => e.source === "nic-1" && e.target === "switch-1")?.label,
      ).toBe("CONNECTS_TO: switch port 3");
    });
    // Still exactly one edge between them, and the node count hasn't grown — this is an update,
    // not a second parallel connection.
    expect(result.current.nodes.length).toBe(2);

    await result.current.connectAssets(nic, switch1, { notes: "actually port 5" });
    await waitFor(() => {
      const updated = result.current.edges.find((e) => e.source === "nic-1" && e.target === "switch-1");
      expect(updated?.label).toBe("CONNECTS_TO: actually port 5");
    });
    expect(result.current.edges.filter((e) => e.source === "nic-1" && e.target === "switch-1").length).toBe(1);
    expect(result.current.nodes.length).toBe(2);
  });

  it("disconnectAssets removes only the CONNECTS_TO edge, leaving both nodes untouched", async () => {
    const nic = disk("nic-1");
    const switch1 = disk("switch-1");
    vi.mocked(api.listAssets).mockResolvedValue([nic, switch1]);
    vi.mocked(api.listRelationships).mockResolvedValue([]);
    vi.mocked(api.listMembers).mockResolvedValue([]);
    vi.mocked(api.getType).mockImplementation(async (id: string) => resolvedType(id));
    vi.mocked(api.createRelationship).mockResolvedValue({
      fromId: "nic-1",
      kind: "CONNECTS_TO",
      toId: "switch-1",
      properties: {},
    });
    vi.mocked(api.deleteRelationship).mockResolvedValue(undefined);

    const { result } = renderHook(() => useBelvedereGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.connectAssets(nic, switch1);
    await waitFor(() => {
      expect(result.current.edges.some((e) => e.source === "nic-1" && e.target === "switch-1")).toBe(true);
    });

    await result.current.disconnectAssets("nic-1", "switch-1");

    expect(api.deleteRelationship).toHaveBeenCalledWith("nic-1", "CONNECTS_TO", "switch-1");
    await waitFor(() => {
      expect(result.current.edges.some((e) => e.source === "nic-1" && e.target === "switch-1")).toBe(false);
    });
    expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["nic-1", "switch-1"]);
  });
});
