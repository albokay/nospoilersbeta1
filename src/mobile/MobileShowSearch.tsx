import React, { useEffect, useRef, useState } from "react";
import { Search, Tv } from "lucide-react";
import LoadingDots from "../components/LoadingDots";

// Reusable mobile show-search component. Wraps TVMaze search + result
// list rendering. Used by:
//
//   <MobileRooms />     (find-a-show field at the bottom of the room list)
//   <MobileRoomMenu />  (find-a-show section inside the S7 dropdown)
//
// The TVMaze helpers (tvmazeSearch, networkLabel) are exported alongside
// because the third caller appearing was the trigger to consolidate them.
// Mobile-internal — desktop keeps its own copies inside SearchShows.tsx
// to avoid a cross-surface refactor here.

export type TVmazeShow = {
  id: number;
  name: string;
  network?: { name: string } | null;
  webChannel?: { name: string } | null;
  premiered?: string | null;
};

export async function tvmazeSearch(q: string): Promise<TVmazeShow[]> {
  const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data ?? []).map((r: any) => r.show).filter(Boolean);
}

export function networkLabel(s: TVmazeShow): string {
  const net = s.network?.name || s.webChannel?.name || "";
  const year = s.premiered ? s.premiered.slice(0, 4) : "";
  return [net, year].filter(Boolean).join(", ");
}

export default function MobileShowSearch({
  placeholder = "Search a TV show…",
  onPickResult,
}: {
  placeholder?: string;
  onPickResult: (tv: TVmazeShow) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TVmazeShow[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced TVMaze fetch (320ms — matches the desktop SearchShows
  // pattern at SearchShows.tsx:208).
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setLoading(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await tvmazeSearch(q);
        if (cancelled) return;
        setResults(r.slice(0, 8));
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 320);
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div>
      <div style={{ position: "relative" }}>
        <Search
          size={18}
          style={{
            position: "absolute",
            left: 14, top: "50%", transform: "translateY(-50%)",
            opacity: 0.55,
            pointerEvents: "none",
          }}
        />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="words"
          autoCorrect="off"
          style={{
            width: "100%",
            padding: "14px 14px 14px 40px",
            fontSize: 16,
            fontFamily: "inherit",
            border: "2px solid rgba(255,255,255,0.4)",
            borderRadius: 10,
            background: "rgba(255,255,255,0.08)",
            color: "#fff",
            outline: "none",
            boxSizing: "border-box",
            WebkitAppearance: "none",
          }}
        />
      </div>

      {query.trim() !== "" && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {loading ? (
            <div style={{ padding: "12px 4px", fontSize: 13, opacity: 0.85 }}>
              Searching<LoadingDots />
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: "12px 4px", fontSize: 13, opacity: 0.7 }}>
              No results for &ldquo;{query.trim()}&rdquo;.
            </div>
          ) : (
            results.map(tv => (
              <button
                key={tv.id}
                onClick={() => onPickResult(tv)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "rgba(255,255,255,0.95)",
                  color: "var(--dos-bg, #2a4a36)",
                  border: "none",
                  borderRadius: 10,
                  padding: "12px 14px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  fontFamily: "inherit",
                }}
              >
                <div style={{
                  flexShrink: 0,
                  width: 32, height: 32,
                  borderRadius: 8,
                  background: "rgba(0,0,0,0.06)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Tv size={16} strokeWidth={2} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14,
                    fontWeight: 700,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {tv.name}
                  </div>
                  {networkLabel(tv) && (
                    <div style={{
                      fontSize: 11,
                      opacity: 0.65,
                      marginTop: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {networkLabel(tv)}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
