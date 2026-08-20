import { useCallback, useEffect, useRef, useState } from "react";
import { applyNodeChanges, type Edge, type NodeChange } from "@xyflow/react";
import { api } from "../api/client";
import { GROUP_TYPE_ID, type Asset, type Relationship, type ResolvedType, type SavedView } from "../api/types";
import type { AssetNodeType } from "./AssetNode";
import { autoLayout } from "./autoLayout";
import { childPosition } from "./layout";

interface GraphState {
  nodes: AssetNodeType[];
  edges: Edge[];
  loading: boolean;
  error: string | null;
  selectedAssetId: string | null;
  // Which node's expand() call added which — collapse() uses this to remove exactly what was
  // revealed and nothing else. Kept in the same state object as nodes/edges (updated together in
  // one setState) so the two can never disagree about what's actually new vs. pre-existing.
  expandedFrom: Map<string, string>;
}

const initialState: GraphState = {
  nodes: [],
  edges: [],
  loading: true,
  error: null,
  selectedAssetId: null,
  expandedFrom: new Map(),
};

function toEdge(rel: Relationship): Edge {
  return {
    id: `${rel.fromId}-${rel.kind}-${rel.toId}`,
    source: rel.fromId,
    target: rel.toId,
    label: rel.kind,
    // MEMBER_OF is a tag, not containment — dashed to read as an overlay distinct from a solid
    // HOSTS/PROVIDES/CONNECTS_TO line at a glance.
    style: rel.kind === "MEMBER_OF" ? { strokeDasharray: "4 4" } : undefined,
  };
}

/** Tracks which node added which, so collapsing a node removes everything it (transitively) revealed. */
function descendantsOf(rootId: string, expandedFrom: Map<string, string>): Set<string> {
  const result = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [childId, parentId] of expandedFrom) {
      if (parentId === current && !result.has(childId)) {
        result.add(childId);
        queue.push(childId);
      }
    }
  }
  return result;
}

/**
 * Finds HOSTS children (of the given set) that are redundantly represented by a *nested* group,
 * not just a direct sibling group — a chain of HOSTS edges through group-typed nodes only (a
 * group's HOSTS group child, that group's own HOSTS group child, and so on). A child is "grouped
 * away" if it's MEMBER_OF *any* group anywhere in that whole nested chain, not only a group one
 * level down: e.g. `unraid -HOSTS-> "Disks" -HOSTS-> "Array" `, with `disk3` a direct HOSTS child
 * of `unraid` (ground truth — it's really plugged into unraid) that's separately `MEMBER_OF
 * "Array"`, two HOSTS-hops below `unraid`. `disk3` must stay hidden from `unraid`'s own expansion
 * (since "Array" already represents it, transitively via "Disks"), and from `expand("Disks")` too
 * (still not the group actually holding it) — only `expand("Array")` should reveal it. The
 * traversal stops at the first non-group HOSTS child down any branch, so it never chains through
 * ordinary hardware/software (only literal group-in-group nesting counts). Best-effort: any fetch
 * failure degrades to "nothing hidden" rather than failing the whole expand — this is a display
 * refinement, not something worth a broken double-click over.
 */
async function findGroupedAwayIds(hostsChildIds: string[]): Promise<Set<string>> {
  try {
    // Populated as groups are discovered, so a group's relationships (fetched once here to find
    // its own HOSTS children) don't need re-fetching for the final MEMBER_OF check below.
    const relCache = new Map<string, Relationship[]>();
    const fetchRels = async (id: string): Promise<Relationship[]> => {
      const rels = await api.listRelationships(id);
      relCache.set(id, rels);
      return rels;
    };

    const reachableGroupIds = new Set<string>();
    let frontier = hostsChildIds;
    while (frontier.length > 0) {
      const candidates = await Promise.all(frontier.map((id) => api.getAsset(id).catch(() => null)));
      const groupsAtThisLevel = frontier.filter((_id, i) => candidates[i]?.typeId === GROUP_TYPE_ID);
      if (groupsAtThisLevel.length === 0) break;
      for (const id of groupsAtThisLevel) reachableGroupIds.add(id);

      const childRelLists = await Promise.all(groupsAtThisLevel.map((id) => fetchRels(id)));
      frontier = [
        ...new Set(childRelLists.flatMap((rels) => rels.filter((r) => r.kind === "HOSTS").map((r) => r.toId))),
      ].filter((id) => !reachableGroupIds.has(id));
    }

    if (reachableGroupIds.size === 0) return new Set();

    const directChildRelLists = await Promise.all(hostsChildIds.map((id) => relCache.get(id) ?? fetchRels(id)));
    return new Set(
      hostsChildIds.filter((_id, i) =>
        directChildRelLists[i].some((r) => r.kind === "MEMBER_OF" && reachableGroupIds.has(r.toId)),
      ),
    );
  } catch {
    return new Set();
  }
}

