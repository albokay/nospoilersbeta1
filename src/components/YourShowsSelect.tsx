import React from "react";
import type { Show } from "../lib/db";

export default function YourShowsSelect({
  shows, progress, value, onChange, compact, placeholder, wrapperStyle
}: { shows: Show[]; progress: Record<string, { s: number; e: number }>; value: string; onChange: (id: string) => void; compact?: boolean; placeholder?: string; wrapperStyle?: React.CSSProperties }) {
  const keys = Object.keys(progress).filter(id => shows.some(x => x.id === id));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: compact ? "flex-end" : "center", width: compact ? "auto" : "100%", ...wrapperStyle }}>
      <select
        className={compact ? "badge" : "badge listPill"}
        style={{ background: "#f45028", color: "#fff", border: "2px solid #f45028", textAlign: "center", textAlignLast: "center", ...(compact ? { width: "auto", padding: "5px 13px" } : { width: "100%" }) }}
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
      >
        <option value="" disabled>{placeholder ?? "switch shows"}</option>
        {keys.map((id) => {
          const s = shows.find(x => x.id === id);
          return <option key={id} value={id}>{s?.name || id}</option>;
        })}
      </select>
    </div>
  );
}
