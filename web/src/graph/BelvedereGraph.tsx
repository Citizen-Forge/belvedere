import { ReactFlow, Background, Controls, type NodeTypes, type NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AssetNode } from "./AssetNode";
import { useBelvedereGraph } from "./useBelvedereGraph";

const nodeTypes: NodeTypes = { asset: AssetNode };

export interface BelvedereGraphProps {
  graph: ReturnType<typeof useBelvedereGraph>;
}

export function BelvedereGraph({ graph }: BelvedereGraphProps) {
  const handleNodeClick: NodeMouseHandler = (_event, node) => graph.select(node.id);
  const handleNodeDoubleClick: NodeMouseHandler = (_event, node) => graph.expand(node.id);

  if (graph.loading) return <div className="graph-status">Loading…</div>;
  if (graph.error) return <div className="graph-status graph-status--error">{graph.error}</div>;

  return (
    <ReactFlow
      nodes={graph.nodes}
      edges={graph.edges}
      nodeTypes={nodeTypes}
      onNodesChange={graph.onNodesChange}
      onNodeClick={handleNodeClick}
      onNodeDoubleClick={handleNodeDoubleClick}
      fitView
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}
