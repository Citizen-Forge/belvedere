# belvedere-mcp

An MCP (Model Context Protocol) server exposing Belvedere's type catalog and instance graph to AI
agents — browse types and existing assets/relationships, and create new ones. It's a thin stdio
server: every tool call is just a request against Belvedere's own REST API (`src/api` in the
parent repo), so it needs a running Belvedere backend to talk to.

## Running it

```bash
npm install
BELVEDERE_API_URL=http://localhost:3000 npm run dev   # or npm run build && npm start
```

`BELVEDERE_API_URL` defaults to `http://localhost:3000`. Point it at a deployed instance (e.g.
`http://192.168.250.236:3000`) to let an agent work against real inventory instead of local dev
data.

To use it from an MCP client (Claude Code, Claude Desktop, etc.), configure it as a stdio server
with the command `node` and args `["<path-to>/mcp/dist/index.js"]` (after `npm run build`), or
`npx tsx <path-to>/mcp/src/index.ts` for local dev without a build step.

## Tools

| Tool | Purpose |
|---|---|
| `list_type_roots` | List the three system roots (hardware/software/cloud-provider), or one filtered by `root`. |
| `get_type` | Resolve a type by id — inherited + own attributes, icon, ancestry. |
| `list_type_children` | Browse the inheritance tree from a given type id. |
| `list_libraries` | List configured type-library sources. |
| `list_assets` | List asset instances, optionally filtered by `typeId`/`layer`. |
| `get_asset` | Get one asset instance by id. |
| `create_asset` | Instantiate a new asset of a given type. |
| `delete_asset` | Delete an asset instance (and its relationships). |
| `list_asset_relationships` | List `HOSTS`/`PROVIDES`/`CONNECTS_TO` edges originating from an asset. |
| `create_relationship` | Connect two existing assets. |
| `delete_relationship` | Remove a specific relationship. |

See `ARCHITECTURE.md` (parent repo) for design notes and how this was verified.
