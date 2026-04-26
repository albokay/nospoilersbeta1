import React, { useState, useEffect } from "react";
import { X, ChevronDown } from "lucide-react";
import Modal from "./Modal";
import { buildProgressOptions, isZeroProgress } from "../lib/utils";

const ZERO_ID = "0-0";
const ZERO_LABEL = "haven't started";

function buildGroupedOptions(show: { seasons?: number[] }) {
  const seasons = show?.seasons || [];
  const groups: { season: number; episodes: { id: string; s: number; e: number }[] }[] = [];
  for (let s = 1; s <= seasons.length; s++) {
    const eMax = seasons[s - 1] || 1;
    const episodes = [];
    for (let e = 1; e <= eMax; e++) {
      episodes.push({ id: `${s}-${e}`, s, e });
    }
    groups.push({ season: s, episodes });
  }
  return groups;
}

function epLabel(s: number, e: number) {
  if (s === 0 && e === 0) return ZERO_LABEL;
  return `S${String(s).padStart(2, "0")} E${String(e).padStart(2, "0")}`;
}

// Returns true when (s, e) is ≤ the previous highest — i.e. the user is
// still within the territory they've already seen before on this show.
function isWithinPreviousHighest(s: number, e: number, highest?: { s: number; e: number } | null) {
  if (!highest) return false;
  if (s < highest.s) return true;
  if (s === highest.s && e <= highest.e) return true;
  return false;
}

