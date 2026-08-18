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

## Quickstart

Requires Docker (for Neo4j) and Node.js >= 20.12.

```bash
docker compose up -d          # Neo4j for the instance graph + settings

npm install
npm run dev                   # backend API on :3000

cd web
npm install
npm run dev                   # frontend on :5173, proxies /api to :3000
```

Open `http://localhost:5173`. A fresh install auto-loads the bundled belvedere-library as its
default type source — no setup beyond the above.

## Testing

```bash
npm test                      # pure-logic unit tests, no external dependencies
npm run test:integration      # requires Neo4j running (docker compose up -d first)

cd web
npm test                      # frontend unit tests (vitest)
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE).
