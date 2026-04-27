import React, { useState, useEffect, useMemo } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import type { Show, FeedbackRow, PromptRow, AdminUserOverviewRow, AdminUserActivityRow } from "../lib/db";
import { adminDeleteShow, adminToggleHidden, fetchFeedback, updateFeedbackStatus, markFeedbackRead, deleteFeedback, fetchAllPrompts, togglePromptActive, deletePrompt, updatePrompt, createPrompt, fetchAdminUserOverview, fetchAdminUserActivity } from "../lib/db";
import { timeAgo } from "../lib/utils";

// Section ids used for the collapse-state map. Default collapsed for all
// (per-spec); persisted to localStorage so the panel remembers.
type AdminSectionId = "forums" | "feedback" | "prompts" | "activity";
const ADMIN_SECTION_IDS: AdminSectionId[] = ["forums", "feedback", "prompts", "activity"];
const ADMIN_COLLAPSE_KEY = "ns_admin_section_expanded";

// Activity overview sort state. `key` indexes the sort column; `dir` is the
// direction. Default: lastActivity DESC NULLS LAST.
type ActivitySortKey =
  | "username" | "email" | "signupAt" | "lastSignInAt"
  | "roomsCount" | "distinctCoMembers" | "invitesSent"
  | "threadsCount" | "threadsCountTsp" | "repliesCount" | "repliesCountTsp"
  | "postsPerWeek" | "lastActivityAt";
type ActivitySortDir = "asc" | "desc";

function loadCollapseState(): Record<AdminSectionId, boolean> {
  // Default ALL collapsed on first load.
  const defaults: Record<AdminSectionId, boolean> = {
    forums: false, feedback: false, prompts: false, activity: false,
  };
  try {
    const raw = localStorage.getItem(ADMIN_COLLAPSE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      forums:   typeof parsed.forums   === "boolean" ? parsed.forums   : false,
      feedback: typeof parsed.feedback === "boolean" ? parsed.feedback : false,
      prompts:  typeof parsed.prompts  === "boolean" ? parsed.prompts  : false,
      activity: typeof parsed.activity === "boolean" ? parsed.activity : false,
    };
  } catch {
    return defaults;
  }
}

function compareNullable<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  cmp: (x: T, y: T) => number,
  dir: ActivitySortDir
): number {
  // NULLS LAST regardless of direction (matches the SQL ORDER BY default).
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const raw = cmp(a as T, b as T);
  return dir === "asc" ? raw : -raw;
}

function sortActivityRows(rows: AdminUserOverviewRow[], key: ActivitySortKey, dir: ActivitySortDir): AdminUserOverviewRow[] {
  const copy = [...rows];
  const numCmp = (x: number, y: number) => x - y;
  const strCmp = (x: string, y: string) => x.localeCompare(y);
  copy.sort((a, b) => {
    switch (key) {
      case "username":          return compareNullable(a.username, b.username, strCmp, dir);
      case "email":             return compareNullable(a.email, b.email, strCmp, dir);
      case "signupAt":          return compareNullable(a.signupAt, b.signupAt, numCmp, dir);
      case "lastSignInAt":      return compareNullable(a.lastSignInAt, b.lastSignInAt, numCmp, dir);
      case "roomsCount":        return compareNullable(a.roomsCount, b.roomsCount, numCmp, dir);
      case "distinctCoMembers": return compareNullable(a.distinctCoMembers, b.distinctCoMembers, numCmp, dir);
      case "invitesSent":       return compareNullable(a.invitesSent, b.invitesSent, numCmp, dir);
      case "threadsCount":      return compareNullable(a.threadsCount, b.threadsCount, numCmp, dir);
      case "threadsCountTsp":   return compareNullable(a.threadsCountTsp, b.threadsCountTsp, numCmp, dir);
      case "repliesCount":      return compareNullable(a.repliesCount, b.repliesCount, numCmp, dir);
      case "repliesCountTsp":   return compareNullable(a.repliesCountTsp, b.repliesCountTsp, numCmp, dir);
      case "postsPerWeek":      return compareNullable(a.postsPerWeek, b.postsPerWeek, numCmp, dir);
      case "lastActivityAt":    return compareNullable(a.lastActivityAt, b.lastActivityAt, numCmp, dir);
    }
  });
  return copy;
}

function fmtDateShort(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" });
}

