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
 *             statement + Lucide thumb (personal-green up / alert-red down).
 *             Group rows show one slot per member — answer-to-reveal
 *             (2026-08-01): a revealed thumb, a covered greyblue "?" (they
 *             answered, you haven't — tap it for the tip), or plain empty
 *             (unanswered; the old business dot is retired). The n=2 header
 *             line sits under the title. First-set conditional copy
 *             (§7.6.1): with only the first 8 answered the subtitle drops
 *             "latest" and the "see all" tap is hidden.
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
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, CircleCheck, ThumbsUp, ThumbsDown, ArrowRight, X } from "lucide-react";
import LoadingDots from "../LoadingDots";
import {
  fetchDeckCards, fetchMyDeckAnswers, fetchGroupDeckAnswers, upsertDeckAnswer,
  type DeckCard, type GroupDeckAnswer,
} from "../../lib/db";
import { pairHeaderLine, computeCardFindings, type DeckMember } from "../../lib/deckFindings";
import { joinNames } from "../../lib/groupNames";
import { useAuth } from "../../lib/auth";
import SidebarLogo from "../SidebarLogo";
import { CANON } from "../../styles/canon";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';
const WINDOW = 8;   // §7.6.1 "latest N" window
const ST_W = 170;   // statement column (grid view) — wide enough for the
                    // title + its pencil/save-check (Alborz 2026-08-11: the
                    // check was clipping under the sticky (me) column at 150)
const ME_W = 48;    // (me) column
const FR_W = 56;    // friend columns
const SHEET_CW = 36; // sheet answer columns (air-tight grid, 2026-08-14)

