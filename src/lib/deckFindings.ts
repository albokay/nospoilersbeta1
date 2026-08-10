/**
 * deckFindings — the swipe deck's artifact arithmetic (spec §5, §7.5, §8, §9).
 * Pure client-side math over one group read; NO LLM, hand-authored templates.
 *
 * ── COPY TEMPLATES LIVE IN THIS FILE ──────────────────────────────────────
 * Every user-facing string the n=2 header, the Findings sticky and the
 * mobile findings card can emit is authored below (search "T_"). Copy pass
 * COMPLETE (Alborz 2026-07-17): SPEC = verbatim from the spec; ALBORZ =
 * written/approved in the CP3 review. The findings-card templates (2026-07-28)
 * ship as shown in the approved Option B rev-3 mockup — Alborz may still tune
 * wording. Future copy changes happen here and nowhere else.
 *
 * ── DECISIONS BAKED IN (flagged for review) ───────────────────────────────
 * • A "hot take" = a solo answer: you answered one way, every other member
 *   who answered that card went the other way, and at least TWO others
 *   answered it. Solo NOs are LIVE as of 2026-07-28 (negations CP3) — but
 *   only on cards whose negated forms are authored (`singular_neg` /
 *   `plural_neg`; NULL = that card never fires a NO-based line). The
 *   renegade's quoted takes include NO-takes as the verbatim statement plus
 *   a "— {name} says NOPE." suffix outside the closing quote (Alborz
 *   2026-07-28).
 * • Agreement counts only cards BOTH people answered (drip desync can't
 *   skew); pair/opposite lines need ≥4 cards in common to fire.
 * • Ties: renegade tie → no renegade (spec rule). Ally/opposite ties with
 *   IDENTICAL stats (same ratio, agree, total) get dedicated tie copy
 *   (Alborz 2026-07-26 — closes the §7.2 TODO); ties on ratio alone with
 *   different counts still break deterministically (the copy quotes one
 *   count, so only exact ties can share it). When there's NO spread at all
 *   (your best and worst pairs have identical stats) the opposite line is
 *   skipped — the same friends can't be both your soulmates and your
 *   furthest apart.
 * • Backbone: zero hot takes + your LOWEST pairwise agreement rate is
 *   strictly the group's highest (nobody is far from you), min rate ≥ 55%.
 * • Aligned ending fires when nobody has a hot take AND every pair with
 *   enough data agrees ≥ 70%.
 * • The findings CARD (computeCardFindings) is the n≥4 shareable: viewer-
 *   centric "you" voice (the owner is named once by the card chrome), the
 *   viewer's own hottest take leads when they have one, shared headline
 *   resolution otherwise (same order as the sticky).
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

// Findings sticky (§7.5 skeleton). Copy pass: Alborz 2026-07-17 (all
// templates below are now his — none awaiting rewrite).
const T_RENEGADE = (name: string) =>
  `Your group's renegade is ${name} — they have the most hot-takes between you.`; // ALBORZ
const T_UNANIMOUS = (n: number, plural: string) => `All ${n} of you ${plural}.`; // ALBORZ (approved)
const T_CANT_AGREE = (statement: string) =>
  `No two of you watch TV the same way. The liveliest split: "${statement}"`; // ALBORZ
const T_ALIGNED_HEAD = `Nobody here has a hot take.`; // SPEC (§8)
const T_ALIGNED_SUB = `Friends, aligned. Go forth and watch.`; // SPEC (§8)
const T_PAIR_LINE = (name: string, a: number, t: number) =>
  `You and ${name} are TV soulmates — you agree on ${a} out of ${t} questions.`; // ALBORZ (2026-07-29 copy pass)
const T_PAIR_DUO_PROOF = (form: string) => `You're the only two who ${form}.`; // ALBORZ (approved)
const T_BACKBONE = `You're the backbone of the group. You have the most in common with everyone else in the group.`; // SPEC (§7.5.5)
const T_OPPOSITE = (name: string, a: number, t: number) =>
  `You and ${name} are the furthest apart — you only agree on ${a} out of ${t}. But opposites attract…`; // ALBORZ (2026-07-29 copy pass)
// Exact-tie variants (Alborz 2026-07-26): call out the tie, list everyone.
const NUM_WORD: Record<number, string> = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven" };
const T_PAIR_TIE = (names: string, count: number, n: number) =>
  `You have ${NUM_WORD[count] ?? count} soulmates: ${names}. You agree on ${n} questions.`; // ALBORZ
const T_OPPOSITE_TIE = (names: string, a: number, t: number) =>
  `You're furthest apart from ${names} — you only agree on ${a} out of ${t} with each. But opposites attract…`; // ALBORZ (2026-07-29 copy pass)
// A renegade's NO-take, quoted with the twist (Alborz 2026-07-28): the
// statement stays verbatim, the suffix lands OUTSIDE the closing quote.
const T_NOPE_SUFFIX = (name: string) => ` — ${name} says NOPE.`; // ALBORZ
const joinLabels = (names: string[]): string =>
  names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
const T_SOLO = (singular: string) => `You're the only one who ${singular}.`; // SPEC (§7.2)
const T_DUO = (name: string, form: string) => `Only you and ${name} ${form}.`; // SPEC (§7.2)
const T_TRIO = (a: string, b: string, form: string) => `Only you, ${a} and ${b} ${form}.`; // SPEC (§7.5.3)

// Findings card (Option B rev-3 mockup, 2026-07-28 — see the copy note in
// the file header).
const T_CARD_SOLO_QUOTE = (statement: string) => `"${statement}" — you, and only you.`;
const T_CARD_ALLY = (name: string, a: number, t: number) =>
  `Your closest ally: ${name} — you agree on ${a} of ${t}.`;
const T_CARD_ALLY_PROOF = (form: string) => ` You're the only two who ${form}.`;
const T_CARD_OPPOSITE = (name: string, a: number, t: number) =>
  `Your opposite is ${name} — you only agree on ${a} out of ${t}. But opposites attract…`; // ALBORZ (2026-07-29 copy pass)

// ── Tunables ────────────────────────────────────────────────────────────────
const MIN_COMMON = 4;        // pair/opposite lines need this many shared cards
const MIN_OTHER_ANSWERS = 2; // a hot take needs this many others on the card
const ALIGNED_RATIO = 0.7;   // every pair at/above this (and no hot takes) → §8
const BACKBONE_MIN_RATIO = 0.55;

// ── Shared arithmetic ───────────────────────────────────────────────────────

export function buildAnswerMap(answers: GroupDeckAnswer[]): Map<string, Map<string, boolean>> {
  const m = new Map<string, Map<string, boolean>>();
  for (const a of answers) {
    if (a.answer == null) continue; // masked (answer-to-reveal) — unknown, not an answer
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

type HotTake = { card: DeckCard; negated: boolean };

/** Solo hot takes for one member — a solo YES, or (negations CP3) a solo NO
 *  on a card whose negated forms are authored (see file header). */
