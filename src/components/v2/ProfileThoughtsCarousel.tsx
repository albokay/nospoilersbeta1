import React, { useEffect, useState } from "react";
import {
  LockKeyhole,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Pencil,
  Globe,
  Trash2,
} from "lucide-react";
import type { ProfileThought } from "../../types";
import Tooltip from "../Tooltip";

// "Thoughts on..." carousel — one ticket visible at a time, chevron-step
// navigation. Renders only when there are pieces; empty state is owned by
// the parent (V2ProfileSelfPage). Slide animation on step.
//
// Owner-mode affordances per piece state:
//   - private:                edit + publish (private→public) + delete
//   - public (featured + non): edit + delete
// (Original spec excluded delete on the featured public piece, but the
// owner can now delete any ticket they own — fewer rules to remember.)
//
// Visitor mode: no affordances. The parent is responsible for filtering to
// public-only before passing `thoughts` in.
//
// "Featured" is the first public piece in the sorted list (parent sorts so
// the most recently published public piece is index 0 of any public subset).

export type ProfileThoughtsOwnerHandlers = {
  onEdit: (t: ProfileThought) => void;
  onPublish: (t: ProfileThought) => Promise<void>;
  onDelete: (t: ProfileThought) => Promise<void>;
};

type Props = {
  thoughts: ProfileThought[];
  ownerMode: boolean;
  /** Required when ownerMode = true; ignored otherwise. */
  ownerHandlers?: ProfileThoughtsOwnerHandlers;
};

