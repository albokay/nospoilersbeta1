import React from "react";
import type { Show } from "../lib/db";

export default function YourShowsSelect({
  shows, progress, value, onChange
}: { shows: Show[]; progress: Record<string, { s: number; e: number }>; value: string; onChange: (id: string) => void }) {
  const keys = Object.keys(progress);
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <select
        className="badge listPill"
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
      >
        <option value="" disabled>GO TO YOUR SHOW</option>
        {keys.map((id) => {
          const s = shows.find(x => x.id === id);
          return <option key={id} value={id}>{s?.name || id}</option>;
        })}
      </select>
    </div>
  );
}
