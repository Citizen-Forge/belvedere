import type { AssetNodeType } from "../graph/AssetNode";

export interface InspectorPanelProps {
  node: AssetNodeType | undefined;
  onClose: () => void;
  onAddHostedChild: (parent: { id: string; name: string }) => void;
}

export function InspectorPanel({ node, onClose, onAddHostedChild }: InspectorPanelProps) {
  if (!node) {
    return (
      <aside className="inspector-panel inspector-panel--empty">
        <p>Select an asset to see its details. Double-click a node to reveal what it hosts.</p>
      </aside>
    );
  }

  const { asset, type } = node.data;

  return (
    <aside className="inspector-panel">
      <div className="inspector-panel__header">
        <h2>{asset.name}</h2>
        <button onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <dl className="inspector-panel__meta">
        <dt>Type</dt>
        <dd>{type?.name ?? asset.typeId}</dd>
        <dt>Layer</dt>
        <dd>{asset.layer}</dd>
      </dl>

      <h3>Attributes</h3>
      {type ? (
        <table className="inspector-panel__attributes">
          <tbody>
            {type.resolvedAttributes.map((attr) => (
              <tr key={attr.key}>
                <td>{attr.label}</td>
                <td>
                  {asset.attributeValues[attr.key] !== undefined
                    ? String(asset.attributeValues[attr.key])
                    : <span className="inspector-panel__unset">—</span>}
                  {attr.unit ? ` ${attr.unit}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>Type could not be resolved — the library source may no longer define it.</p>
      )}

      <button
        className="inspector-panel__add-child"
        onClick={() => onAddHostedChild({ id: asset.id, name: asset.name })}
      >
        + Add hosted asset
      </button>
    </aside>
  );
}
