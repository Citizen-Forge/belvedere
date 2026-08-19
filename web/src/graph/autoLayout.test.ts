import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";
import { autoLayout } from "./autoLayout";
import type { AssetNodeType } from "./AssetNode";
import type { Asset } from "../api/types";

function node(id: string): AssetNodeType {
  const asset: Asset = {
    id,
    typeId: "core/server",
    name: id,
    layer: "physical",
    attributeValues: {},
    createdAt: "",
    updatedAt: "",
  };
  return { id, type: "asset", position: { x: 0, y: 0 }, data: { asset, type: undefined, expanded: false } };
}

function edge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target, label: "HOSTS" };
}

describe("autoLayout", () => {
  it("returns an empty array unchanged", () => {
    expect(autoLayout([], [])).toEqual([]);
  });

  it("gives every node a distinct position", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [edge("a", "b"), edge("a", "c")];

    const laidOut = autoLayout(nodes, edges);
    const positions = laidOut.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(positions).size).toBe(3);
  });

  it("places a HOSTS child below its parent (top-to-bottom hierarchy)", () => {
    const nodes = [node("parent"), node("child")];
    const edges = [edge("parent", "child")];

    const [parent, child] = autoLayout(nodes, edges);
    expect(child.position.y).toBeGreaterThan(parent.position.y);
  });

  it("ignores edges referencing a node outside the given set rather than throwing", () => {
    const nodes = [node("a")];
    const edges = [edge("a", "not-in-graph")];

    expect(() => autoLayout(nodes, edges)).not.toThrow();
  });

  it("preserves each node's data, only replacing position", () => {
    const nodes = [node("a")];
    const [result] = autoLayout(nodes, []);
    expect(result.data.asset.id).toBe("a");
    expect(result.id).toBe("a");
  });
});
