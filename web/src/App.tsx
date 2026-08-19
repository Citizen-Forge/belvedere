import { useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { BelvedereGraph } from "./graph/BelvedereGraph";
import { useBelvedereGraph } from "./graph/useBelvedereGraph";
import { InspectorPanel } from "./panel/InspectorPanel";
import { CreateAssetDialog } from "./create/CreateAssetDialog";
import { ViewsMenu } from "./views/ViewsMenu";

interface DialogState {
  open: boolean;
  hostedBy?: { id: string; name: string };
}

export default function App() {
  const graph = useBelvedereGraph();
  const [dialog, setDialog] = useState<DialogState>({ open: false });

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
          <button onClick={() => setDialog({ open: true })}>+ Add asset</button>
        </div>
      </header>

      <main className="app__body">
        <div className="app__canvas">
          <ReactFlowProvider>
            <BelvedereGraph graph={graph} />
          </ReactFlowProvider>
        </div>
        <InspectorPanel
          node={selectedNode}
          onClose={() => graph.select(null)}
          onAddHostedChild={(parent) => setDialog({ open: true, hostedBy: parent })}
          onJoinGroup={(member, group) => graph.joinGroup(member.id, group)}
        />
      </main>

      {dialog.open && (
        <CreateAssetDialog
          hostedBy={dialog.hostedBy}
          onClose={() => setDialog({ open: false })}
          onCreated={(asset) =>
            dialog.hostedBy ? graph.attachHostedChild(dialog.hostedBy.id, asset) : graph.reload()
          }
        />
      )}
    </div>
  );
}
