import { useCallback, useEffect, useRef, useState } from "react";
import { applyNodeChanges, type Edge, type NodeChange } from "@xyflow/react";
import { api } from "../api/client";
import type { Asset, Relationship, ResolvedType, SavedView } from "../api/types";
import type { AssetNodeType } from "./AssetNode";
import { childPosition, gridPosition } from "./layout";

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

      const nodes: AssetNodeType[] = topLevelAssets.map((asset, i) => ({
        id: asset.id,
        type: "asset",
        position: gridPosition(i),
        data: { asset, type: typeByAssetId.get(asset.id), expanded: false },
      }));
      const edges = allRels.filter((r) => topLevelIds.has(r.fromId) && topLevelIds.has(r.toId)).map(toEdge);

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

  const collapse = useCallback((assetId: string) => {
    setState((prev) => {
      const toRemove = descendantsOf(assetId, prev.expandedFrom);
      const expandedFrom = new Map(prev.expandedFrom);
      for (const id of toRemove) expandedFrom.delete(id);

      return {
        ...prev,
        nodes: prev.nodes
          .filter((n) => !toRemove.has(n.id))
          .map((n) => (n.id === assetId ? { ...n, data: { ...n.data, expanded: false } } : n)),
        edges: prev.edges.filter((e) => !toRemove.has(e.target) && !toRemove.has(e.source)),
        expandedFrom,
      };
    });
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
      const [outgoingRels, memberRels] = await Promise.all([
        api.listRelationships(assetId),
        api.listMembers(assetId),
      ]);
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
        if (prev.nodes.some((n) => n.id === asset.id)) return prev;

        // Position among this parent's existing children specifically, not the total node
        // count on the whole canvas — otherwise the child can land far outside the viewport
        // on a canvas that already has many unrelated nodes.
        const siblingCount = [...prev.expandedFrom.values()].filter((p) => p === parentId).length;

        const newNode: AssetNodeType = {
          id: asset.id,
          type: "asset",
          position: childPosition(parentNode.position, siblingCount),
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
    async (memberId: string, group: Asset) => {
      await api.createRelationship(memberId, "MEMBER_OF", group.id);
      const type = await resolveType(group.typeId);

      setState((prev) => {
        const memberNode = prev.nodes.find((n) => n.id === memberId);
        if (!memberNode) return prev;

        const newEdge = toEdge({ fromId: memberId, kind: "MEMBER_OF", toId: group.id, properties: {} });
        if (prev.edges.some((e) => e.id === newEdge.id)) return prev;

        if (prev.nodes.some((n) => n.id === group.id)) {
          return { ...prev, edges: [...prev.edges, newEdge] };
        }

        // Group isn't on canvas yet — place it near the member so the new membership is visible
        // immediately, without an expandedFrom entry (see doc comment above).
        const newNode: AssetNodeType = {
          id: group.id,
          type: "asset",
          position: childPosition(memberNode.position, 0),
          data: { asset: group, type, expanded: false },
        };
        return { ...prev, nodes: [...prev.nodes, newNode], edges: [...prev.edges, newEdge] };
      });
    },
    [resolveType],
  );

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
  };
}