/**
 * Shared core of `collapse()` and `deleteAsset()`: computes everything `expandedFrom`-descended
 * from `rootId` (via `descendantsOf`) and returns nodes/edges/expandedFrom with all of it gone.
 * `includeRoot` controls whether `rootId` itself is removed too (`deleteAsset`, which really
 * deletes it) or just marked un-expanded and left in place (`collapse`, which only ever hides,
 * never deletes anything).
 */
function pruneDescendants(
  prev: GraphState,
  rootId: string,
  includeRoot: boolean,
): Pick<GraphState, "nodes" | "edges" | "expandedFrom"> {
  const toRemove = descendantsOf(rootId, prev.expandedFrom);
  if (includeRoot) toRemove.add(rootId);

  const expandedFrom = new Map(prev.expandedFrom);
  for (const id of toRemove) expandedFrom.delete(id);

  const nodes = prev.nodes
    .filter((n) => !toRemove.has(n.id))
    .map((n) => (!includeRoot && n.id === rootId ? { ...n, data: { ...n.data, expanded: false } } : n));
  const edges = prev.edges.filter((e) => !toRemove.has(e.source) && !toRemove.has(e.target));

  return { nodes, edges, expandedFrom };
}

/**
 * After removing an expandedFrom entry, a parent node can be left with nothing actually revealed
 * from it anymore while still showing the "expanded" badge (set together with the entry that just
 * got removed, but never unset on removal) — misleadingly signaling there's something to collapse.
 * Clears it only if `parentId` truly has no remaining expandedFrom entries pointing to it, so
 * removing one of several children/members doesn't wrongly clear a badge that's still accurate.
 */
function withExpandedBadgeClearedIfEmpty(
  nodes: AssetNodeType[],
  expandedFrom: Map<string, string>,
  parentId: string,
): AssetNodeType[] {
  const stillHasEntries = [...expandedFrom.values()].includes(parentId);
  if (stillHasEntries) return nodes;
  return nodes.map((n) => (n.id === parentId ? { ...n, data: { ...n.data, expanded: false } } : n));
}

