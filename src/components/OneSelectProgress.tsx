import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import Modal from "./Modal";
import { buildProgressOptions } from "../lib/utils";

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
  return `S${String(s).padStart(2, "0")} E${String(e).padStart(2, "0")}`;
}

export default function OneSelectProgress({
  show, value, onConfirm, onPendingChange, requireConfirm = true, onChangeSelected, compactLabel
}: {
  show: any;
  value: any;
  onConfirm: (v: { s: number; e: number }) => void;
  onPendingChange?: (b: boolean) => void;
  requireConfirm?: boolean;
  onChangeSelected?: (v: { s: number; e: number }) => void;
  compactLabel?: string;
}) {
  const opts = buildProgressOptions(show);
  const currentId = `${value?.s || 1}-${value?.e || 1}`;
  const [selectedId, setSelectedId] = useState(currentId);
  const [pending, setPending] = useState<{ id: string; s: number; e: number; backwards?: boolean } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { setSelectedId(currentId); setPending(null); setConfirmOpen(false); onPendingChange?.(false); }, [currentId]);

  function onSelect(ev: React.ChangeEvent<HTMLSelectElement>) {
    const nextId = String(ev.target.value);
    const [sStr, eStr] = nextId.split("-");
    const next = { id: nextId, s: Number(sStr), e: Number(eStr) };

    const curS = value?.s ?? 1;
    const curE = value?.e ?? 1;

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
  const shortEp = epLabel(value?.s || 1, value?.e || 1);

  // Compact (mobile) button that opens a picker modal
  if (compactLabel) {
    return (
      <>
        <button
          className="btn"
          style={{ whiteSpace: "nowrap", background: "var(--progress-bg,#adc8d7)", color: "var(--progress-fg,#355eb8)", border: "2px solid var(--progress-bg,#adc8d7)", fontSize: 12, padding: "5px 9px", lineHeight: 1.2, fontWeight: 700 }}
          onClick={() => setMobileOpen(true)}
        >
          {compactLabel} ▾
        </button>
        {mobileOpen && (
          <Modal onClose={() => setMobileOpen(false)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <h3 className="title" style={{ fontSize: 20, margin: 0 }}>you've watched: {pending ? epLabel(pending.s, pending.e) : ""}</h3>
              <button className="close-x" onClick={() => setMobileOpen(false)}><X size={14} /></button>
            </div>
            <select
              className="badge"
              value={selectedId}
              onChange={(e) => { onSelect(e); setMobileOpen(false); }}
              style={{ background: "var(--progress-bg,#adc8d7)", color: "var(--progress-fg,#355eb8)", border: "2px solid var(--progress-bg,#adc8d7)", width: "100%", height: 40 }}
              size={1}
            >
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
          <Modal onClose={cancelSelection}>
            <div style={{ marginBottom: 12 }}>
              <h3 className="title" style={{ fontSize: 20, margin: 0 }}>you've watched: {pending ? epLabel(pending.s, pending.e) : ""}</h3>
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

  return (
    <>
      <select
        className="badge h40"
        value={selectedId}
        onChange={onSelect}
        style={{ background: "var(--progress-bg,#adc8d7)", color: "var(--progress-fg,#355eb8)", border: "2px solid var(--progress-bg,#adc8d7)", fontWeight: 700, fontSize: 12, textAlign: "center", textAlignLast: "center" }}
      >
        {groups.map((g) => (
          <optgroup key={g.season} label={`Season ${g.season}`}>
            {g.episodes.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {`you've watched: ${epLabel(ep.s, ep.e)}`}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {requireConfirm && confirmOpen && (
        <Modal onClose={cancelSelection}>
          <div style={{ marginBottom: 12 }}>
            <h3 className="title" style={{ fontSize: 20, margin: 0 }}>you've watched: {pending ? epLabel(pending.s, pending.e) : ""}</h3>
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
