import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { AttributeValue, ResolvedType } from "../api/types";
import { TypePicker } from "./TypePicker";
import { AttributeForm } from "./AttributeForm";

export interface CreateAssetDialogProps {
  onClose: () => void;
  onCreated: () => void;
}

export function CreateAssetDialog({ onClose, onCreated }: CreateAssetDialogProps) {
  const [selectedType, setSelectedType] = useState<ResolvedType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (name: string, attributeValues: Record<string, AttributeValue>) => {
    if (!selectedType) return;
    setError(null);
    try {
      await api.createAsset({ typeId: selectedType.id, name, attributeValues });
      onCreated();
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Failed to create asset.");
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <h2>Add asset</h2>
          <button onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && <p className="dialog__error">{error}</p>}

        {selectedType ? (
          <AttributeForm type={selectedType} onSubmit={handleSubmit} onCancel={() => setSelectedType(null)} />
        ) : (
          <TypePicker onSelect={setSelectedType} />
        )}
      </div>
    </div>
  );
}
