import { useState } from "react";
import type { AttributeValue, ResolvedType } from "../api/types";

export interface AttributeFormProps {
  type: ResolvedType;
  onSubmit: (name: string, attributeValues: Record<string, AttributeValue>) => void;
  onCancel: () => void;
}

export function AttributeForm({ type, onSubmit, onCancel }: AttributeFormProps) {
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const attributeValues: Record<string, AttributeValue> = {};
    for (const attr of type.resolvedAttributes) {
      const raw = values[attr.key];
      if (raw === undefined || raw === "") continue;
      attributeValues[attr.key] = attr.dataType === "number" ? Number(raw) : attr.dataType === "boolean" ? raw === "true" : raw;
    }
    onSubmit(name, attributeValues);
  };

  return (
    <form className="attribute-form" onSubmit={handleSubmit}>
      <h3>New {type.name}</h3>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      {type.resolvedAttributes.map((attr) => (
        <label key={attr.key}>
          {attr.label}
          {attr.dataType === "boolean" ? (
            <select value={values[attr.key] ?? ""} onChange={(e) => setValue(attr.key, e.target.value)}>
              <option value="">—</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : attr.dataType === "enum" ? (
            <select value={values[attr.key] ?? ""} onChange={(e) => setValue(attr.key, e.target.value)}>
              <option value="">—</option>
              {attr.options?.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={attr.dataType === "number" ? "number" : "text"}
              value={values[attr.key] ?? ""}
              onChange={(e) => setValue(attr.key, e.target.value)}
            />
          )}
        </label>
      ))}

      <div className="attribute-form__actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit">Create</button>
      </div>
    </form>
  );
}
