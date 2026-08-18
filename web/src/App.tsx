import { useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { BelvedereGraph } from "./graph/BelvedereGraph";
import { useBelvedereGraph } from "./graph/useBelvedereGraph";
import { InspectorPanel } from "./panel/InspectorPanel";
import { CreateAssetDialog } from "./create/CreateAssetDialog";
import { ViewsMenu } from "./views/ViewsMenu";

export default function App() {
  const graph = useBelvedereGraph();
  const [dialogOpen, setDialogOpen] = useState(false);

  const selectedNode = graph.nodes.find((n) => n.id === graph.selectedAssetId);

  return (
    <div className="app">
      <header className="app__header">
        <h1>Belvedere</h1>
        <div className="app__header-actions">
          <ViewsMenu
            onSave={async (name) => {
              await graph.saveView(name);
            }}
            onLoad={graph.loadView}
            onReset={graph.reload}
          />
          <button onClick={() => setDialogOpen(true)}>+ Add asset</button>
        </div>
      </header>

      <main className="app__body">
        <div className="app__canvas">
          <ReactFlowProvider>
            <BelvedereGraph graph={graph} />
          </ReactFlowProvider>
        </div>
        <InspectorPanel node={selectedNode} onClose={() => graph.select(null)} />
      </main>

      {dialogOpen && (
        <CreateAssetDialog onClose={() => setDialogOpen(false)} onCreated={graph.reload} />
      )}
    </div>
  );
}
