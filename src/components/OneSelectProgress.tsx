import React, { useState, useEffect } from "react";
import Modal from "./Modal";
import { buildProgressOptions } from "../lib/utils";

export default function OneSelectProgress({
  show, value, onConfirm, onPendingChange, requireConfirm = true, onChangeSelected
}: {
  show: any;
  value: any;
  onConfirm: (v: { s: number; e: number }) => void;
  onPendingChange?: (b: boolean) => void;
  requireConfirm?: boolean;
  onChangeSelected?: (v: { s: number; e: number }) => void;
}) {
  const opts = buildProgressOptions(show);
  const currentId = `${value?.s || 1}-${value?.e || 1}`;
  const [selectedId, setSelectedId] = useState(currentId);
  const [pending, setPending] = useState<{ id: string; s: number; e: number; backwards?: boolean } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontStyle: "italic", fontWeight: 700, color: "black" }}>
        <select
          className="badge h40"
          value={selectedId}
          onChange={onSelect}
          style={{ background: "white", color: "black" }}
        >
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {requireConfirm && confirmOpen && (
        <Modal onClose={cancelSelection}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <h3 className="title" style={{ fontSize: 20, margin: 0 }}>ARE YOU SURE?</h3>
            <button className="btn" onClick={cancelSelection}>✕</button>
          </div>

          {pending?.backwards ? (
            <>
              <br />
              <p style={{ marginTop: 0, fontWeight: 700 }}>*HEADS UP BETA-TESTER*</p>
              <p className="muted" style={{ marginTop: 4 }}>
                In a live version of the site, users would not be able to turn their watch
                progress backward — I don't think there is a legitimate reason to do so.
                Restricting the ability to turn back the clock will make it more difficult
                for trolls to troll.
                <br /><br />
                But for the purposes of beta-testing, you can flip back and forth at will.
              </p>
            </>
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>
              <br />Updating your watch progress will change which posts and replies you can see.
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button className="btn btn-danger" onClick={cancelSelection}>No</button>
            <button className="btn btn-danger" onClick={confirmSelection}>Yes</button>
          </div>
        </Modal>
      )}
    </>
  );
}