function fmtDateTimeShort(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

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
  // ── Section collapse state ───────────────────────────────────────────────
  // Default: all sections collapsed on first load. Persisted to localStorage
  // so the panel remembers across admin visits.
  const [expanded, setExpanded] = useState<Record<AdminSectionId, boolean>>(loadCollapseState);
  const toggleSection = (id: AdminSectionId) => {
    setExpanded(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(ADMIN_COLLAPSE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

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
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchFeedback()
      .then(rows => {
        setFeedback(rows);
        setFeedbackError(null);
        // Mark all currently unread as read
        const unreadIds = rows.filter(r => !r.readAt).map(r => r.id);
        if (unreadIds.length) markFeedbackRead(unreadIds).catch(err => {
          console.error("[admin] markFeedbackRead failed:", err);
        });
      })
      .catch(err => {
        console.error("[admin] fetchFeedback failed:", err);
        setFeedbackError(err?.message ?? String(err));
      })
      .finally(() => setFeedbackLoading(false));
  }, []);

  // ── Activity (per-user overview) state ───────────────────────────────────
  const [activityRows, setActivityRows] = useState<AdminUserOverviewRow[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityHasLoaded, setActivityHasLoaded] = useState(false);
  const [activitySortKey, setActivitySortKey] = useState<ActivitySortKey>("lastActivityAt");
  const [activitySortDir, setActivitySortDir] = useState<ActivitySortDir>("desc");

  // Drill-down (per-user activity log) state.
  const [drilldownUser, setDrilldownUser] = useState<{ userId: string; username: string | null } | null>(null);
  const [drilldownRows, setDrilldownRows] = useState<AdminUserActivityRow[]>([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);

  const loadActivity = async () => {
    setActivityLoading(true);
    setActivityError(null);
    try {
      const rows = await fetchAdminUserOverview();
      setActivityRows(rows);
      setActivityHasLoaded(true);
    } catch (err: any) {
      console.error("[admin] fetchAdminUserOverview failed:", err);
      setActivityError(err?.message ?? String(err));
    } finally {
      setActivityLoading(false);
    }
  };

  // Fetch on first expand. Subsequent expands reuse cached rows; the explicit
  // refresh button handles re-fetch.
  useEffect(() => {
    if (expanded.activity && !activityHasLoaded && !activityLoading) {
      loadActivity();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded.activity]);

  const sortedActivityRows = useMemo(
    () => sortActivityRows(activityRows, activitySortKey, activitySortDir),
    [activityRows, activitySortKey, activitySortDir]
  );

  const handleActivitySort = (key: ActivitySortKey) => {
    if (key === activitySortKey) {
      setActivitySortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setActivitySortKey(key);
      // Default direction on switching columns: desc for numeric/date,
      // asc for text. Matches the way most admins read these tables.
      const isText = key === "username" || key === "email";
      setActivitySortDir(isText ? "asc" : "desc");
    }
  };

  const openDrilldown = async (row: AdminUserOverviewRow) => {
    setDrilldownUser({ userId: row.userId, username: row.username });
    setDrilldownRows([]);
    setDrilldownLoading(true);
    setDrilldownError(null);
    try {
      const rows = await fetchAdminUserActivity(row.userId);
      setDrilldownRows(rows);
    } catch (err: any) {
      console.error("[admin] fetchAdminUserActivity failed:", err);
      setDrilldownError(err?.message ?? String(err));
    } finally {
      setDrilldownLoading(false);
    }
  };

  // ── Prompt Library state ──────────────────────────────────────────────────
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [promptsLoading, setPromptsLoading] = useState(true);
  const [addressedIds, setAddressedIds] = useState<Set<number>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("ns_admin_addressed_prompts") || "[]")); } catch { return new Set(); }
  });
  const toggleAddressed = (id: number) => {
    setAddressedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem("ns_admin_addressed_prompts", JSON.stringify([...next]));
      return next;
    });
  };
  const [promptFilter, setPromptFilter] = useState<"all" | "fragment" | "lighthearted-fragment" | "prompt">("all");
  const [deletingPromptId, setDeletingPromptId] = useState<number | null>(null);

  // ── Prompt edit state ─────────────────────────────────────────────────────
  const TVMAZE_TYPES = ["all", "Scripted", "Animation", "Reality", "Documentary", "Game Show", "Panel Show", "Talk Show", "Variety"];
  const TVMAZE_GENRES = [
    "all-genre",
    "Action", "Adventure", "Anime", "Children", "Comedy", "Crime",
    "DIY", "Drama", "Espionage", "Family", "Fantasy", "Food",
    "History", "Horror", "Legal", "Medical", "Music", "Mystery",
    "Nature", "Romance", "Science-Fiction", "Sports", "Supernatural",
    "Thriller", "Travel", "War", "Western",
  ];
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [editTypes, setEditTypes] = useState<string[]>([]);
  const [editGenres, setEditGenres] = useState<string[]>([]);
  const [editProgressTags, setEditProgressTags] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  const openEdit = (p: PromptRow) => {
    setEditingId(p.id);
    setEditText(p.text);
    setEditTypes(p.tvmaze_types ?? []);
    setEditGenres(p.genres ?? []);
    setEditProgressTags(p.progress_tags ?? []);
  };

  const closeEdit = () => setEditingId(null);

  const toggleTag = (tag: string, list: string[], setList: (v: string[]) => void) => {
    setList(list.includes(tag) ? list.filter(t => t !== tag) : [...list, tag]);
  };

  const selectAll = (items: string[], list: string[], setList: (v: string[]) => void) => {
    const allSelected = items.every(item => list.includes(item));
    setList(allSelected ? [] : items);
  };

  const selectAllLink = (items: string[], list: string[], setList: (v: string[]) => void) => (
    <button
      type="button"
      onClick={() => selectAll(items, list, setList)}
      style={{ fontSize: 10, cursor: "pointer", background: "none", border: "none", color: "#355eb8", padding: 0, textDecoration: "underline", marginLeft: 8, fontFamily: "inherit" }}
    >
      {items.every(item => list.includes(item)) ? "deselect all" : "select all"}
    </button>
  );

  const handleSaveEdit = async (id: number) => {
    setEditSaving(true);
    try {
      await updatePrompt(id, { text: editText.trim(), tvmaze_types: editTypes, genres: editGenres, progress_tags: editProgressTags });
      setPrompts(prev => prev.map(p => p.id === id
        ? { ...p, text: editText.trim(), tvmaze_types: editTypes, genres: editGenres, progress_tags: editProgressTags }
        : p
      ));
      setEditingId(null);
    } catch (e: any) {
      alert(`Failed to save: ${e?.message}`);
    } finally {
      setEditSaving(false);
    }
  };

  useEffect(() => {
    fetchAllPrompts()
      .then(rows => setPrompts(rows))
      .catch(() => {})
      .finally(() => setPromptsLoading(false));
  }, []);


  const handleToggleActive = async (id: number, current: boolean) => {
    try {
      await togglePromptActive(id, !current);
      setPrompts(prev => prev.map(p => p.id === id ? { ...p, is_active: !current } : p));
    } catch (e: any) {
      alert(`Failed to toggle: ${e?.message}`);
    }
  };

  const handleDeletePrompt = async (id: number) => {
    try {
      await deletePrompt(id);
      setPrompts(prev => prev.filter(p => p.id !== id));
      setDeletingPromptId(null);
    } catch (e: any) {
      alert(`Failed to delete: ${e?.message}`);
    }
  };

  // ── Add new prompt state ──────────────────────────────────────────────────
  const [addingPrompt, setAddingPrompt] = useState(false);
  const [newText, setNewText] = useState("");
  const [newDisplayType, setNewDisplayType] = useState<"fragment" | "lighthearted-fragment" | "prompt">("prompt");
  const [newTypes, setNewTypes] = useState<string[]>([]);
  const [newGenres, setNewGenres] = useState<string[]>([]);
  const [newProgressTags, setNewProgressTags] = useState<string[]>([]);
  const [newSaving, setNewSaving] = useState(false);

  const handleCreatePrompt = async () => {
    if (!newText.trim()) return;
    setNewSaving(true);
    try {
      const created = await createPrompt({
        text: newText.trim(),
        display_type: newDisplayType,
        tvmaze_types: newTypes,
        genres: newGenres,
        progress_tags: newProgressTags,
        themes: [],
      });
      setPrompts(prev => [created, ...prev]);
      setNewText("");
      setNewDisplayType("prompt");
      setNewTypes([]);
      setNewGenres([]);
      setNewProgressTags([]);
      setAddingPrompt(false);
    } catch (e: any) {
      alert(`Failed to create: ${e?.message}`);
    } finally {
      setNewSaving(false);
    }
  };

  const filteredPrompts = (promptFilter === "all"
    ? prompts
    : prompts.filter(p => p.display_type === promptFilter)
  ).slice().sort((a, b) => {
    const aAddr = addressedIds.has(a.id) ? 1 : 0;
    const bAddr = addressedIds.has(b.id) ? 1 : 0;
    if (aAddr !== bAddr) return aAddr - bAddr;
    // Within each group: active (on) before inactive (off)
    const aActive = a.is_active ? 0 : 1;
    const bActive = b.is_active ? 0 : 1;
    return aActive - bActive;
  });

  const activeCount = prompts.filter(p => p.is_active).length;

  const handleFeedbackStatus = async (id: string, status: FeedbackStatus | null) => {
    try {
      await updateFeedbackStatus(id, status);
      setFeedback(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    } catch (err) {
      console.error("[admin] updateFeedbackStatus failed:", err);
      alert("Couldn't update status: " + ((err as any)?.message ?? String(err)));
    }
  };

  const handleFeedbackDelete = async (id: string) => {
    try {
      await deleteFeedback(id);
      setFeedback(prev => prev.filter(r => r.id !== id));
      setDeletingId(null);
    } catch (err) {
      console.error("[admin] deleteFeedback failed:", err);
      alert("Couldn't delete: " + ((err as any)?.message ?? String(err)));
    }
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
        <button
          onClick={() => toggleSection("forums")}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 700, marginBottom: expanded.forums ? 16 : 0, background: "transparent", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
        >
          {expanded.forums ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <span>Forums ({shows.length})</span>
        </button>

        {expanded.forums && (<>

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

        </>)}
      </div>

      {/* ── Feedback section ── */}
      <div style={{ marginTop: 48 }}>
        <button
          onClick={() => toggleSection("feedback")}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 700, marginBottom: expanded.feedback ? 16 : 0, background: "transparent", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
        >
          {expanded.feedback ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <span>Feedback {!feedbackLoading && `(${feedback.length})`}</span>
        </button>

        {expanded.feedback && (<>

        {feedbackLoading && <div className="muted">Loading…</div>}

        {!feedbackLoading && feedbackError && (
          <div style={{ padding: 12, border: "1px solid var(--danger)", borderRadius: 6, color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>
            Couldn&rsquo;t load feedback: {feedbackError}
          </div>
        )}

        {!feedbackLoading && !feedbackError && feedback.length === 0 && (
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
                  <th style={{ padding: "6px 10px", fontWeight: 700, minWidth: 320, width: "100%" }}>message</th>
                  <th style={{ padding: "6px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>status</th>
                  <th style={{ padding: "6px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>user</th>
                  <th style={{ padding: "6px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>when</th>
                  <th style={{ padding: "6px 10px", fontWeight: 700, whiteSpace: "nowrap", width: 80 }}>page</th>
                  <th style={{ padding: "6px 10px" }}></th>
                </tr>
              </thead>
              <tbody>
                {sortedFeedback.map((row, i) => {
                  const isNew = !row.readAt && !row.status;
                  return (
                    <tr key={row.id} style={{
                      borderBottom: "1px solid #ddd",
                      background: row.status === "done" ? "#7abd8e" : row.status === "will-do" ? "#adc8d7" : isNew ? "#fffbe6" : i % 2 === 0 ? "#fff" : "#f9f9f9",
                      verticalAlign: "top",
                    }}>
                      <td style={{ padding: "6px 10px", whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 11 }}>
                        {isNew && <span style={{ color: "green", marginRight: 4 }}>●</span>}
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
                        @{row.username ?? "—"}
                      </td>
                      <td style={{ padding: "6px 10px", whiteSpace: "nowrap", color: "#555" }}>
                        {timeAgo(row.createdAt)}
                      </td>
                      <td style={{ padding: "6px 10px", color: "#555", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {row.pageUrl ?? "—"}
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

        </>)}
      </div>

      {/* ── Prompt Library section ── */}
      <div style={{ marginTop: 48 }}>
        <button
          onClick={() => toggleSection("prompts")}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 700, marginBottom: expanded.prompts ? 8 : 0, background: "transparent", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
        >
          {expanded.prompts ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <span>Prompt Library {!promptsLoading && `(${activeCount} active / ${prompts.length} total)`}</span>
        </button>

        {expanded.prompts && (<>

        {/* ＋ Add new prompt toggle */}
        <div style={{ marginBottom: 12 }}>
          <button
            className="btn"
            onClick={() => setAddingPrompt(v => !v)}
            style={{ fontSize: 13 }}
          >
            {addingPrompt ? "▲ Cancel" : "＋ Add new prompt"}
          </button>
        </div>

        {addingPrompt && (
          <div style={{ background: "#f0f4f8", border: "1px solid #c0d0e0", borderRadius: 6, padding: "16px", marginBottom: 16, fontFamily: "monospace", fontSize: 12 }}>
            {/* Text */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#555", marginBottom: 4 }}>Prompt text</div>
              <textarea
                value={newText}
                onChange={e => setNewText(e.target.value)}
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: "6px 8px", borderRadius: 4, border: "1px solid #bbb", fontFamily: "inherit", resize: "vertical" }}
                placeholder="Enter prompt text…"
              />
            </div>
            {/* Display type */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#555", marginBottom: 6 }}>Display type</div>
              <div style={{ display: "flex", gap: 16 }}>
                {(["fragment", "lighthearted-fragment", "prompt"] as const).map(dt => (
                  <label key={dt} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="newDisplayType"
                      value={dt}
                      checked={newDisplayType === dt}
                      onChange={() => setNewDisplayType(dt)}
                    />
                    {dt}
                  </label>
                ))}
              </div>
            </div>
            {/* Tags: three columns */}
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
              {/* TVMaze type */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#555", marginBottom: 6 }}>
                  TVMaze type {selectAllLink(TVMAZE_TYPES, newTypes, setNewTypes)}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {TVMAZE_TYPES.map(t => (
                    <label key={t} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                      <input type="checkbox" checked={newTypes.includes(t)} onChange={() => toggleTag(t, newTypes, setNewTypes)} />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
              {/* TVMaze genre */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#555", marginBottom: 6 }}>
                  TVMaze genre {selectAllLink(TVMAZE_GENRES, newGenres, setNewGenres)}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 140px)", gap: "3px 12px" }}>
                  {TVMAZE_GENRES.map(g => (
                    <label key={g} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                      <input type="checkbox" checked={newGenres.includes(g)} onChange={() => toggleTag(g, newGenres, setNewGenres)} />
                      {g}
                    </label>
                  ))}
                </div>
              </div>
              {/* Progress */}
              <div>
                {(() => { const PROGRESS_TAGS = ["any-progress", "start-of-show", "season-start", "show-arc", "season-ending", "approaching-end", "end"]; return (<>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#555", marginBottom: 6 }}>
                  Progress {selectAllLink(PROGRESS_TAGS, newProgressTags, setNewProgressTags)}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {PROGRESS_TAGS.map(tag => (
                    <label key={tag} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                      <input type="checkbox" checked={newProgressTags.includes(tag)} onChange={() => toggleTag(tag, newProgressTags, setNewProgressTags)} />
                      {tag}
                    </label>
                  ))}
                </div>
                </>); })()}
              </div>
            </div>
            {/* Actions */}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleCreatePrompt}
                disabled={newSaving || !newText.trim()}
                style={{ fontSize: 12, cursor: "pointer", background: "#355eb8", color: "#fff", border: "none", borderRadius: 4, padding: "5px 14px", fontWeight: 600 }}
              >
                {newSaving ? "Adding…" : "Add prompt"}
              </button>
              <button
                onClick={() => { setAddingPrompt(false); setNewText(""); setNewTypes([]); setNewGenres([]); setNewProgressTags([]); }}
                style={{ fontSize: 12, cursor: "pointer", background: "transparent", color: "#555", border: "1px solid #bbb", borderRadius: 4, padding: "5px 14px" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <button
            className="btn"
            onClick={() => setPrompts(prev => [...prev].sort((a, b) => Number(b.is_active) - Number(a.is_active)))}
            style={{ fontSize: 12, padding: "3px 10px" }}
          >
            inactive to bottom
          </button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {(["all", "fragment", "lighthearted-fragment", "prompt"] as const).map(f => (
              <button
                key={f}
                className="btn"
                onClick={() => setPromptFilter(f)}
                style={{
                  fontSize: 12, padding: "3px 10px",
                  background: promptFilter === f ? "rgba(255,255,255,0.3)" : "transparent",
                  fontWeight: promptFilter === f ? 700 : 400,
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {promptsLoading && <div className="muted">Loading…</div>}

        {!promptsLoading && prompts.length === 0 && (
          <div className="muted" style={{ fontSize: 14 }}>
            No prompts in database.
          </div>
        )}

        {!promptsLoading && filteredPrompts.length > 0 && (
          <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
            <table style={{
              width: "100%", borderCollapse: "collapse",
              fontSize: 12, fontFamily: "monospace",
              background: "#fff", color: "#000",
            }}>
              <thead style={{ position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>
                <tr style={{ borderBottom: "2px solid #999", textAlign: "left" }}>
                  <th style={{ padding: "5px 8px", fontWeight: 700 }}>ID</th>
                  <th style={{ padding: "5px 8px", fontWeight: 700 }}>text</th>
                  <th style={{ padding: "5px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>type</th>
                  <th style={{ padding: "5px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>active</th>
                  <th style={{ padding: "5px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>done</th>
                  <th style={{ padding: "5px 8px" }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredPrompts.map((p, i) => {
                  const isAddressed = addressedIds.has(p.id);
                  return (
                  <React.Fragment key={p.id}>
                    <tr
                      style={{
                        borderBottom: editingId === p.id ? "none" : "1px solid #eee",
                        background: isAddressed ? "#e8e8e8" : !p.is_active ? "#fafafa" : i % 2 === 0 ? "#fff" : "#f9f9f9",
                        opacity: isAddressed ? 0.5 : p.is_active ? 1 : 0.55,
                        verticalAlign: "top",
                      }}
                    >
                      <td style={{ padding: "5px 8px", color: "#888", whiteSpace: "nowrap" }}>{p.id}</td>
                      <td style={{ padding: "5px 8px", maxWidth: 480, whiteSpace: "normal", lineHeight: 1.4 }}>
                        {p.text.length > 100 ? p.text.slice(0, 100) + "…" : p.text}
                      </td>
                      <td style={{ padding: "5px 8px", whiteSpace: "nowrap", color: "#666" }}>{p.display_type}</td>
                      <td style={{ padding: "5px 8px" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={p.is_active}
                            onChange={() => handleToggleActive(p.id, p.is_active)}
                            style={{ cursor: "pointer" }}
                          />
                          {p.is_active ? "on" : "off"}
                        </label>
                      </td>
                      <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer", color: "#555" }}>
                          <input
                            type="checkbox"
                            checked={isAddressed}
                            onChange={() => toggleAddressed(p.id)}
                            style={{ cursor: "pointer" }}
                          />
                          done
                        </label>
                      </td>
                      <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <button
                            onClick={() => editingId === p.id ? closeEdit() : openEdit(p)}
                            style={{ fontSize: 11, cursor: "pointer", color: "#355eb8", background: "none", border: "none", padding: 0, textDecoration: "underline" }}
                          >
                            {editingId === p.id ? "cancel" : "edit"}
                          </button>
                          {deletingPromptId === p.id ? (
                            <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                              <span style={{ color: "#c00" }}>sure?</span>
                              <button
                                onClick={() => handleDeletePrompt(p.id)}
                                style={{ fontSize: 11, cursor: "pointer", color: "#c00", background: "none", border: "1px solid #c00", borderRadius: 3, padding: "1px 5px" }}
                              >yes</button>
                              <button
                                onClick={() => setDeletingPromptId(null)}
                                style={{ fontSize: 11, cursor: "pointer", background: "none", border: "1px solid #999", borderRadius: 3, padding: "1px 5px" }}
                              >no</button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setDeletingPromptId(p.id)}
                              style={{ fontSize: 11, cursor: "pointer", color: "#c00", background: "none", border: "none", padding: 0, textDecoration: "underline" }}
                            >
                              delete
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                    {editingId === p.id && (
                      <tr style={{ background: "#f0f4f8", borderBottom: "2px solid #c0d0e0" }}>
                        <td colSpan={6} style={{ padding: "12px 16px", position: "relative" }}>
                          {/* Save button — top right */}
                          <button
                            onClick={() => handleSaveEdit(p.id)}
                            disabled={editSaving}
                            style={{ position: "absolute", top: 12, right: 16, fontSize: 12, cursor: "pointer", background: "#355eb8", color: "#fff", border: "none", borderRadius: 4, padding: "5px 14px", fontWeight: 600 }}
                          >
                            {editSaving ? "Saving…" : "Save changes"}
                          </button>
                          {/* Text */}
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#555", marginBottom: 4 }}>Prompt text</div>
                            <textarea
                              value={editText}
                              onChange={e => setEditText(e.target.value)}
                              rows={3}
                              style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: "6px 8px", borderRadius: 4, border: "1px solid #bbb", fontFamily: "inherit", resize: "vertical" }}
                            />
                          </div>
                          {/* Tags: two sections side by side */}
                          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
                            {/* Types */}
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#555", marginBottom: 6 }}>
                                TVMaze type {selectAllLink(TVMAZE_TYPES, editTypes, setEditTypes)}
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                {TVMAZE_TYPES.map(t => (
                                  <label key={t} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                                    <input type="checkbox" checked={editTypes.includes(t)} onChange={() => toggleTag(t, editTypes, setEditTypes)} />
                                    {t}
                                  </label>
                                ))}
                              </div>
                            </div>
                            {/* Genres */}
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#555", marginBottom: 6 }}>
                                TVMaze genre {selectAllLink(TVMAZE_GENRES, editGenres, setEditGenres)}
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 140px)", gap: "3px 12px" }}>
                                {TVMAZE_GENRES.map(g => (
                                  <label key={g} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                                    <input type="checkbox" checked={editGenres.includes(g)} onChange={() => toggleTag(g, editGenres, setEditGenres)} />
                                    {g}
                                  </label>
                                ))}
                              </div>
                            </div>
                            {/* Progress */}
                            <div>
                              {(() => { const PROGRESS_TAGS = ["any-progress", "start-of-show", "season-start", "show-arc", "season-ending", "approaching-end", "end"]; return (<>
                              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#555", marginBottom: 6 }}>
                                Progress {selectAllLink(PROGRESS_TAGS, editProgressTags, setEditProgressTags)}
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                {PROGRESS_TAGS.map(tag => (
                                  <label key={tag} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                                    <input type="checkbox" checked={editProgressTags.includes(tag)} onChange={() => toggleTag(tag, editProgressTags, setEditProgressTags)} />
                                    {tag}
                                  </label>
                                ))}
                              </div>
                              </>); })()}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ); })}
              </tbody>
            </table>
          </div>
        )}

        </>)}
      </div>

      {/* ── Activity section (per-user overview + drill-down) ── */}
      <div style={{ marginTop: 48 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: expanded.activity ? 16 : 0 }}>
          <button
            onClick={() => toggleSection("activity")}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 700, background: "transparent", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
          >
            {expanded.activity ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            <span>Activity {activityHasLoaded && `(${activityRows.length} users)`}</span>
          </button>
          {expanded.activity && (
            <button
              className="btn"
              onClick={loadActivity}
              disabled={activityLoading}
              style={{ fontSize: 12, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 6 }}
              title="Refresh"
            >
              <RefreshCw size={12} />
              {activityLoading ? "Loading…" : "Refresh"}
            </button>
          )}
        </div>

        {expanded.activity && (<>
          {activityError && (
            <div style={{ padding: 12, border: "1px solid var(--danger)", borderRadius: 6, color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>
              Couldn&rsquo;t load activity: {activityError}
            </div>
          )}
          {activityLoading && activityRows.length === 0 && (
            <div className="muted">Loading…</div>
          )}
          {!activityLoading && !activityError && activityHasLoaded && activityRows.length === 0 && (
            <div className="muted">No users.</div>
          )}
          {activityRows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{
                width: "100%", borderCollapse: "collapse",
                fontSize: 12, fontFamily: "monospace",
                background: "#fff", color: "#000",
              }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #999", textAlign: "left", background: "#f5f5f5" }}>
                    {([
                      ["username",          "Name"],
                      ["email",             "Email"],
                      ["signupAt",          "Signup"],
                      ["lastSignInAt",      "Last sign-in"],
                      ["roomsCount",        "Rooms"],
                      ["distinctCoMembers", "Friends"],
                      ["invitesSent",       "Invites"],
                      ["threadsCount",      "Threads"],
                      ["threadsCountTsp",   "TSP threads"],
                      ["repliesCount",      "Replies"],
                      ["repliesCountTsp",   "TSP replies"],
                      ["postsPerWeek",      "Posts/wk"],
                      ["lastActivityAt",    "Last activity"],
                    ] as [ActivitySortKey, string][]).map(([key, label]) => {
                      const active = activitySortKey === key;
                      const arrow = active ? (activitySortDir === "asc" ? " ▲" : " ▼") : "";
                      return (
                        <th
                          key={key}
                          onClick={() => handleActivitySort(key)}
                          style={{ padding: "6px 8px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}
                          title="Sort"
                        >
                          {label}{arrow}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedActivityRows.map((row, i) => (
                    <tr
                      key={row.userId}
                      onClick={() => openDrilldown(row)}
                      style={{
                        borderBottom: "1px solid #eee",
                        background: i % 2 === 0 ? "#fff" : "#f9f9f9",
                        cursor: "pointer",
                      }}
                    >
                      <td style={{ padding: "5px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{row.username ?? "—"}</td>
                      <td style={{ padding: "5px 8px", whiteSpace: "nowrap", color: "#444" }}>{row.email ?? "—"}</td>
                      <td style={{ padding: "5px 8px", whiteSpace: "nowrap", color: "#666" }}>{fmtDateShort(row.signupAt)}</td>
                      <td style={{ padding: "5px 8px", whiteSpace: "nowrap", color: "#666" }}>{fmtDateShort(row.lastSignInAt)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{row.roomsCount}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{row.distinctCoMembers}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{row.invitesSent}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{row.threadsCount}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: "#888" }}>{row.threadsCountTsp}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{row.repliesCount}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: "#888" }}>{row.repliesCountTsp}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap" }}>{row.postsPerWeek.toFixed(2)}</td>
                      <td style={{ padding: "5px 8px", whiteSpace: "nowrap", color: "#666" }}>{fmtDateTimeShort(row.lastActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>)}
      </div>

      {/* ── Activity drill-down modal ── */}
      {drilldownUser && (
        <div
          onClick={() => setDrilldownUser(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="card"
            style={{
              background: "#fff", color: "#000", border: "none",
              borderRadius: 10, padding: "20px 24px",
              maxWidth: 800, width: "92vw", maxHeight: "85vh", overflowY: "auto",
              fontFamily: "monospace",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {drilldownUser.username ?? "(no username)"}
                {drilldownRows.length > 0 && (
                  <span style={{ fontWeight: 400, color: "#666", marginLeft: 8, fontSize: 13 }}>
                    {drilldownRows.length} {drilldownRows.length === 1 ? "item" : "items"}
                  </span>
                )}
              </div>
              <button
                onClick={() => setDrilldownUser(null)}
                style={{ background: "transparent", border: "none", fontSize: 16, cursor: "pointer", color: "#666" }}
              >
                ✕
              </button>
            </div>
            {drilldownLoading && <div style={{ color: "#666", fontSize: 13 }}>Loading…</div>}
            {drilldownError && (
              <div style={{ color: "var(--danger)", fontSize: 13, padding: 8, border: "1px solid var(--danger)", borderRadius: 4 }}>
                {drilldownError}
              </div>
            )}
            {!drilldownLoading && !drilldownError && drilldownRows.length === 0 && (
              <div style={{ color: "#666", fontSize: 13 }}>No activity yet.</div>
            )}
            {drilldownRows.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {drilldownRows.map((r, i) => {
                  const mode =
                    r.kind === "thread"
                      ? (r.isPublic ? "public" : (r.groupName ? "friend" : "private"))
                      : (r.groupName ? "friend" : "public");
                  const tag = `S${String(r.season).padStart(2, "0")} E${String(r.episode).padStart(2, "0")}`;
                  return (
                    <div
                      key={`${r.kind}-${r.replyId ?? r.threadId}-${i}`}
                      style={{
                        background: r.isDeleted ? "#fafafa" : "#fff",
                        border: "1px solid #e5e5e5",
                        borderRadius: 4,
                        padding: "8px 10px",
                        fontSize: 12,
                        opacity: r.isDeleted ? 0.65 : 1,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 4, color: "#666" }}>
                        <span style={{ fontWeight: 700, color: "#222", textTransform: "uppercase", fontSize: 11 }}>
                          {r.kind} · {mode}
                          {r.groupName && <span style={{ fontWeight: 400, marginLeft: 6, color: "#666" }}>· {r.groupName}</span>}
                          {r.isDeleted && <span style={{ marginLeft: 6, color: "var(--danger)", fontWeight: 700 }}>· DELETED</span>}
                        </span>
                        <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontSize: 11 }}>
                          {tag} · {fmtDateTimeShort(r.createdAt)}
                        </span>
                      </div>
                      {r.title && (
                        <div style={{ fontWeight: 700, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {r.title}
                        </div>
                      )}
                      <div style={{ color: "#444", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.body || <span style={{ color: "#aaa", fontStyle: "italic" }}>(empty)</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete show confirmation */}
      {confirmDelete && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div className="card" style={{
            background: "var(--dos-bg)", border: "none",
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