export function useBelvedereGraph() {
  const [state, setState] = useState<GraphState>(initialState);
  // Refs, not state: read-through caches for toNode/resolveType, not something the UI renders
  // from directly (each node carries its own resolved `type` already). Making the resolved cache
  // state would give resolveType/toNode/loadOverview a new identity every time a type is first
  // resolved, re-triggering the mount effect below and silently resetting the graph mid-expand.
  const typesByIdRef = useRef<Map<string, ResolvedType>>(new Map());
  const inFlightTypeFetchesRef = useRef<Map<string, Promise<ResolvedType | undefined>>>(new Map());

  const resolveType = useCallback(async (typeId: string): Promise<ResolvedType | undefined> => {
    const cached = typesByIdRef.current.get(typeId);
    if (cached) return cached;

    // Dedupe concurrent requests for the same type (e.g. many assets sharing a typeId loading at once).
    const inFlight = inFlightTypeFetchesRef.current.get(typeId);
    if (inFlight) return inFlight;

    const promise = api
      .getType(typeId)
      .then((type) => {
        typesByIdRef.current.set(typeId, type);
        return type;
      })
      .catch(() => undefined)
      .finally(() => inFlightTypeFetchesRef.current.delete(typeId));
    inFlightTypeFetchesRef.current.set(typeId, promise);
    return promise;
  }, []);

  const toNode = useCallback(
    async (asset: Asset, position: { x: number; y: number }, expanded = false): Promise<AssetNodeType> => ({
      id: asset.id,
      type: "asset",
      position,
      data: { asset, type: await resolveType(asset.typeId), expanded },
    }),
    [resolveType],
  );

  /** Fetches nodes and their relationships concurrently — both depend only on `assets`, not on each other. */
  const loadNodesAndEdges = useCallback(
    async (
      assets: Asset[],
      position: (asset: Asset, index: number) => { x: number; y: number },
      edgeFilter: (rel: Relationship) => boolean,
    ) => {
      const [nodes, relLists] = await Promise.all([
        Promise.all(assets.map((asset, i) => toNode(asset, position(asset, i)))),
        Promise.all(assets.map((asset) => api.listRelationships(asset.id))),
      ]);
      const edges = relLists.flat().filter(edgeFilter).map(toEdge);
      return { nodes, edges };
    },
    [toNode],
  );

  const loadOverview = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const physicalAssets = await api.listAssets({ layer: "physical" });
      const physicalIds = new Set(physicalAssets.map((a) => a.id));

      // Type resolution only depends on each asset's typeId, not on relationship data, so it runs
      // concurrently with the relationship fetch below rather than after it — resolving it for
      // every physical asset even though some turn out to be hidden (filtered out below) trades a
      // little redundant work for not serializing two round trips that don't actually depend on
      // each other.
      const [relLists, resolvedTypes] = await Promise.all([
        Promise.all(physicalAssets.map((asset) => api.listRelationships(asset.id))),
        Promise.all(physicalAssets.map((asset) => resolveType(asset.typeId))),
      ]);
      const allRels = relLists.flat();
      const typeByAssetId = new Map(physicalAssets.map((asset, i) => [asset.id, resolvedTypes[i]]));

      // Anything HOSTS-connected from another physical asset is a component of it (a disk, CPU,
      // NIC, GPU...) — never a free-standing device in its own right (this is exactly what
      // core/component's types are for). Keep those out of the top-level overview and let
      // expand() reveal them: otherwise every device's internals clutter the overview as if they
      // were standalone equipment, and expand/collapse would have nothing left to actually toggle
      // for them since they'd already be permanently visible regardless of expansion state.
      const hostedIds = new Set(
        allRels.filter((r) => r.kind === "HOSTS" && physicalIds.has(r.toId)).map((r) => r.toId),
      );
      const topLevelAssets = physicalAssets.filter((a) => !hostedIds.has(a.id));
      const topLevelIds = new Set(topLevelAssets.map((a) => a.id));

      const unpositioned: AssetNodeType[] = topLevelAssets.map((asset) => ({
        id: asset.id,
        type: "asset",
        position: { x: 0, y: 0 }, // overwritten by autoLayout below
        data: { asset, type: typeByAssetId.get(asset.id), expanded: false },
      }));
      const edges = allRels.filter((r) => topLevelIds.has(r.fromId) && topLevelIds.has(r.toId)).map(toEdge);
      // Nothing to disrupt yet on a fresh load, unlike expand()/attachHostedChild() adding to an
      // already-arranged (possibly manually-dragged) canvas — so the initial overview gets a real
      // layout instead of the plain grid, straight away.
      const nodes = autoLayout(unpositioned, edges);

      setState({ ...initialState, nodes, edges, loading: false });
    } catch (cause) {
      setState((prev) => ({ ...prev, loading: false, error: (cause as Error).message }));
    }
  }, [resolveType]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const select = useCallback((assetId: string | null) => {
    setState((prev) => ({ ...prev, selectedAssetId: assetId }));
  }, []);

  // Wires React Flow's drag/select interactions back into our own state — without this, dragging
  // a node moves it on screen only until the next render, since we fully control the `nodes` prop.
  const onNodesChange = useCallback((changes: NodeChange<AssetNodeType>[]) => {
    setState((prev) => ({ ...prev, nodes: applyNodeChanges(changes, prev.nodes) }));
  }, []);

  // On-demand re-layout of whatever's currently on the canvas — expand()/attachHostedChild()
  // deliberately don't do this automatically on every reveal (see autoLayout.ts's doc comment),
  // so a graph that's been expanded a lot without ever calling this can still sprawl until the
  // user asks for it.
  const arrange = useCallback(() => {
    setState((prev) => ({ ...prev, nodes: autoLayout(prev.nodes, prev.edges) }));
  }, []);

  const collapse = useCallback((assetId: string) => {
    setState((prev) => ({ ...prev, ...pruneDescendants(prev, assetId, false) }));
  }, []);

  const expand = useCallback(
    async (assetId: string) => {
      const parentNode = state.nodes.find((n) => n.id === assetId);
      if (!parentNode) return;
      if (parentNode.data.expanded) {
        collapse(assetId);
        return;
      }

      // Two independent directions: this asset's own outgoing relationships (HOSTS children,
      // PROVIDES/CONNECTS_TO peers, and its own "part of" MEMBER_OF tags), plus — since membership
      // is stored on the member, not the group — whoever has tagged themselves as a MEMBER_OF
      // *this* asset (relevant when expanding a group: that's how its members get revealed).
      // Kicked off as separate promises, not an immediate `await Promise.all`, so the per-child
      // fan-out below (which only needs outgoingRelsRaw) can start the moment *that* resolves
      // instead of also waiting on memberRels' unrelated latency.
      const outgoingRelsPromise = api.listRelationships(assetId);
      const memberRelsPromise = api.listMembers(assetId);

      // A HOSTS child that's redundantly represented by a (possibly nested) group is excluded from
      // the reveal entirely — see findGroupedAwayIds's own doc comment for the exact scenario.
      // Still reachable by expanding the actual group that represents it (that's the
      // memberRels/incoming-MEMBER_OF branch above, on whatever node that group is).
      const groupedAwayIdsPromise = outgoingRelsPromise.then((outgoingRelsRaw) => {
        const hostsChildIds = [...new Set(outgoingRelsRaw.filter((r) => r.kind === "HOSTS").map((r) => r.toId))];
        return findGroupedAwayIds(hostsChildIds);
      });

      const [outgoingRelsRaw, memberRels, groupedAwayIds] = await Promise.all([
        outgoingRelsPromise,
        memberRelsPromise,
        groupedAwayIdsPromise,
      ]);
      const outgoingRels = outgoingRelsRaw.filter(
        (r) => !(r.kind === "HOSTS" && groupedAwayIds.has(r.toId)),
      );

      const rels = [...outgoingRels, ...memberRels];
      // Fetch every target's asset + resolved type up front, including ones that turn out to
      // already be on the canvas — which of them are actually "new" is decided inside the setState
      // updater below, against the state at the moment it's applied, not a snapshot taken before
      // these awaits. That's what makes this safe if two expand() calls overlap: whichever's
      // setState applies second still sees the first's results and won't add duplicate node ids.
      const targetIds = [
        ...new Set([...outgoingRels.map((r) => r.toId), ...memberRels.map((r) => r.fromId)]),
      ];
      const targetAssets = await Promise.all(targetIds.map((id) => api.getAsset(id)));
      const targetTypes = await Promise.all(targetAssets.map((asset) => resolveType(asset.typeId)));
      const typeByAssetId = new Map(targetAssets.map((asset, i) => [asset.id, targetTypes[i]]));

      setState((prev) => {
        // assetId itself may have been deleted while these awaits were in flight (e.g. the user
        // double-clicked to expand it, then selected it and hit Delete before the fetch settled)
        // — attaching newly-fetched children/edges to a parent that's no longer on the canvas
        // would resurrect orphan nodes connected to nothing, so bail out entirely rather than
        // partially applying a reveal for a node that doesn't exist anymore.
        if (!prev.nodes.some((n) => n.id === assetId)) return prev;

        const existingNodeIds = new Set(prev.nodes.map((n) => n.id));
        const existingEdgeIds = new Set(prev.edges.map((e) => e.id));

        // Only newly-added assets get an expandedFrom entry — an already-visible target (e.g. two
        // expanded parents sharing a child) must not become collapsible via this parent too, or
        // collapsing this parent would wrongly delete a node something else still depends on.
        const newAssets = targetAssets.filter((asset) => !existingNodeIds.has(asset.id));
        const newNodes: AssetNodeType[] = newAssets.map((asset, i) => ({
          id: asset.id,
          type: "asset",
          position: childPosition(parentNode.position, i),
          data: { asset, type: typeByAssetId.get(asset.id), expanded: false },
        }));
        const newEdges = rels.map(toEdge).filter((edge) => !existingEdgeIds.has(edge.id));

        // A target reached only via this asset's *own outgoing* MEMBER_OF tag (assetId is the
        // member, the target is a group it's part of) is additive, not owned — collapsing assetId
        // later must not delete a group that exists independently of it, same as joinGroup's
        // invariant above. Targets revealed via *incoming* MEMBER_OF (assetId is a group, the
        // target is one of its members) keep normal expandedFrom bookkeeping: that's the
        // collapsible-groups behavior itself — collapsing the group should re-hide its members.
        const ownedTargetIds = new Set([
          ...outgoingRels.filter((r) => r.kind !== "MEMBER_OF").map((r) => r.toId),
          ...memberRels.map((r) => r.fromId),
        ]);
        const expandedFrom = new Map(prev.expandedFrom);
        for (const asset of newAssets) {
          if (ownedTargetIds.has(asset.id)) expandedFrom.set(asset.id, assetId);
        }

        return {
          ...prev,
          nodes: [
            ...prev.nodes.map((n) => (n.id === assetId ? { ...n, data: { ...n.data, expanded: true } } : n)),
            ...newNodes,
          ],
          edges: [...prev.edges, ...newEdges],
          expandedFrom,
        };
      });
    },
    [state.nodes, resolveType, collapse],
  );

  /**
   * Adds a single already-created HOSTS child to the canvas next to its parent, without touching
   * anything else — used after creating a new asset "hosted by" a selected node. Deliberately not
   * built on top of `expand`: calling `expand` on an already-expanded parent would collapse it
   * instead of adding to it, since that's `expand`'s toggle behavior for a direct user click.
   * Takes the already-created `Asset` rather than re-fetching it — the caller (CreateAssetDialog)
   * already has it from the create call.
   */
  const attachHostedChild = useCallback(
    async (parentId: string, asset: Asset) => {
      const parentNode = state.nodes.find((n) => n.id === parentId);
      if (!parentNode) return;

      const type = await resolveType(asset.typeId);

      setState((prev) => {
        // The parent may have been deleted (or otherwise removed) while resolveType was in
        // flight — same race expand() guards against for the same reason: attaching a child to a
        // parent that's no longer on the canvas would leave an edge pointing at a nonexistent
        // node. Reads the *current* parent node from prev, not the stale outer `parentNode`
        // closure, so its position reflects anything that happened (e.g. a drag) during the await too.
        const currentParent = prev.nodes.find((n) => n.id === parentId);
        if (!currentParent) return prev;
        if (prev.nodes.some((n) => n.id === asset.id)) return prev;

        // Position among this parent's existing children specifically, not the total node
        // count on the whole canvas — otherwise the child can land far outside the viewport
        // on a canvas that already has many unrelated nodes.
        const siblingCount = [...prev.expandedFrom.values()].filter((p) => p === parentId).length;

        const newNode: AssetNodeType = {
          id: asset.id,
          type: "asset",
          position: childPosition(currentParent.position, siblingCount),
          data: { asset, type, expanded: false },
        };
        const newEdge: Edge = {
          id: `${parentId}-HOSTS-${asset.id}`,
          source: parentId,
          target: asset.id,
          label: "HOSTS",
        };

        return {
          ...prev,
          nodes: [
            ...prev.nodes.map((n) => (n.id === parentId ? { ...n, data: { ...n.data, expanded: true } } : n)),
            newNode,
          ],
          edges: [...prev.edges, newEdge],
          expandedFrom: new Map(prev.expandedFrom).set(asset.id, parentId),
        };
      });
    },
    [state.nodes, resolveType],
  );

  /**
   * Tags an existing asset as MEMBER_OF an existing group — the "join an existing group" flow,
   * as opposed to `attachHostedChild`'s "create a new asset hosted by this one". Deliberately
   * doesn't record this in `expandedFrom`: membership is an additive overlay, not containment, so
   * collapsing the member later must not delete a group that exists independently of it.
   */
  const joinGroup = useCallback(
    async (member: Asset, group: Asset) => {
      await api.createRelationship(member.id, "MEMBER_OF", group.id);
      // Either side (or neither) may already be on canvas — the "asset joins a group" flow always
      // has the member visible (it's the selected node) but not necessarily the group; the group's
      // own "add an existing asset as a member" flow is the reverse: the group is visible, but the
      // chosen member could be anywhere in the whole inventory, including nested under something
      // that's never been expanded. Resolve both types regardless of which turns out unneeded.
      const [memberType, groupType] = await Promise.all([
        resolveType(member.typeId),
        resolveType(group.typeId),
      ]);

      setState((prev) => {
        const existingIds = new Set(prev.nodes.map((n) => n.id));
        const newEdge = toEdge({ fromId: member.id, kind: "MEMBER_OF", toId: group.id, properties: {} });
        const edgeExists = prev.edges.some((e) => e.id === newEdge.id);
        if (edgeExists && existingIds.has(member.id) && existingIds.has(group.id)) return prev;

        // Anchor new nodes near whichever side is already visible; if neither is, there's no
        // meaningful "near" — just drop them at the origin, same as the top-level "+ Add asset" flow.
        const anchorPosition =
          prev.nodes.find((n) => n.id === member.id)?.position ??
          prev.nodes.find((n) => n.id === group.id)?.position ??
          { x: 0, y: 0 };

        const newNodes: AssetNodeType[] = [];
        if (!existingIds.has(member.id)) {
          newNodes.push({
            id: member.id,
            type: "asset",
            position: childPosition(anchorPosition, newNodes.length),
            data: { asset: member, type: memberType, expanded: false },
          });
        }
        if (!existingIds.has(group.id)) {
          newNodes.push({
            id: group.id,
            type: "asset",
            position: childPosition(anchorPosition, newNodes.length),
            data: { asset: group, type: groupType, expanded: false },
          });
        }

        // Neither newly-added node gets an expandedFrom entry — membership is additive, not
        // containment (see the doc comment on this invariant elsewhere in this file), so neither
        // should vanish just because some unrelated node it's near later gets collapsed.
        return {
          ...prev,
          nodes: [...prev.nodes, ...newNodes],
          edges: edgeExists ? prev.edges : [...prev.edges, newEdge],
        };
      });
    },
    [resolveType],
  );

  /**
   * Removes an existing MEMBER_OF tag — the reverse of `joinGroup`. Only ever removes the one
   * edge, never either node: unlike a HOSTS child, a member usually still belongs on the canvas
   * for other reasons (it's still HOSTS-connected to its real parent, or the group may have other
   * members still worth seeing), so there's no safe general rule for auto-hiding it. Takes bare
   * ids, not full Assets — unlike `joinGroup`, nothing here ever needs to place a new node. Also
   * drops the member's `expandedFrom` entry if it pointed at this exact group — a member revealed
   * by *expanding the group* (incoming-MEMBER_OF targets get normal expandedFrom bookkeeping, see
   * `expand()`) would otherwise still get swept away by a later collapse of that group, even
   * though it's no longer actually a member.
   */
  const leaveGroup = useCallback(async (member: { id: string }, group: { id: string }) => {
    await api.deleteRelationship(member.id, "MEMBER_OF", group.id);
    // Reuses toEdge's own id format rather than rebuilding the template by hand, so the two can't
    // silently drift apart if that format ever changes.
    const edgeId = toEdge({ fromId: member.id, kind: "MEMBER_OF", toId: group.id, properties: {} }).id;
    setState((prev) => {
      const expandedFrom = new Map(prev.expandedFrom);
      if (expandedFrom.get(member.id) === group.id) expandedFrom.delete(member.id);
      const nodes = withExpandedBadgeClearedIfEmpty(prev.nodes, expandedFrom, group.id);
      return { ...prev, nodes, edges: prev.edges.filter((e) => e.id !== edgeId), expandedFrom };
    });
  }, []);

  /**
   * Removes a HOSTS relationship — e.g. un-nesting a group that was HOSTS-connected under another
   * group via "+ Add hosted group" (the only way a group ever ends up *inside* another one, since
   * that button always creates HOSTS, not MEMBER_OF — a group's own "Members" list only shows
   * MEMBER_OF, so a HOSTS-nested child group never appeared there and had no way to be removed).
   * Like `leaveGroup`, only ever removes the one edge, never either node or anything it hosts —
   * un-hosting doesn't imply deleting. Also drops the child's `expandedFrom` entry if it pointed
   * at this exact parent, since collapsing that parent later shouldn't hide a node it no longer
   * actually hosts.
   */
  const unhost = useCallback(async (parent: { id: string }, child: { id: string }) => {
    await api.deleteRelationship(parent.id, "HOSTS", child.id);
    const edgeId = toEdge({ fromId: parent.id, kind: "HOSTS", toId: child.id, properties: {} }).id;
    setState((prev) => {
      const expandedFrom = new Map(prev.expandedFrom);
      if (expandedFrom.get(child.id) === parent.id) expandedFrom.delete(child.id);
      const nodes = withExpandedBadgeClearedIfEmpty(prev.nodes, expandedFrom, parent.id);
      return { ...prev, nodes, edges: prev.edges.filter((e) => e.id !== edgeId), expandedFrom };
    });
  }, []);

  /**
   * Permanently deletes an asset (`DETACH DELETE` on the backend — the node and every relationship
   * touching it, in both directions). Anything that survives (a HOSTS child, a fellow group member)
   * keeps existing as real data, just loses that one connection — same as `unhost`/`leaveGroup`,
   * deleting a container never cascades into deleting what it contained. On the canvas, though, the
   * deleted node's own `expandedFrom` descendants (things only ever visible *because* this node
   * revealed them) are removed too, via `pruneDescendants` (the same helper `collapse()` uses,
   * with `includeRoot: true` since this one really does delete the root) — they're not deleted
   * server-side, just no longer shown floating with no context; a reload or a different path to
   * them (another HOSTS parent, a saved view) still surfaces them normally. Clears
   * `selectedAssetId` if the deleted node (or one of its removed descendants) was selected, so the
   * inspector panel closes itself rather than pointing at a node that no longer exists in `nodes`.
   */
  const deleteAsset = useCallback(async (assetId: string) => {
    await api.deleteAsset(assetId);
    setState((prev) => {
      // The deleted node's own former parent (if any) may now have nothing left revealed from it
      // — every *other* parent/child relationship touched by this deletion is entirely within
      // what pruneDescendants removes (descendantsOf only ever walks forward from assetId), so
      // this is the one node outside the removed set whose "expanded" badge could go stale, same
      // class of fix as unhost/leaveGroup.
      const formerParentId = prev.expandedFrom.get(assetId);
      const pruned = pruneDescendants(prev, assetId, true);
      const nodes = formerParentId
        ? withExpandedBadgeClearedIfEmpty(pruned.nodes, pruned.expandedFrom, formerParentId)
        : pruned.nodes;
      return {
        ...prev,
        ...pruned,
        nodes,
        selectedAssetId:
          prev.selectedAssetId && !nodes.some((n) => n.id === prev.selectedAssetId)
            ? null
            : prev.selectedAssetId,
      };
    });
  }, []);

  const loadView = useCallback(
    async (viewId: string) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const view = await api.getView(viewId);
        // Tolerate assets deleted since the view was saved: skip them rather than failing the
        // whole load, so the rest of the saved layout still comes up.
        const assetResults = await Promise.allSettled(view.visibleAssetIds.map((id) => api.getAsset(id)));
        const assets = assetResults.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));

        const visibleIds = new Set(assets.map((a) => a.id));
        const { nodes, edges } = await loadNodesAndEdges(
          assets,
          (asset) => view.nodePositions[asset.id] ?? { x: 0, y: 0 },
          (rel) => visibleIds.has(rel.toId),
        );

        setState({ ...initialState, nodes, edges, loading: false });
      } catch (cause) {
        setState((prev) => ({ ...prev, loading: false, error: (cause as Error).message }));
      }
    },
    [loadNodesAndEdges],
  );

  const saveView = useCallback(
    (name: string): Promise<SavedView> =>
      api.createView({
        name,
        visibleAssetIds: state.nodes.map((n) => n.id),
        nodePositions: Object.fromEntries(state.nodes.map((n) => [n.id, n.position])),
      }),
    [state.nodes],
  );

  return {
    ...state,
    expand,
    select,
    onNodesChange,
    reload: loadOverview,
    loadView,
    saveView,
    attachHostedChild,
    joinGroup,
    leaveGroup,
    unhost,
    deleteAsset,
    arrange,
  };
}
