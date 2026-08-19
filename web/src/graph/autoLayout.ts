import dagre from "dagre";
import type { Edge } from "@xyflow/react";
import type { AssetNodeType } from "./AssetNode";

// Matches .asset-node's CSS (min-width: 140px, auto height) closely enough for spacing purposes —
// dagre only needs approximate dimensions to avoid overlap, not pixel-perfect measurements.
const NODE_WIDTH = 180;
const NODE_HEIGHT = 70;

/**
 * Computes a hierarchical top-to-bottom layout for the given nodes/edges via dagre, returning new
 * nodes with updated `position` (same node objects otherwise, so React Flow doesn't lose selection
 * or drag state unrelated to position). Pure — doesn't mutate its inputs.
 *
 * Deliberately not run automatically on every expand()/attachHostedChild()/joinGroup() — that would
 * fight a user's manual dragging every time they reveal one more node. Used for the initial
 * overview (nothing to disrupt yet) and an explicit "Auto-arrange" action.
 */
export function autoLayout(nodes: AssetNodeType[], edges: Edge[]): AssetNodeType[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    // dagre errors if an edge references a node outside the graph — can happen for a saved view
    // or a partial selection that doesn't include every endpoint.
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const { x, y } = g.node(node.id);
    // dagre positions are node centers; React Flow positions are top-left corners.
    return { ...node, position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 } };
  });
}
