import { useEffect, useState } from "react";
import { api } from "../api/client";
import { GROUP_TYPE_ID, type Asset, type AttributeValue, type Relationship } from "../api/types";
import type { AssetNodeType } from "../graph/AssetNode";

export interface InspectorPanelProps {
  node: AssetNodeType | undefined;
  onClose: () => void;
  onAddHostedChild: (parent: { id: string; name: string }) => void;
  onAddHostedGroup: (parent: { id: string; name: string }) => void;
  onJoinGroup: (member: Asset, group: Asset) => Promise<void>;
  onLeaveGroup: (member: { id: string }, group: { id: string }) => Promise<void>;
  onUnhost: (parent: { id: string }, child: { id: string }) => Promise<void>;
  onConnect: (from: Asset, to: Asset, properties?: Record<string, AttributeValue>) => Promise<void>;
  onDisconnect: (fromId: string, toId: string) => Promise<void>;
  onDelete: (asset: { id: string }) => Promise<void>;
}

/**
 * "Part of groups": lists the asset's existing MEMBER_OF tags (each removable) and offers a
 * picker to add this asset to another existing group. Kept separate from HOSTS ("+ Add hosted
 * asset"/"+ Add hosted group" above) — joining/leaving a group tags/untags an *existing* asset
 * without touching its real HOSTS parent.
 */
