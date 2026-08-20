# Roadmap

Not commitments or a schedule — a working list of what's known to be missing or worth doing next,
kept here instead of scattered across chat history. `ARCHITECTURE.md` documents what exists;
this documents what doesn't yet.

## MCP server (AI-driven discovery and inventory management) — done

Built as `mcp/` (see `ARCHITECTURE.md`'s `mcp/` section): a stdio MCP server with tools to browse
types/assets/relationships and create/delete both. Verified end-to-end with a real MCP client
(stdio handshake, tool calls, error handling) rather than just unit-testing the handlers — that's
what caught a real bug (a bodyless DELETE request breaking on the API's JSON-parser, also affecting
the web UI's delete-view button, which no test had ever clicked).

**Also done: used it to map the actual Unraid box** (2026-08-18) into the live deployment as real
inventory — 59 assets: the host (`core/generic-server`), CPU, 12 disks (real Unraid pool/role data:
parity/parity2/disk1-4/cache/dockermain/etc, via a new `pool` attribute on `core/disk`), 3 GPUs (new
`core/gpu` type), a NIC, the OS, Docker as `core/container-platform`, and 39 running containers (new
`core/container` type) all HOSTS-connected in the correct physical→logical chain. Confirmed by
browser-driving the live UI, not just checking asset counts. This is what the type library gaps
mentioned above turned out to be in practice (GPU and container types; disk roles needed a
free-text field alongside the fixed enum since real Unraid pool names don't fit a closed set).

This also made the missing auto-layout item below concretely painful for the first time — a
59-node real graph sprawls in a long strip with the current grid/child-offset layout, unlike every
synthetic test graph so far which stayed small. Worth bumping priority on that item.

## Groups — done (redesigned 2026-08-19)

First attempt (2026-08-19, same day) made group membership *only* a HOSTS edge — put a disk under
an "array" group by re-parenting its HOSTS relationship from the server to the group. Rejected on
review: it forces a choice between an asset's real physical/logical location and its organizational
grouping, and can't express an asset belonging to *several* groups at once, or a cross-cutting
group (e.g. "ALL GPUs" spanning multiple servers) that isn't hosted by any single parent.

Replaced with a second, orthogonal relationship kind: **`MEMBER_OF`** (`src/instances/types.ts`).
An asset's HOSTS parent stays untouched — MEMBER_OF is a purely additive tag alongside it:

- A GPU stays `HOSTS`-connected to its real server (ground truth, unchanged) **and** can separately
  be `MEMBER_OF` a "GPUs" group hosted under that same server (an organizational cluster local to
  that server) **and** `MEMBER_OF` a second, free-floating "ALL GPUs" group with no HOSTS parent at
  all (a cross-cutting collection — free-floating groups just surface directly in the physical
  overview, since nothing hosts them to hide them).
- Many-to-many: nothing stops an asset joining several groups, or a group being MEMBER_OF another
  group.
- Membership is stored on the member, not the group (`member -[MEMBER_OF]-> group`), so listing a
  group's members means querying *incoming* edges — the new `listMembers()` /
  `GET /api/assets/:id/members` (backend) and `expand()` (frontend, which now fetches both a
  node's outgoing relationships *and* its incoming members before deciding what to reveal).
- `HOSTS`'s cycle-prevention (`assertNoHostsCycle`) is deliberately **not** extended to MEMBER_OF —
  the bug it guards against (a cycle makes every member permanently unreachable, since HOSTS is the
  only thing that drives the expand/collapse hiding) doesn't apply to a purely additive edge that
  never hides anything.
- New UI: the inspector's "Groups" section lists an asset's current memberships and a picker to
  join an *existing* group — the first UI affordance in Belvedere for connecting two already-created
  assets, as opposed to creating a new hosted child.

`core/group` is now the type used on both sides: hosted locally under whatever it organizes, or
created free-floating for a cross-cutting collection.

Verified end-to-end in the real browser UI: server hosting a "GPUs" group and 3 GPUs, one GPU also
tagged into a free-floating "ALL GPUs" group, the server itself tagged into a free-floating
"servers" group, and the join-group picker used to add a fresh membership live.

**Fixed (2026-08-20): `core/group` no longer shows unused `manufacturer`/`model`.** Real user
feedback after actually using groups on the live Unraid graph — a group has neither, and it stuck
out. Fixed with a new, general type-system primitive rather than a group-specific hack:
`excludeAttributes` on a `TypeRecord` (`src/library/types.ts`/`schema.ts`/`resolveType.ts`) drops
named *inherited* attribute keys from a type's resolved set, propagating to anything that further
extends it (same as icon/attributes already do) unless a descendant explicitly redeclares that key.
`core/group` now declares `excludeAttributes: [manufacturer, model]` and adds its own freeform
`notes` string attribute. Also added a "Layer" display fix to the same request: a group is tracked
internally as `physical` layer (that's what makes a free-floating group with no `HOSTS` parent show
up in the top-level overview at all — `loadOverview()` only ever queries physical-layer assets, see
`ARCHITECTURE.md`), but showing "Layer: physical" to the user on something that's purely
organizational was actively misleading, not just unhelpful clutter — `InspectorPanel.tsx` now hides
that row for anything that's a `core/group` (or extends it, ancestry-aware) rather than changing the
underlying layer (which would silently break free-floating group visibility, a load-bearing existing
feature, instead of fixing a cosmetic display issue).

**Added (2026-08-20): remove an asset from a group.** The join-a-group UI only ever supported
adding — there was no way to undo it short of deleting the asset entirely. `graph.leaveGroup(member,
group)` removes one `MEMBER_OF` edge via `DELETE /api/assets/:id/relationships/:kind/:toId` (already
existed on the backend for other relationship kinds; just needed a `deleteRelationship` client method
on the frontend, which was missing) and strips exactly that edge from canvas state — never either
node, since a member usually still belongs on the canvas for other reasons. Wired to a "×" next to
every entry in both `InspectorPanel`'s "Groups" list (leave a group) and "Members" list (remove a
member), the two directions `joinGroup` already supported.

**Fixed (2026-08-20): couldn't remove a group nested inside another group.** Real gap hit live:
"+ Add hosted group" (used to nest one group under another, e.g. an "Array" sub-group under
"Drives") always creates a `HOSTS` edge — the same as "+ Add hosted asset" — not `MEMBER_OF`, so the
nested group never appeared in the parent's "Members" list (which only ever shows `MEMBER_OF`) and
had no way to be un-nested short of deleting it outright. Added `graph.unhost(parent, child)`
(removes one `HOSTS` edge, same "only the edge, never either node" philosophy as `leaveGroup`, and
also clears the child's `expandedFrom` entry if it pointed at that exact parent, so a later collapse
of the old parent doesn't hide a node it no longer actually hosts) and a new "Hosted" section in the
inspector, shown only for groups (same scoping as "Members" — an ordinary asset's `HOSTS` children
are better managed via canvas expand/collapse and can run into the dozens, which would clutter this
panel far more than help).

**Extended (2026-08-20): grouped-away hiding now sees through nested groups, not just one level.**
Real gap hit live, same day as the fix above: `unraid -HOSTS-> "Disks" -HOSTS-> "Array"`, with
`disk3` a direct `HOSTS` child of `unraid` (ground truth — really plugged into it) that's `MEMBER_OF
"Array"`, two `HOSTS`-hops below `unraid`. The original single-level check (added 2026-08-19) only
looked at *direct* sibling groups, so `disk3` still leaked through both `expand("unraid")` *and*
`expand("Disks")` — it should only ever appear when `expand("Array")` is called, since "Array" is
what actually represents it. `findGroupedAwayIds` (`useBelvedereGraph.ts`) now BFS's through `HOSTS`
edges into group-typed nodes only, building the full set of groups reachable from the expanded node
via a chain of nested-group `HOSTS` edges, then hides any direct `HOSTS` child that's `MEMBER_OF`
*any* group anywhere in that set. Verified against the real live scenario end-to-end (expand
unraid → shows only Disks; expand Disks → shows only Array; expand Array → finally shows disk3).

**Added (2026-08-20): delete an asset entirely.** No UI anywhere ever called the `deleteAsset` API
client method that already existed — the only way to remove something was `unhost`/`leaveGroup`
(sever one connection) or going around the app entirely via the raw API/MCP. Added a "Delete"
button to the inspector's new "danger zone" (bottom of the panel, visually separated, red-bordered),
`window.confirm`-gated, calling the backend's `DETACH DELETE` (removes the node and every
relationship touching it — anything that survives, like a former `HOSTS` child or fellow group
member, keeps existing as real data, just loses that one connection, same non-cascading philosophy
as `unhost`/`leaveGroup`). On the canvas, deleting a node also removes its own `expandedFrom`
descendants (things only ever visible because it revealed them) via a new shared
`pruneDescendants` helper — extracted from `collapse()`'s and this new logic's otherwise
near-duplicate removal code once both existed side by side. Works for any asset, not just groups,
though a group was the reported motivating case. Code review caught two related races opened up by
introducing a first "the selected node might vanish out from under an in-flight async action" case:
`expand()` didn't check its target was still on the canvas before attaching newly-fetched children
to it, and `attachHostedChild` (the "+ Add hosted asset" flow) had the identical gap — both fixed
with the same "re-check against live state, bail if gone" guard.

## Connections (CONNECTS_TO topology links) — done (2026-08-20)

Asked for directly: "a way to add connections between entities... the network port on the unraid
server will connect to a switch... I might want to add notes to the connection (which switch port
it is)." `CONNECTS_TO` already existed as a relationship kind (used internally for the
network-topology example) but had **zero UI anywhere** to create one between two existing assets —
the only "connect two existing things" affordance in the whole app was groups' `MEMBER_OF`.

Added a full `Connections` section to the inspector, shown on *every* asset (not group-scoped —
`CONNECTS_TO` is a general topology feature): lists existing connections with an editable "Notes"
field per one (free text, e.g. "switch port 3" — shown right on the canvas edge too, not just
buried in the panel), and a picker to connect to any other existing asset. Backed by a new
`listConnections` (backend + web client + MCP tool, for AI-discovery parity with the rest of the
relationship kinds) that queries `CONNECTS_TO` in *either* direction via an undirected Cypher
pattern — unlike `HOSTS`/`MEMBER_OF`, a topology edge (a cable) has no privileged side, so a
connection made from asset A's panel shows up on asset B's panel too, symmetrically.

`joinGroup`'s "place either side on canvas if missing, upsert the edge" logic was generalized into
a shared `linkAssets` helper once `connectAssets` needed the identical behavior for a second
relationship kind — `joinGroup` is now a one-line wrapper over it.

Code review caught two real bugs before shipping: (1) editing a connection's notes called the
backend's `create()`, which fully *replaces* `properties` on write rather than merging — sending
only the new notes would silently delete any other property already on that edge (e.g. one set via
the MCP server, which supports arbitrary properties like `{ switchPort: 3 }`); fixed by spreading
the connection's existing properties before adding the updated notes. (2) Two `CONNECTS_TO` edges
between the same pair in opposite directions would collide on the same React list key (keyed only
by "the other asset's id," not direction) and share notes-editing state, letting an edit to one
silently affect the other; fixed with a direction-inclusive key. Verified live: NIC → switch → a
second switch, notes visible on the canvas edge, editing from either endpoint's own panel, and
confirmed via direct API check that non-notes properties survive an edit.

## Custom attributes, live external data, and alerting — not started, design captured 2026-08-20

The original project brief mentioned "status monitoring" with no further scope. The user has now
given a concrete design for it, building in three layers where each depends on the one before it.
None of this is built yet — capturing it here in enough detail to actually start from, rather than
losing it back to "needs a design conversation."

**1. Per-instance custom attributes.** Today every attribute an asset can have comes entirely from
its *type* (`resolveType`'s merged `resolvedAttributes`) — `validateAttributes` rejects any key not
in that set. The ask: from any entity's inspector, add (and remove) attributes that belong to *that
instance only*, not the type — e.g. an "array type" or "total capacity" field on one specific group,
without every group getting it. This needs a real schema addition, not a UI-only change: an
`Asset`-level list of custom attribute definitions (key/label/dataType, same shape as
`AttributeDefinition`) stored alongside `attributeValues`, merged with — not replacing —
`resolvedAttributes` for display/validation purposes. Needs new API routes (add/remove a custom
attribute definition on a specific asset) and an inspector UI (a "+ Add attribute" affordance,
probably in the existing Attributes table, with per-row remove for anything not part of the type).

**2. Dynamic (externally-sourced) attribute values.** An attribute — custom or eventually even a
type-defined one — can pull its live value from an external source instead of a literal stored
value. Concretely: on a drive, add a "current capacity" field, and either type a value directly or
pick a previously-configured Prometheus (or Grafana) source and enter a PromQL query that resolves
it. Needs:
  - A **data source** concept in Settings (parallel to the existing "Libraries" pattern —
    `LibrarySourceRepository`/`routes/libraries.ts` — a `DataSourceRepository` storing name, kind
    (prometheus/grafana/…), base URL, and whatever auth it needs), with CRUD routes and a Settings UI
    page (nothing like this exists yet — there's no Settings screen at all currently, just the
    Views menu and the graph canvas).
  - A way to bind one attribute to `{ sourceId, query }` instead of (or alongside) a literal value —
    likely a new field on the attribute value shape, not just reusing `AttributeValue` as-is, since a
    dynamic binding needs to survive independent of whatever the last-fetched value was.
  - A backend query-execution path: an HTTP client for Prometheus's `/api/v1/query` (and later
    Grafana's datasource-proxy API), with real error handling for an unreachable/misconfigured
    source — this is the first place Belvedere would depend on a live third-party service being up
    to render correctly, which is a meaningfully different failure mode than anything today (every
    existing read is against Belvedere's own Neo4j).
  - A refresh strategy: fetch on-demand when the inspector is open (simplest, but a dashboard full of
    dynamic values would mean a burst of concurrent queries), a poll interval with caching, or both.
    Needs an actual decision before building, not just "figure it out as you go" — affects the data
    model (does Belvedere ever *store* a fetched value, or always re-query live?).

**3. Alert thresholds + status propagation.** On a dynamic (numeric) attribute, set a threshold
(e.g. capacity < 10% free) with a severity. When breached, the asset should render differently
wherever it's shown (the user's example: turn red). The status should also **percolate upward**
through the `HOSTS` tree — a drive at 5% free should make the unraid server it belongs to show
amber, signaling "something under here needs attention" without necessarily hiding what. This is a
graph aggregation problem, not just a per-node flag: computing "worst status among all descendants"
for every ancestor of every alerting node. Needs a decision on when that's computed — live at render
time (a HOSTS-tree traversal per visible node, potentially expensive on a large graph like the real
59+-node Unraid one) vs. a materialized/cached rollup recomputed on a schedule or when relevant data
changes. Also needs an actual visual language (the color scale itself, and where it renders — node
border color on the canvas is the obvious first place; "any dashboards it shows on" implies
something beyond the single graph canvas that exists today, which is its own open question: is a
"dashboard" just a `SavedView` rendered with status overlays, or a genuinely new artifact type?
Worth resolving before building rather than guessing).

**Suggested build order, since each layer is genuinely a prerequisite for the next**: (1) custom
attributes first — useful standalone, and dynamic attributes are really "a custom attribute whose
value has a different source," so building custom attributes without the dynamic-source concept
first keeps the schema/API change small and reviewable on its own. (2) Data sources + dynamic
values next, once there's something to attach them to. (3) Alerting/propagation last, since it's
meaningless without real live data to threshold against, and its own biggest open question (how/
where status renders) benefits from having actual dynamic attributes in the app to design against
rather than guessing in the abstract.

## Other known gaps

- **Publishing a type back to a library from inside the app.** Currently a manual fork-and-PR
  workflow (see belvedere-library's README) — there's no in-app "publish this custom type" flow.
- **Saved-view sharing/permissions.** Views are global to the install, not per-user — fine for
  single-user, needs revisiting before any multi-user support.
- **Auto-layout — done (2026-08-19).** `web/src/graph/autoLayout.ts` runs `dagre` (top-to-bottom
  hierarchical) over whatever's currently on the canvas, wired to a new "Auto-arrange" button
  (`BelvedereGraph.tsx`'s React Flow `Panel`, which also re-fits the viewport to the result —
  `fitView`'s own prop only runs once on mount). Used for the initial overview too (nothing to
  disrupt there), while `expand()`/`attachHostedChild()`/`joinGroup()` keep their existing
  incremental child-offset placement rather than re-arranging the whole canvas on every single
  reveal, which would fight manual dragging. Verified against the real, live 59-node Unraid graph
  (not a synthetic one): expanding unraid → OS → Docker → all 39 containers previously left most of
  the graph scrolled off-screen in a horizontal strip with no way to see it all at once; Auto-arrange
  turns it into a legible ranked tree that `fitView` fits on screen.

  Known remaining rough edge: dagre centers each rank over *its own* children's span, not the whole
  tree's span, so on a very wide-but-shallow hierarchy like this one (1 root → 18 direct children →
  39 grandchildren under just one of them) the root can end up positioned near the horizontal edge of
  the fitted view rather than looking centered above everything — confirmed on the real graph, not
  just theorized. Still fully visible and clickable, just not centered. Not fixing now — would need
  either a different layout algorithm (a proper tree/radial layout, or `elkjs` with a layered
  algorithm tuned for this) or custom post-processing on top of dagre's output; the current version
  is already a large improvement over the fixed grid and worth shipping as-is.
- **No committed browser test suite.** Every UI feature so far was verified with one-off
  Playwright driver scripts during development, not committed — see `ARCHITECTURE.md`'s `web/`
  section. Worth promoting to a real Playwright suite if browser-level regressions become a
  recurring problem.
- **IP addressing is just a string attribute** (e.g. a NIC's `ipAddress`), not a validated/queryable
  relationship to a `core/network` asset the way subnet membership is. Fine until something needs
  to query "what's using this IP."
- **`routes/libraries.ts` reloads every configured library source on any single add/remove** —
  correct (duplicate-id detection needs the full set) but means one unreachable remote source can
  block mutating an unrelated local one. Revisit if it becomes a real pain point.
- **`expand()`'s grouped-away-sibling check adds one `listRelationships` call per direct HOSTS
  child, unconditionally**, even when nothing under that node is grouped at all — noticeable extra
  latency on a node with many hosted components (the Unraid box's 18-child `unraid` node, or a
  24-drive NAS). Degrades gracefully on failure (falls back to showing everything, no hiding) but
  doesn't currently avoid the N calls when it turns out none of them were needed. A bulk backend
  endpoint ("list relationships for these N ids in one call") would fix this properly; not building
  it preemptively without a concrete report that it's actually slow in practice.
- **The "join a group" picker only finds assets whose `typeId` is exactly `core/group`**
  (`GroupMembership`'s `listAssets({ typeId: GROUP_TYPE_ID })`), unlike `InspectorPanel`'s own
  `isGroup` check, which is ancestry-aware. No subtype of `core/group` exists yet, so this hasn't
  mattered in practice — would need either a backend query that can filter "is-a" rather than
  exact-type, or fetching+resolving every asset's type client-side to check ancestry (expensive).
  Revisit if/when a group subtype actually gets created.
- **`excludeAttributes` has no migration path for an asset's already-stored `attributeValues`.**
  Not a problem *today* — there's no asset-update endpoint at all yet (create/read/delete only), so
  nothing ever re-validates an existing asset's attribute values against its current resolved type.
  Would become one the moment an "edit attributes" feature is built: an asset created before a key
  was excluded (or set out-of-band) would fail that validation on its first edit until the stale
  key is stripped. Worth handling when that feature is actually designed, not before.
