import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ResolvedType } from "../api/types";

export interface TypePickerProps {
  onSelect: (type: ResolvedType) => void;
}

/** Breadcrumb drill-down through the type library, from the three roots down to any descendant. */
export function TypePicker({ onSelect }: TypePickerProps) {
  const [path, setPath] = useState<ResolvedType[]>([]);
  const [level, setLevel] = useState<ResolvedType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    const parent = path[path.length - 1];
    const load = parent ? api.listChildTypes(parent.id) : api.listRootTypes();
    load.then((types) => {
      // Guards against out-of-order responses if the user drills through several levels quickly.
      if (ignore) return;
      setLevel(types);
      setLoading(false);
    });
    return () => {
      ignore = true;
    };
  }, [path]);

  const drillInto = (type: ResolvedType) => setPath((prev) => [...prev, type]);
  const jumpTo = (index: number) => setPath((prev) => prev.slice(0, index + 1));
  const goToRoot = () => setPath([]);

  return (
    <div className="type-picker">
      <div className="type-picker__breadcrumbs">
        <button onClick={goToRoot}>Root</button>
        {path.map((type, i) => (
          <span key={type.id}>
            {" / "}
            <button onClick={() => jumpTo(i)}>{type.name}</button>
          </span>
        ))}
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <ul className="type-picker__list">
          {level.map((type) => (
            <li key={type.id}>
              <span>{type.name}</span>
              <button onClick={() => drillInto(type)}>Browse ▸</button>
              <button onClick={() => onSelect(type)}>Use this type</button>
            </li>
          ))}
          {level.length === 0 && <li className="type-picker__empty">No subtypes here.</li>}
        </ul>
      )}
    </div>
  );
}
