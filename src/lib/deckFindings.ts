/**
 * deckFindings — the swipe deck's artifact arithmetic (spec §5, §7.5, §8, §9).
 * Pure client-side math over one group read; NO LLM, hand-authored templates.
 *
 * ── COPY TEMPLATES LIVE IN THIS FILE ──────────────────────────────────────
 * Every user-facing string the n=2 header and the Findings sticky can emit
 * is authored below (search "T_"). The spec's §10 inventory marks most of
 * these unchecked — the ones marked STAND-IN are Claude drafts awaiting
 * Alborz's rewrite; the ones marked SPEC are lifted verbatim from the spec.
 *
 * ── DECISIONS BAKED IN (flagged for review) ───────────────────────────────
 * • A "hot take" = a solo YES: you answered yes, every other member who
 *   answered that card said no, and at least TWO others answered it. Solo
 *   NOs are EXCLUDED for now — rendering "she's the only one who DOESN'T…"
 *   needs a per-card negated restatement form that hasn't been authored
 *   (spec §7.5.8 hand-wrote one; the deck rows carry none). Pinned.
 * • Agreement counts only cards BOTH people answered (drip desync can't
 *   skew); pair/opposite lines need ≥4 cards in common to fire.
 * • Ties: renegade tie → no renegade (spec rule). Ally/opposite ties break
 *   deterministically (more cards in common, then label order) — dedicated
 *   tie copy is a spec TODO (§7.2).
 * • Backbone: zero hot takes + your LOWEST pairwise agreement rate is
 *   strictly the group's highest (nobody is far from you), min rate ≥ 55%.
 * • Aligned ending fires when nobody has a hot take AND every pair with
 *   enough data agrees ≥ 70%.
 */
import type { DeckCard, GroupDeckAnswer } from "./db";

export type DeckMember = { id: string; label: string };

// ── Templates (Alborz's voice goes here) ────────────────────────────────────
// n=2 header (§5 — thresholds: high ≥ 75% of ≥4 common; stark ≤ 25% of ≥8
// common, kept LOW/rare per spec; the wide middle stays flat).
const T_PAIR_HIGH = (name: string, n: number, t: number) =>
  `You and ${name} are practically the same viewer — you agree on ${n} of ${t}.`; // SPEC (§5)
const T_PAIR_STARK = (name: string, n: number, t: number) =>
  `You and ${name} expect different things from TV — you agree on ${n} of ${t}. But opposites attract…`; // SPEC (§5)
const T_PAIR_PLAIN = (name: string, n: number, t: number) =>
  `You and ${name} agree on ${n} of ${t} questions:`; // SPEC (§5 + mockup)

// Findings sticky (§7.5 skeleton).
const T_RENEGADE = (name: string) => `${name} is the renegade.`; // STAND-IN
const T_UNANIMOUS = (n: number, plural: string) => `All ${n} of you ${plural}.`; // STAND-IN (§6 shape)
const T_CANT_AGREE = (statement: string) =>
  `You can't agree on anything. Start with the fight over "${statement}"`; // STAND-IN (§7.5.4-3)
const T_ALIGNED_HEAD = `Nobody here has a hot take.`; // SPEC (§8)
const T_ALIGNED_SUB = `Friends, aligned. Go forth and watch.`; // SPEC (§8)
const T_PAIR_LINE = (name: string, a: number, t: number) =>
  `You and ${name} watch TV the same way — you agree on ${a} of ${t}.`; // STAND-IN (§7.5.8 shape)
const T_PAIR_DUO_PROOF = (plural: string) => `You're the only two who ${plural}.`; // STAND-IN
const T_BACKBONE = `You're the backbone of the group. You have the most in common with everyone else in the group.`; // SPEC (§7.5.5)
const T_OPPOSITE = (name: string, a: number, t: number) =>
  `You and ${name} are the furthest apart — ${a} of ${t}.`; // SPEC (§7.5.8)
const T_SOLO = (singular: string) => `You're the only one who ${singular}.`; // SPEC (§7.2)
const T_DUO = (name: string, plural: string) => `Only you and ${name} ${plural}.`; // SPEC (§7.2)
const T_TRIO = (a: string, b: string, plural: string) => `Only you, ${a} and ${b} ${plural}.`; // SPEC (§7.5.3)

// ── Tunables ────────────────────────────────────────────────────────────────
const MIN_COMMON = 4;        // pair/opposite lines need this many shared cards
const MIN_OTHER_ANSWERS = 2; // a hot take needs this many others on the card
const ALIGNED_RATIO = 0.7;   // every pair at/above this (and no hot takes) → §8
const BACKBONE_MIN_RATIO = 0.55;

// ── Shared arithmetic ───────────────────────────────────────────────────────

