import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Asset, AttributeValue, ResolvedType } from "../api/types";
import { TypePicker } from "./TypePicker";
import { AttributeForm } from "./AttributeForm";

export interface CreateAssetDialogProps {
  /** When set, the new asset is HOSTS-connected to this asset once created (e.g. "add a disk to this server"). */
  hostedBy?: { id: string; name: string };
  /** When set, skips the type picker and goes straight to the attribute form for this type — e.g. "+ Add hosted group" always creates a core/group, no need to drill through the library for it. */
  presetTypeId?: string;
  /** Overrides the default "Add asset[ hosted by X]" header — used by presetTypeId callers to say what they're actually creating (e.g. "Add group hosted by unraid"). */
  title?: string;
  onClose: () => void;
  onCreated: (asset: Asset) => void | Promise<void>;
}

export function CreateAssetDialog({ hostedBy, presetTypeId, title, onClose, onCreated }: CreateAssetDialogProps) {
  const [selectedType, setSelectedType] = useState<ResolvedType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!presetTypeId) return;
    let cancelled = false;
    api
      .getType(presetTypeId)
      .then((type) => {
        if (!cancelled) setSelectedType(type);
      })
      .catch(() => {
        if (!cancelled) setError(`Could not load type "${presetTypeId}".`);
      });
    return () => {
      cancelled = true;
    };
  }, [presetTypeId]);

  const handleSubmit = async (name: string, attributeValues: Record<string, AttributeValue>) => {
    if (!selectedType) return;
    setError(null);

    let asset: Asset;
    try {
      asset = await api.createAsset({ typeId: selectedType.id, name, attributeValues });
    } catch (cause) {
      // Nothing was created — safe to leave the form open for the user to fix and resubmit.
      setError(cause instanceof ApiError ? cause.message : "Failed to create asset.");
      return;
    }

    // The asset now exists server-side. Close immediately so a failure in the follow-up steps
    // (linking it to a parent, updating the canvas) can't tempt a resubmit that would create a
    // second, orphaned duplicate — surface those failures as a one-off alert instead.
    onClose();
    try {
      if (hostedBy) await api.createRelationship(hostedBy.id, "HOSTS", asset.id);
      await onCreated(asset);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : "an unknown error";
      window.alert(`"${asset.name}" was created but couldn't be fully linked/shown (${message}). Reload to see it.`);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <h2>{title ?? (hostedBy ? `Add asset hosted by ${hostedBy.name}` : "Add asset")}</h2>
          <button onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && <p className="dialog__error">{error}</p>}

        {selectedType ? (
          <AttributeForm
            type={selectedType}
            onSubmit={handleSubmit}
            // presetTypeId locks the dialog to one type — cancelling backs out of the whole dialog
            // rather than dropping into a type picker the caller never intended to offer.
            onCancel={presetTypeId ? onClose : () => setSelectedType(null)}
          />
        ) : presetTypeId && !error ? (
          <p>Loading…</p>
        ) : (
          // Falls back here both for the normal "no preset" case and for a failed preset-type
          // fetch (error is set, presetTypeId didn't resolve) — better to let the user pick a type
          // manually than get stuck on a spinner that will never resolve.
          <TypePicker onSelect={setSelectedType} />
        )}
      </div>
    </div>
  );
}
