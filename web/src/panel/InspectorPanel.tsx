import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Asset, Relationship } from "../api/types";
import type { AssetNodeType } from "../graph/AssetNode";

export interface InspectorPanelProps {
  node: AssetNodeType | undefined;
  onClose: () => void;
  onAddHostedChild: (parent: { id: string; name: string }) => void;
  onJoinGroup: (member: { id: string }, group: Asset) => Promise<void>;
}

const GROUP_TYPE_ID = "core/group";

/**
 * "Part of groups": lists the asset's existing MEMBER_OF tags and offers a picker to join
 * another existing group. Kept separate from HOSTS ("+ Add hosted asset" above) — joining a
 * group tags an *existing* asset without touching its real HOSTS parent.
 */
function GroupMembership({
  asset,
  onJoin,
}: {
  asset: Asset;
  onJoin: (group: Asset) => Promise<void>;
}) {
  const [groups, setGroups] = useState<Asset[]>([]);
  const [memberships, setMemberships] = useState<Relationship[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSelectedGroupId("");
    Promise.all([api.listAssets({ typeId: GROUP_TYPE_ID }), api.listRelationships(asset.id)]).then(
      ([allGroups, rels]) => {
        if (cancelled) return;
        setGroups(allGroups);
        setMemberships(rels.filter((r) => r.kind === "MEMBER_OF"));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [asset.id]);

  const availableGroups = groups.filter(
    (g) => g.id !== asset.id && !memberships.some((m) => m.toId === g.id),
  );
  const selectedGroup = availableGroups.find((g) => g.id === selectedGroupId);

  return (
    <div className="inspector-panel__groups">
      <h3>Groups</h3>
      {memberships.length > 0 ? (
        <ul className="inspector-panel__group-list">
          {memberships.map((m) => (
            <li key={m.toId}>{groups.find((g) => g.id === m.toId)?.name ?? m.toId}</li>
          ))}
        </ul>
      ) : (
        <p className="inspector-panel__unset">Not part of any group.</p>
      )}
      {availableGroups.length > 0 && (
        <div className="inspector-panel__join-group">
          <select value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}>
            <option value="">Join group…</option>
            {availableGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button
            disabled={!selectedGroup}
            onClick={async () => {
              if (!selectedGroup) return;
              try {
                await onJoin(selectedGroup);
                setMemberships((prev) => [
                  ...prev,
                  { fromId: asset.id, kind: "MEMBER_OF", toId: selectedGroup.id, properties: {} },
                ]);
                setSelectedGroupId("");
              } catch (cause) {
                window.alert(`Could not join group: ${(cause as Error).message}`);
              }
            }}
          >
            Join
          </button>
        </div>
      )}
    </div>
  );
}

export function InspectorPanel({ node, onClose, onAddHostedChild, onJoinGroup }: InspectorPanelProps) {
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

      <GroupMembership asset={asset} onJoin={(group) => onJoinGroup({ id: asset.id }, group)} />
    </aside>
  );
}