export function buildAnswerMap(answers: GroupDeckAnswer[]): Map<string, Map<string, boolean>> {
  const m = new Map<string, Map<string, boolean>>();
  for (const a of answers) {
    let inner = m.get(a.userId);
    if (!inner) { inner = new Map(); m.set(a.userId, inner); }
    inner.set(a.cardId, a.answer);
  }
  return m;
}

function pairCount(a: Map<string, boolean> | undefined, b: Map<string, boolean> | undefined): { agree: number; total: number } {
  if (!a || !b) return { agree: 0, total: 0 };
  let agree = 0, total = 0;
  for (const [cardId, av] of a) {
    const bv = b.get(cardId);
    if (bv === undefined) continue;
    total++;
    if (av === bv) agree++;
  }
  return { agree, total };
}

/** Solo-YES hot takes for one member (see file header for the solo-NO call). */
function hotTakes(memberId: string, memberIds: string[], byUser: Map<string, Map<string, boolean>>, cards: DeckCard[]): DeckCard[] {
  const mine = byUser.get(memberId);
  if (!mine) return [];
  const out: DeckCard[] = [];
  for (const card of cards) {
    if (mine.get(card.id) !== true) continue;
    let others = 0, otherYes = 0;
    for (const id of memberIds) {
      if (id === memberId) continue;
      const v = byUser.get(id)?.get(card.id);
      if (v === undefined) continue;
      others++;
      if (v === true) otherYes++;
    }
    if (others >= MIN_OTHER_ANSWERS && otherYes === 0) out.push(card);
  }
  return out;
}

// ── The n=2 header (§5) ─────────────────────────────────────────────────────

export function pairHeaderLine(otherLabel: string, answers: GroupDeckAnswer[], viewerId: string, otherId: string): string | null {
  const byUser = buildAnswerMap(answers);
  const { agree, total } = pairCount(byUser.get(viewerId), byUser.get(otherId));
  if (total === 0) return null;
  const r = agree / total;
  if (total >= 8 && r <= 0.25) return T_PAIR_STARK(otherLabel, agree, total);
  if (total >= MIN_COMMON && r >= 0.75) return T_PAIR_HIGH(otherLabel, agree, total);
  return T_PAIR_PLAIN(otherLabel, agree, total);
}

// ── The Findings (n≥3, per-viewer; §7.5) ────────────────────────────────────

export type Findings = {
  /** Bold first line. */
  headline: string;
  /** Verbatim card statements quoted under the headline (renegade's takes). */
  quotes: string[];
  /** The per-viewer lines (pair/backbone, opposite, duo). */
  lines: string[];
  /** §8 aligned ending — headline + sub only, no lines. */
  aligned: boolean;
};

