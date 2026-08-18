import type { Driver } from "neo4j-driver";
import { getDriver } from "./db.js";
import { LibraryRegistry } from "./library/registry.js";
import { coreLibrarySource } from "./library/config.js";
import { applyInstanceSchema } from "./instances/schema.js";
import { AssetRepository } from "./instances/assetRepository.js";
import { RelationshipRepository } from "./instances/relationshipRepository.js";
import { AssetService } from "./instances/assetService.js";
import { applySettingsSchema } from "./settings/schema.js";
import { LibrarySourceRepository } from "./settings/librarySourceRepository.js";
import { toLibrarySource } from "./settings/types.js";
import { applyViewsSchema } from "./views/schema.js";
import { SavedViewRepository } from "./views/savedViewRepository.js";

export interface AppContext {
  driver: Driver;
  registry: LibraryRegistry;
  librarySources: LibrarySourceRepository;
  assets: AssetRepository;
  relationships: RelationshipRepository;
  assetService: AssetService;
  savedViews: SavedViewRepository;
}

/** Composition root: applies schema, seeds defaults, and loads the type library from persisted sources. */
export async function buildContext(driver: Driver = getDriver()): Promise<AppContext> {
  await applyInstanceSchema(driver);
  await applySettingsSchema(driver);
  await applyViewsSchema(driver);

  const librarySources = new LibrarySourceRepository(driver);
  await librarySources.seedDefaultIfEmpty(coreLibrarySource);

  const registry = new LibraryRegistry();
  const configuredSources = await librarySources.list();
  await registry.load(configuredSources.map(toLibrarySource));

  const assets = new AssetRepository(driver);
  const relationships = new RelationshipRepository(driver);
  const assetService = new AssetService(registry, assets);
  const savedViews = new SavedViewRepository(driver);

  return { driver, registry, librarySources, assets, relationships, assetService, savedViews };
}
