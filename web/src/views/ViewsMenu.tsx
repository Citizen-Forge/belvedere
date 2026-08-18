import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { SavedView } from "../api/types";

export interface ViewsMenuProps {
  onSave: (name: string) => Promise<void>;
  onLoad: (viewId: string) => void;
  onReset: () => void;
}

function messageFor(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : "Something went wrong.";
}

/** Save the current canvas layout, or load a previously-saved one. */
export function ViewsMenu({ onSave, onLoad, onReset }: ViewsMenuProps) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api.listViews().then(setViews, (cause) => setError(messageFor(cause)));
  }, [open]);

  const handleSave = async () => {
    const name = window.prompt("Name this view:");
    if (!name) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(name);
      setViews(await api.listViews());
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await api.deleteView(id);
      setViews(await api.listViews());
    } catch (cause) {
      setError(messageFor(cause));
    }
  };

  return (
    <div className="views-menu">
      <button onClick={() => setOpen((v) => !v)}>Views ▾</button>
      {open && (
        <div className="views-menu__dropdown">
          <button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save current layout…"}
          </button>
          <button
            onClick={() => {
              onReset();
              setOpen(false);
            }}
          >
            Reset to physical overview
          </button>
          {error && <p className="views-menu__error">{error}</p>}
          <hr />
          {views.length === 0 && <p className="views-menu__empty">No saved views yet.</p>}
          {views.map((view) => (
            <div key={view.id} className="views-menu__item">
              <button
                onClick={() => {
                  onLoad(view.id);
                  setOpen(false);
                }}
              >
                {view.name}
              </button>
              <button onClick={() => handleDelete(view.id)} aria-label={`Delete ${view.name}`}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
