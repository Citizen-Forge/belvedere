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
