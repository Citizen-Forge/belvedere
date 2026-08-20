# Belvedere Architecture

This doc tracks the current module structure as the codebase grows. Update it at the end of each
build phase — it should always describe what exists now, not what's planned.

## Repo split

- **belvedere** (this repo) — all code. Owns the instance graph (assets, their config, physical
  and logical relationships), persisted settings, the HTTP API, and the visualization UI (`web/`).
- **[belvedere-library](../belvedere-library)** — data only, no code. A tree of type definitions
  (`types/**/*.yaml`) that this repo's `src/library` module loads and interprets. Belvedere never
  writes to a library repo; it only reads.

## `src/library` — type loading and resolution

Responsible for turning one or more configured [`LibrarySource`](src/library/types.ts)s (git repos
or local checkouts following the belvedere-library format) into a queryable, inheritance-resolved
type catalog. Each file has one job:

| File | Responsibility |
|---|---|
| `types.ts` | Shared shapes: `TypeRecord` (a type file's own fields, including optional `excludeAttributes`), `ResolvedType` (with inheritance merged in), `LibrarySource`, `AttributeDefinition`. |
| `schema.ts` | zod validation for a raw parsed type file. |
| `parseTypeFile.ts` | YAML text → validated `TypeRecord`. |
| `gitSource.ts` | Gets a `LibrarySource` onto local disk (`file://`/local path used in place; remote git sources shallow-fetched into a per-process cache dir, with in-flight dedup to avoid concurrent-checkout races). |
| `loadLibrary.ts` | Walks a checked-out source's `types/` tree and parses every file in it. |
| `resolveType.ts` | Pure function: given the full id→record map, walks `extends` to merge icon + attributes. No I/O. Also resolves `excludeAttributes` — a type can drop named *inherited* attribute keys it doesn't want (added for `core/group`, which extends `core/hardware` — every type must extend one of the three roots — but has no real `manufacturer`/`model` of its own). Exclusion propagates to further descendants the same way attributes/icon do, tracked by "distance from the resolved type" for both where a key is *defined* and where it's *excluded*: whichever happens closer to the leaf wins, so a middle type redeclaring an excluded key correctly un-excludes it for everything past that point too, not just for itself. |
| `registry.ts` | `LibraryRegistry` — loads multiple sources, indexes by id (rejecting duplicate ids, including within one source), exposes `get`/`listRoots`/`listChildren`/`all`, memoizes resolved types. |
| `config.ts` | The default source list a fresh install loads (currently the bundled `belvedere-library` checkout via `file://`, pending a published git remote). |

Design intent: `resolveType` stays a pure function over in-memory data so inheritance logic is
trivially unit-testable without touching disk or git. Everything I/O-related (`gitSource`,
`loadLibrary`) is isolated below `registry.ts`, which is the only thing the rest of the app should
depend on.

## `src/db.ts` — shared Neo4j access

Belvedere's own Neo4j (`docker-compose.yml`, default bolt port 7687 — separate from any
belvedere-library checkout, which has no database of its own) backs both the instance graph and
app settings, so the driver singleton, `withSession` helper, and generic `applySchemaFile(driver,
path)` (reads a `schema.cypher`, strips `//` comments, runs each statement — idempotent via `IF
NOT EXISTS`) live at the top level. `src/instances` and `src/settings` each keep their own
`schema.cypher` plus a one-line `applyXSchema(driver)` wrapper around `applySchemaFile`; nothing
outside `src/db.ts` should import `neo4j-driver` directly except test-only driver construction
(`src/instances/testSupport.ts`, and the integration test files under `src/settings` and `src/api`
that intentionally open their own driver rather than share the process-wide singleton, for test
isolation).

## `src/instances` — the instance graph

Owns actual asset data: things a user has instantiated from a type resolved by `src/library`,
plus typed relationships between them.

