/**
 * InviteShowSuggest — the invite wall's "Do you want to suggest shows too?"
 * block (Alborz, 2026-08-01). Rendered on BOTH invite arrivals (desktop
 * PublicDashboardPage wall / MobileGroupInviteAccept), logged-out.
 *
 * Search = the site catalog (anon-readable) + debounced TVMaze for shows we
 * don't have — the onboarding search's exact behavior, but ADDITIVE: each
 * result row carries a "+", picking appends a chip and re-arms the search
 * for another. Nothing is written here (no account yet): picks park in
 * localStorage per invite token (lib/invitePicks) and are claimed as real
 * group proposals right after the invite is accepted.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { fetchShows, type Show } from "../lib/db";
import { tvmazeSearch, networkLabel, slugify, type TVmazeShow } from "../lib/tvmaze";
import { readInvitePicks, parkInvitePicks, type InviteShowPick } from "../lib/invitePicks";
import { CANON } from "../styles/canon";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

export default function InviteShowSuggest({ token, idiom }: { token: string; idiom: "desktop" | "mobile" }) {
  const mobile = idiom === "mobile";
  const [shows, setShows] = useState<Show[]>([]);
  const [query, setQuery] = useState("");
  const [tvResults, setTvResults] = useState<TVmazeShow[]>([]);
  const [picks, setPicks] = useState<InviteShowPick[]>(() => readInvitePicks(token));
  const tvDebounceRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchShows().then((rows) => { if (!cancelled) setShows(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Catalog matches + debounced TVMaze lookup — the onboarding search's
  // behavior (SocialOnboarding), minus anything that writes.
  const pickedIds = useMemo(
    () => new Set(picks.map((p) => (p.kind === "catalog" ? p.id : slugify(p.name)))),
    [picks],
  );
  const catalogMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return shows.filter((s) => !s.isHidden && !pickedIds.has(s.id) && s.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, shows, pickedIds]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setTvResults([]); return; }
    if (tvDebounceRef.current) window.clearTimeout(tvDebounceRef.current);
    let cancelled = false;
    tvDebounceRef.current = window.setTimeout(async () => {
      try {
        const r = await tvmazeSearch(q);
        if (!cancelled) setTvResults(r);
      } catch { if (!cancelled) setTvResults([]); }
    }, 320);
    return () => { cancelled = true; if (tvDebounceRef.current) window.clearTimeout(tvDebounceRef.current); };
  }, [query]);

  const tvToAdd = useMemo(() => {
    const known = new Set(shows.map((s) => s.id));
    const seen = new Set<string>();
    const out: { tv: TVmazeShow; id: string }[] = [];
    for (const tv of tvResults) {
      const id = slugify(tv.name);
      if (known.has(id) || seen.has(id) || pickedIds.has(id)) continue;
      seen.add(id);
      out.push({ tv, id });
      if (out.length >= 6) break;
    }
    return out;
  }, [tvResults, shows, pickedIds]);

  function commit(next: InviteShowPick[]) {
    setPicks(next);
    parkInvitePicks(token, next); // park on EVERY change — the join hop leaves this page
  }
  function addPick(p: InviteShowPick) {
    commit([...picks, p]);
    setQuery("");
    setTvResults([]);
  }
  function removePick(i: number) {
    commit(picks.filter((_, j) => j !== i));
  }

  return (
    <div style={{ textAlign: "center", marginTop: mobile ? 48 : 72 }}>
      <h2 style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 24 : 34, letterSpacing: 0, color: CANON.cream, margin: "0 0 4px" }}>
        Do you want to suggest shows too?
      </h2>
      <div style={{ color: CANON.cream, fontSize: mobile ? 13 : 15, marginBottom: 20 }}>(You can also do this later.)</div>

      {picks.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10, margin: "0 auto 16px", maxWidth: 560 }}>
          {picks.map((p, i) => (
            <span key={i} style={chip}>
              {p.name}
              <button aria-label={`remove ${p.name}`} style={chipX} onClick={() => removePick(i)}><X size={14} /></button>
            </span>
          ))}
        </div>
      )}

      <div style={{ ...searchCard, width: mobile ? "min(340px, 88vw)" : 380 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="find a show"
          style={searchInput}
        />
        {(catalogMatches.length > 0 || tvToAdd.length > 0) && (
          <div style={{ marginTop: 8, textAlign: "left" }}>
            {catalogMatches.map((s) => (
              <button key={s.id} style={resultRow} onClick={() => addPick({ kind: "catalog", id: s.id, name: s.name })}>
                <span style={resultName}>{s.name}</span><Plus size={16} strokeWidth={2.5} />
              </button>
            ))}
            {tvToAdd.map(({ tv, id }) => (
              <button key={id} style={resultRow} onClick={() => addPick({ kind: "tv", tvmazeId: tv.id, name: tv.name, status: tv.status })}>
                <span style={resultName}>{tv.name}{networkLabel(tv) ? ` · ${networkLabel(tv)}` : ""}</span><Plus size={16} strokeWidth={2.5} />
              </button>
            ))}
          </div>
        )}
        {query.trim().length >= 2 && catalogMatches.length === 0 && tvToAdd.length === 0 && (
          <div style={{ padding: "12px 16px", fontSize: 13, color: CANON.dark, opacity: 0.6, textAlign: "left" }}>searching&hellip;</div>
        )}
      </div>
    </div>
  );
}

// Self-contained styles — the wall pages each carry their own scoped CSS, so
// this block depends on none of it.
const searchCard: React.CSSProperties = {
  margin: "0 auto", background: CANON.cream, borderRadius: 15, padding: 10, boxSizing: "border-box",
  boxShadow: "0 8px 24px rgba(0,0,0,0.12)", textAlign: "center",
};
const searchInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `2px solid ${CANON.friend}`, borderRadius: 12,
  padding: "12px 14px", fontFamily: '"Inter", sans-serif', fontSize: 16, color: CANON.dark, outline: "none",
};
const resultRow: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  width: "100%", textAlign: "left", border: "none", background: "transparent",
  padding: "12px 16px", borderRadius: 12, cursor: "pointer",
  fontFamily: '"Inter", sans-serif', fontSize: 14, fontWeight: 600, color: CANON.personal,
};
const resultName: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const chip: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  border: `2px solid ${CANON.cream}`, color: CANON.cream, background: "transparent",
  borderRadius: 65, padding: "10px 12px 10px 20px",
  fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: -0.5,
};
const chipX: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  border: "none", background: "transparent", color: CANON.cream, cursor: "pointer", padding: 2,
};