function hotTakes(memberId: string, memberIds: string[], byUser: Map<string, Map<string, boolean>>, cards: DeckCard[]): HotTake[] {
  const mine = byUser.get(memberId);
  if (!mine) return [];
  const out: HotTake[] = [];
  for (const card of cards) {
    const v = mine.get(card.id);
    if (v === undefined) continue;
    if (v === false && !card.singularNeg) continue; // unrenderable without the NO form
    let others = 0, otherSame = 0;
    for (const id of memberIds) {
      if (id === memberId) continue;
      const ov = byUser.get(id)?.get(card.id);
      if (ov === undefined) continue;
      others++;
      if (ov === v) otherSame++;
    }
    if (others >= MIN_OTHER_ANSWERS && otherSame === 0) out.push({ card, negated: !v });
  }
  return out;
}

/** T_SOLO with the right form for the take's direction. */
function soloLine(t: HotTake): string {
  return T_SOLO(t.negated ? (t.card.singularNeg ?? t.card.singular) : t.card.singular);
}

type PairStat = { otherId: string; agree: number; total: number; ratio: number };

type Selection = {
  byUser: Map<string, Map<string, boolean>>;
  memberIds: string[];
  label: (id: string) => string;
  takes: Map<string, HotTake[]>;
  scored: { a: string; b: string; agree: number; total: number }[];
  viewerPairs: PairStat[];
  viewerTakes: HotTake[];
  isBackbone: boolean;
};

