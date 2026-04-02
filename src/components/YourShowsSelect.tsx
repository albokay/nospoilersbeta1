import React from "react";
import type { Show } from "../lib/db";

export default function YourShowsSelect({
  shows, progress, value, onChange, compact
}: { shows: Show[]; progress: Record<string, { s: number; e: number }>; value: string; onChange: (id: string) => void; compact?: boolean }) {
  const keys = Object.keys(progress);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: compact ? "flex-end" : "center", width: compact ? "auto" : "100%" }}>
      <select
        className={compact ? "badge" : "badge listPill"}
        style={compact ? { width: "auto" } : undefined}
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