export function computeFindings(args: {
  cards: DeckCard[];
  answers: GroupDeckAnswer[];
  members: DeckMember[]; // ALL members incl. the viewer
  viewerId: string;
}): Findings | null {
  const { cards, answers, members, viewerId } = args;
  if (members.length < 3) return null;
  const byUser = buildAnswerMap(answers);
  const memberIds = members.map((m) => m.id);
  const label = (id: string) => members.find((m) => m.id === id)?.label ?? "someone";

  // Everyone's hot takes + pairwise stats.
  const takes = new Map<string, DeckCard[]>();
  for (const id of memberIds) takes.set(id, hotTakes(id, memberIds, byUser, cards));
  const pairs: { a: string; b: string; agree: number; total: number }[] = [];
  for (let i = 0; i < memberIds.length; i++) {
    for (let j = i + 1; j < memberIds.length; j++) {
      const { agree, total } = pairCount(byUser.get(memberIds[i]), byUser.get(memberIds[j]));
      pairs.push({ a: memberIds[i], b: memberIds[j], agree, total });
    }
  }
  const scored = pairs.filter((p) => p.total >= MIN_COMMON);
  if (!scored.length) return null; // not enough shared data for any read

  const anyTakes = memberIds.some((id) => (takes.get(id) ?? []).length > 0);

  // §7.5.4 headline resolution.
  let headline: string;
  let quotes: string[] = [];
  const counts = memberIds.map((id) => ({ id, n: (takes.get(id) ?? []).length })).sort((x, y) => y.n - x.n);
  const renegade = counts[0].n > 0 && (counts.length < 2 || counts[0].n > counts[1].n) ? counts[0].id : null;

  if (renegade) {
    headline = T_RENEGADE(label(renegade));
    quotes = (takes.get(renegade) ?? []).slice(0, 3).map((c) => c.statement); // quote, don't inflect (§9.1)
  } else {
    // Unanimous YES with everyone on the card (≥3 answerers = all members here).
    const unanimous = cards.find((c) => memberIds.every((id) => byUser.get(id)?.get(c.id) === true));
    if (unanimous) {
      headline = T_UNANIMOUS(members.length, unanimous.plural);
    } else if (!anyTakes && scored.every((p) => p.agree / p.total >= ALIGNED_RATIO)) {
      return { headline: T_ALIGNED_HEAD, quotes: [], lines: [T_ALIGNED_SUB], aligned: true };
    } else {
      // Sharpest split: the most even yes/no divide with the most answers.
      let best: { card: DeckCard; score: number } | null = null;
      for (const c of cards) {
        let yes = 0, no = 0;
        for (const id of memberIds) {
          const v = byUser.get(id)?.get(c.id);
          if (v === true) yes++; else if (v === false) no++;
        }
        if (yes + no < 3 || yes === 0 || no === 0) continue;
        const score = Math.min(yes, no) * 10 - Math.abs(yes - no);
        if (!best || score > best.score) best = { card: c, score };
      }
      if (!best) return null;
      headline = T_CANT_AGREE(best.card.statement);
    }
  }

  const lines: string[] = [];
  const viewerPairs = scored
    .filter((p) => p.a === viewerId || p.b === viewerId)
    .map((p) => ({ otherId: p.a === viewerId ? p.b : p.a, agree: p.agree, total: p.total, ratio: p.agree / p.total }));

  // §7.5.5 backbone detection (swaps the pair slot).
  const viewerTakes = takes.get(viewerId) ?? [];
  let isBackbone = false;
  if (viewerTakes.length === 0 && viewerPairs.length >= 2) {
    const minRatioOf = (id: string) => {
      const rs = scored.filter((p) => p.a === id || p.b === id).map((p) => p.agree / p.total);
      return rs.length ? Math.min(...rs) : -1;
    };
    const mine = minRatioOf(viewerId);
    isBackbone = mine >= BACKBONE_MIN_RATIO && memberIds.every((id) => id === viewerId || minRatioOf(id) < mine);
  }

  let pairCardId: string | null = null;
  if (isBackbone) {
    lines.push(T_BACKBONE);
  } else if (viewerPairs.length) {
    const best = [...viewerPairs].sort((x, y) => y.ratio - x.ratio || y.total - x.total || label(x.otherId).localeCompare(label(y.otherId)))[0];
    let line = T_PAIR_LINE(label(best.otherId), best.agree, best.total);
    // The concrete shared against-the-grain answer: a card only these two said yes to.
    const duoCard = findDuoCard(cards, byUser, memberIds, viewerId, best.otherId);
    if (duoCard) { line += ` ${T_PAIR_DUO_PROOF(duoCard.plural)}`; pairCardId = duoCard.id; }
    lines.push(line);
  }

  if (viewerPairs.length >= 2 || (isBackbone && viewerPairs.length >= 1)) {
    const worst = [...viewerPairs].sort((x, y) => x.ratio - y.ratio || y.total - x.total || label(x.otherId).localeCompare(label(y.otherId)))[0];
    lines.push(T_OPPOSITE(label(worst.otherId), worst.agree, worst.total));
  }

  // §7.5.3 line 4 — solo → duo → smallest minority (skipping the pair's cited card).
  if (viewerTakes.length) {
    lines.push(T_SOLO(viewerTakes[0].singular));
  } else {
    let duo: { card: DeckCard; other: string } | null = null;
    let trio: { card: DeckCard; others: string[] } | null = null;
    for (const c of cards) {
      if (c.id === pairCardId) continue;
      if (byUser.get(viewerId)?.get(c.id) !== true) continue;
      const yesOthers: string[] = [];
      let noOthers = 0;
      for (const id of memberIds) {
        if (id === viewerId) continue;
        const v = byUser.get(id)?.get(c.id);
        if (v === true) yesOthers.push(id); else if (v === false) noOthers++;
      }
      if (noOthers === 0) continue; // not distinctive — nobody on the other side
      if (yesOthers.length === 1 && !duo) duo = { card: c, other: yesOthers[0] };
      if (yesOthers.length === 2 && !trio) trio = { card: c, others: yesOthers };
    }
    if (duo) lines.push(T_DUO(label(duo.other), duo.card.plural));
    else if (trio) lines.push(T_TRIO(label(trio.others[0]), label(trio.others[1]), trio.card.plural));
  }

  if (!lines.length && !quotes.length) return null;
  return { headline, quotes, lines, aligned: false };
}

function findDuoCard(cards: DeckCard[], byUser: Map<string, Map<string, boolean>>, memberIds: string[], a: string, b: string): DeckCard | null {
  for (const c of cards) {
    if (byUser.get(a)?.get(c.id) !== true || byUser.get(b)?.get(c.id) !== true) continue;
    let othersNo = 0, othersYes = 0;
    for (const id of memberIds) {
      if (id === a || id === b) continue;
      const v = byUser.get(id)?.get(c.id);
      if (v === true) othersYes++; else if (v === false) othersNo++;
    }
    if (othersYes === 0 && othersNo >= 1) return c;
  }
  return null;
}
