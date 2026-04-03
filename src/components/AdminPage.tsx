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
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {sortedFeedback.map((row, i) => {
              // Show a group header when the group changes
              const prevRow = sortedFeedback[i - 1];
              const showGroupHeader = i === 0 || groupLabel(row) !== groupLabel(prevRow);
              const isNew = !row.readAt && !row.status;

              return (
                <React.Fragment key={row.id}>
                  {showGroupHeader && (
                    <div style={{
                      fontSize: 11, fontWeight: 800, textTransform: "uppercase",
                      letterSpacing: 1, opacity: 0.55, marginTop: i === 0 ? 0 : 8,
                    }}>
                      {groupLabel(row)}
                    </div>
                  )}
                  <div className="card" style={{
                    padding: "14px 16px",
                    background: isNew ? "rgba(255,255,255,0.18)" : undefined,
                    position: "relative",
                  }}>
                    {/* Unread dot */}
                    {isNew && (
                      <div style={{
                        position: "absolute", top: 12, right: 12,
                        width: 10, height: 10, borderRadius: "50%",
                        background: "var(--green)",
                      }} />
                    )}

                    {/* Meta */}
                    <div style={{ marginBottom: 8, fontSize: 12, opacity: 0.7 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700 }}>@{row.username ?? "unknown"}</span>
                        <span>{timeAgo(row.createdAt)}</span>
                      </div>
                      {row.pageUrl && (
                        <div style={{ fontFamily: "monospace", marginTop: 2 }}>
                          📍 {row.pageUrl}
                        </div>
                      )}
                    </div>

                    {/* Message */}
                    <div style={{ fontSize: 15, lineHeight: 1.55, marginBottom: 14, whiteSpace: "pre-wrap" }}>
                      {row.message}
                    </div>

                    {/* Status checkboxes + delete */}
                    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                      {STATUS_LABELS.map(s => (
                        <label key={s} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 13, fontWeight: row.status === s ? 700 : 400 }}>
                          <input
                            type="checkbox"
                            checked={row.status === s}
                            onChange={() => handleFeedbackStatus(row.id, row.status === s ? null : s)}
                            style={{ cursor: "pointer" }}
                          />
                          {s}
                        </label>
                      ))}

                      <div style={{ marginLeft: "auto" }}>
                        {deletingId === row.id ? (
                          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <span style={{ fontSize: 12 }}>sure?</span>
                            <button
                              className="btn btn-danger"
                              style={{ fontSize: 11, padding: "3px 8px" }}
                              onClick={() => handleFeedbackDelete(row.id)}
                            >
                              yes, delete
                            </button>
                            <button
                              className="btn"
                              style={{ fontSize: 11, padding: "3px 8px" }}
                              onClick={() => setDeletingId(null)}
                            >
                              cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            className="btn btn-danger"
                            style={{ fontSize: 11, padding: "3px 8px" }}
                            onClick={() => setDeletingId(row.id)}
                          >
                            delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
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
