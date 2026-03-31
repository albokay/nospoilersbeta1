import React, { useState } from "react";
import type { Show } from "../lib/db";
import { adminDeleteShow, adminToggleHidden } from "../lib/db";

export default function AdminPage({
  shows,
  onShowsChange,
  onShowDeleted,
  onClose,
}: {
  shows: Show[];
  onShowsChange: (shows: Show[]) => void;
  onShowDeleted?: (showId: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Show | null>(null);

  const sorted = [...shows].sort((a, b) => a.name.localeCompare(b.name));

  const handleToggleHidden = async (show: Show) => {
    setBusy(show.id);
    setError(null);
    try {
      await adminToggleHidden(show.id, !show.isHidden);
      onShowsChange(shows.map(s => s.id === show.id ? { ...s, isHidden: !s.isHidden } : s));
    } catch (e: any) {
      setError(e?.message ?? "Failed to update show.");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (show: Show) => {
    setBusy(show.id);
    setError(null);
    setConfirmDelete(null);
    try {
      await adminDeleteShow(show.id);
      onShowsChange(shows.filter(s => s.id !== show.id));
      onShowDeleted?.(show.id);
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete show.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="container" style={{ paddingBottom: 60 }}>
      <div className="stickybar bleed" style={{ top: 72 }}>
        <div className="container" style={{ padding: "10px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase" }}>
            Admin
          </div>
          <button className="btn h40" onClick={onClose}>← Back</button>
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Forums ({shows.length})</div>

        {error && (
          <div style={{ color: "var(--danger)", marginBottom: 12, fontSize: 14 }}>{error}</div>
        )}

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {sorted.map((show, i) => (
            <div
              key={show.id}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 16px",
                borderBottom: i < sorted.length - 1 ? "1px solid rgba(255,255,255,0.2)" : "none",
                opacity: busy === show.id ? 0.5 : 1,
              }}
            >
              {/* Show info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {show.name}
                  {show.isHidden && (
                    <span className="muted" style={{ fontSize: 12, marginLeft: 8, fontWeight: 400 }}>hidden</span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  id: {show.id}
                  {show.tvmazeId && ` · TVmaze: ${show.tvmazeId}`}
                  {show.status && ` · ${show.status}`}
                  {` · ${show.seasons.length} season${show.seasons.length !== 1 ? "s" : ""}`}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  disabled={busy === show.id}
                  onClick={() => handleToggleHidden(show)}
                >
                  {show.isHidden ? "Unhide" : "Hide"}
                </button>
                <button
                  className="btn btn-danger"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  disabled={busy === show.id}
                  onClick={() => setConfirmDelete(show)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}

          {sorted.length === 0 && (
            <div className="muted" style={{ padding: 16 }}>No forums yet.</div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div className="card" style={{
            background: "rgba(201,168,67,0.98)", border: "3px solid #fff",
            borderRadius: 24, padding: "24px 28px", maxWidth: 360, width: "92vw",
          }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>
              Delete "{confirmDelete.name}"?
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
              This will permanently delete the forum and all its posts and replies. This cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete)}>
                Delete forever
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