export default function ProfileThoughtsCarousel({ thoughts, ownerMode, ownerHandlers }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  // Clamp the visible index if the thoughts array shrinks (e.g. after the
  // current ticket gets deleted). Drop back to 0 on full empty (shouldn't
  // happen since the parent unmounts us, but defensive).
  useEffect(() => {
    if (currentIndex >= thoughts.length) {
      setCurrentIndex(Math.max(0, thoughts.length - 1));
    }
  }, [thoughts.length, currentIndex]);

  if (!thoughts.length) return null;

  const current = thoughts[Math.min(currentIndex, thoughts.length - 1)];

  function goPrev() {
    if (currentIndex === 0) return;
    setSlideDir("left");
    setCurrentIndex(currentIndex - 1);
  }
  function goNext() {
    if (currentIndex >= thoughts.length - 1) return;
    setSlideDir("right");
    setCurrentIndex(currentIndex + 1);
  }
  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handlePublish(t: ProfileThought) {
    if (!ownerHandlers) return;
    setPublishingId(t.id);
    try {
      await ownerHandlers.onPublish(t);
    } catch (err) {
      console.warn("publish failed:", err);
    } finally {
      setPublishingId(null);
    }
  }

  async function confirmDelete() {
    if (!ownerHandlers || !pendingDeleteId) return;
    const t = thoughts.find((x) => x.id === pendingDeleteId);
    if (!t) {
      setPendingDeleteId(null);
      return;
    }
    setDeleting(true);
    try {
      await ownerHandlers.onDelete(t);
      setPendingDeleteId(null);
    } catch (err) {
      console.warn("delete failed:", err);
    } finally {
      setDeleting(false);
    }
  }

  const showArrows = thoughts.length > 1;
  const isCurrentExpanded = expandedIds.has(current.id);
  const canDelete = ownerMode && !!ownerHandlers;
  const canPublish = ownerMode && !!ownerHandlers && !current.isPublic;

  // Visual treatment per spec:
  //   - public:  no fill (transparent), 2px dotted white outline, white text.
  //   - private: canon-green fill, 2px dashed white outline, white text.
  // Either way text + icons render white (the article's `color` cascade
  // covers any child using currentColor or inherited color).
  const outlineStyle = current.isPublic
    ? "2px dotted rgba(255,255,255,0.85)"
    : "2px dashed #fff";
  const ticketBg = current.isPublic ? "transparent" : "#7abd8e";

  // Show expand toggle when the body is long enough that 2-line clamp would
  // hide content. Heuristic: > 120 chars or contains a newline. Always show
  // in expanded state so the user can collapse back.
  const showExpand = isCurrentExpanded || current.body.length > 120 || current.body.includes("\n");

  return (
    <div style={{ position: "relative" }}>
      {/* Slide keyframes — two-phase: slide holds opacity 0 until ~50%, then
          fades in while the transform finishes. Total duration 480ms for a
          calm, deliberate transition that doesn't feel snappy. */}
      <style>{`
        @keyframes pt-slide-from-right {
          0%   { transform: translateX(70px); opacity: 0; }
          50%  { transform: translateX(20px); opacity: 0; }
          100% { transform: translateX(0);    opacity: 1; }
        }
        @keyframes pt-slide-from-left {
          0%   { transform: translateX(-70px); opacity: 0; }
          50%  { transform: translateX(-20px); opacity: 0; }
          100% { transform: translateX(0);     opacity: 1; }
        }
      `}</style>

      {/* Article spans the full content column so its left edge stays aligned
          with the profile name header. Chevrons are absolute-positioned at the
          left/right edges so they don't push the article rightward. */}
      <article
        // Re-keying on `${id}-${index}` forces remount on step so the
        // keyframe animation runs every time the user navigates.
        key={`${current.id}-${currentIndex}`}
        style={{
          display: "block",
          width: "100%",
          background: ticketBg,
          border: outlineStyle,
          borderRadius: 24,
          padding: "20px 24px",
          // Always white. Public bg = canon yellow page color (white reads);
          // private bg = canon green (white reads). currentColor carries
          // through to nested icons + text using inherited color.
          color: "#fff",
          animation:
            slideDir === "right" ? "pt-slide-from-right 480ms ease-out" :
            slideDir === "left"  ? "pt-slide-from-left 480ms ease-out"  : "none",
          position: "relative",
          minHeight: 160,
          boxSizing: "border-box",
        }}
      >
          {/* Private indicator row — lock icon + "only you see this thought"
              label sit above the title. Mirrors the styling of the populated-
              state below-carousel "write a new one?" link (italic Lora 14
              + dotted underline). */}
          {!current.isPublic && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8, color: "#fff" }}>
              <LockKeyhole size={14} color="currentColor" />
              <span
                style={{
                  fontFamily: "Lora, Georgia, serif",
                  fontStyle: "italic",
                  fontSize: 14,
                }}
              >
                only you see this thought
              </span>
            </div>
          )}

          {/* Header row — title on the left, owner affordances on the right. */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", minWidth: 0, flex: 1 }}>
              <span style={{ fontFamily: "Inter, sans-serif", fontSize: 22, fontWeight: 600, color: "currentColor", lineHeight: 1.25 }}>
                Thoughts on {current.titleCompletion}.
              </span>
            </div>

            {ownerMode && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                <IconButton
                  onClick={() => ownerHandlers?.onEdit(current)}
                  label="edit"
                  icon={<Pencil size={14} color="currentColor" />}
                />
                {canPublish && (
                  <Tooltip
                    text="Turn this into a public thought."
                    direction="above"
                    align="center"
                    portal
                    width={220}
                  >
                    <IconButton
                      onClick={() => handlePublish(current)}
                      label={publishingId === current.id ? "publishing…" : "publish to profile"}
                      icon={<Globe size={14} color="currentColor" />}
                      disabled={publishingId === current.id}
                    />
                  </Tooltip>
                )}
                {canDelete && (
                  <IconButton
                    onClick={() => setPendingDeleteId(current.id)}
                    label="delete"
                    icon={<Trash2 size={14} color="currentColor" />}
                  />
                )}
              </div>
            )}
          </div>

          {/* Body — clamped to 2 lines collapsed; full body when expanded. */}
          <div
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 15,
              lineHeight: 1.6,
              color: "currentColor",
              whiteSpace: "pre-wrap",
              ...(isCurrentExpanded
                ? {}
                : {
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical" as const,
                    overflow: "hidden",
                  }),
            }}
          >
            {current.body}
          </div>

          {/* Expand / collapse — only when there's more body than the 2-line
              preview would show. */}
          {showExpand && (
            <button
              onClick={() => toggleExpand(current.id)}
              style={{
                background: "transparent",
                border: "none",
                color: "currentColor",
                opacity: 0.85,
                fontFamily: "Lora, Georgia, serif",
                fontStyle: "italic",
                fontSize: 13,
                cursor: "pointer",
                marginTop: 10,
                padding: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {isCurrentExpanded ? (
                <><ChevronUp size={14} /> collapse</>
              ) : (
                <><ChevronDown size={14} /> expand</>
              )}
            </button>
          )}
      </article>

      {/* Chevrons — absolute-positioned outside the article so navigating
          between tickets doesn't shift the article's left edge. Left chevron
          sits in the journalShift gutter (≥731px); right chevron in the
          container's right margin. Hidden via display:none when only one
          piece exists. */}
      {showArrows && (
        <>
          <button
            onClick={goPrev}
            disabled={currentIndex === 0}
            aria-label="previous thought"
            style={{
              position: "absolute",
              left: -32,
              top: "50%",
              transform: "translateY(-50%)",
              background: "transparent",
              border: "none",
              color: "var(--dos-fg)",
              padding: 8,
              cursor: currentIndex === 0 ? "default" : "pointer",
              opacity: currentIndex === 0 ? 0.2 : 0.7,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <ChevronLeft size={20} color="currentColor" />
          </button>
          <button
            onClick={goNext}
            disabled={currentIndex >= thoughts.length - 1}
            aria-label="next thought"
            style={{
              position: "absolute",
              right: -32,
              top: "50%",
              transform: "translateY(-50%)",
              background: "transparent",
              border: "none",
              color: "var(--dos-fg)",
              padding: 8,
              cursor: currentIndex >= thoughts.length - 1 ? "default" : "pointer",
              opacity: currentIndex >= thoughts.length - 1 ? 0.2 : 0.7,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <ChevronRight size={20} color="currentColor" />
          </button>
        </>
      )}

      {/* Delete-confirm modal — canon-yellow fill, white text. Cancel reads
          as a quiet outline (white-on-yellow); Delete is canon-red fill. */}
      {pendingDeleteId && (() => {
        const t = thoughts.find((x) => x.id === pendingDeleteId);
        if (!t) return null;
        return (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9995,
              padding: 20,
            }}
            onClick={(e) => { if (e.target === e.currentTarget && !deleting) setPendingDeleteId(null); }}
          >
            <div
              style={{
                background: "#dea838",
                borderRadius: 18,
                padding: "24px 28px",
                maxWidth: 440,
                width: "100%",
                color: "#fff",
              }}
            >
              <p style={{ margin: "0 0 22px", fontSize: 17, lineHeight: 1.5, fontWeight: 600 }}>
                Are you sure you want to delete this thought?
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  style={{ fontSize: 14, background: "transparent", border: "2px solid #fff", color: "#fff", borderRadius: 9999, padding: "8px 16px", cursor: deleting ? "not-allowed" : "pointer", fontWeight: 500 }}
                  onClick={() => setPendingDeleteId(null)}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  style={{ fontSize: 14, background: "var(--danger)", border: "2px solid var(--danger)", color: "#fff", borderRadius: 9999, padding: "8px 16px", cursor: deleting ? "not-allowed" : "pointer", fontWeight: 600 }}
                  disabled={deleting}
                  onClick={confirmDelete}
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function IconButton({
  onClick,
  label,
  icon,
  disabled,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      style={{
        background: "transparent",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        padding: 6,
        borderRadius: 9999,
        color: "currentColor",
        opacity: disabled ? 0.4 : 0.85,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
      }}
    >
      {icon}
    </button>
  );
}