/** All the per-group + per-viewer selection state both renderers read. */
function selectFacts(args: {
  cards: DeckCard[];
  answers: GroupDeckAnswer[];
  members: DeckMember[];
  viewerId: string;
}): Selection | null {
  const { answers, members, viewerId } = args;
  const byUser = buildAnswerMap(answers);
  // Answer-to-reveal (spec §4): the engine only considers cards the VIEWER
  // has answered — findings deepen with your own participation, and no line
  // can reveal a friend's answer to a question you were never asked. (The
  // masking RPC enforces the same server-side; this keeps pre-migration
  // behavior identical and the scoping explicit.)
  const viewerAnswered = byUser.get(viewerId);
  const cards = args.cards.filter((c) => viewerAnswered?.get(c.id) !== undefined);
  const memberIds = members.map((m) => m.id);
  const label = (id: string) => members.find((m) => m.id === id)?.label ?? "someone";

  const takes = new Map<string, HotTake[]>();
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

  const viewerPairs: PairStat[] = scored
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

  return { byUser, memberIds, label, takes, scored, viewerPairs, viewerTakes, isBackbone };
}

/** §7.5.4 shared headline resolution (renegade → aligned → unanimous →
 *  sharpest split), identical for the sticky and the card. */
function sharedHeadline(cards: DeckCard[], sel: Selection, memberCount: number):
  | { kind: "headline"; headline: string; quotes: FindingsQuote[] }
  | { kind: "aligned" }
  | null {
  const { byUser, memberIds, label, takes, scored } = sel;
  const counts = memberIds.map((id) => ({ id, n: (takes.get(id) ?? []).length })).sort((x, y) => y.n - x.n);
  const renegade = counts[0].n > 0 && (counts.length < 2 || counts[0].n > counts[1].n) ? counts[0].id : null;

  if (renegade) {
    // Quote, don't inflect (§9.1). A NO-take quotes the statement verbatim
    // too, with the "says NOPE" twist appended after the closing quote
    // (Alborz 2026-07-28) — so a mostly-NO renegade reads fully.
    const quotes = (takes.get(renegade) ?? []).slice(0, 3).map((t) => ({
      text: t.card.statement,
      suffix: t.negated ? T_NOPE_SUFFIX(label(renegade)) : undefined,
    }));
    return { kind: "headline", headline: T_RENEGADE(label(renegade)), quotes };
  }

  // ALIGNED runs BEFORE the unanimous fallback (Alborz 2026-07-17): an
  // aligned group almost always HAS a unanimous card, so the old order
  // made the §8 ending unreachable in practice.
  const anyTakes = memberIds.some((id) => (takes.get(id) ?? []).length > 0);
  if (!anyTakes && scored.every((p) => p.agree / p.total >= ALIGNED_RATIO)) {
    return { kind: "aligned" };
  }
  // Unanimous YES with everyone on the card; failing that, unanimous NO on a
  // card with an authored negated form (negations CP3).
  const unanimous = cards.find((c) => memberIds.every((id) => byUser.get(id)?.get(c.id) === true));
  if (unanimous) return { kind: "headline", headline: T_UNANIMOUS(memberCount, unanimous.plural), quotes: [] };
  const unanimousNo = cards.find((c) => c.pluralNeg && memberIds.every((id) => byUser.get(id)?.get(c.id) === false));
  if (unanimousNo) return { kind: "headline", headline: T_UNANIMOUS(memberCount, unanimousNo.pluralNeg!), quotes: [] };

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
  return { kind: "headline", headline: T_CANT_AGREE(best.card.statement), quotes: [] };
}

/** Best/worst pairs + exact-tie sets, with the sticky's deterministic
 *  tie-break sorts preserved. */
function pickPairs(sel: Selection) {
  const { viewerPairs, label } = sel;
  const bestSorted = [...viewerPairs].sort((x, y) => y.ratio - x.ratio || y.total - x.total || label(x.otherId).localeCompare(label(y.otherId)));
  const best = bestSorted[0];
  const tiedTop = best ? bestSorted.filter((p) => p.ratio === best.ratio && p.agree === best.agree && p.total === best.total) : [];
  const worstSorted = [...viewerPairs].sort((x, y) => x.ratio - y.ratio || y.total - x.total || label(x.otherId).localeCompare(label(y.otherId)));
  const worst = worstSorted[0];
  const tiedWorst = worst ? worstSorted.filter((p) => p.ratio === worst.ratio && p.agree === worst.agree && p.total === worst.total) : [];
  return { best, tiedTop, worst, tiedWorst };
}

/** §7.5.3 line-4 walk — the smallest distinctive minority the viewer belongs
 *  to (duo, then trio), in EITHER direction (a shared NO needs the card's
 *  negated plural form). Skips the pair line's already-cited card. */
