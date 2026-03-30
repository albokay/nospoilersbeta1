import React from "react";
import { seedShows } from "../lib/mockData";

export default function YourShowsSelect({
  progress, value, onChange
}: { progress: Record<string, { s: number; e: number }>; value: string; onChange: (id: string) => void }) {
  const keys = Object.keys(progress);
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 12 }}>
        Your Shows
      </div>
      <select
        className="badge listPill"
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
      >
        <option value="" disabled>Select your show</option>
        {keys.map((id) => {
          const s = seedShows.find(x => x.id === id);
          return <option key={id} value={id}>{s?.name || id}</option>;
        })}
      </select>
    </div>
  );
}