function GroupMembership({
  asset,
  onJoin,
  onLeave,
}: {
  asset: Asset;
  onJoin: (group: Asset) => Promise<void>;
  onLeave: (group: { id: string }) => Promise<void>;
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
            <li key={m.toId}>
              <span>{groups.find((g) => g.id === m.toId)?.name ?? m.toId}</span>
              <button
                className="inspector-panel__remove"
                aria-label="Remove from group"
                onClick={async () => {
                  try {
                    await onLeave({ id: m.toId });
                    setMemberships((prev) => prev.filter((mem) => mem.toId !== m.toId));
                  } catch (cause) {
                    window.alert(`Could not remove from group: ${(cause as Error).message}`);
                  }
                }}
              >
                ×
              </button>
            </li>
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
 * the user to go select that other asset and use its own "+ Add to group" picker instead. Each
 * member is individually removable, the same as GroupMembership's list above.
 */
function GroupMembers({
  group,
  onAdd,
  onRemove,
}: {
  group: Asset;
  onAdd: (member: Asset) => Promise<void>;
  onRemove: (member: { id: string }) => Promise<void>;
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
            <li key={id}>
              <span>{candidatesById.get(id)?.name ?? id}</span>
              <button
                className="inspector-panel__remove"
                aria-label="Remove member"
                onClick={async () => {
                  try {
                    await onRemove({ id });
                    setMemberIds((prev) => {
                      const next = new Set(prev);
                      next.delete(id);
                      return next;
                    });
                  } catch (cause) {
                    window.alert(`Could not remove member: ${(cause as Error).message}`);
                  }
                }}
              >
                ×
              </button>
            </li>
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

/**
 * Lists this group's HOSTS children, each removable — the only way a group ever ends up *inside*
 * another one is via "+ Add hosted group" above (which always creates HOSTS, matching "+ Add
 * hosted asset"'s semantics, not MEMBER_OF), so a nested child group never showed up in "Members"
 * (MEMBER_OF only) and had no way to be un-nested short of deleting it outright. Scoped to groups
 * only, same as "Members" — an ordinary asset's HOSTS children are better managed via canvas
 * expand/collapse, and can run into the dozens (e.g. a server with many components), which would
 * clutter this panel far more than it would help.
 */
function HostedChildren({
  parent,
  onRemove,
}: {
  parent: Asset;
  onRemove: (child: { id: string }) => Promise<void>;
}) {
  const [childIds, setChildIds] = useState<string[]>([]);
  const [childrenById, setChildrenById] = useState<Map<string, Asset>>(new Map());

  useEffect(() => {
    let cancelled = false;
    api.listRelationships(parent.id).then(async (rels) => {
      const ids = rels.filter((r) => r.kind === "HOSTS").map((r) => r.toId);
      if (cancelled) return;
      // childIds (from listRelationships, the source of truth) is set immediately, before the
      // per-id getAsset resolution below settles — same reasoning as GroupMembers: a child whose
      // asset record fails to resolve (e.g. deleted concurrently) still shows as its raw id and
      // stays removable, rather than silently vanishing from the list with no way to clean up the
      // dangling relationship.
      setChildIds(ids);
      const assets = await Promise.all(ids.map((id) => api.getAsset(id).catch(() => null)));
      if (cancelled) return;
      setChildrenById(new Map(assets.filter((a): a is Asset => a !== null).map((a) => [a.id, a])));
    });
    return () => {
      cancelled = true;
    };
  }, [parent.id]);

  if (childIds.length === 0) return null;

  return (
    <div className="inspector-panel__hosted">
      <h3>Hosted</h3>
      <ul className="inspector-panel__group-list">
        {childIds.map((id) => (
          <li key={id}>
            <span>{childrenById.get(id)?.name ?? id}</span>
            <button
              className="inspector-panel__remove"
              aria-label="Remove from hosted items"
              onClick={async () => {
                try {
                  await onRemove({ id });
                  setChildIds((prev) => prev.filter((c) => c !== id));
                } catch (cause) {
                  window.alert(`Could not un-host: ${(cause as Error).message}`);
                }
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Stable identity for a stored edge, direction included — two edges between the same pair in
 *  opposite directions (unusual, but the data model doesn't forbid it — e.g. created via the MCP
 *  server) are genuinely different relationships and must never collapse onto the same list key
 *  or share draft-notes state. */
function connectionKey(c: Pick<Relationship, "fromId" | "toId">): string {
  return `${c.fromId} ${c.toId}`;
}

/**
 * "Connections" — CONNECTS_TO topology links to any other asset (e.g. a NIC to a switch, a switch
 * to another switch), shown on every asset since this isn't group-specific the way Members/Hosted
 * are. Each connection can carry a free-text note (e.g. "switch port 3"), editable in place by
 * calling `onConnect` again — it always upserts (see `linkAssets`'s doc comment). Unlike HOSTS/
 * MEMBER_OF, CONNECTS_TO has no privileged direction: `api.listConnections` already returns edges
 * from *either* side, so a connection shows here regardless of which asset happens to be the
 * relationship's stored `fromId` — and editing one preserves that original direction rather than
 * re-creating it backwards (which would `MERGE` a second, separate edge instead of updating it).
 */
function Connections({
  asset,
  onConnect,
  onDisconnect,
}: {
  asset: Asset;
  onConnect: (from: Asset, to: Asset, properties?: Record<string, AttributeValue>) => Promise<void>;
  onDisconnect: (fromId: string, toId: string) => Promise<void>;
}) {
  const [connections, setConnections] = useState<Relationship[]>([]);
  const [candidates, setCandidates] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [draftNotes, setDraftNotes] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setSelectedId("");
    setNewNotes("");
    setDraftNotes(new Map());
    Promise.all([api.listConnections(asset.id), api.listAssets()]).then(([conns, allAssets]) => {
      if (cancelled) return;
      setConnections(conns);
      setCandidates(allAssets);
    });
    return () => {
      cancelled = true;
    };
  }, [asset.id]);

  const candidatesById = new Map(candidates.map((a) => [a.id, a]));
  // A minimal fallback so a connection to a since-deleted (or otherwise unresolved) asset can
  // still be displayed/edited/removed by id, rather than silently breaking — same fallback
  // philosophy GroupMembers/HostedChildren use.
  const assetFor = (id: string): Asset =>
    candidatesById.get(id) ?? {
      id,
      typeId: "",
      name: id,
      layer: "physical",
      attributeValues: {},
      createdAt: "",
      updatedAt: "",
    };

  const connectedOtherIds = new Set(connections.map((c) => (c.fromId === asset.id ? c.toId : c.fromId)));
  const available = candidates.filter((a) => a.id !== asset.id && !connectedOtherIds.has(a.id));
  const selected = available.find((a) => a.id === selectedId);

  return (
    <div className="inspector-panel__connections">
      <h3>Connections</h3>
      {connections.length > 0 ? (
        <ul className="inspector-panel__connection-list">
          {connections.map((c) => {
            const otherId = c.fromId === asset.id ? c.toId : c.fromId;
            const key = connectionKey(c);
            const savedNotes = typeof c.properties.notes === "string" ? c.properties.notes : "";
            const draft = draftNotes.get(key) ?? savedNotes;
            const dirty = draft !== savedNotes;
            return (
              <li key={key}>
                <div className="inspector-panel__connection-row">
                  <span>{candidatesById.get(otherId)?.name ?? otherId}</span>
                  <button
                    className="inspector-panel__remove"
                    aria-label="Remove connection"
                    onClick={async () => {
                      try {
                        await onDisconnect(c.fromId, c.toId);
                        setConnections((prev) => prev.filter((x) => x !== c));
                      } catch (cause) {
                        window.alert(`Could not remove connection: ${(cause as Error).message}`);
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
                <div className="inspector-panel__connection-notes">
                  <input
                    type="text"
                    placeholder="Notes (e.g. switch port 3)"
                    value={draft}
                    onChange={(e) => setDraftNotes((prev) => new Map(prev).set(key, e.target.value))}
                  />
                  {dirty && (
                    <button
                      onClick={async () => {
                        try {
                          // Preserve the connection's real stored direction — asset might be
                          // either the fromId or the toId, and re-creating it backwards would
                          // MERGE a second, separate edge instead of updating this one. Also
                          // spread the edge's existing properties: the backend replaces
                          // `properties` wholesale on write, so sending only the new notes would
                          // silently wipe any other property already set on this edge (e.g. one
                          // added via the MCP server).
                          const [from, to] =
                            c.fromId === asset.id ? [asset, assetFor(otherId)] : [assetFor(otherId), asset];
                          const properties = { ...c.properties, notes: draft };
                          await onConnect(from, to, properties);
                          setConnections((prev) => prev.map((x) => (x === c ? { ...x, properties } : x)));
                        } catch (cause) {
                          window.alert(`Could not save notes: ${(cause as Error).message}`);
                        }
                      }}
                    >
                      Save
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="inspector-panel__unset">Not connected to anything.</p>
      )}
      {available.length > 0 && (
        <div className="inspector-panel__connection-picker">
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">Connect to…</option>
            {available.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Notes (optional)"
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
          />
          <button
            disabled={!selected}
            onClick={async () => {
              if (!selected) return;
              try {
                const properties: Record<string, AttributeValue> = newNotes ? { notes: newNotes } : {};
                await onConnect(asset, selected, properties);
                setConnections((prev) => [
                  ...prev,
                  { fromId: asset.id, kind: "CONNECTS_TO", toId: selected.id, properties },
                ]);
                setSelectedId("");
                setNewNotes("");
              } catch (cause) {
                window.alert(`Could not connect: ${(cause as Error).message}`);
              }
            }}
          >
            Connect
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
  onLeaveGroup,
  onUnhost,
  onConnect,
  onDisconnect,
  onDelete,
}: InspectorPanelProps) {
  if (!node) {
    return (
      <aside className="inspector-panel inspector-panel--empty">
        <p>Select an asset to see its details. Double-click a node to reveal what it hosts.</p>
      </aside>
    );
  }

  const { asset, type } = node.data;
  // Ancestry-aware, not just an exact typeId match — a hypothetical type that extends core/group
  // (the same kind of subtyping excludeAttributes itself supports, e.g. a "branded group") is
  // still a group for this purpose. Falls back to the exact match if the type couldn't be
  // resolved at all (no ancestry to check).
  const isGroup = asset.typeId === GROUP_TYPE_ID || (type?.ancestry.includes(GROUP_TYPE_ID) ?? false);

  const handleDelete = async () => {
    const confirmed = window.confirm(
      `Delete "${asset.name}"? This can't be undone. Anything it hosts or that's tagged into it ` +
        `keeps existing — it just loses that connection.`,
    );
    if (!confirmed) return;
    try {
      await onDelete({ id: asset.id });
    } catch (cause) {
      window.alert(`Could not delete "${asset.name}": ${(cause as Error).message}`);
    }
  };

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
        {/* A group is purely organizational, not meaningfully physical or logical — it's still
            internally tracked as physical layer (see ARCHITECTURE.md: that's what lets a
            free-floating group with no HOSTS parent show up in the top-level overview at all,
            the same way any other physical root asset does), but showing that internal detail
            to the user here would be actively misleading, not just unhelpful. */}
        {!isGroup && (
          <>
            <dt>Layer</dt>
            <dd>{asset.layer}</dd>
          </>
        )}
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

      <GroupMembership
        asset={asset}
        onJoin={(group) => onJoinGroup(asset, group)}
        onLeave={(group) => onLeaveGroup(asset, group)}
      />
      {isGroup && (
        <GroupMembers
          group={asset}
          onAdd={(member) => onJoinGroup(member, asset)}
          onRemove={(member) => onLeaveGroup(member, asset)}
        />
      )}
      {isGroup && <HostedChildren parent={asset} onRemove={(child) => onUnhost(asset, child)} />}
      <Connections asset={asset} onConnect={onConnect} onDisconnect={onDisconnect} />

      <div className="inspector-panel__danger-zone">
        <button className="inspector-panel__delete" onClick={handleDelete}>
          Delete {type?.name.toLowerCase() ?? "asset"}
        </button>
      </div>
    </aside>
  );
}
