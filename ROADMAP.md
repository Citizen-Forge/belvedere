# Roadmap

Not commitments or a schedule — a working list of what's known to be missing or worth doing next,
kept here instead of scattered across chat history. `ARCHITECTURE.md` documents what exists;
this documents what doesn't yet.

## MCP server (AI-driven discovery and inventory management)

An MCP server exposing Belvedere's graph to AI agents/assistants: discover existing elements,
types, and connections, and add new instances/relationships to the inventory. This would make
Belvedere usable as the "memory" for an agent doing infrastructure work, not just a UI a human
drives directly.

**Planned first real use once built:** map the actual Unraid box (`Citizen-Forge/belvedere`'s own
deployment target — see `ARCHITECTURE.md`'s Deployment section and [[reference_unraid-box]]) into
Belvedere as real inventory: the host itself (a `core/generic-server` instance), its CPU/RAM/disks
via `core/component` children (`core/cpu`, `core/disk`), its GPUs (no library type for a GPU yet —
add one, likely another `core/component` child), and every Docker container it runs (the OS,
container platform, and each container as `core/os` → `core/container-platform` → software
instances, per the pattern in `src/api/networkTopology.integration.test.ts`). Expect this to
surface gaps in the type library (GPU, more specific container/service types) — extend
belvedere-library as needed rather than forcing everything into existing types.

## Other known gaps

- **Publishing a type back to a library from inside the app.** Currently a manual fork-and-PR
  workflow (see belvedere-library's README) — there's no in-app "publish this custom type" flow.
- **Status monitoring.** Mentioned in the original project brief, never scoped beyond that. Needs
  a real design conversation (health checks? uptime pings? metric ingestion?) before building.
- **Saved-view sharing/permissions.** Views are global to the install, not per-user — fine for
  single-user, needs revisiting before any multi-user support.
- **Auto-layout.** The graph canvas uses a fixed grid/child-offset layout
  (`web/src/graph/layout.ts`); a real layout engine (`dagre`/`elkjs`) is the natural upgrade once
  graphs get bigger than a demo.
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
