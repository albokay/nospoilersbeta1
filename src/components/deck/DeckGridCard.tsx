/**
 * DeckGridCard — the "How I Watch TV" / "How We Watch TV" result surface
 * (swipe-deck arc CP3, desktop). One component, two modes:
 *
 *   • personal (base dashboard): your own answers, one color column.
 *   • group (group room): everyone's columns. Title flips to "We" when
 *     friends' columns are present (§11.5); a 1-member group reads "I".
 *
 * States: DOCKED (a peek pinned to the viewport bottom — the grid header
 * only) → tap → OPEN (centered card over the dimmed page; the docked peek
 * slides up) → pencil → EDIT (your column live, friends faded, confirm
 * checkmark riding the frozen header; batch save like the room map's
 * commitRatings — parallel upserts, patch in place, revert on failure).
 *
 * Frozen panes (§11.6): statements + (me) stick left, the header row sticks
 * top; friends scroll. n=2 renders the computed header line inline in the
 * card (§5/§7.6.2b); n≥3 renders the "Findings:" sticky beside the card
 * (§7.5/§7.6.2 — desktop-only), generated on load, cleared on edit-entry,
 * regenerated on confirm.
 *
 * Self-hiding: no released cards, or nobody has answered anything → no
 * docked card at all (pre-seed / pre-catch-up accounts see nothing).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, CircleCheck } from "lucide-react";
import LoadingDots from "../LoadingDots";
import StickyNote from "../StickyNote";
import {
  fetchDeckCards, fetchMyDeckAnswers, fetchGroupDeckAnswers, upsertDeckAnswer,
  type DeckCard, type GroupDeckAnswer,
} from "../../lib/db";
import { pairHeaderLine, computeFindings, type DeckMember } from "../../lib/deckFindings";
import { CANON } from "../../styles/canon";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

const STATEMENT_W = 440;
const MEMBER_W = 104;
const ROW_MIN_H = 52;

export default function DeckGridCard({ mode, groupId, others = [], viewerId }: {
  mode: "personal" | "group";
  groupId?: string;
  /** Group mode: the OTHER members (viewer excluded), in display order. */
  others?: DeckMember[];
  viewerId: string;
}) {
  const [cards, setCards] = useState<DeckCard[] | null>(null);
  const [answers, setAnswers] = useState<GroupDeckAnswer[]>([]);
  const [ui, setUi] = useState<"docked" | "open" | "edit">("docked");
  const [edits, setEdits] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  // Click bounce on own cells in edit mode — the room map's two-phase
  // pattern (V2RoomMap): instant pop 'up' with no transition, then animate
  // back 'down' over 150ms; state clears so the transform rests at the
  // edit-mode scale.
  const [bounce, setBounce] = useState<{ cardId: string; phase: "up" | "down" } | null>(null);
  const [editTip, setEditTip] = useState(false);
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

  // Load the released deck + answers (group read includes the viewer's rows).
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

  // Self-hide: nothing released, or nobody here has answered anything.
  if (!cards || cards.length === 0 || answers.length === 0) return null;

  const isWe = mode === "group" && others.length > 0;
  const title = isWe ? "How We Watch TV" : "How I Watch TV";
  const columns: DeckMember[] = mode === "group" ? others : [];

  // §5 — the n=2 inline header (exactly one friend column).
  const pairLine = mode === "group" && others.length === 1
    ? pairHeaderLine(others[0].label, answers, viewerId, others[0].id)
    : null;

  // §7.5 — the Findings (n≥3), regenerated whenever answers change (i.e. on
  // load and after a confirm); cleared while editing (rendered gate below).
  const findings = mode === "group" && others.length >= 2
    ? computeFindings({ cards, answers, members: [{ id: viewerId, label: "you" }, ...others], viewerId })
    : null;

  function valueFor(userId: string, cardId: string): boolean | undefined {
    if (userId === viewerId && cardId in edits) return edits[cardId];
    const row = answers.find((a) => a.userId === userId && a.cardId === cardId);
    return row?.answer;
  }

  function toggleOwn(cardId: string) {
    if (ui !== "edit" || saving) return;
    const cur = valueFor(viewerId, cardId);
    // Answered cells flip yes↔no; an unanswered own cell starts at yes
    // (the safety-net in-place answer — the forced modal is the real flow).
    setEdits((prev) => ({ ...prev, [cardId]: cur === undefined ? true : !cur }));
    triggerBounce(cardId);
  }

  async function confirmEdits() {
    if (saving) return;
    const changed = Object.entries(edits).filter(([cardId, v]) => {
      const orig = answers.find((a) => a.userId === viewerId && a.cardId === cardId)?.answer;
      return orig !== v;
    });
    if (!changed.length) { setEdits({}); setUi("open"); return; }
    setSaving(true);
    try {
      await Promise.all(changed.map(([cardId, answer]) => upsertDeckAnswer({ userId: viewerId, cardId, answer })));
      // Patch in place (commitRatings pattern) — no refetch.
      setAnswers((prev) => {
        const next = prev.filter((a) => !(a.userId === viewerId && changed.some(([id]) => id === a.cardId)));
        for (const [cardId, answer] of changed) next.push({ userId: viewerId, cardId, answer, answeredAt: Date.now() });
        return next;
      });
      setEdits({});
      setUi("open");
    } catch (e) {
      console.warn("[deck] edit save failed — keeping edit mode:", e);
    } finally {
      setSaving(false);
    }
  }

  // ── The grid header row (shared by the docked peek + the open card).
  // alignItems: baseline puts "(me)" + the friend names on the TITLE's
  // baseline (Alborz QA 2026-07-18); the last column flex-grows so the
  // colored area runs flush to the card's right edge. ───────────────────────
  const headerRow = (interactive: boolean) => (
    <div style={{ display: "flex", alignItems: "baseline", background: CANON.cream }}>
      <div style={{ width: STATEMENT_W, minWidth: STATEMENT_W, padding: "16px 8px 12px 24px", position: "sticky", left: 0, background: CANON.cream, zIndex: 3, boxSizing: "border-box" }}>
        <span style={{ fontFamily: LORA, fontWeight: 700, fontSize: 32, color: CANON.identity, whiteSpace: "nowrap" }}>{title}</span>
      </div>
      <div style={{ width: MEMBER_W, minWidth: MEMBER_W, position: "sticky", left: STATEMENT_W, background: CANON.cream, zIndex: 3, textAlign: "center", boxSizing: "border-box", ...(columns.length === 0 ? { flexGrow: 1 } : {}) }}>
        {ui === "edit" ? (
          <button title="save your answers" onClick={confirmEdits} disabled={saving}
            style={{ border: "none", background: "transparent", cursor: "pointer", color: CANON.alert, display: "inline-flex", alignItems: "center" }}>
            {saving ? <LoadingDots /> : <CircleCheck size={22} strokeWidth={2.5} />}
          </button>
        ) : (
          <>
            {isWe && <span style={{ ...colName, display: "block" }}>(me)</span>}
            {interactive && (
              <span style={{ position: "relative", display: "inline-block" }}>
                <button
                  onClick={() => { setEdits({}); setUi("edit"); }}
                  onMouseEnter={() => setEditTip(true)}
                  onMouseLeave={() => setEditTip(false)}
                  style={{ border: "none", background: "transparent", cursor: "pointer", color: CANON.identity, padding: 2, display: "inline-flex" }}>
                  <Pencil size={14} />
                </button>
                {editTip && (
                  <span style={editTipBubble}>Edit answers?</span>
                )}
              </span>
            )}
          </>
        )}
      </div>
      {columns.map((m, ci) => (
        <div key={m.id} style={{ width: MEMBER_W, minWidth: MEMBER_W, textAlign: "center", boxSizing: "border-box", opacity: ui === "edit" ? 0.45 : 1, ...(ci === columns.length - 1 ? { flexGrow: 1 } : {}) }}>
          <span style={colName}>{m.label}</span>
        </div>
      ))}
    </div>
  );

  const cardW = Math.min(STATEMENT_W + MEMBER_W * (columns.length + 1) + 2, typeof window !== "undefined" ? window.innerWidth * 0.92 : 1200);

  // ── DOCKED — the header row peeking at the viewport bottom ────────────────
  if (ui === "docked") {
    return (
      <div
        role="button"
        title={`open ${title}`}
        onClick={() => setUi("open")}
        style={{
          position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
          width: cardW, zIndex: 40, cursor: "pointer",
          background: CANON.cream, borderRadius: "24px 24px 0 0",
          boxShadow: "0 -6px 24px rgba(0,0,0,0.18)", overflow: "hidden",
        }}
      >
        {headerRow(false)}
      </div>
    );
  }

  // ── OPEN / EDIT — centered card over the dimmed page ──────────────────────
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(26,58,74,0.25)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box" }}
      onClick={(e) => { if (e.target === e.currentTarget && ui === "open") setUi("docked"); }}
    >
      <div style={{ width: cardW, maxWidth: "92vw", maxHeight: "82vh", background: CANON.cream, borderRadius: 24, boxShadow: "0 12px 36px rgba(0,0,0,0.25)", overflow: "auto", animation: "deckGridIn .24s ease" }}>
        {/* Frozen top: the header (title + names + pencil/confirm). The
            divider sits under the WHOLE header block — below the n=2 line
            when present, never between heading and subheading. */}
        <div style={{ position: "sticky", top: 0, zIndex: 4, background: CANON.cream, borderBottom: `2px solid ${withA(CANON.business, 0.3)}` }}>
          {headerRow(true)}
          {pairLine && (
            <div style={{ padding: "0 24px 10px", fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, color: CANON.personal, background: CANON.cream }}>
              {pairLine}
            </div>
          )}
        </div>

        {cards.map((card, i) => {
          const mine = valueFor(viewerId, card.id);
          // Edit mode shrinks the own-column color block into a rounded,
          // tappable chip (animated via the standing transition); clicks
          // bounce it (the room map's rating-edit feel).
          const phase = bounce?.cardId === card.id ? bounce.phase : null;
          const editing = ui === "edit";
          return (
            <div key={card.id} style={{ display: "flex", minHeight: ROW_MIN_H, alignItems: "stretch" }}>
              <div style={{ width: STATEMENT_W, minWidth: STATEMENT_W, position: "sticky", left: 0, zIndex: 2, background: i % 2 === 0 ? CANON.friend : CANON.cream, padding: "10px 16px 10px 24px", boxSizing: "border-box", display: "flex", alignItems: "center", fontFamily: "Inter, sans-serif", fontSize: 14, lineHeight: 1.35, color: CANON.dark }}>
                {card.statement}
              </div>
              <div
                onClick={() => toggleOwn(card.id)}
                style={{
                  width: MEMBER_W, minWidth: MEMBER_W, boxSizing: "border-box",
                  position: "sticky", left: STATEMENT_W, zIndex: 2,
                  background: CANON.cream, display: "flex", alignItems: "stretch",
                  borderLeft: mine === undefined && !editing ? `1px solid ${withA(CANON.business, 0.18)}` : "none",
                  cursor: editing ? "pointer" : "default",
                  ...(columns.length === 0 ? { flexGrow: 1 } : {}),
                }}
              >
                {/* Sharp corners on the edit chips (Alborz QA 2026-07-18). */}
                <div style={{
                  flex: 1,
                  background: mine === undefined ? "transparent" : mine ? CANON.personal : CANON.alert,
                  border: editing && mine === undefined ? `1.5px dashed ${withA(CANON.business, 0.6)}` : "none",
                  transform: editing ? (phase === "up" ? "scale(0.94)" : "scale(0.82)") : undefined,
                  transition: phase === "up" ? "none" : "transform .18s ease",
                }} />
              </div>
              {columns.map((m, ci) => (
                <div key={m.id} style={{ ...cell(valueFor(m.id, card.id)), opacity: editing ? 0.45 : 1, ...(ci === columns.length - 1 ? { flexGrow: 1 } : {}) }} />
              ))}
            </div>
          );
        })}
      </div>

      {/* §7.6.2 — the Findings sticky, beside the card (n≥3; cleared while
          editing; no dismiss X by design). */}
      {ui === "open" && findings && (
        <StickyNote
          tone="cream"
          tilt={2.5}
          width={290}
          fontSize={13}
          ignoreViewportGate={false}
          animateEntrance
          style={{ left: `calc(50% + ${Math.min(cardW / 2, window.innerWidth * 0.46) - 60}px)`, top: "14%", zIndex: 910 }}
        >
          <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Findings:</div>
          <div style={{ fontWeight: 700, marginBottom: findings.quotes.length ? 4 : 8 }}>{findings.headline}</div>
          {findings.quotes.map((q) => (
            <div key={q} style={{ fontStyle: "italic", margin: "2px 0" }}>· &ldquo;{q}&rdquo;</div>
          ))}
          {findings.lines.map((l) => (
            <div key={l} style={{ marginTop: 8 }}>{l}</div>
          ))}
        </StickyNote>
      )}
      <style>{`@keyframes deckGridIn { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}

// The site's tipBubble look (DashboardPage), anchored above the pencil.
const editTipBubble: React.CSSProperties = {
  position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
  background: CANON.personal, color: CANON.cream, padding: "7px 12px", borderRadius: 12,
  fontFamily: '"Inter", sans-serif', fontSize: 13, fontWeight: 600, lineHeight: 1.3,
  whiteSpace: "nowrap", pointerEvents: "none", zIndex: 10, boxShadow: "0 6px 18px rgba(0,0,0,0.2)",
};

const colName: React.CSSProperties = {
  fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 13, color: CANON.dark,
  maxWidth: MEMBER_W - 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

function cell(v: boolean | undefined): React.CSSProperties {
  return {
    width: MEMBER_W, minWidth: MEMBER_W, boxSizing: "border-box",
    background: v === undefined ? CANON.cream : v ? CANON.personal : CANON.alert,
    borderLeft: v === undefined ? `1px solid ${withA(CANON.business, 0.18)}` : "none",
  };
}

function withA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
