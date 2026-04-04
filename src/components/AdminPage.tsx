import React, { useState, useEffect } from "react";
import type { Show, FeedbackRow } from "../lib/db";
import { adminDeleteShow, adminToggleHidden, fetchFeedback, updateFeedbackStatus, markFeedbackRead, deleteFeedback } from "../lib/db";
import { timeAgo } from "../lib/utils";

type FeedbackStatus = "will-do" | "consider" | "done" | "ignore";
const STATUS_LABELS: FeedbackStatus[] = ["will-do", "consider", "done", "ignore"];
const STATUS_ORDER: Record<string, number> = { "will-do": 0, "consider": 1, "done": 4, "ignore": 5 };

function sortFeedback(rows: FeedbackRow[]): FeedbackRow[] {
  return [...rows].sort((a, b) => {
    const aKey = a.status ? STATUS_ORDER[a.status] : (a.readAt ? 3 : 2);
    const bKey = b.status ? STATUS_ORDER[b.status] : (b.readAt ? 3 : 2);
    if (aKey !== bKey) return aKey - bKey;
    return b.createdAt - a.createdAt;
  });
}

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
  // ── Shows state ──────────────────────────────────────────────────────────
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

  // ── Feedback state ───────────────────────────────────────────────────────
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchFeedback()
      .then(rows => {
        setFeedback(rows);
        // Mark all currently unread as read
        const unreadIds = rows.filter(r => !r.readAt).map(r => r.id);
        if (unreadIds.length) markFeedbackRead(unreadIds).catch(() => {});
      })
      .catch(() => {})
      .finally(() => setFeedbackLoading(false));
  }, []);

  const handleFeedbackStatus = async (id: string, status: FeedbackStatus | null) => {
    await updateFeedbackStatus(id, status).catch(() => {});
    setFeedback(prev => prev.map(r => r.id === id ? { ...r, status } : r));
  };

  const handleFeedbackDelete = async (id: string) => {
    await deleteFeedback(id).catch(() => {});
    setFeedback(prev => prev.filter(r => r.id !== id));
    setDeletingId(null);
  };

  const sortedFeedback = sortFeedback(feedback);

  // Group label helper
  const groupLabel = (row: FeedbackRow): string => {
    if (row.status) return row.status;
    return row.readAt ? "unchecked" : "new";
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

      {/* ── Forums section ── */}
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

      {/* ── Feedback section ── */}
      <div style={{ marginTop: 48 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
          Feedback {!feedbackLoading && `(${feedback.length})`}
        </div>

        {feedbackLoading && <div className="muted">Loading…</div>}

        {!feedbackLoading && feedback.length === 0 && (
          <div className="muted">No feedback yet.</div>
        )}

        {!feedbackLoading && sortedFeedback.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{
              width: "100%", borderCollapse: "collapse",
              fontSize: 13, fontFamily: "monospace",
              background: "#fff", color: "#000",
            }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #999", textAlign: "left" }}>
                  <th style={{ padding: "6px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>user</th>
                  <th style={{ padding: "6px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>when</th>
                  <th style={{ padding: "6px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>page</th>
                  <th style={{ padding: "6px 10px", fontWeight: 700 }}>message</th>
                  <th style={{ padding: "6px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>status</th>
                  <th style={{ padding: "6px 10px" }}></th>
                </tr>
              </thead>
              <tbody>
                {sortedFeedback.map((row, i) => {
                  const isNew = !row.readAt && !row.status;
                  return (
                    <tr key={row.id} style={{
                      borderBottom: "1px solid #ddd",
                      background: isNew ? "#fffbe6" : i % 2 === 0 ? "#fff" : "#f9f9f9",
                      verticalAlign: "top",
                    }}>
                      <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                        {isNew && <span style={{ color: "green", marginRight: 4 }}>●</span>}
                        @{row.username ?? "—"}
                      </td>
                      <td style={{ padding: "6px 10px", whiteSpace: "nowrap", color: "#555" }}>
                        {timeAgo(row.createdAt)}
                      </td>
                      <td style={{ padding: "6px 10px", whiteSpace: "nowrap", color: "#555" }}>
                        {row.pageUrl ?? "—"}
                      </td>
                      <td style={{ padding: "6px 10px", whiteSpace: "pre-wrap", maxWidth: 420, fontFamily: "inherit", fontSize: 13 }}>
                        {row.message}
                      </td>
                      <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {STATUS_LABELS.map(s => (
                            <label key={s} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12 }}>
                              <input
                                type="checkbox"
                                checked={row.status === s}
                                onChange={() => handleFeedbackStatus(row.id, row.status === s ? null : s)}
                                style={{ cursor: "pointer" }}
                              />
                              {s}
                            </label>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                        {deletingId === row.id ? (
                          <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <span style={{ color: "#c00" }}>sure?</span>
                            <button onClick={() => handleFeedbackDelete(row.id)} style={{ fontSize: 11, cursor: "pointer", color: "#c00", background: "none", border: "1px solid #c00", borderRadius: 3, padding: "1px 6px" }}>yes</button>
                            <button onClick={() => setDeletingId(null)} style={{ fontSize: 11, cursor: "pointer", background: "none", border: "1px solid #999", borderRadius: 3, padding: "1px 6px" }}>no</button>
                          </span>
                        ) : (
                          <button onClick={() => setDeletingId(row.id)} style={{ fontSize: 11, cursor: "pointer", color: "#c00", background: "none", border: "none", padding: 0, textDecoration: "underline" }}>
                            delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete show confirmation */}
      {confirmDelete && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div className="card" style={{
            background: "var(--dos-bg)", border: "3px solid #fff",
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
