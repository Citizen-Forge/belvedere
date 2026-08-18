export type TypeRoot = "hardware" | "software" | "cloud-provider";
export type AttributeDataType = "string" | "number" | "boolean" | "enum" | "reference";

export interface AttributeDefinition {
  key: string;
  label: string;
  dataType: AttributeDataType;
  unit?: string;
  options?: string[];
  required?: boolean;
}

export interface ResolvedType {
  id: string;
  name: string;
  root: TypeRoot;
  extends: string | null;
  icon: string | null;
  description: string | null;
  resolvedIcon: string | null;
  resolvedAttributes: AttributeDefinition[];
  ancestry: string[];
}

export type AssetLayer = "physical" | "logical";
export type AttributeValue = string | number | boolean;

export interface Asset {
  id: string;
  typeId: string;
  name: string;
  layer: AssetLayer;
  attributeValues: Record<string, AttributeValue>;
  createdAt: string;
  updatedAt: string;
}

export type RelationshipKind = "HOSTS" | "PROVIDES" | "CONNECTS_TO";

export interface Relationship {
  fromId: string;
  kind: RelationshipKind;
  toId: string;
  properties: Record<string, AttributeValue>;
}

export interface NodePosition {
  x: number;
  y: number;
}

export interface SavedView {
  id: string;
  name: string;
  visibleAssetIds: string[];
  nodePositions: Record<string, NodePosition>;
  createdAt: string;
  updatedAt: string;
}

export interface NewSavedView {
  name: string;
  visibleAssetIds: string[];
  nodePositions: Record<string, NodePosition>;
}
