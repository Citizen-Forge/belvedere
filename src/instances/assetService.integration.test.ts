import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Driver } from "neo4j-driver";
import { setupTestDb } from "./testSupport.js";
import { AssetRepository } from "./assetRepository.js";
import { AssetService } from "./assetService.js";
import { AttributeValidationError } from "./validateAttributes.js";
import { LibraryRegistry } from "../library/registry.js";
import { coreLibrarySource } from "../library/config.js";

let driver: Driver | undefined;
let assets: AssetRepository;
let service: AssetService;
const createdIds: string[] = [];

before(async () => {
  ({ driver, assets } = await setupTestDb());
  const registry = new LibraryRegistry();
  await registry.load([coreLibrarySource]);
  service = new AssetService(registry, assets);
});

after(async () => {
  if (assets) {
    for (const id of createdIds) {
      await assets.remove(id);
    }
  }
  await driver?.close();
});

test("creates a hardware asset and derives a physical layer from the resolved type's root", async () => {
  const asset = await service.createAsset({
    typeId: "core/server",
    name: "web-03",
    attributeValues: { cpu: "Xeon E5", formFactor: "rack" },
  });
  createdIds.push(asset.id);

  assert.equal(asset.layer, "physical");
});

test("creates a software asset and derives a logical layer", async () => {
  const asset = await service.createAsset({
    typeId: "core/os",
    name: "ubuntu-24.04",
    attributeValues: { kernel: "linux", isHypervisor: false },
  });
  createdIds.push(asset.id);

  assert.equal(asset.layer, "logical");
});

test("rejects an asset with attribute values that don't match the resolved type", async () => {
  await assert.rejects(
    () =>
      service.createAsset({
        typeId: "core/server",
        name: "bad-config",
        attributeValues: { formFactor: "blade-server" }, // not in core/server's enum options
      }),
    AttributeValidationError,
  );
});
