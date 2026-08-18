export interface NodePosition {
  x: number;
  y: number;
}

/** A user-saved arrangement: which assets are on the canvas and where, independent of the live graph. */
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
