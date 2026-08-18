import type { LibraryRegistry } from "../library/registry.js";
import type { TypeRoot } from "../library/types.js";
import type { AssetRepository } from "./assetRepository.js";
import { validateAttributes } from "./validateAttributes.js";
import type { Asset, AssetLayer, NewAsset } from "./types.js";

function layerForRoot(root: TypeRoot): AssetLayer {
  switch (root) {
    case "hardware":
      return "physical";
    case "software":
    case "cloud-provider":
      return "logical";
    default: {
      // Compile-time exhaustiveness check: fails to typecheck if a TypeRoot
      // variant is ever added without being routed to a layer above.
      const exhaustive: never = root;
      throw new Error(`Unhandled type root: ${String(exhaustive)}`);
    }
  }
}

/** Creates an asset, validating its attribute values against the type resolved from the library. */
export class AssetService {
  constructor(
    private readonly registry: LibraryRegistry,
    private readonly assets: AssetRepository,
  ) {}

  async createAsset(input: NewAsset): Promise<Asset> {
    const resolvedType = this.registry.get(input.typeId);
    validateAttributes(resolvedType, input.attributeValues);

    return this.assets.create({ ...input, layer: layerForRoot(resolvedType.root) });
  }
}
