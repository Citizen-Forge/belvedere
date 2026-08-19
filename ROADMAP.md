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

`core/group` (unchanged type, still extends `core/hardware` for the same known cosmetic reason as
before — inherits unused `manufacturer`/`model`) is now the type used on both sides: hosted locally
under whatever it organizes, or created free-floating for a cross-cutting collection.

Verified end-to-end in the real browser UI: server hosting a "GPUs" group and 3 GPUs, one GPU also
tagged into a free-floating "ALL GPUs" group, the server itself tagged into a free-floating
"servers" group, and the join-group picker used to add a fresh membership live.

## Other known gaps

- **Publishing a type back to a library from inside the app.** Currently a manual fork-and-PR
  workflow (see belvedere-library's README) — there's no in-app "publish this custom type" flow.
- **Status monitoring.** Mentioned in the original project brief, never scoped beyond that. Needs
  a real design conversation (health checks? uptime pings? metric ingestion?) before building.
- **Saved-view sharing/permissions.** Views are global to the install, not per-user — fine for
  single-user, needs revisiting before any multi-user support.
- **Auto-layout** (bumped up after mapping the real Unraid box — see above). The graph canvas uses
  a fixed grid/child-offset layout (`web/src/graph/layout.ts`); a real layout engine
  (`dagre`/`elkjs`) is the natural upgrade now that a real graph (59 nodes) has actually
  demonstrated the problem, not just a hypothetical one.
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
