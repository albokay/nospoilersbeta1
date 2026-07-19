/**
 * MobileDeckCard — the mobile "How I Watch TV" / "How We Watch TV" result
 * surfaces (swipe-deck arc CP3b; approved rev-2 mockup
 * docs/swipe-deck/mobile-result-surfaces-preview.html).
 *
 * Mobile leads with the ANSWERS-LED artifact (§7.6.1/§12.10) — never the
 * synthesis (the Findings sticky is desktop-only):
 *
 *   DOCKED  — title + the in-card Sidebar mark peeking at the viewport
 *             bottom (same grammar as desktop's docked cards).
 *   SHEET   — tap → slides up over the dimmed page: the latest answers as
 *             statement + Lucide thumb (personal-green up / alert-red down;
 *             group rows show one thumb per member, a business dot when a
 *             member hasn't answered that card). The n=2 header line sits
 *             under the title. First-set conditional copy (§7.6.1): with
 *             only the first 8 answered the subtitle drops "latest" and the
 *             "see all" tap is hidden.
 *   GRID    — the full grid behind a tap (§11.6 frozen panes: statements +
 *             (me) pinned left, header pinned top; friends scroll under the
 *             card's own horizontal scroll). Cells carry a cream thumb
 *             centered on their color.
 *   EDIT    — pencil under (me): your column live, friends faded, confirm
 *             checkmark riding the frozen header; batch save + patch in
 *             place (the commitRatings pattern), same as desktop.
 *
 * Self-hiding like desktop: no released cards or no answers → nothing.
 * The artifact card is screenshot-safe: the Sidebar mark is baked in.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pencil, CircleCheck, ThumbsUp, ThumbsDown, X } from "lucide-react";
import LoadingDots from "../LoadingDots";
import {
  fetchDeckCards, fetchMyDeckAnswers, fetchGroupDeckAnswers, upsertDeckAnswer,
  type DeckCard, type GroupDeckAnswer,
} from "../../lib/db";
import { pairHeaderLine, type DeckMember } from "../../lib/deckFindings";
import { CANON } from "../../styles/canon";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';
const WINDOW = 8;   // §7.6.1 "latest N" window
const ST_W = 150;   // statement column (grid view)
const ME_W = 48;    // (me) column
const FR_W = 56;    // friend columns

export default function MobileDeckCard({ mode, groupId, others = [], viewerId }: {
  mode: "personal" | "group";
  groupId?: string;
  /** Group mode: the OTHER members (viewer excluded), display order. */
  others?: DeckMember[];
  viewerId: string;
}) {
  const [cards, setCards] = useState<DeckCard[] | null>(null);
  const [answers, setAnswers] = useState<GroupDeckAnswer[]>([]);
  const [ui, setUi] = useState<"docked" | "sheet" | "grid" | "edit">("docked");
  const [edits, setEdits] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  // Click bounce on own cells in edit mode — the room map's two-phase
  // pattern (V2RoomMap): instant pop 'up', animate back 'down' over 150ms.
  const [bounce, setBounce] = useState<{ cardId: string; phase: "up" | "down" } | null>(null);
  function triggerBounce(cardId: string) {
    setBounce({ cardId, phase: "up" });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setBounce((prev) => (prev && prev.cardId === cardId ? { cardId, phase: "down" } : prev));
      });
    });
    window.setTimeout(() => {
      setBounce((prev) => (prev && prev.cardId === cardId && prev.phase === "down" ? null : prev));
    }, 200);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [deck, rows] = await Promise.all([
        fetchDeckCards(),
        mode === "group" && groupId
          ? fetchGroupDeckAnswers(groupId)
          : fetchMyDeckAnswers(viewerId).then((m) =>
              Object.entries(m).map(([cardId, answer]) => ({ userId: viewerId, cardId, answer, answeredAt: 0 })),
            ),
      ]);
      if (cancelled) return;
      setCards(deck);
      setAnswers(rows);
    })();
    return () => { cancelled = true; };
  }, [mode, groupId, viewerId]);

  const myAnswers = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const a of answers) if (a.userId === viewerId) m[a.cardId] = a.answer;
    return m;
  }, [answers, viewerId]);

  if (!cards || cards.length === 0 || answers.length === 0) return null;

  const isWe = mode === "group" && others.length > 0;
  const title = isWe ? "How We Watch TV" : "How I Watch TV";
  const columns: DeckMember[] = mode === "group" ? others : [];

  // The artifact window: the newest answered cards (release/serve order —
  // "latest" = the most recent batch you answered), newest first.
  const answeredMine = cards.filter((c) => myAnswers[c.id] !== undefined);
  const anyAnswered = mode === "group"
    ? cards.filter((c) => answers.some((a) => a.cardId === c.id))
    : answeredMine;
  const windowRows = [...anyAnswered].sort((a, b) => b.sortOrder - a.sortOrder).slice(0, WINDOW);
  const firstSet = answeredMine.length <= WINDOW; // §7.6.1 conditional copy
  const subtitle = mode === "group"
    ? "our answers on Sidebar"
    : firstSet ? "my answers on Sidebar" : "my latest answers on Sidebar";

  const pairLine = mode === "group" && others.length === 1
    ? pairHeaderLine(others[0].label, answers, viewerId, others[0].id)
    : null;

  function valueFor(userId: string, cardId: string): boolean | undefined {
    if (userId === viewerId && cardId in edits) return edits[cardId];
    const row = answers.find((a) => a.userId === userId && a.cardId === cardId);
    return row?.answer;
  }

  function toggleOwn(cardId: string) {
    if (ui !== "edit" || saving) return;
    const cur = valueFor(viewerId, cardId);
    setEdits((prev) => ({ ...prev, [cardId]: cur === undefined ? true : !cur }));
    triggerBounce(cardId);
  }

  async function confirmEdits() {
    if (saving) return;
    const changed = Object.entries(edits).filter(([cardId, v]) => {
      const orig = answers.find((a) => a.userId === viewerId && a.cardId === cardId)?.answer;
      return orig !== v;
    });
    if (!changed.length) { setEdits({}); setUi("grid"); return; }
    setSaving(true);
    try {
      await Promise.all(changed.map(([cardId, answer]) => upsertDeckAnswer({ userId: viewerId, cardId, answer })));
      setAnswers((prev) => {
        const next = prev.filter((a) => !(a.userId === viewerId && changed.some(([id]) => id === a.cardId)));
        for (const [cardId, answer] of changed) next.push({ userId: viewerId, cardId, answer, answeredAt: Date.now() });
        return next;
      });
      setEdits({});
      setUi("grid");
    } catch (e) {
      console.warn("[deck] edit save failed — keeping edit mode:", e);
    } finally {
      setSaving(false);
    }
  }

  // ── DOCKED ────────────────────────────────────────────────────────────────
  if (ui === "docked") {
    return (
      <div
        role="button"
        title={`open ${title}`}
        onClick={() => setUi("sheet")}
        style={{
          position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
          width: "calc(100% - 28px)", maxWidth: 520, zIndex: 40, cursor: "pointer",
          background: CANON.cream, borderRadius: "24px 24px 0 0",
          boxShadow: "0 -6px 24px rgba(0,0,0,0.18)",
          padding: "16px 20px calc(env(safe-area-inset-bottom, 0px) + 10px)",
          boxSizing: "border-box",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        }}
      >
        <span style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, color: CANON.identity, whiteSpace: "nowrap" }}>{title}</span>
      </div>
    );
  }

  // ── SHEET — the answers-led artifact ──────────────────────────────────────
  if (ui === "sheet") {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 1000 }}>
        <div style={{ position: "absolute", inset: 0, background: "rgba(26,58,74,0.35)" }} onClick={() => setUi("docked")} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 96, background: CANON.cream, borderRadius: "24px 24px 0 0", boxShadow: "0 -8px 28px rgba(0,0,0,0.28)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ width: 44, height: 4, borderRadius: 2, background: CANON.business, opacity: 0.5, margin: "10px auto 0" }} />
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "16px 20px 10px" }}>
            <div>
              <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, color: CANON.identity, whiteSpace: "nowrap" }}>{title}</div>
              <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 11.5, color: CANON.business, marginTop: 3 }}>{subtitle}</div>
              {pairLine && (
                <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 13, color: CANON.personal, marginTop: 6 }}>{pairLine}</div>
              )}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
            {windowRows.map((card, i) => (
              <div key={card.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 20px", fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.35, color: CANON.dark, background: i % 2 === 0 ? "rgba(173,200,215,0.45)" : "transparent" }}>
                <span>{card.statement}</span>
                {mode === "personal" ? (
                  <Th v={myAnswers[card.id]!} size={18} />
                ) : (
                  <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {[{ id: viewerId }, ...columns].map((m) => {
                      const v = valueFor(m.id, card.id);
                      return (
                        <span key={m.id} style={{ width: 20, display: "flex", justifyContent: "center", alignItems: "center" }}>
                          {v === undefined
                            ? <span style={{ color: CANON.business, fontWeight: 700 }}>·</span>
                            : <Th v={v} size={16} />}
                        </span>
                      );
                    })}
                  </span>
                )}
              </div>
            ))}
          </div>
          {(mode === "group" || !firstSet) && (
            <button
              onClick={() => setUi("grid")}
              style={{ border: "none", background: "transparent", cursor: "pointer", padding: "12px 20px calc(env(safe-area-inset-bottom, 0px) + 12px)", textAlign: "right", fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 12, color: CANON.identity }}
            >
              {mode === "group" ? "tap for the full grid →" : "see all →"}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── GRID / EDIT — frozen panes (§11.6) ────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(26,58,74,0.35)", display: "flex", flexDirection: "column" }}>
      {ui === "grid" && (
        <button onClick={() => setUi("sheet")} aria-label="close"
          style={{ position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 8px)", right: 14, zIndex: 2, border: "none", background: "transparent", color: CANON.cream, cursor: "pointer", padding: 6 }}>
          <X size={24} />
        </button>
      )}
      <div style={{ position: "absolute", left: 10, right: 10, top: "calc(env(safe-area-inset-top, 0px) + 44px)", bottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)", background: CANON.cream, borderRadius: 20, boxShadow: "0 8px 24px rgba(0,0,0,0.18)", overflow: "auto", WebkitOverflowScrolling: "touch" }}>
        {/* Frozen top: title + (me) + names. */}
        <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 4, background: CANON.cream, borderBottom: `2px solid rgba(141,170,186,0.3)`, minWidth: ST_W + ME_W + FR_W * columns.length }}>
          <div style={{ width: ST_W, minWidth: ST_W, position: "sticky", left: 0, background: CANON.cream, zIndex: 3, padding: "14px 8px 8px 14px", boxSizing: "border-box", display: "flex", alignItems: "flex-end" }}>
            <span style={{ fontFamily: LORA, fontWeight: 700, fontSize: 13.5, color: CANON.identity, whiteSpace: "nowrap" }}>{title}</span>
          </div>
          <div style={{ width: ME_W, minWidth: ME_W, position: "sticky", left: ST_W, background: CANON.cream, zIndex: 3, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", paddingBottom: 4, boxSizing: "border-box" }}>
            {ui === "edit" ? (
              <button title="save your answers" onClick={confirmEdits} disabled={saving}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: CANON.alert, display: "flex", alignItems: "center", padding: 2 }}>
                {saving ? <LoadingDots /> : <CircleCheck size={20} strokeWidth={2.5} />}
              </button>
            ) : (
              <>
                {isWe && <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 11, color: CANON.dark }}>(me)</span>}
                <button title="Edit answers?" onClick={() => { setEdits({}); setUi("edit"); }}
                  style={{ border: "none", background: "transparent", cursor: "pointer", color: CANON.identity, padding: 2, display: "flex" }}>
                  <Pencil size={12} />
                </button>
              </>
            )}
          </div>
          {columns.map((m) => (
            <div key={m.id} style={{ width: FR_W, minWidth: FR_W, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 6, boxSizing: "border-box", opacity: ui === "edit" ? 0.45 : 1 }}>
              <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 10.5, color: CANON.dark, maxWidth: FR_W - 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</span>
            </div>
          ))}
        </div>

        {cards.map((card, i) => {
          const mine = valueFor(viewerId, card.id);
          return (
            <div key={card.id} style={{ display: "flex", minHeight: 42, alignItems: "stretch", minWidth: ST_W + ME_W + FR_W * columns.length }}>
              <div style={{ width: ST_W, minWidth: ST_W, position: "sticky", left: 0, zIndex: 2, background: i % 2 === 0 ? CANON.friend : CANON.cream, padding: "6px 8px 6px 14px", boxSizing: "border-box", display: "flex", alignItems: "center", fontFamily: "Inter, sans-serif", fontSize: 10.5, lineHeight: 1.3, color: CANON.dark }}>
                {card.statement}
              </div>
              <div
                onClick={() => toggleOwn(card.id)}
                style={{
                  width: ME_W, minWidth: ME_W, boxSizing: "border-box",
                  position: "sticky", left: ST_W, zIndex: 2,
                  background: CANON.cream, display: "flex", alignItems: "stretch",
                  borderLeft: mine === undefined && ui !== "edit" ? "1px solid rgba(141,170,186,0.18)" : "none",
                  cursor: ui === "edit" ? "pointer" : "default",
                }}
              >
                {/* Edit mode shrinks the color block into a rounded chip;
                    taps bounce it (the room map's rating-edit feel). */}
                <div style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                  background: mine === undefined ? "transparent" : mine ? CANON.personal : CANON.alert,
                  border: ui === "edit" && mine === undefined ? "1.5px dashed rgba(141,170,186,0.6)" : "none",
                  borderRadius: ui === "edit" ? 8 : 0,
                  transform: ui === "edit"
                    ? (bounce?.cardId === card.id && bounce.phase === "up" ? "scale(0.94)" : "scale(0.82)")
                    : undefined,
                  transition: bounce?.cardId === card.id && bounce.phase === "up" ? "none" : "transform .18s ease, border-radius .18s ease",
                }}>
                  {mine !== undefined && <Th v={mine} size={14} color={CANON.cream} />}
                </div>
              </div>
              {columns.map((m) => {
                const v = valueFor(m.id, card.id);
                return (
                  <div key={m.id} style={{ ...mCell(v, FR_W), opacity: ui === "edit" ? 0.45 : 1 }}>
                    {v !== undefined && <Th v={v} size={14} color={CANON.cream} />}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Lucide thumb — personal-green up / alert-red down (or forced color). */
function Th({ v, size, color }: { v: boolean; size: number; color?: string }) {
  const c = color ?? (v ? CANON.personal : CANON.alert);
  return v
    ? <ThumbsUp size={size} color={c} strokeWidth={2.2} style={{ flexShrink: 0 }} />
    : <ThumbsDown size={size} color={c} strokeWidth={2.2} style={{ flexShrink: 0 }} />;
}

function mCell(v: boolean | undefined, w: number): React.CSSProperties {
  return {
    width: w, minWidth: w, boxSizing: "border-box",
    display: "flex", alignItems: "center", justifyContent: "center",
    background: v === undefined ? CANON.cream : v ? CANON.personal : CANON.alert,
    borderLeft: v === undefined ? "1px solid rgba(141,170,186,0.18)" : "none",
  };
}