| File | Responsibility |
|---|---|
| `types.ts` | `Asset`, `NewAsset`, `Relationship`, `RelationshipKind` (`HOSTS`/`PROVIDES`/`CONNECTS_TO`/`MEMBER_OF`), `AssetLayer` (`physical`/`logical`). |
| `validateAttributes.ts` | Pure function: checks an asset's attribute values against a `ResolvedType`'s merged attribute schema (required fields, data types, enum options, unknown-key rejection). No I/O. |
| `schema.cypher` / `schema.ts` | Constraints/indexes for `Asset` nodes (unique id, indexed typeId/layer). |
| `assetRepository.ts` | `AssetRepository` — Neo4j CRUD for `Asset` nodes. |
| `relationshipRepository.ts` | `RelationshipRepository` — creates/lists/removes `HOSTS`/`PROVIDES`/`CONNECTS_TO`/`MEMBER_OF` edges between assets. Relationship kinds map to literal Cypher relationship types via an exhaustive switch (Neo4j can't parameterize relationship types, so this avoids ever interpolating caller-controlled strings into a query). Throws `RelationshipEndpointNotFoundError` (not a generic `Error`) when either endpoint doesn't exist, so the API layer can map it to 404. `create()` also rejects a `HOSTS` edge that would close a cycle (`HostsCycleError`, self-loops included) — HOSTS specifically drives the graph UI's containment/expand-collapse model (see the `web/` section below), so a cycle in it makes every asset on the cycle permanently unreachable there: each one is only ever revealed by expanding its HOSTS parent, and on a cycle every member's parent is another cycle member, so none of them is ever a top-level node to begin expanding from. Nothing in the UI can create a cycle today (the only relationship-creation path is "create a new asset hosted by an existing one," which can't reference an existing ancestor), but the MCP server and raw API both can, so the check lives here rather than only in the frontend. `PROVIDES`/`CONNECTS_TO`/`MEMBER_OF` have no containment semantics, so the check is HOSTS-only, not a general graph-wide acyclicity rule. `listFrom(assetId)` returns an asset's *outgoing* edges of any kind (including its own `MEMBER_OF` tags — "which groups is this a part of"); `listMembers(assetId)` is the reverse, returning *incoming* `MEMBER_OF` edges only ("who has tagged themselves into this asset") — needed because membership is stored on the member, not the group, so discovering a group's members means querying the opposite direction from every other relationship kind. `create()` also rejects a `MEMBER_OF` self-loop (`SelfMembershipError`) — the UI's join picker already filters this client-side, but the MCP server and raw API don't go through it. Unlike `HOSTS`, `MEMBER_OF` has no transitive-cycle check: a cycle in it can't strand anything (it never drives what's hidden from the UI the way `HOSTS` does), so two groups can legitimately be `MEMBER_OF` each other. `listConnections(assetId)` is `CONNECTS_TO`'s equivalent of `listMembers`, but symmetric rather than reversed: a topology edge (e.g. a NIC to a switch) has no privileged direction the way `MEMBER_OF` does, so it matches `(a {id: $assetId})-[r:CONNECTS_TO]-(b)` — an *undirected* Cypher pattern — rather than picking one side, returning each edge's real stored `fromId`/`toId` as-is (needed so a caller editing or removing a specific connection still knows which way it's actually stored). No self-loop or cycle guard for `CONNECTS_TO` — nothing in this app currently creates one, and unlike `MEMBER_OF`'s self-membership (a real category error) or `HOSTS`'s cycle (strands nodes from the UI), a self-`CONNECTS_TO` wouldn't actually break anything if it ever happened. |
| `assetService.ts` | `AssetService` — the seam between the two modules: resolves an asset's type via `LibraryRegistry`, validates its attributes, derives its `layer` from the type's root, then persists it. |
| `testSupport.ts` | Test-only helper: opens a driver against `docker-compose.yml`'s Neo4j, applies the schema, and wires up both repositories for `*.integration.test.ts` files. |

Design intent: `validateAttributes` is pure like `resolveType`, so schema-conformance logic is
tested without a database. `AssetService` is intentionally the only place that talks to both
`src/library` and `src/instances` — repositories don't know the library exists, and the library
module doesn't know instances exist.

**Modeling networking needs no new code.** A physical NIC, an exposed port, and a subnet are just
more library types (`core/network-interface`, `core/port`, `core/network` in belvedere-library) —
instantiated as ordinary `Asset`s and wired up with the existing `HOSTS`/`CONNECTS_TO` primitives:
`server -HOSTS-> nic -CONNECTS_TO(switchPort: N)-> switch` for physical cabling; `platform -HOSTS->
port` for what a service exposes, with a separate `client -CONNECTS_TO-> port` from anyone talking
to it (targeting the port asset, not the service, so which port was used is explicit in the
graph); `nic -CONNECTS_TO-> network` for subnet membership. See
`src/api/networkTopology.integration.test.ts` for the full worked example. This was the intended
payoff of the type-inheritance system from the start — new domains extend the graph purely as data
in belvedere-library, without belvedere needing a new node/relationship kind for every concept.

**Test cleanup gotcha:** integration tests that create relationship-connected fixtures (e.g. asset
A `CONNECTS_TO` asset B) must delete them sequentially in `after()`, not via `Promise.all`.
Concurrent `DETACH DELETE`s on nodes sharing an edge can hit Neo4j lock contention, which
intermittently left orphaned rows in exactly this way during development. All
`*.integration.test.ts` files follow the sequential pattern now.

## `src/settings` — persisted app configuration

Currently just the "Libraries" setting: which sources `src/library`'s `LibraryRegistry` loads on
startup, beyond the bundled default.

| File | Responsibility |
|---|---|
| `types.ts` | `LibrarySourceConfig` (a persisted, Neo4j-storable form of `LibrarySource` — `ref` is `string \| null`, never `undefined`, since Neo4j has no absent-vs-undefined distinction) and `toLibrarySource()` to convert back for `LibraryRegistry.load`. |
| `schema.cypher` / `schema.ts` | Unique constraint on `LibrarySourceConfig.id`. |
| `librarySourceRepository.ts` | `LibrarySourceRepository` — add/list/remove configured sources, plus `seedDefaultIfEmpty` for the fresh-install path. `add` relies on the unique constraint (catching the resulting `LibrarySourceAlreadyExistsError`) rather than a check-then-act read, so concurrent seeding from two processes can't both succeed. `list()` normalizes a missing `ref` property back to `null` on read. |

## `src/context.ts` — composition root

`buildContext(driver?)` is the one place that wires everything together: applies both schemas,
seeds the default library source if none are configured, loads the `LibraryRegistry` from
whatever sources are persisted, and constructs the repositories/services into an `AppContext`.
Both `src/index.ts` (real startup) and `src/api/server.integration.test.ts` (tests, with their own
driver) call this instead of duplicating the wiring.

## `src/api` — HTTP layer

A thin Fastify layer over the modules above — routes parse/validate input and delegate; no
business logic lives here.

| File | Responsibility |
|---|---|
| `schemas.ts` | zod request-body/param schemas (`createAssetBodySchema`, `createRelationshipBodySchema`, `relationshipKindSchema` — shared between the POST body and the DELETE route param so both validate the same way, `addLibrarySourceBodySchema`). |
| `errors.ts` | `statusForError(error)` — maps this app's domain error classes to HTTP status codes. Unrecognized errors default to 500. |
| `server.ts` | `buildServer(ctx)` — builds the Fastify instance and registers all routes. The global error handler trusts an error's own `statusCode` first (so Fastify's native errors, e.g. malformed JSON, keep their correct 400) and falls back to `statusForError` only for this app's own thrown errors. |
| `routes/types.ts` | `GET /api/types`, `/api/types/roots`, `/api/types/:namespace/:slug`, `/api/types/:namespace/:slug/children` — read-only, backed by `LibraryRegistry`. |
| `routes/assets.ts` | `POST/GET /api/assets`, `GET/DELETE /api/assets/:id` — backed by `AssetService`/`AssetRepository`. |
| `routes/relationships.ts` | `POST/GET /api/assets/:id/relationships`, `GET /api/assets/:id/members` (incoming `MEMBER_OF` only), `GET /api/assets/:id/connections` (`CONNECTS_TO` from either side — see `relationshipRepository.ts` above), `DELETE /api/assets/:id/relationships/:kind/:toId` — the DELETE route validates `:kind` through the same zod enum the POST body uses, rather than trusting the URL param. |
| `routes/libraries.ts` | `GET/POST /api/libraries`, `DELETE /api/libraries/:id` — mutates `LibrarySourceRepository` then reloads the full `LibraryRegistry`; if the reload fails (e.g. a newly-added source's types collide with an existing one), the just-added source is rolled back rather than left persisted-but-broken. |

`src/index.ts` is the real entrypoint: `buildContext()` then `buildServer(ctx)` then `listen()`.

Testing: `npm test` runs pure-logic unit tests only (no external dependencies) — this now includes
`errorHandler.test.ts` for `statusForError`. `npm run test:integration` runs everything against a
real Neo4j (`docker compose up -d` first): repository/service tests, the settings repository, and
full HTTP-layer tests via Fastify's `inject()` (no real port bound). Integration tests run with
`--test-concurrency=1` since concurrent files each apply schema against the same live database,
and each file scopes its own cleanup to the rows/sources it created rather than wiping a whole
label.

`routes/libraries.ts` reloads *every* configured source on any single add/remove (needed for
correctness — duplicate-id detection requires the full combined set — but means one remote git
source being unreachable can block mutating an unrelated local one); revisit if/when that becomes
a real pain point rather than fixing it preemptively. IP addressing is currently just a `string`
attribute on whatever asset needs one (e.g. a NIC's `ipAddress`) rather than a validated/queryable
type — fine until something needs to query "what's using this IP," at which point it may deserve
the same `CONNECTS_TO`-to-a-`core/network`-asset treatment as subnet membership.

## `web/` — visualization UI

A separate Vite + React + TypeScript app (its own `package.json`, not part of the backend's npm
workspace) that talks to the API over HTTP; `vite.config.ts` proxies `/api` to `:3000` in dev so
there's no CORS setup to maintain. No shared-types package with the backend yet — `web/src/api/types.ts`
duplicates the response shapes by hand; if that drifts enough to hurt, consider a shared `@belvedere/types`
package rather than reaching for codegen prematurely.

| Path | Responsibility |
|---|---|
| `src/api/client.ts` / `types.ts` | Thin typed `fetch` wrapper (`ApiError` carries the HTTP status) and response-shape types mirroring the backend's. `request()` only sets `Content-Type: application/json` when the call actually has a body — a bodyless DELETE with that header set gets rejected by Fastify's JSON parser ("Body cannot be empty..."), which silently broke every delete call (`deleteAsset`, `deleteView`) until `mcp/`'s own client hit the same bug and got caught by its stdio integration test; `ViewsMenu`'s delete button had been calling the broken path in the shipped UI the whole time with no test ever clicking it. |
| `src/graph/useBelvedereGraph.ts` | All graph state — nodes, edges, `expandedFrom` (which node's `expand()` revealed which) — lives in one `GraphState` object updated via a single `setState` per action, specifically so nodes/edges/`expandedFrom` can never disagree about what's new vs. pre-existing (an earlier version tracked `expandedFrom` in separate state and could make `collapse()` delete a pre-existing overview node that happened to share an edge with the expanded one — see `useBelvedereGraph.test.ts`'s "collapsing a node removes only what it revealed" test). The resolved-type cache is a `useRef`, not `useState`, for a related reason: a state-backed cache gave `resolveType`/`toNode`/`loadOverview` a new identity every time a type was first resolved, re-triggering the mount effect and silently resetting the graph mid-expand (caught by browser-testing, not typecheck or unit tests — see that test file's other regression case). `expand()` fetches all relationship targets up front, then decides what's actually new *inside* the `setState` updater (against state as applied, not a snapshot taken before the awaits), which is what makes overlapping `expand()` calls safe. `onNodesChange` wires React Flow's drag interaction back into this state via `applyNodeChanges` — without it, dragging a node moves it on screen only until the next render, since the canvas is fully controlled. `attachHostedChild(parentId, asset)` adds one already-created+linked asset next to its parent (used by the "+ Add hosted asset" flow); it's deliberately separate from `expand()` rather than reusing it, since calling `expand()` on an already-expanded parent collapses it (that's its toggle behavior for a direct click) — and it positions the new node by its sibling count *under that specific parent* (via `expandedFrom`), not the total node count on the canvas, or it can land far outside the viewport on a canvas with unrelated nodes already loaded. Re-reads the parent from `prev.nodes` *inside* the `setState` updater, not the `parentNode` captured before the `await resolveType(...)` call, and bails out entirely if the parent isn't there anymore — the parent can be deleted (`deleteAsset`) while `CreateAssetDialog`'s create-then-link flow is still in flight, and attaching a child to a since-deleted parent would leave an edge pointing at a nonexistent node (caught by code review, same class of race `expand()` guards against below). **`loadOverview()` excludes any physical asset that's a `HOSTS`-target of another physical asset** (computed from the same relationship fetch used to build overview edges, run concurrently with resolving every visible asset's type — the two don't depend on each other) — without this, a disk/CPU/GPU/NIC (same `physical` layer as the server hosting it) showed up in the initial overview unconditionally, regardless of whether its parent was expanded or collapsed, so expand/collapse looked broken for hardware specifically (only a *logical* child, like an OS, actually toggled, since logical assets were never in the physical-only overview to begin with) — see `useBelvedereGraph.test.ts`'s "excludes physical HOSTS children" test. **`expand()` also fetches `api.listMembers(assetId)`** (incoming `MEMBER_OF` edges) alongside `listRelationships` — this is how expanding a group reveals its members, since membership is stored on the member, not the group; `toEdge()` renders `MEMBER_OF` edges dashed to read as a tag/overlay rather than containment. **`joinGroup(member, group)`** takes full `Asset` objects for both sides (not just an id) and tags `member` onto `group` (creates the `MEMBER_OF` edge). It adds *either* side to the canvas if missing, anchored near whichever side is already visible — needed because it now backs two different flows with opposite visibility assumptions: an asset joining a group it's not yet on canvas near (the group may be new), and a group's own "add an existing asset as a member" picker, where the chosen member could be anywhere in the whole inventory, including hidden as an unexpanded HOSTS child elsewhere (caught by browser-testing after the group-side flow was added — the original single-sided version only ever placed the group, silently no-op'ing the canvas update whenever the member wasn't already present). Neither newly-added node gets an `expandedFrom` entry, since membership is additive and collapsing some unrelated nearby node later must not delete either one. This is currently the only UI path for connecting two *already-created* assets; every other relationship (HOSTS via "+ Add hosted asset"/"+ Add hosted group") is created alongside a brand-new asset. The same "additive, not owned" rule applies inside `expand()` itself, not just `joinGroup`: a target reached only via the expanded asset's *own outgoing* `MEMBER_OF` tag (it's a member, the target is a group it's part of) is excluded from `expandedFrom` for the same reason — otherwise expanding a NAS that happens to be `MEMBER_OF` a "Storage" group would make that group (and anything already revealed under it) get deleted when the NAS is later collapsed, even though the group exists independently. Targets reached via *incoming* `MEMBER_OF` (the expanded asset is a group, the target is one of its members) keep normal `expandedFrom` bookkeeping — that's the actual collapsible-groups mechanic, and collapsing the group is meant to re-hide its members. **`expand()` also hides a HOSTS child that's redundantly represented by a (possibly nested) group** — `findGroupedAwayIds(hostsChildIds)` (module-level pure-ish helper, calls `api` directly): reported live (2026-08-19) on the real Unraid graph: `unraid` `HOSTS`es both a "Drives" group and `disk3`/`parity` directly (ground truth, unchanged), and `disk3`/`parity` are separately `MEMBER_OF` "Drives" — expanding `unraid` should show only "Drives", not "Drives" *and* the two disks redundantly, with the disks still reachable by separately expanding "Drives". Extended the same day (2026-08-20) to nested groups: `unraid -HOSTS-> "Disks" -HOSTS-> "Array"`, with `disk3` a direct HOSTS child of `unraid` that's `MEMBER_OF "Array"` two HOSTS-hops down — the original single-level version only checked *direct* sibling groups, so `disk3` still leaked through both `expand("unraid")` and `expand("Disks")`. `findGroupedAwayIds` now BFS's through HOSTS edges into group-typed nodes only (stopping at the first non-group child down any branch, so it never chains through ordinary hardware/software) to build the full set of groups reachable from the expanded node via nested-group HOSTS chains, then hides any direct HOSTS child that's `MEMBER_OF` *any* group in that whole set — not just a group that's a direct sibling. A free-floating group elsewhere (no HOSTS parent connecting it to this expansion at all) still can't hide anything, since it isn't reachable via the BFS and isn't what's representing the child in this particular view. Caches each group's own relationships during the BFS (needed to find its HOSTS children) so the final per-direct-child `MEMBER_OF` check doesn't re-fetch them. Best-effort throughout: any fetch failure degrades to "nothing hidden" rather than aborting the whole expand, since this is a display refinement, not something worth a broken double-click over. The whole thing only depends on the outgoing-relationships fetch, not the members fetch, so it's kicked off as its own chained promise rather than waiting on both via one `Promise.all` — otherwise it'd be needlessly delayed by `listMembers`' unrelated latency whenever that happens to be the slower of the two. **`leaveGroup(member, group)`** is the reverse of `joinGroup`: removes one `MEMBER_OF` edge (`api.deleteRelationship`) and strips exactly that edge from canvas state, never either node — unlike a HOSTS child there's no safe general rule for auto-hiding a member on removal, since it usually still belongs on the canvas for other reasons (its real HOSTS parent, or other memberships). Takes bare `{ id }` for both sides, not full `Assets`, since removal never needs to place a new node the way `joinGroup` does; its edge id is built via the same `toEdge()` used everywhere else rather than re-deriving the id format by hand, so the two can't silently drift apart. **`unhost(parent, child)`** is the same shape of fix, but for `HOSTS`: the only way a group ever ends up nested *inside* another one is "+ Add hosted group", which always creates `HOSTS` (matching "+ Add hosted asset"'s semantics), not `MEMBER_OF` — so a nested group never showed up in the parent's "Members" list and had no way to be un-nested short of deleting it. Removes one `HOSTS` edge and, unlike `leaveGroup`, also clears the child's `expandedFrom` entry if it pointed at that exact parent — otherwise collapsing the old parent later would still hide a node it no longer actually hosts. `expand()`'s `setState` updater also bails out (returns `prev` unchanged) if `assetId` is no longer in `prev.nodes` at all — the same deleted-mid-flight race `attachHostedChild` guards against above, here for the "expand a node, then delete it before the fetch settles" case; without this, the newly-fetched children/edges would still get attached to a parent that no longer exists on the canvas. **`pruneDescendants(prev, rootId, includeRoot)`** is the shared core of `collapse()` and `deleteAsset()`: computes `descendantsOf(rootId, ...)` and returns nodes/edges/`expandedFrom` with all of it gone, `includeRoot` distinguishing "leave `rootId` in place, just un-expanded" (`collapse`) from "remove `rootId` too" (`deleteAsset`, extracted by code review after both had nearly-identical inline copies of the same removal logic). **`deleteAsset(assetId)`** permanently deletes an asset (`DETACH DELETE` on the backend — the node and every relationship touching it, in both directions; anything that survives, like a former HOSTS child or fellow group member, keeps existing as real data, just loses that one connection, same as `unhost`/`leaveGroup`). Calls `pruneDescendants(prev, assetId, true)` so the deleted node's own `expandedFrom` descendants (things only ever visible *because* this node revealed them) disappear from the canvas too — not deleted server-side, just no longer shown floating with no context. Also runs `withExpandedBadgeClearedIfEmpty` on the deleted node's *former parent* (captured before pruning), and clears `selectedAssetId` if the deleted node (or one of its removed descendants) was selected, so the inspector panel closes itself. Wired to a "Delete" button in `InspectorPanel.tsx`'s danger zone (bottom of the panel, red-bordered, `window.confirm` before calling through) — works for any asset, not just groups, though a group was the reported motivating case (no prior UI ever called the pre-existing `api.deleteAsset` client method at all). **`linkAssets(fromAsset, kind, toAsset, properties)`** is `joinGroup`'s original body generalized (extracted once `connectAssets` needed the identical "place either side on canvas if missing, upsert the edge" logic for a second relationship kind) — `joinGroup(member, group)` is now a one-line wrapper calling `linkAssets(member, "MEMBER_OF", group)`. Unlike the version this replaced, `linkAssets` always *upserts* the edge (replaces it by id if already present) rather than no-op'ing when it exists — harmless for `MEMBER_OF` (no properties ever change) and required for `CONNECTS_TO`, where editing a connection's notes is just calling this again for the same pair, not a separate update path. **`connectAssets(a, b, properties)`** creates/updates a `CONNECTS_TO` link — takes a full `properties` object, not just a `notes` string, because the backend's `create()` fully replaces `properties` on write rather than merging; a caller editing just the notes must spread the connection's existing `properties` in itself first (`InspectorPanel.tsx`'s `Connections` component does this) or silently wipe any other property the edge had (e.g. one set via the MCP server) — caught by code review, not the initial browser verification. **`disconnectAssets(fromId, toId)`** removes one `CONNECTS_TO` edge, same "only the edge, never either node" philosophy as `leaveGroup`/`unhost`; takes the edge's actual stored direction (not just "the two assets," since `CONNECTS_TO` has no privileged side — see `listConnections` above) so the right relationship gets deleted. |
| `src/graph/AssetNode.tsx` / `BelvedereGraph.tsx` / `layout.ts` | The React Flow custom node, canvas wrapper, and `childPosition` — a deterministic offset used to place a single newly-revealed node next to its parent on `expand()`/`attachHostedChild()`/`joinGroup()` (not a full-graph layout; see `autoLayout.ts` for that). `BelvedereGraph.tsx` renders an "Auto-arrange" button in a React Flow `Panel`, which calls `graph.arrange()` then `fitView()` on the next animation frame (has to wait a frame for React Flow to measure the newly-laid-out positions before `fitView` can frame them — the `fitView` *prop* on `<ReactFlow>` only runs once, on mount). |
| `src/graph/autoLayout.ts` | `autoLayout(nodes, edges)` — a pure function running `dagre` (top-to-bottom hierarchical) over an arbitrary node/edge set, returning the same nodes with recomputed `position`s. Used for the initial overview (nothing to disrupt yet) and the explicit "Auto-arrange" action; deliberately *not* run automatically on every `expand()`/`attachHostedChild()`/`joinGroup()` call, since re-laying-out the whole canvas on every single reveal would fight a user's manual dragging. Verified against the real, live 59-node Unraid graph — see `ROADMAP.md`'s auto-layout entry for the specific before/after and a known remaining rough edge (dagre centers each rank over its own children's span, not the whole tree's, so the root can land near the fitted view's edge on a very wide-but-shallow hierarchy). |
| `src/panel/InspectorPanel.tsx` | Shows the selected node's resolved attributes (inherited + own, matching `resolveType`'s merge), plus two action buttons: "+ Add hosted asset" (create a new asset HOSTS-connected to the selected one) and "+ Add hosted group" (the same flow with the type locked to `core/group` via `CreateAssetDialog`'s `presetTypeId`, skipping the type picker). Two more sections handle *existing*-asset membership, both backed by `graph.joinGroup`/`graph.leaveGroup`: `GroupMembership` ("Groups" — what groups is this asset a member of, each with a "×" to leave it, plus a picker to add it to another existing one) and, shown only when the selected asset is a group, `GroupMembers` ("Members" — the reverse direction: current members each removable, plus pulling in an *existing* asset from anywhere in the inventory as a member without needing to go select it first). "Is a group" is checked via `asset.typeId === GROUP_TYPE_ID || type?.ancestry.includes(GROUP_TYPE_ID)` — ancestry-aware, not just an exact match, so a hypothetical type that *extends* `core/group` (the same subtyping `excludeAttributes` itself supports) is still recognized as one. `GROUP_TYPE_ID` itself is a single shared constant from `api/types.ts` — App.tsx's preset-type wiring and this file's group detection both import the same one rather than risking two copies drifting apart. A group's "Layer" meta row is hidden entirely (it's tracked as `physical` internally purely so a free-floating group shows in the top-level overview — see `loadOverview()` above — but showing that as "Layer: physical" to the user would be actively misleading for something purely organizational). `GroupMembers` lists members by iterating the id set from `listMembers()` rather than filtering the unfiltered `listAssets()` result down, so a member whose asset record didn't come back (e.g. deleted concurrently) still shows as its raw id instead of silently vanishing — mirrors the fallback `GroupMembership` already used for the same situation on the other side. Both "Add" buttons await the mutation and only update local state on success, alerting on failure — matching `CreateAssetDialog`'s established convention for a post-creation linking call that can fail after the point of no return; the "×" remove buttons follow the same pattern. A third group-only section, `HostedChildren` ("Hosted"), lists this group's `HOSTS` children (fetched via `listRelationships`, resolved to names via `getAsset`) each with a "×" backed by `graph.unhost` — the only way a group ever ends up nested inside another (via "+ Add hosted group") is `HOSTS`, not `MEMBER_OF`, so without this section a nested group had no management UI at all. Renders nothing when there are no `HOSTS` children, unlike "Groups"/"Members" which always show at least a "not part of any group"/"no members yet" placeholder — a group with nothing hosted is the common case (most groups are pure `MEMBER_OF` containers) and an empty "Hosted" heading for every single one would be more clutter than signal. A "danger zone" at the very bottom of the panel (visually separated by a border, red-bordered button) holds a "Delete {type name}" button, `window.confirm`-gated, calling `graph.deleteAsset` — works for any asset, not just groups. `Connections` (shown on *every* asset, not group-scoped like Members/Hosted — `CONNECTS_TO` is a general topology feature, not organizational) lists `api.listConnections(asset.id)` results with an editable "Notes" text input per connection (e.g. "switch port 3") and a "Save" button that only appears once the draft differs from the saved value. Each row is keyed by `connectionKey(c)` (`"${fromId} ${toId}"`, direction included), not just the *other* asset's id — two `CONNECTS_TO` edges between the same pair in opposite directions (unusual, but the data model allows it, e.g. via the MCP server) would otherwise collide on the same React list key and share `draftNotes` state, letting an edit to one silently overwrite the other (caught by code review). Saving preserves the connection's real stored direction (`c.fromId === asset.id ? [asset, other] : [other, asset]`) and spreads its existing `properties` before adding the new `notes` — `connectAssets`/`linkAssets` always fully replaces `properties` on write, so sending only `{ notes }` would otherwise silently delete any other property already on the edge (also caught by code review, verified against a connection seeded with non-notes properties). The "+ Connect to…" picker below excludes the asset itself and anything already connected (checked in *either* direction, matching `listConnections`' own symmetry) from its candidate list. |
| `src/create/TypePicker.tsx` / `AttributeForm.tsx` / `CreateAssetDialog.tsx` | Breadcrumb drill-down through the library (any type at any depth is selectable, not just leaves) into a generated attribute form, POSTing through `AssetService`'s validation. Takes an optional `hostedBy` — once the asset is created, the dialog itself creates the HOSTS relationship, then closes *before* calling `onCreated`/updating the canvas: any failure past the point the asset exists server-side surfaces as a one-off alert rather than leaving the form open, since resubmitting at that point would create a second, orphaned duplicate rather than retrying anything meaningful. Also takes an optional `presetTypeId` (used by "+ Add hosted group") that skips `TypePicker` entirely and fetches that one type directly; if the fetch fails, falls back to the normal `TypePicker` (with the error shown above it) rather than getting stuck on a permanent loading state with no way out. |
| `src/views/ViewsMenu.tsx` | Save the current canvas (node ids + dragged positions) as a named `SavedView` via the backend, or load one back — `useBelvedereGraph.loadView`/`saveView`. Tolerates a saved view referencing an asset that's since been deleted (skips it via `Promise.allSettled` rather than failing the whole load). |

Testing: `npm test` (vitest + jsdom + React Testing Library) covers `useBelvedereGraph`'s async
state logic without a browser. There is no automated browser test yet — every feature so far was
verified with one-off Playwright driver scripts during development (dev server + headless
Chromium, following the pattern in the `run` skill's `examples/playwright.md`), not committed to
the repo. If browser-level regressions become a recurring problem, promote that into a real
Playwright test in this package rather than re-deriving a driver script each time.

## `mcp/` — MCP server

A third sub-package (own `package.json`, like `web/`) exposing Belvedere to AI agents over the
Model Context Protocol: discover types/assets/relationships and create new ones. It's a thin
stdio server — every tool is a pure handler function (`src/tools/*.ts`) that calls Belvedere's own
REST API via `src/apiClient.ts` (a near-duplicate of `web/src/api/client.ts`; not worth a shared
package yet, same tradeoff `web/` already documents above). `src/index.ts` wires each handler into
`McpServer.registerTool` via a small `toolCallback` adapter that JSON-serializes the result as
text content and turns a thrown `ApiError` into an MCP error result instead of crashing the
process.

Handlers take `api` as an explicit parameter rather than importing the client module directly —
makes them trivially testable with a plain stub object (`{ listRootTypes: async () => [...] }`),
no module mocking needed, unlike `web/`'s `vi.mock`-based tests.

**Verification followed the same "don't just claim it, drive it" discipline as the frontend's
browser tests**: a one-off script (not committed, matching the Playwright driver-script precedent)
uses the MCP SDK's own `Client` + `StdioClientTransport` to spawn the server as a real subprocess,
do a real stdio handshake, list tools, and call each one — discovery, create, connect, read, an
invalid-id error case, and delete/cleanup. This is what actually caught the `Content-Type` bug
above: unit tests with a stubbed `api` never touch the real HTTP layer, so only an end-to-end run
against the live backend exposed it.

## `src/views` (backend) — saved views

Mirrors the `src/settings` pattern closely: `SavedView` nodes (unique `id` constraint,
`nodePositions` stored as a JSON string like `Asset.attributeValues`), `SavedViewRepository`
(create/list/get/remove), routes at `/api/views`. A saved view is just `visibleAssetIds` +
`nodePositions` — it doesn't snapshot attribute values or relationships, so loading a view always
reflects the assets' current state, not a copy frozen at save time.

Not yet built: publishing a custom type back to a library source (still a manual fork-and-PR
workflow per belvedere-library's README) and any kind of view sharing/permissions — saved views
are global to the install, not per-user, which is fine for a single-user instance and will need
revisiting before multi-user support.

## Deployment

One container serves everything: `Dockerfile` is a three-stage build (compile the backend,
`vite build` the frontend, then a slim runtime image with only production deps) that copies the
frontend's build output to `/app/public` and serves it from the same Fastify instance as the API
via `@fastify/static` (`server.ts`'s `staticDir` option) — same origin, no CORS setup needed in
production, and only one IP/port to expose. `scripts/copy-assets.mjs` exists because `tsc` only
emits `.ts → .js`; the `.cypher` schema files under `src/*/schema.cypher` need copying into `dist`
separately, or the compiled app throws `ENOENT` on startup looking for them — this was caught
building the image for the first real deployment, not by any test, since local dev always runs
straight from `src/` via `tsx` and never exercises the compiled `dist/` layout.

`docker-compose.yml` defines `neo4j` + `app` on a private `belvedere-net` bridge network (`app`
reaches Neo4j at `bolt://neo4j:7687`, service-name DNS). `docker-compose.prod.yml` is a
host-specific overlay: it macvlan-attaches `app` to an external `br0` network with a static LAN IP
and resets its published port (Docker's macvlan driver can't publish ports — the app is reached
directly at `<its IP>:3000` from any real device on that network, not the host, and not from
another container on a different Docker network; only real devices on the physical LAN segment can
reach a macvlan IP). Neo4j stays off `br0` entirely — it doesn't need a LAN IP, only `app` does.
This mirrors the same pattern already used for this org's other Unraid-hosted apps.

`neo4j`'s healthcheck (`wget --spider` against its HTTP port) plus `app`'s `depends_on: condition:
service_healthy` avoid a real startup race that showed up on first deploy: without it, `app`
crash-loops through a few `ECONNREFUSED`s before Neo4j finishes its cold JVM start, then recovers
via `restart: unless-stopped` — functionally fine but noisy, and the healthcheck needs a
`start_period` (30s) or Compose hard-fails the whole `up` instead of waiting through a slow cold
start on modest hardware.

Deploying to the Unraid box specifically: `tar`-over-SSH the repo (excluding `node_modules`/`dist`)
to `/mnt/dockermain/appdata/belvedere`, write a `.env` there with a real
`BELVEDERE_NEO4J_PASSWORD` (never the `belvedere-dev` default), then `docker compose -f
docker-compose.yml -f docker-compose.prod.yml up -d --build`. Verify from an actual LAN device
(this dev machine), never by curling from the Unraid host itself — the host can't reach its own
macvlan children, which looks like a failed deploy but isn't.
