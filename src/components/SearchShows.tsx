import React, { useState, useMemo, useEffect } from "react";
import { seedShows } from "../lib/mockData";

export default function SearchShows({ onPick, onStartNewForum }: {
  onPick: (showId: string) => void;
  onStartNewForum: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return seedShows.filter(s => s.name.toLowerCase().includes(q)).slice(0, 25);
  }, [query]);

  useEffect(() => { if (hi >= matches.length) setHi(0); }, [matches.length]);

  const choose = (idx: number) => {
    const m = matches[idx];
    if (!m) return;
    onPick(m.id);
    setQuery(m.name);
    setOpen(false);
  };

  return (
    <div className="splashSearchWrap">
      <span className="splashSearchIcon" aria-hidden>🔍</span>
      <input
        placeholder="find a show"
        className="badge splashSearch"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) setOpen(true);
          if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, Math.max(0, matches.length - 1))); }
          if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
          if (e.key === "Enter") { e.preventDefault(); if (matches.length) choose(hi); }
          if (e.key === "Escape") { setOpen(false); }
        }}
        aria-autocomplete="list"
        aria-expanded={open && !!query}
        aria-controls="search-suggest"
      />
      {open && !!query && (
        <div id="search-suggest" className="card dropdownPanel" role="listbox">
          {matches.length === 0 && <div className="muted">No matches</div>}
          {matches.map((m, idx) => (
            <div
              key={m.id}
              role="option"
              aria-selected={idx === hi}
              style={{ padding: "6px 8px", cursor: "pointer", background: idx === hi ? "rgba(0,255,255,.15)" : "transparent" }}
              onMouseEnter={() => setHi(idx)}
              onMouseDown={(e) => { e.preventDefault(); choose(idx); }}
            >
              {m.name}
            </div>
          ))}
          <div style={{ margin: "6px 0", borderTop: "1px solid var(--dos-border)" }} />
          <div style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
            <button className="btn" onMouseDown={(e) => { e.preventDefault(); onStartNewForum(query.trim()); setOpen(false); }}>
              Start a new forum
            </button>
          </div>
          <div className="muted" style={{ textAlign: "center", fontSize: 12, paddingBottom: 6 }}>
            Showing {matches.length} of {seedShows.length}
          </div>
        </div>
      )}
    </div>
  );
}
