export type AssetLayer = "physical" | "logical";

export type AttributeValue = string | number | boolean;

export interface Asset {
  id: string;
  typeId: string; // resolves against a LibraryRegistry, e.g. "core/server"
  name: string;
  layer: AssetLayer;
  attributeValues: Record<string, AttributeValue>;
  createdAt: string;
  updatedAt: string;
}

export type NewAsset = Omit<Asset, "id" | "layer" | "createdAt" | "updatedAt">;

/**
 * HOSTS: one asset runs/contains another (server hosts OS, OS hosts container
 *   platform, container platform hosts a container or service).
 * PROVIDES: a software asset offers a capability, distinct from what runs on
 *   what (a container platform PROVIDES containerization; an OS PROVIDES a
 *   filesystem service) — kept separate from HOSTS because containment and
 *   capability are independent facts about an asset.
 * CONNECTS_TO: a topology edge — physical (NIC to switch port) or logical
 *   (client to server) — not a containment relationship.
 */
export type RelationshipKind = "HOSTS" | "PROVIDES" | "CONNECTS_TO";

export interface Relationship {
  fromId: string;
  kind: RelationshipKind;
  toId: string;
  properties: Record<string, AttributeValue>;
}
