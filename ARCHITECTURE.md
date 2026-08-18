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
| `types.ts` | Shared shapes: `TypeRecord` (a type file's own fields), `ResolvedType` (with inheritance merged in), `LibrarySource`, `AttributeDefinition`. |
| `schema.ts` | zod validation for a raw parsed type file. |
| `parseTypeFile.ts` | YAML text → validated `TypeRecord`. |
| `gitSource.ts` | Gets a `LibrarySource` onto local disk (`file://`/local path used in place; remote git sources shallow-fetched into a per-process cache dir, with in-flight dedup to avoid concurrent-checkout races). |
| `loadLibrary.ts` | Walks a checked-out source's `types/` tree and parses every file in it. |
| `resolveType.ts` | Pure function: given the full id→record map, walks `extends` to merge icon + attributes. No I/O. |
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
| `types.ts` | `Asset`, `NewAsset`, `Relationship`, `RelationshipKind` (`HOSTS`/`PROVIDES`/`CONNECTS_TO`), `AssetLayer` (`physical`/`logical`). |
| `validateAttributes.ts` | Pure function: checks an asset's attribute values against a `ResolvedType`'s merged attribute schema (required fields, data types, enum options, unknown-key rejection). No I/O. |
| `schema.cypher` / `schema.ts` | Constraints/indexes for `Asset` nodes (unique id, indexed typeId/layer). |
| `assetRepository.ts` | `AssetRepository` — Neo4j CRUD for `Asset` nodes. |
| `relationshipRepository.ts` | `RelationshipRepository` — creates/lists/removes `HOSTS`/`PROVIDES`/`CONNECTS_TO` edges between assets. Relationship kinds map to literal Cypher relationship types via an exhaustive switch (Neo4j can't parameterize relationship types, so this avoids ever interpolating caller-controlled strings into a query). Throws `RelationshipEndpointNotFoundError` (not a generic `Error`) when either endpoint doesn't exist, so the API layer can map it to 404. |
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
| `routes/relationships.ts` | `POST/GET /api/assets/:id/relationships`, `DELETE /api/assets/:id/relationships/:kind/:toId` — the DELETE route validates `:kind` through the same zod enum the POST body uses, rather than trusting the URL param. |
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
| `src/api/client.ts` / `types.ts` | Thin typed `fetch` wrapper (`ApiError` carries the HTTP status) and response-shape types mirroring the backend's. |
| `src/graph/useBelvedereGraph.ts` | All graph state — nodes, edges, `expandedFrom` (which node's `expand()` revealed which) — lives in one `GraphState` object updated via a single `setState` per action, specifically so nodes/edges/`expandedFrom` can never disagree about what's new vs. pre-existing (an earlier version tracked `expandedFrom` in separate state and could make `collapse()` delete a pre-existing overview node that happened to share an edge with the expanded one — see `useBelvedereGraph.test.ts`'s "collapsing a node removes only what it revealed" test). The resolved-type cache is a `useRef`, not `useState`, for a related reason: a state-backed cache gave `resolveType`/`toNode`/`loadOverview` a new identity every time a type was first resolved, re-triggering the mount effect and silently resetting the graph mid-expand (caught by browser-testing, not typecheck or unit tests — see that test file's other regression case). `expand()` fetches all relationship targets up front, then decides what's actually new *inside* the `setState` updater (against state as applied, not a snapshot taken before the awaits), which is what makes overlapping `expand()` calls safe. `onNodesChange` wires React Flow's drag interaction back into this state via `applyNodeChanges` — without it, dragging a node moves it on screen only until the next render, since the canvas is fully controlled. `attachHostedChild(parentId, asset)` adds one already-created+linked asset next to its parent (used by the "+ Add hosted asset" flow); it's deliberately separate from `expand()` rather than reusing it, since calling `expand()` on an already-expanded parent collapses it (that's its toggle behavior for a direct click) — and it positions the new node by its sibling count *under that specific parent* (via `expandedFrom`), not the total node count on the canvas, or it can land far outside the viewport on a canvas with unrelated nodes already loaded. |
| `src/graph/AssetNode.tsx` / `BelvedereGraph.tsx` / `layout.ts` | The React Flow custom node, canvas wrapper, and a deterministic grid/child-offset layout (no auto-layout engine yet — a real one like `dagre`/`elkjs` is the natural upgrade once graphs get bigger than a demo). |
| `src/panel/InspectorPanel.tsx` | Shows the selected node's resolved attributes (inherited + own, matching `resolveType`'s merge), plus "+ Add hosted asset" to create a new asset HOSTS-connected to the selected one (e.g. adding a disk to a server). |
| `src/create/TypePicker.tsx` / `AttributeForm.tsx` / `CreateAssetDialog.tsx` | Breadcrumb drill-down through the library (any type at any depth is selectable, not just leaves) into a generated attribute form, POSTing through `AssetService`'s validation. Takes an optional `hostedBy` — once the asset is created, the dialog itself creates the HOSTS relationship, then closes *before* calling `onCreated`/updating the canvas: any failure past the point the asset exists server-side surfaces as a one-off alert rather than leaving the form open, since resubmitting at that point would create a second, orphaned duplicate rather than retrying anything meaningful. |
| `src/views/ViewsMenu.tsx` | Save the current canvas (node ids + dragged positions) as a named `SavedView` via the backend, or load one back — `useBelvedereGraph.loadView`/`saveView`. Tolerates a saved view referencing an asset that's since been deleted (skips it via `Promise.allSettled` rather than failing the whole load). |

Testing: `npm test` (vitest + jsdom + React Testing Library) covers `useBelvedereGraph`'s async
state logic without a browser. There is no automated browser test yet — every feature so far was
verified with one-off Playwright driver scripts during development (dev server + headless
Chromium, following the pattern in the `run` skill's `examples/playwright.md`), not committed to
the repo. If browser-level regressions become a recurring problem, promote that into a real
Playwright test in this package rather than re-deriving a driver script each time.

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