export default function OneSelectProgress({
  show, value, onConfirm, onPendingChange, requireConfirm = true, onChangeSelected, compactLabel, allowZero = false, rewatchHighest, plain = false, pillBg
}: {
  show: any;
  value: any;
  onConfirm: (v: { s: number; e: number }) => void;
  onPendingChange?: (b: boolean) => void;
  requireConfirm?: boolean;
  onChangeSelected?: (v: { s: number; e: number }) => void;
  compactLabel?: string;
  allowZero?: boolean;
  // When the user is rewatching a show, pass the previous highest point.
  // Options ≤ this get "you rewatched: " labels; options past it revert
  // to "you've watched: " because the user would be entering genuinely
  // new territory (and crossing out of rewatch mode).
  rewatchHighest?: { s: number; e: number } | null;
  // When true, render as a minimal white select ("Season X Episode X" labels,
  // no green pill styling). Matches the other in-modal EpisodeSelectInline
  // pickers so modals have a consistent dropdown flavor.
  plain?: boolean;
  // Override the default pill bg color (#7abd8e canon-green). Used by
  // ProfilePage's filter-as-destination theming pass: when the diary
  // surface flips per filter, the picker bg should track it so the
  // picker reads as a ghost on the new surface (canon-light-blue on
  // friends, canon-yellow on public). Default keeps the canon-green
  // pill for every other callsite (ShowSection, mobile, etc.).
  pillBg?: string;
}) {
  const effectivePillBg = pillBg ?? "#7abd8e";
  const opts = buildProgressOptions(show);
  const curS = value?.s ?? 1;
  const curE = value?.e ?? 1;
  const currentId = `${curS}-${curE}`;
  const [selectedId, setSelectedId] = useState(currentId);
  const [pending, setPending] = useState<{ id: string; s: number; e: number; backwards?: boolean } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { setSelectedId(currentId); setPending(null); setConfirmOpen(false); onPendingChange?.(false); }, [currentId]);

  // Defense-in-depth: the zero option is monotonic. Once the user is past zero,
  // it must never be offered again, even if a caller passes allowZero={true}.
  const showZeroOption = allowZero && curS === 0 && curE === 0;

  // Prefix helper for an option label. Rewatching users see "you rewatched: "
  // for options within their previous highest, and "you've watched: " past it.
  function optionPrefix(s: number, e: number) {
    if (rewatchHighest && isWithinPreviousHighest(s, e, rewatchHighest)) {
      return "you REwatched: ";
    }
    return "you've watched: ";
  }

  function onSelect(ev: React.ChangeEvent<HTMLSelectElement>) {
    const nextId = String(ev.target.value);
    const [sStr, eStr] = nextId.split("-");
    const next = { id: nextId, s: Number(sStr), e: Number(eStr) };

    const backwards = (next.s < curS) || (next.s === curS && next.e < curE);

    setSelectedId(nextId);
    setPending({ ...next, backwards });
    onPendingChange?.(true);
    onChangeSelected?.({ s: next.s, e: next.e });
    if (requireConfirm) setConfirmOpen(true);
  }

  function confirmSelection() {
    if (pending) {
      onConfirm({ s: pending.s, e: pending.e });
      window.dispatchEvent(new CustomEvent("dock:progress", { detail: { showId: "bb", s: pending.s, e: pending.e } }));
      setPending(null);
      onPendingChange?.(false);
      setConfirmOpen(false);
    }
  }
  function cancelSelection() {
    setSelectedId(currentId);
    setPending(null);
    onPendingChange?.(false);
    setConfirmOpen(false);
  }

  const groups = buildGroupedOptions(show);
  const shortEp = epLabel(curS, curE);
  const currentIsRewatch = !!rewatchHighest && isWithinPreviousHighest(curS, curE, rewatchHighest);
  const selectedLabelPrefix = currentIsRewatch ? "you REwatched: " : "you've watched: ";

  // Compact (mobile) button that opens a picker modal
  if (compactLabel) {
    return (
      <>
        <button
          className="btn progress-control"
          style={{ whiteSpace: "nowrap", background: effectivePillBg, color: "#fff", border: "2px solid #fff", fontSize: 12, padding: "5px 9px", lineHeight: 1.2, fontWeight: 700 }}
          onClick={() => setMobileOpen(true)}
        >
          {compactLabel} ▾
        </button>
        {mobileOpen && (
          <Modal onClose={() => setMobileOpen(false)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <h3 className="title" style={{ fontSize: 20, margin: 0 }}>{selectedLabelPrefix}{pending ? epLabel(pending.s, pending.e) : ""}</h3>
              <button className="close-x" onClick={() => setMobileOpen(false)}><X size={14} /></button>
            </div>
            <select
              className="badge progress-control"
              value={selectedId}
              onChange={(e) => { onSelect(e); setMobileOpen(false); }}
              style={{ background: effectivePillBg, color: "#fff", border: "2px solid #fff", width: "100%", height: 40 }}
              size={1}
            >
              {showZeroOption && (
                <option value={ZERO_ID}>{ZERO_LABEL}</option>
              )}
              {groups.map((g) => (
                <optgroup key={g.season} label={`Season ${g.season}`}>
                  {g.episodes.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {epLabel(ep.s, ep.e)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Modal>
        )}
        {requireConfirm && confirmOpen && (
          <Modal onClose={cancelSelection} cardStyle={pending?.backwards ? { background: "#f45028" } : undefined}>
            <div style={{ marginBottom: 12 }}>
              <h3 className="title" style={{ fontSize: 20, margin: 0 }}>{pending ? `${optionPrefix(pending.s, pending.e)}${epLabel(pending.s, pending.e)}` : ""}</h3>
            </div>
            <p className="muted" style={{ marginTop: 0, marginBottom: 0, fontSize: 14 }}>
              Your feed will only show posts up to your selected episode.
            </p>
            {pending?.backwards && (
              <>
                <p style={{ marginTop: 12, marginBottom: 0, fontWeight: 700 }}>*HEADS UP BETA-TESTER*</p>
                <p className="muted" style={{ marginTop: 4, marginBottom: 0 }}>
                  In a live version of the site, users would not be able to turn their watch
                  progress backward. But for beta-testing, you can flip back and forth at will.
                </p>
              </>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button className="btn" onClick={cancelSelection}>Cancel</button>
              <button className="btn" onClick={confirmSelection}>Confirm</button>
            </div>
          </Modal>
        )}
      </>
    );
  }

  const selectElement = (
    <select
      className={plain ? "" : "badge h40 progress-control"}
      value={selectedId}
      onChange={onSelect}
      style={plain
        ? {
            background: "#fff", color: "#000",
            border: "1px solid var(--dos-border)", borderRadius: 6,
            padding: "4px 8px", fontSize: 13, width: "100%",
          }
        // Non-plain (default pill) path always strips the native arrow and
        // reserves right-padding for the overlay ChevronDown rendered below.
        // Keeps the affordance consistent across browsers (Safari in
        // particular hides the native arrow at this font-size + padding).
        : { background: effectivePillBg, color: "#fff", border: "2px solid #fff", fontWeight: 700, fontSize: 12, textAlign: "center", textAlignLast: "center", appearance: "none", WebkitAppearance: "none", MozAppearance: "none", paddingRight: 28 }
      }
    >
      {showZeroOption && (
        <option value={ZERO_ID}>{plain ? "Haven't started" : ZERO_LABEL}</option>
      )}
      {groups.map((g) => (
        <optgroup key={g.season} label={`Season ${g.season}`}>
          {g.episodes.map((ep) => (
            <option key={ep.id} value={ep.id}>
              {plain
                ? `Season ${ep.s} Episode ${ep.e}`
                : `${optionPrefix(ep.s, ep.e)}${epLabel(ep.s, ep.e)}`}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  return (
    <>
      {plain ? (
        selectElement
      ) : (
        <span style={{ position: "relative", display: "inline-block" }}>
          {selectElement}
          <ChevronDown
            size={14}
            color="#fff"
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
          />
        </span>
      )}

      {requireConfirm && confirmOpen && (
        <Modal onClose={cancelSelection} cardStyle={pending?.backwards ? { background: "#f45028" } : undefined}>
          <div style={{ marginBottom: 12 }}>
            <h3 className="title" style={{ fontSize: 20, margin: 0 }}>{pending ? `${optionPrefix(pending.s, pending.e)}${epLabel(pending.s, pending.e)}` : ""}</h3>
          </div>

          <p className="muted" style={{ marginTop: 0, marginBottom: 0, fontSize: 14 }}>
            Your feed will only show posts up to your selected episode.
          </p>

          {pending?.backwards && (
            <>
              <p style={{ marginTop: 12, marginBottom: 0, fontWeight: 700 }}>*HEADS UP BETA-TESTER*</p>
              <p className="muted" style={{ marginTop: 4, marginBottom: 0 }}>
                In a live version of the site, users would not be able to turn their watch
                progress backward. But for beta-testing, you can flip back and forth at will.
              </p>
            </>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
            <button className="btn" onClick={cancelSelection}>Cancel</button>
            <button className="btn" onClick={confirmSelection}>Confirm</button>
          </div>
        </Modal>
      )}
    </>
  );
}
