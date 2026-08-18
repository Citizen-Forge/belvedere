import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import neo4j, { type Driver } from "neo4j-driver";
import type { FastifyInstance } from "fastify";
import { buildContext, type AppContext } from "../context.js";
import { buildServer } from "./server.js";

// Demonstrates that networking (NICs, physical cabling, exposed ports, subnet membership) needs
// no dedicated belvedere code — it composes entirely from library types (core/network-interface,
// core/port, core/network) plus the existing HOSTS/CONNECTS_TO relationships.

const uri = process.env.BELVEDERE_NEO4J_URI ?? "bolt://localhost:7687";
const auth = neo4j.auth.basic(
  process.env.BELVEDERE_NEO4J_USER ?? "neo4j",
  process.env.BELVEDERE_NEO4J_PASSWORD ?? "belvedere-dev",
);

let driver: Driver | undefined;
let ctx: AppContext;
let app: FastifyInstance;
const createdAssetIds: string[] = [];

before(async () => {
  driver = neo4j.driver(uri, auth);
  ctx = await buildContext(driver);
  app = buildServer(ctx);
});

after(async () => {
  // Sequential, not Promise.all: these assets are densely interconnected, and concurrent
  // DETACH DELETEs on nodes sharing relationships can hit Neo4j lock contention. Errors are not
  // swallowed — a failed cleanup should fail the test run, not silently leave an orphaned row.
  if (ctx) {
    for (const id of createdAssetIds) {
      await ctx.assets.remove(id);
    }
  }
  if (app) await app.close();
  await driver?.close();
});

async function createAsset(typeId: string, name: string, attributeValues: Record<string, unknown> = {}) {
  const res = await app.inject({ method: "POST", url: "/api/assets", payload: { typeId, name, attributeValues } });
  assert.equal(res.statusCode, 201);
  const asset = res.json();
  createdAssetIds.push(asset.id);
  return asset;
}

async function connect(fromId: string, kind: string, toId: string, properties: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: `/api/assets/${fromId}/relationships`,
    payload: { kind, toId, properties },
  });
  assert.equal(res.statusCode, 201);
}

test("builds a physical-to-logical network topology using only existing asset/relationship primitives", async () => {
  // Physical: server --HOSTS--> NIC --CONNECTS_TO(port 3)--> switch
  const server = await createAsset("core/server", "net-server-01", { formFactor: "rack" });
  const nic = await createAsset("core/network-interface", "net-server-01-eth0", { macAddress: "00:1a:2b:3c:4d:5e" });
  const aSwitch = await createAsset("core/switch", "net-switch-01", { portCount: 24 });

  await connect(server.id, "HOSTS", nic.id);
  await connect(nic.id, "CONNECTS_TO", aSwitch.id, { switchPort: 3 });

  // Logical: server hosts an OS, which hosts a container platform, which HOSTS an exposed port.
  const os = await createAsset("core/os", "net-os-01", { kernel: "linux" });
  const platform = await createAsset("core/container-platform", "net-platform-01", { runtime: "docker" });
  const port = await createAsset("core/port", "net-port-8443", { port: 8443, protocol: "tcp", purpose: "https" });

  await connect(server.id, "HOSTS", os.id);
  await connect(os.id, "HOSTS", platform.id);
  await connect(platform.id, "HOSTS", port.id);

  // A separate client connects to that specific port.
  const client = await createAsset("core/laptop", "net-client-01");
  await connect(client.id, "CONNECTS_TO", port.id);

  // Subnet membership: the NIC connects to a Network asset representing its subnet.
  const network = await createAsset("core/network", "net-subnet-01", { cidr: "10.0.0.0/24", vlanId: 100 });
  await connect(nic.id, "CONNECTS_TO", network.id);

  // Verify the physical path: server -> NIC -> switch, with the port number preserved on the edge.
  const nicRels = (await app.inject({ method: "GET", url: `/api/assets/${nic.id}/relationships` })).json();
  const toSwitch = nicRels.find((r: { toId: string }) => r.toId === aSwitch.id);
  assert.ok(toSwitch, "expected a relationship from the NIC to the switch");
  assert.equal(toSwitch.kind, "CONNECTS_TO");
  assert.equal(toSwitch.properties.switchPort, 3);

  // Verify the logical hosting chain resolves down to the port.
  const platformRels = (await app.inject({ method: "GET", url: `/api/assets/${platform.id}/relationships` })).json();
  assert.ok(platformRels.some((r: { kind: string; toId: string }) => r.kind === "HOSTS" && r.toId === port.id));

  // Verify the client's connection targets the port asset specifically, not the platform/service.
  const clientRels = (await app.inject({ method: "GET", url: `/api/assets/${client.id}/relationships` })).json();
  assert.deepEqual(
    clientRels.map((r: { kind: string; toId: string }) => [r.kind, r.toId]),
    [["CONNECTS_TO", port.id]],
  );

  // Verify subnet membership is queryable from the NIC.
  const nicNetworkEdge = nicRels.find((r: { toId: string }) => r.toId === network.id);
  assert.ok(nicNetworkEdge, "expected a relationship from the NIC to the network");
  assert.equal(nicNetworkEdge.kind, "CONNECTS_TO");
});
