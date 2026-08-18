# Belvedere

System inventory, visualization, and (eventually) status monitoring — a class-based description
system for hardware, software, services, and networking.

Everything you model is an instance of a type resolved from a configurable type library — see
[belvedere-library](https://github.com/Citizen-Forge/belvedere-library), the default catalog of
hardware/software/cloud-provider types Belvedere ships with. Types form an inheritance tree (e.g.
`core/server` extends `core/hardware`); anyone can publish their own library alongside or instead
of the default one.

Instances are connected by typed relationships (`HOSTS`, `PROVIDES`, `CONNECTS_TO`) that model both
physical topology (a server's NIC physically connecting to a switch) and logical topology (an OS
hosting a container platform hosting a service) in the same graph. See
[ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together and why they're built the way
they are.

## Quickstart (local dev, hot-reload)

Requires Docker (for Neo4j) and Node.js >= 20.12.

```bash
docker compose up -d neo4j    # just the database — the app itself runs via npm run dev, not this

npm install
npm run dev                   # backend API on :3000

cd web
npm install
npm run dev                   # frontend on :5173, proxies /api to :3000
```

Open `http://localhost:5173`. A fresh install auto-loads the bundled belvedere-library as its
default type source — no setup beyond the above.

## Running the whole stack in Docker

`docker-compose.yml` also defines an `app` service (builds the `Dockerfile`, which bundles the
built frontend and serves it from the same container/port as the API — no separate frontend
container or IP needed):

```bash
docker compose up -d --build  # neo4j + app, everything on :3000
```

`docker-compose.prod.yml` is an overlay for deploying to a host with a Docker macvlan network
(e.g. Unraid's `br0`) — it gives the app its own real LAN IP instead of a published host port
(macvlan can't publish ports), and disables Neo4j's LAN-facing ports:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

See the comments at the top of `docker-compose.prod.yml` for the network/IP specifics — they're
host-specific and will need editing for a different macvlan setup.

## Testing

```bash
npm test                      # pure-logic unit tests, no external dependencies
npm run test:integration      # requires Neo4j running (docker compose up -d first)

cd web
npm test                      # frontend unit tests (vitest)
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE).
