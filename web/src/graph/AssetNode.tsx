import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { Asset, ResolvedType } from "../api/types";

export type AssetNodeData = {
  asset: Asset;
  type: ResolvedType | undefined;
  expanded: boolean;
};

export type AssetNodeType = Node<AssetNodeData, "asset">;

export function AssetNode({ data, selected }: NodeProps<AssetNodeType>) {
  const layerClass = data.asset.layer === "physical" ? "asset-node--physical" : "asset-node--logical";
  return (
    <div className={`asset-node ${layerClass} ${selected ? "asset-node--selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className="asset-node__name">{data.asset.name}</div>
      <div className="asset-node__type">{data.type?.name ?? data.asset.typeId}</div>
      {data.expanded && <div className="asset-node__badge">expanded</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