function findDistinctiveMinority(cards: DeckCard[], sel: Selection, viewerId: string, skipCardId: string | null):
  | { kind: "duo"; other: string; form: string }
  | { kind: "trio"; others: string[]; form: string }
  | null {
  const { byUser, memberIds } = sel;
  let duo: { other: string; form: string } | null = null;
  let trio: { others: string[]; form: string } | null = null;
  for (const c of cards) {
    if (c.id === skipCardId) continue;
    const v = byUser.get(viewerId)?.get(c.id);
    if (v === undefined) continue;
    if (v === false && !c.pluralNeg) continue;
    const sameOthers: string[] = [];
    let diffOthers = 0;
    for (const id of memberIds) {
      if (id === viewerId) continue;
      const ov = byUser.get(id)?.get(c.id);
      if (ov === v) sameOthers.push(id); else if (ov !== undefined) diffOthers++;
    }
    if (diffOthers === 0) continue; // not distinctive — nobody on the other side
    const form = v ? c.plural : c.pluralNeg!;
    if (sameOthers.length === 1 && !duo) duo = { other: sameOthers[0], form };
    if (sameOthers.length === 2 && !trio) trio = { others: sameOthers, form };
  }
  if (duo) return { kind: "duo", ...duo };
  if (trio) return { kind: "trio", ...trio };
  return null;
}

/** The pair line's concrete proof: a card only these two answered the same
 *  way on, against ≥1 dissenter (either direction; a shared NO needs the
 *  negated plural form). */
