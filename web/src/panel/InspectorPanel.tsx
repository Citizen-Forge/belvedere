import { useEffect, useState } from "react";
import { api } from "../api/client";
import { GROUP_TYPE_ID, type Asset, type Relationship } from "../api/types";
import type { AssetNodeType } from "../graph/AssetNode";

export interface InspectorPanelProps {
  node: AssetNodeType | undefined;
  onClose: () => void;
  onAddHostedChild: (parent: { id: string; name: string }) => void;
  onAddHostedGroup: (parent: { id: string; name: string }) => void;
  onJoinGroup: (member: Asset, group: Asset) => Promise<void>;
}

/**
 * "Part of groups": lists the asset's existing MEMBER_OF tags and offers a picker to add this
 * asset to another existing group. Kept separate from HOSTS ("+ Add hosted asset"/"+ Add hosted
 * group" above) — joining a group tags an *existing* asset without touching its real HOSTS parent.
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
        <div className="inspector-panel__group-picker">
          <select value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}>
            <option value="">Add to group…</option>
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
                window.alert(`Could not add to group: ${(cause as Error).message}`);
              }
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The reverse direction of GroupMembership, shown only when the selected asset is itself a
 * group: pulls an *existing* asset in as a member (MEMBER_OF this group), rather than requiring
 * the user to go select that other asset and use its own "+ Add to group" picker instead.
 */
function GroupMembers({
  group,
  onAdd,
}: {
  group: Asset;
  onAdd: (member: Asset) => Promise<void>;
}) {
  const [candidates, setCandidates] = useState<Asset[]>([]);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSelectedId("");
    Promise.all([api.listAssets(), api.listMembers(group.id)]).then(([allAssets, memberRels]) => {
      if (cancelled) return;
      setCandidates(allAssets);
      setMemberIds(new Set(memberRels.map((r) => r.fromId)));
    });
    return () => {
      cancelled = true;
    };
  }, [group.id]);

  const available = candidates.filter((a) => a.id !== group.id && !memberIds.has(a.id));
  const selected = available.find((a) => a.id === selectedId);
  const candidatesById = new Map(candidates.map((a) => [a.id, a]));

  return (
    <div className="inspector-panel__members">
      <h3>Members</h3>
      {memberIds.size > 0 ? (
        <ul className="inspector-panel__group-list">
          {/* Iterate memberIds (from listMembers, the source of truth), not `candidates` filtered
              down — a member whose asset record didn't come back in the unfiltered listAssets()
              (e.g. deleted since) would otherwise be silently dropped instead of just unnamed,
              same fallback GroupMembership uses above for the reverse listing. */}
          {[...memberIds].map((id) => (
            <li key={id}>{candidatesById.get(id)?.name ?? id}</li>
          ))}
        </ul>
      ) : (
        <p className="inspector-panel__unset">No members yet.</p>
      )}
      {available.length > 0 && (
        <div className="inspector-panel__group-picker">
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">Add existing asset…</option>
            {available.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            disabled={!selected}
            onClick={async () => {
              if (!selected) return;
              try {
                await onAdd(selected);
                setMemberIds((prev) => new Set(prev).add(selected.id));
                setSelectedId("");
              } catch (cause) {
                window.alert(`Could not add member: ${(cause as Error).message}`);
              }
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

export function InspectorPanel({
  node,
  onClose,
  onAddHostedChild,
  onAddHostedGroup,
  onJoinGroup,
}: InspectorPanelProps) {
  if (!node) {
    return (
      <aside className="inspector-panel inspector-panel--empty">
        <p>Select an asset to see its details. Double-click a node to reveal what it hosts.</p>
      </aside>
    );
  }

  const { asset, type } = node.data;
  const isGroup = asset.typeId === GROUP_TYPE_ID;

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

      <div className="inspector-panel__actions">
        <button onClick={() => onAddHostedChild({ id: asset.id, name: asset.name })}>+ Add hosted asset</button>
        <button onClick={() => onAddHostedGroup({ id: asset.id, name: asset.name })}>+ Add hosted group</button>
      </div>

      <GroupMembership asset={asset} onJoin={(group) => onJoinGroup(asset, group)} />
      {isGroup && <GroupMembers group={asset} onAdd={(member) => onJoinGroup(member, asset)} />}
    </aside>
  );
}