export default function MobileDeckCard({ mode, groupId, others = [], viewerId }: {
  mode: "personal" | "group";
  groupId?: string;
  /** Group mode: the OTHER members (viewer excluded), display order. */
  others?: DeckMember[];
  viewerId: string;
}) {
  const [cards, setCards] = useState<DeckCard[] | null>(null);
  const [answers, setAnswers] = useState<GroupDeckAnswer[]>([]);
  const [ui, setUi] = useState<"docked" | "sheet" | "grid" | "edit" | "findings">("docked");
  // The findings card names its owner once ("Al, with …") — the viewer's own
  // first name, straight from the profile (contact names never apply to self).
  const { profile } = useAuth();
  const [edits, setEdits] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  // Click bounce on own cells in edit mode — the room map's two-phase
  // pattern (V2RoomMap): instant pop 'up', animate back 'down' over 150ms.
  const [bounce, setBounce] = useState<{ cardId: string; phase: "up" | "down" } | null>(null);
  const [tapTip, setTapTip] = useState<{ plural: boolean; x: number; y: number } | null>(null);
  const tapTipTimer = useRef<number | null>(null);
  function showTapTip(cardId: string, e: React.MouseEvent) {
    if (tapTipTimer.current) window.clearTimeout(tapTipTimer.current);
    setTapTip({ plural: coveredCount(cardId) > 1, x: e.clientX, y: e.clientY });
    tapTipTimer.current = window.setTimeout(() => setTapTip(null), 3500);
  }
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
    for (const a of answers) if (a.userId === viewerId && a.answer != null) m[a.cardId] = a.answer;
    return m;
  }, [answers, viewerId]);

  if (!cards || cards.length === 0 || answers.length === 0) return null;

  // Group room = "We" even before anyone else joins (Alborz 2026-08-01):
  // the dock is the group's object; a solo founder reading "I" made it look
  // personal. (Desktop still flips on others.length — flagged, one word.)
  const isWe = mode === "group";
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
  // Blanks the viewer can still fill — the "see more answers" route opens
  // whenever any exist, not just past 8 answered (help-system CP1, standing
  // issue (h)). Counted over the GRID's rows (what the group has answered)
  // rather than the whole deck, so the route never promises a grid with
  // nothing of theirs left to fill.
  const hasUnanswered = anyAnswered.some((c) => myAnswers[c.id] === undefined);
  // No group subtitle (Alborz QA 2026-07-18 — "our answers on Sidebar" cut).
  const subtitle = mode === "group"
    ? null
    : firstSet ? "my answers on Sidebar" : "my latest answers on Sidebar";

  // Answer-to-reveal pull signal (Alborz §6.1): revealable answers exist —
  // any friend row on a card the viewer hasn't answered.
  const hasRevealable = mode === "group" && answers.some((a) => a.userId !== viewerId && myAnswers[a.cardId] === undefined);

  // The tap-tip (mobile's hover equivalent, Alborz rev 2): tapping a "?"
  // pops the same two-line copy near the tap; the next tap anywhere (the
  // catcher below) or 3.5s dismisses it. Rendered by sheet AND grid.
  const tapTipOverlay = tapTip ? (
    <div style={{ position: "fixed", inset: 0, zIndex: 1002 }} onClick={() => setTapTip(null)}>
      <div style={{
        position: "fixed",
        left: Math.min(tapTip.x, (typeof window !== "undefined" ? window.innerWidth : 360) - 236),
        top: Math.max(tapTip.y - 78, 12),
        background: CANON.cream, color: CANON.dark, borderRadius: 10,
        padding: "10px 14px", fontFamily: '"Inter", sans-serif', fontWeight: 500,
        fontSize: 12.5, lineHeight: 1.5, whiteSpace: "nowrap", textAlign: "left",
        boxShadow: "0 6px 18px rgba(0,0,0,0.3)",
      }}>
        Your {tapTip.plural ? "friends have" : "friend has"} answered<br />this one. What do you think?
      </div>
    </div>
  ) : null;

  const pairLine = mode === "group" && others.length === 1
    ? pairHeaderLine(others[0].label, answers, viewerId, others[0].id)
    : null;

  // The findings card (n≥4 shareable; Option B rev 3, 2026-07-28) — group
  // mode with 4+ members and enough shared answers for the math to say
  // something; otherwise the "see findings" route never appears.
  const cardFindings = mode === "group" && others.length >= 3
    ? computeCardFindings({ cards, answers, members: [{ id: viewerId, label: "you" }, ...others], viewerId })
    : null;

  /** undefined = no row (unanswered) · null = masked, answer-to-reveal's
   *  covered mark · boolean = revealed. Own column can never be null. */
  function valueFor(userId: string, cardId: string): boolean | null | undefined {
    if (userId === viewerId && cardId in edits) return edits[cardId];
    const row = answers.find((a) => a.userId === userId && a.cardId === cardId);
    // Pre-migration the server still sends friends' answers concrete —
    // derive covered-ness locally so the gate holds either side of the SQL.
    if (row && userId !== viewerId && myAnswers[cardId] === undefined && !(cardId in edits)) return null;
    return row?.answer;
  }

  /** Covered answers waiting on a row — drives the tap tip's plural. */
  function coveredCount(cardId: string): number {
    if (myAnswers[cardId] !== undefined || cardId in edits) return 0;
    return answers.filter((a) => a.userId !== viewerId && a.cardId === cardId).length;
  }

  function toggleOwn(cardId: string) {
    if (ui !== "edit" || saving) return;
    const cur = valueFor(viewerId, cardId);
    setEdits((prev) => ({ ...prev, [cardId]: cur == null ? true : !cur }));
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
      // Newly-answered cards unmask friends' answers server-side — re-read
      // so the "?"s flip without a page nav.
      if (mode === "group" && groupId) {
        fetchGroupDeckAnswers(groupId).then((rows) => setAnswers(rows)).catch(() => {});
      }
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
        // Edge-to-edge (Alborz 2026-08-18): the dock runs to both screen
        // edges (was inset 14px a side); the top curve stays, and the title +
        // dot keep their exact screen positions (padding-left absorbs the
        // removed gap) — the poster rows peek out beneath more cleanly.
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          width: "100%", zIndex: 40, cursor: "pointer",
          background: CANON.cream, borderRadius: "24px 24px 0 0",
          boxShadow: "0 -6px 24px rgba(0,0,0,0.18)",
          padding: "16px 20px calc(env(safe-area-inset-bottom, 0px) + 10px) 34px",
          boxSizing: "border-box",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        }}
      >
        {/* Answers are waiting behind "?"s — the show-pill dot grammar,
            overlapping the card's top-left corner (Alborz rev 2). */}
        {hasRevealable && <span style={{ position: "absolute", top: -6, left: 20, width: 16, height: 16, borderRadius: "50%", background: CANON.identity, zIndex: 6, pointerEvents: "none" }} />}
        {/* Docked title matches the page behind it: Personal green on the
            dashboard, Sky in the group room (Alborz QA 2026-07-20);
            Identity once opened. */}
        <span style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, color: mode === "personal" ? CANON.personal : CANON.friend, whiteSpace: "nowrap" }}>{title}</span>
      </div>
    );
  }

  // ── SHEET — the answers-led artifact ──────────────────────────────────────
  if (ui === "sheet") {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 1000 }}>
        <div style={{ position: "absolute", inset: 0, background: "rgba(26,58,74,0.35)" }} onClick={() => setUi("docked")} />
        {/* "×" + tap-outside close (Alborz 2026-08-01 — the swipe handle and
            its gesture retired here with the tips sheet's, so the rows can
            scroll without competing with a drag). */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 96, background: CANON.cream, borderRadius: "24px 24px 0 0", boxShadow: "0 -8px 28px rgba(0,0,0,0.28)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* No "×" on THIS sheet (Alborz 2026-08-11 — it collided with the
              name columns; tap-outside closes). The pencil rides the title
              instead and jumps straight into the grid's edit mode. */}
          {/* Header + the vertical names SHARE this band (names bottom-
              aligned at the right) so they don't push the questions down
              with their own row (Alborz QA 2026-07-18). Name slot widths
              match the row cells below and run to the sheet's right EDGE
              (no band padding on that side) so the columns line up with the
              air-tight cells. */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "16px 0 8px 20px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, color: CANON.identity, whiteSpace: "nowrap" }}>{title}</div>
                {/* Group mode's pencil sits over the (me) column (Alborz
                    2026-08-14); personal has no (me), so it keeps the
                    beside-the-title spot. */}
                {mode === "personal" && (
                  <button title="Edit answers?" onClick={() => { setEdits({}); setUi("edit"); }}
                    style={{ border: "none", background: "transparent", cursor: "pointer", color: CANON.identity, padding: "4px 6px", display: "inline-flex" }}>
                    <Pencil size={15} />
                  </button>
                )}
              </div>
              {subtitle && <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 11.5, color: CANON.business, marginTop: 3 }}>{subtitle}</div>}
              {pairLine && (
                <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 13, color: CANON.personal, marginTop: 6 }}>{pairLine}</div>
              )}
            </div>
            {mode === "group" && (
              <div style={{ display: "flex", flexShrink: 0 }}>
                {[{ id: viewerId, label: "(me)" }, ...columns].map((m) => (
                  <span key={m.id} style={{ width: SHEET_CW, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
                    {/* The edit pencil rides ON TOP of "(me)" (Alborz
                        2026-08-14); the band grows to hold it — names stay
                        bottom-aligned. Jumps straight into the grid's edit
                        mode, as before. */}
                    {m.id === viewerId && (
                      <button title="Edit answers?" onClick={() => { setEdits({}); setUi("edit"); }}
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: CANON.identity, padding: 2, display: "inline-flex" }}>
                        <Pencil size={15} />
                      </button>
                    )}
                    <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 10, color: CANON.dark, maxHeight: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.label}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
            {/* AIR-TIGHT grid grammar (Alborz 2026-08-14): full-height color
                cells with cream thumbs tile edge-to-edge under the name
                columns, exactly like the full grid — the floating mini-cells
                are retired. Covered stays the greyblue "?" cell (tap for the
                tip); unanswered continues the row stripe. */}
            {windowRows.map((card, i) => {
              const stripe = i % 2 === 0 ? "rgba(173,200,215,0.45)" : "transparent";
              const cols = mode === "personal" ? [{ id: viewerId }] : [{ id: viewerId }, ...columns];
              return (
                <div key={card.id} style={{ display: "flex", alignItems: "stretch", minHeight: 44, fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.35, color: CANON.dark }}>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", padding: "11px 12px 11px 20px", background: stripe }}>{card.statement}</span>
                  {cols.map((m) => {
                    const v = mode === "personal" ? myAnswers[card.id] : valueFor(m.id, card.id);
                    return (
                      <span
                        key={m.id}
                        onClick={v === null ? (e) => { e.stopPropagation(); showTapTip(card.id, e); } : undefined}
                        style={{
                          width: SHEET_CW, minWidth: SHEET_CW, display: "flex", alignItems: "center", justifyContent: "center",
                          background: v === undefined ? stripe : v === null ? CANON.business : v ? CANON.personal : CANON.alert,
                          cursor: v === null ? "pointer" : "default",
                        }}
                      >
                        {v === null
                          ? <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 800, fontSize: 13, color: CANON.friend, userSelect: "none" }}>?</span>
                          : v !== undefined && <Th v={v} size={15} color={CANON.cream} />}
                      </span>
                    );
                  })}
                </div>
              );
            })}
            {/* Right under the question list, not pinned to the screen
                bottom. Appears once there's MORE than the sheet shows
                (Alborz QA 2026-07-18 — at 8 answered the sheet already IS
                everything) OR the viewer has unanswered cards to fill in
                via the grid's pencil. */}
            {(hasUnanswered || (mode === "group" ? anyAnswered.length > WINDOW : !firstSet)) && (
              <button
                onClick={() => setUi("grid")}
                style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", padding: "12px 20px", fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 12, color: CANON.identity }}
              >
                see more answers <ArrowRight size={13} strokeWidth={2.5} />
              </button>
            )}
            {cardFindings && (
              <button
                onClick={() => setUi("findings")}
                style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", padding: "4px 20px 12px", fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 12, color: CANON.identity }}
              >
                see findings <ArrowRight size={13} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
        {tapTipOverlay}
      </div>
    );
  }

  // ── FINDINGS — the n≥4 shareable card (Option B rev 3, 2026-07-28) ────────
  // Clean solid background (no page text behind — Alborz), close returns to
  // the answers sheet. A screenshot is the share: no share button.
  if (ui === "findings" && cardFindings) {
    const quoteEnd = (t: string) => (t.startsWith("“") || t.startsWith('"')) ? t.indexOf(t[0] === '"' ? '"' : "”", 1) : -1;
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: CANON.friend }}>
        <button onClick={() => setUi("sheet")} aria-label="close"
          style={{ position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 8px)", right: 14, zIndex: 2, border: "none", background: "transparent", color: CANON.cream, cursor: "pointer", padding: 6 }}>
          <X size={24} />
        </button>
        <div style={{ position: "absolute", left: 20, right: 20, top: "calc(env(safe-area-inset-top, 0px) + 72px)", background: CANON.cream, borderRadius: 20, boxShadow: "0 12px 32px rgba(0,0,0,0.3)", padding: "20px 20px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 20, color: CANON.identity, whiteSpace: "nowrap" }}>How We Watch TV</div>
              <div style={{ fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.5, color: CANON.dark, margin: "4px 0 16px" }}>
                {profile?.display_name ?? "Me"}, with {joinNames(others.map((o) => o.label))}
              </div>
            </div>
            {/* The dynamic logo, on the card's own cream (surfaceBg keeps the
                cream block visible on the cream surface). */}
            <SidebarLogo scale={0.34} wordmarkTint={CANON.dark} surfaceBg={CANON.cream} />
          </div>
          <div style={{ fontFamily: LORA, fontWeight: 600, fontSize: 19, lineHeight: 1.35, color: CANON.identity, marginBottom: 16 }}>{cardFindings.headline}</div>
          {cardFindings.lines.map((l, i) => {
            // Emphasis: the ally/opposite name bolds Identity; a leading
            // quoted statement renders italic (the rev-3 mockup treatment).
            const bi = l.bold ? l.text.indexOf(l.bold) : -1;
            const qe = quoteEnd(l.text);
            return (
              <div key={i} style={{ fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.55, marginBottom: 13, color: CANON.dark }}>
                {bi >= 0 && l.bold ? (
                  <>{l.text.slice(0, bi)}<b style={{ color: CANON.identity }}>{l.bold}</b>{l.text.slice(bi + l.bold.length)}</>
                ) : qe > 0 ? (
                  <><i>{l.text.slice(0, qe + 1)}</i>{l.text.slice(qe + 1)}</>
                ) : l.text}
              </div>
            );
          })}
          <div style={{ borderTop: "1px solid rgba(141,170,186,0.4)", marginTop: 14, paddingTop: 10, fontFamily: "Inter, sans-serif", fontSize: 11, fontWeight: 600, color: CANON.business, display: "flex", justifyContent: "space-between" }}>
            <span>{answeredMine.length} questions answered</span>
            <span>beta.sidebar.watch</span>
          </div>
        </div>
      </div>
    );
  }

  // ── GRID / EDIT — frozen panes (§11.6) ────────────────────────────────────
  // Clean solid background behind the open grid (was the page dim — Alborz
  // 2026-07-28: page text showing through caused confusion).
  // Columns sit FLUSH at the card's right edge (Alborz 2026-08-12): the
  // statement column absorbs any leftover width — never an empty strip after
  // the columns. With more columns than fit, statements keep their minimum
  // and the grid scrolls.
  const availW = (typeof window !== "undefined" ? window.innerWidth : 390) - 20;
  const stW = Math.max(ST_W, availW - ME_W - FR_W * columns.length);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: mode === "personal" ? CANON.personal : CANON.friend, display: "flex", flexDirection: "column" }}>
      {ui !== "edit" && (
        <button onClick={() => setUi("sheet")} aria-label="close"
          style={{ position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 8px)", right: 14, zIndex: 2, border: "none", background: "transparent", color: CANON.cream, cursor: "pointer", padding: 6 }}>
          <X size={24} />
        </button>
      )}
      <div style={{ position: "absolute", left: 10, right: 10, top: "calc(env(safe-area-inset-top, 0px) + 44px)", bottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)", background: CANON.cream, borderRadius: 20, boxShadow: "0 8px 24px rgba(0,0,0,0.18)", overflow: "auto", WebkitOverflowScrolling: "touch" }}>
        {/* Frozen top: title + (me) + names. */}
        <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 4, background: CANON.cream, minWidth: stW + ME_W + FR_W * columns.length }}>
          {/* Pencil (→ save check while editing) rides ON TOP of "(me)" in
              group grids (Alborz 2026-08-14); the personal grid has no (me)
              column, so its pencil stays beside the title. */}
          <div style={{ width: stW, minWidth: stW, position: "sticky", left: 0, background: CANON.cream, zIndex: 3, padding: "14px 8px 8px 14px", boxSizing: "border-box", display: "flex", alignItems: "flex-end", gap: 6 }}>
            <span style={{ fontFamily: LORA, fontWeight: 700, fontSize: 13.5, color: CANON.identity, whiteSpace: "nowrap" }}>{title}</span>
            {!isWe && (ui === "edit" ? (
              <button title="save your answers" onClick={confirmEdits} disabled={saving}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: CANON.alert, display: "flex", alignItems: "center", padding: 2 }}>
                {saving ? <LoadingDots /> : <CircleCheck size={20} strokeWidth={2.5} />}
              </button>
            ) : (
              <button title="Edit answers?" onClick={() => { setEdits({}); setUi("edit"); }}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: CANON.identity, padding: 2, display: "flex" }}>
                <Pencil size={14} />
              </button>
            ))}
          </div>
          <div style={{ width: ME_W, minWidth: ME_W, position: "sticky", left: stW, background: CANON.cream, zIndex: 3, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 2, paddingTop: 8, paddingBottom: 4, boxSizing: "border-box" }}>
            {isWe && (ui === "edit" ? (
              <button title="save your answers" onClick={confirmEdits} disabled={saving}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: CANON.alert, display: "flex", alignItems: "center", padding: 2 }}>
                {saving ? <LoadingDots /> : <CircleCheck size={20} strokeWidth={2.5} />}
              </button>
            ) : (
              <button title="Edit answers?" onClick={() => { setEdits({}); setUi("edit"); }}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: CANON.identity, padding: 2, display: "flex" }}>
                <Pencil size={14} />
              </button>
            ))}
            {isWe && <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 11, color: CANON.dark }}>(me)</span>}
          </div>
          {columns.map((m) => (
            <div key={m.id} style={{ width: FR_W, minWidth: FR_W, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 6, boxSizing: "border-box", opacity: ui === "edit" ? 0.45 : 1 }}>
              <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 10.5, color: CANON.dark, maxWidth: FR_W - 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</span>
            </div>
          ))}
        </div>

        {/* Rows = questions somebody here has answered (Alborz 2026-08-01),
            matching the sheet — the grid grows with the group instead of
            listing the entire deck as blanks once it's all live. */}
        {anyAnswered.map((card, i) => {
          const mine = valueFor(viewerId, card.id);
          return (
            <div key={card.id} style={{ display: "flex", minHeight: 42, alignItems: "stretch", minWidth: stW + ME_W + FR_W * columns.length }}>
              <div style={{ width: stW, minWidth: stW, position: "sticky", left: 0, zIndex: 2, background: i % 2 === 0 ? CANON.friend : CANON.cream, padding: "6px 8px 6px 14px", boxSizing: "border-box", display: "flex", alignItems: "center", fontFamily: "Inter, sans-serif", fontSize: 10.5, lineHeight: 1.3, color: CANON.dark }}>
                {card.statement}
              </div>
              <div
                onClick={() => toggleOwn(card.id)}
                style={{
                  width: ME_W, minWidth: ME_W, boxSizing: "border-box",
                  position: "sticky", left: stW, zIndex: 2,
                  background: CANON.cream, display: "flex", alignItems: "stretch",
                  borderLeft: mine === undefined && ui !== "edit" ? "1px solid rgba(141,170,186,0.18)" : "none",
                  cursor: ui === "edit" ? "pointer" : "default",
                }}
              >
                {/* Edit mode shrinks the color block into a sharp-cornered
                    chip; taps bounce it (the room map's rating-edit feel). */}
                <div style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                  background: mine === undefined ? "transparent" : mine ? CANON.personal : CANON.alert,
                  border: ui === "edit" && mine === undefined ? "1.5px dashed rgba(141,170,186,0.6)" : "none",
                  transform: ui === "edit"
                    ? (bounce?.cardId === card.id && bounce.phase === "up" ? "scale(0.94)" : "scale(0.82)")
                    : undefined,
                  transition: bounce?.cardId === card.id && bounce.phase === "up" ? "none" : "transform .18s ease",
                }}>
                  {mine != null && <Th v={mine} size={14} color={CANON.cream} />}
                </div>
              </div>
              {columns.map((m) => {
                const v = valueFor(m.id, card.id);
                return (
                  <div
                    key={m.id}
                    style={{ ...mCell(v, FR_W), opacity: ui === "edit" ? 0.45 : 1 }}
                    onClick={v === null && ui !== "edit" ? (e) => showTapTip(card.id, e) : undefined}
                  >
                    {v === null
                      ? <span aria-hidden style={{ fontFamily: "Inter, sans-serif", fontWeight: 800, fontSize: 15, lineHeight: 1, color: CANON.friend, userSelect: "none" }}>?</span>
                      : v !== undefined && <Th v={v} size={14} color={CANON.cream} />}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {tapTipOverlay}
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

function mCell(v: boolean | null | undefined, w: number): React.CSSProperties {
  return {
    width: w, minWidth: w, boxSizing: "border-box",
    display: "flex", alignItems: "center", justifyContent: "center",
    // null = covered (answer-to-reveal): flat greyblue, the map's
    // hidden-writing fill. undefined = plain empty (unanswered).
    background: v === undefined ? CANON.cream : v === null ? CANON.business : v ? CANON.personal : CANON.alert,
    borderLeft: v === undefined ? "1px solid rgba(141,170,186,0.18)" : "none",
  };
}

// (The sheet's floating mini-cells were retired 2026-08-14 — the sheet now
// tiles full-height grid cells under the name columns, see the sheet rows.)
