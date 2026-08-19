import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  useReactFlow,
  type NodeTypes,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AssetNode } from "./AssetNode";
import { useBelvedereGraph } from "./useBelvedereGraph";

const nodeTypes: NodeTypes = { asset: AssetNode };

export interface BelvedereGraphProps {
  graph: ReturnType<typeof useBelvedereGraph>;
}

export function BelvedereGraph({ graph }: BelvedereGraphProps) {
  const { fitView } = useReactFlow();
  const handleNodeClick: NodeMouseHandler = (_event, node) => graph.select(node.id);
  const handleNodeDoubleClick: NodeMouseHandler = (_event, node) => graph.expand(node.id);
  // The `fitView` prop below only runs once, on mount — arranging later needs its own re-fit, and
  // has to wait a frame for React Flow to measure the newly-laid-out node positions before
  // fitView() can frame them (calling it synchronously right after arrange() still sees the
  // pre-arrange bounds), the same pattern React Flow's own dagre example uses.
  const handleArrange = () => {
    graph.arrange();
    requestAnimationFrame(() => fitView({ duration: 300 }));
  };

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
      <Panel position="top-right">
        <button onClick={handleArrange}>Auto-arrange</button>
      </Panel>
    </ReactFlow>
  );
}