function findDuoCard(cards: DeckCard[], byUser: Map<string, Map<string, boolean>>, memberIds: string[], a: string, b: string):
  { card: DeckCard; form: string } | null {
  for (const c of cards) {
    const av = byUser.get(a)?.get(c.id);
    if (av === undefined || byUser.get(b)?.get(c.id) !== av) continue;
    if (av === false && !c.pluralNeg) continue;
    let othersSame = 0, othersDiff = 0;
    for (const id of memberIds) {
      if (id === a || id === b) continue;
      const v = byUser.get(id)?.get(c.id);
      if (v === av) othersSame++; else if (v !== undefined) othersDiff++;
    }
    if (othersSame === 0 && othersDiff >= 1) return { card: c, form: av ? c.plural : (c.pluralNeg ?? c.plural) };
  }
  return null;
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

// ── The Findings sticky (n≥3, per-viewer; §7.5) ─────────────────────────────

export type FindingsQuote = {
  /** The verbatim card statement — the renderer wraps it in quote marks. */
  text: string;
  /** NO-take twist, rendered AFTER the closing quote: " — {name} says NOPE." */
  suffix?: string;
};

export type Findings = {
  /** Bold first line. */
  headline: string;
  /** Verbatim card statements quoted under the headline (renegade's takes). */
  quotes: FindingsQuote[];
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
  const { cards, members, viewerId } = args;
  if (members.length < 3) return null;
  const sel = selectFacts(args);
  if (!sel) return null;
  const { label, viewerPairs, viewerTakes, isBackbone } = sel;

  // §7.5.4 headline resolution.
  const shared = sharedHeadline(cards, sel, members.length);
  if (!shared) return null;
  if (shared.kind === "aligned") {
    return { headline: T_ALIGNED_HEAD, quotes: [], lines: [T_ALIGNED_SUB], aligned: true };
  }
  const { headline, quotes } = shared;

  const lines: string[] = [];
  const { best, tiedTop, worst, tiedWorst } = pickPairs(sel);

  let pairCardId: string | null = null;
  if (isBackbone) {
    lines.push(T_BACKBONE);
  } else if (viewerPairs.length) {
    if (tiedTop.length > 1) {
      lines.push(T_PAIR_TIE(joinLabels(tiedTop.map((p) => label(p.otherId))), tiedTop.length, best.agree));
    } else {
      let line = T_PAIR_LINE(label(best.otherId), best.agree, best.total);
      // The concrete shared against-the-grain answer: a card only these two share.
      const duoCard = findDuoCard(cards, sel.byUser, sel.memberIds, viewerId, best.otherId);
      if (duoCard) { line += ` ${T_PAIR_DUO_PROOF(duoCard.form)}`; pairCardId = duoCard.card.id; }
      lines.push(line);
    }
  }

  if (viewerPairs.length >= 2 || (isBackbone && viewerPairs.length >= 1)) {
    // No spread → no opposite line (identical stats to the best pair would
    // name your soulmates as your furthest apart).
    if (worst.ratio < best.ratio) {
      if (tiedWorst.length > 1) {
        lines.push(T_OPPOSITE_TIE(joinLabels(tiedWorst.map((p) => label(p.otherId))), worst.agree, worst.total));
      } else {
        lines.push(T_OPPOSITE(label(worst.otherId), worst.agree, worst.total));
      }
    }
  }

  // §7.5.3 line 4 — solo → duo → smallest minority (skipping the pair's cited card).
  if (viewerTakes.length) {
    lines.push(soloLine(viewerTakes[0]));
  } else {
    const minority = findDistinctiveMinority(cards, sel, viewerId, pairCardId);
    if (minority?.kind === "duo") lines.push(T_DUO(label(minority.other), minority.form));
    else if (minority?.kind === "trio") lines.push(T_TRIO(label(minority.others[0]), label(minority.others[1]), minority.form));
  }

  if (!lines.length && !quotes.length) return null;
  return { headline, quotes, lines, aligned: false };
}

// ── The findings card (n≥4 shareable; Option B rev 3, 2026-07-28) ───────────

export type CardFindings = {
  /** Lora headline — the viewer's own hottest take when they have one,
   *  else the shared headline (renegade stays third person naturally). */
  headline: string;
  /** Body lines in order. `bold` (when set) is the substring the renderer
   *  emphasizes — the ally/opposite name. */
  lines: { text: string; bold?: string }[];
};

export function computeCardFindings(args: {
  cards: DeckCard[];
  answers: GroupDeckAnswer[];
  members: DeckMember[]; // ALL members incl. the viewer
  viewerId: string;
}): CardFindings | null {
  const { cards, members, viewerId } = args;
  if (members.length < 4) return null; // the card is the n≥4 artifact
  const sel = selectFacts(args);
  if (!sel) return null;
  const { label, viewerPairs, viewerTakes, isBackbone } = sel;

  const lines: { text: string; bold?: string }[] = [];
  let headline: string;
  if (viewerTakes.length) {
    headline = soloLine(viewerTakes[0]);
    // A second solo take rides as a quote line (YES takes only — a NO has no
    // quotable statement).
    const second = viewerTakes.slice(1).find((t) => !t.negated);
    if (second) lines.push({ text: T_CARD_SOLO_QUOTE(second.card.statement) });
  } else {
    const shared = sharedHeadline(cards, sel, members.length);
    if (!shared) return null;
    if (shared.kind === "aligned") {
      return { headline: T_ALIGNED_HEAD, lines: [{ text: T_ALIGNED_SUB }] };
    }
    headline = shared.headline;
  }

  const { best, tiedTop, worst, tiedWorst } = pickPairs(sel);

  let pairCardId: string | null = null;
  if (isBackbone) {
    lines.push({ text: T_BACKBONE });
  } else if (viewerPairs.length) {
    if (tiedTop.length > 1) {
      lines.push({ text: T_PAIR_TIE(joinLabels(tiedTop.map((p) => label(p.otherId))), tiedTop.length, best.agree) });
    } else {
      let text = T_CARD_ALLY(label(best.otherId), best.agree, best.total);
      const duoCard = findDuoCard(cards, sel.byUser, sel.memberIds, viewerId, best.otherId);
      if (duoCard) { text += T_CARD_ALLY_PROOF(duoCard.form); pairCardId = duoCard.card.id; }
      lines.push({ text, bold: label(best.otherId) });
    }
  }

  if (viewerPairs.length >= 2 || (isBackbone && viewerPairs.length >= 1)) {
    if (worst.ratio < best.ratio) {
      if (tiedWorst.length > 1) {
        lines.push({ text: T_OPPOSITE_TIE(joinLabels(tiedWorst.map((p) => label(p.otherId))), worst.agree, worst.total) });
      } else {
        lines.push({ text: T_CARD_OPPOSITE(label(worst.otherId), worst.agree, worst.total), bold: label(worst.otherId) });
      }
    }
  }

  // Without a solo take up top, the distinctive-minority line closes the card.
  if (!viewerTakes.length) {
    const minority = findDistinctiveMinority(cards, sel, viewerId, pairCardId);
    if (minority?.kind === "duo") lines.push({ text: T_DUO(label(minority.other), minority.form) });
    else if (minority?.kind === "trio") lines.push({ text: T_TRIO(label(minority.others[0]), label(minority.others[1]), minority.form) });
  }

  if (!lines.length) return null;
  return { headline, lines };
}
