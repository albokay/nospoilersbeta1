/**
 * Help-system arc CP4 — pointer-tip content + open/seen gating.
 *
 * One source for both platforms' tip surfaces (desktop TipsNote stickies,
 * MobileTipsSheet). Copy approved by Alborz 2026-07-26 (QA round 1 rewrote
 * the group-room set and split it into four placed stickies, absorbing the
 * old GroupRoomSticky's text) — locked; edit only with sign-off.
 * 2026-09-25 letters pass (Alborz's sign-off, his wording). 2026-09-27 (his
 * wording): the welcome aside says "write to your friends", the gear tip
 * drops "(sad)", dashboard tip 3 ends at "start writing."
 *
 * Behavior (locked): accounts created AFTER the feature shipped see a
 * page's tips OPEN on their first visit; dismissing closes them; the "?"
 * affordance reopens them anytime. Pre-existing accounts start closed. The
 * show room's help is the "how does this room work?" tour button; its one
 * pointer is the LETTER FROM SIDEBAR (ROOM_LETTER below, 2026-09-26 — it
 * replaced the progress-picker sticky): leads the feed on entrance until
 * "got it"; the desktop "?" brings it back.
 */

export type TipsPage = "dashboard" | "groupRoom";

/** A tip: main copy + optional parenthetical aside (rendered italic). */
export type Tip = { body: string; aside?: string };

/** Accounts created at/after this instant get first-visit auto-open.
 *  (Pulled back to 07-26 so same-day test accounts exercise the auto-open —
 *  every real pre-arc account predates this anyway.) */
export const TIPS_LAUNCH_MS = Date.parse("2026-07-26T00:00:00Z");

/** Desktop group room: one sticky per tip, placed by what it points at
 *  (Alborz's screenshot markup, QA round 1). QA round 2: shown ONE at a
 *  time, stepped with < > in THIS array order (welcome → deck → chat) —
 *  all at once was overwhelming. 2026-10-13 (Alborz): the GEAR tip is
 *  dropped on both platforms (the gear is a superscript on the title now);
 *  the deck tip is 2 and the chat tip 3. `top`/`left` are viewport-relative
 *  fallbacks for the centered StickyNote transform. */
/** `anchor` (2026-09-16): a tip about a VIEWPORT-FIXED control (the docked
 *  deck tab) pins to that control's on-screen rect and stays fixed with it.
 *  `seat` (2026-10-13, his scribbles): a tip seated IN THE PAGE — its
 *  centre at the tagged element's top-left corner plus (dx, dy) — scrolls
 *  with the page like the content it sits beside; `top`/`left` remain the
 *  fallback when the tag isn't on the page (the classic look). */
/** `below` (2026-10-17): the note's top-left corner at the tagged element's
 *  BOTTOM-left plus (dx, dy) instead of its centre at the top-left — a tip
 *  that hangs under a row whatever the row's height. */
export type TipSeat = { anchor: string; dx: number; dy: number; below?: boolean };
export type GroupRoomTipSticky = Tip & { tilt: number; top: string; left: string; mobileOmit?: boolean; anchor?: "deck-dock"; seat?: TipSeat };
export const GROUP_ROOM_TIPS: GroupRoomTipSticky[] = [
  {
    // The 10-17 refresh (Alborz's copy): watch group, pitch, "I'm in" opens
    // the room (no separate start step), and the way to more friends.
    body: "Welcome to your watch group. The shows you’re watching and the shows you pitch collect here. Answer a friend’s pitch with “I’m in” to join its show room, where you write each other letters. Know someone else who’d watch with you? Add them with “Invite.”",
    // Seated at the page's left, straddling the top of the "Find something
    // new to watch" band (his scribble): centre 49px right of the band's
    // head, 20px above it — the note runs ~100px into the left margin.
    tilt: -2, top: "44%", left: "24%", seat: { anchor: "find-head", dx: 49, dy: -20 },
  },
  // DESKTOP-ONLY as of 2026-08-11 (Alborz sign-off): the mobile sheet drops
  // this tip entirely — self-explanatory there, and it made the sheet too
  // long. Pinned to the docked tab (fixed) — its placement stays, his call.
  {
    body: "“How We Watch TV” is a conversation starter for you and your friends. You’ll see a friend’s answer once you’ve answered the same question. It grows as you all answer — you’ll get more questions periodically.",
    aside: "(Missing answers in your column? Open the grid and tap the pencil to fill them in.)",
    tilt: 2, top: "80%", left: "71%", mobileOmit: true, anchor: "deck-dock",
  },
  // Chat is LAST (QA rounds 3–4) — it doubles as the send-off. The caveat
  // sits mid-body ("("-paragraphs render italic); no trailing aside.
  // 2026-10-13 (Alborz, round 5): opens on "Use the …" and drops the
  // "Sidebar is for you and your friends." send-off, both platforms.
  // Seated over the pitched rail (his scribble): centre 261px right of the
  // "Shows pitched" head's left edge and 72px under its top — the note runs
  // past the column's right edge toward the chat corner — and it SCROLLS
  // with the page (it was pinned to the chat tab).
  {
    body: "Use the 💬 button to discuss what you want to watch next, or anything else that doesn’t risk spoilers — unlike the rest of Sidebar, the chat box isn’t spoiler-gated!",
    tilt: -2, top: "48%", left: "min(84vw, calc(100vw - 175px))", seat: { anchor: "pitched-rail", dx: 261, dy: 72 },
  },
];

/** The desktop dashboard's one sticky (his scribble, 2026-10-13): seated
 *  over the right half of the group rows from the second row down — centre
 *  528px right of the "Groups" head's left edge, 233px under its top. */
export const DASHBOARD_TIP_SEAT: TipSeat = { anchor: "groups-head", dx: 528, dy: 233 };

export function tipsFor(page: TipsPage, idiom: "desktop" | "mobile", editorial = false): Tip[] {
  if (page === "dashboard") {
    // The editorial dashboard (Alborz's wording, 2026-10-13, round 5): the
    // rows carry initials, a dashed circle is a friend who hasn't joined,
    // and the nudge lives behind the row's swipe (phone) / pen (desktop).
    if (editorial) {
      return [
        { body: "This is your dashboard, where your watch groups live." },
        // The 10-17 refresh (Alborz's copy): nudge a slow friend in your own
        // words, a letter waits for whoever arrives, and more friends.
        { body: `Each group lists your friends by their initials. A dashed circle is a friend who hasn't joined yet. Sidebar has emailed their invite. If they're slow to respond, nudge them ${idiom === "mobile" ? "by swiping on the row" : "from the pen at the end of the row"}. Your nudge goes out in your own words.` },
        { body: "While you wait, go inside to pitch more shows or write a letter. Whatever you write will be waiting for your friends when they arrive." },
        { body: "Have other friends you watch TV with? Start a group with them from “Invite new watch group.”" },
      ];
    }
    // Alborz's 2026-08-01 rewrite (replaces the QA round 3 copy; same on
    // both platforms).
    return [
      { body: "This is your home dashboard \u2014 where you access your friend groups." },
      { body: "Outlined circles represent invited friends who haven't joined yet. Sidebar has emailed their invite. If you're getting impatient, you can nudge anyone from inside the group." },
      { body: "While you wait for friends to join, you can still go inside to add more shows or start writing." },
    ];
  }
  // (The chat tip reads "the 💬 button" on both platforms since 2026-10-13;
  // the mobile-only rewording it used to need is gone.)
  const tips: Tip[] = GROUP_ROOM_TIPS
    .filter((t) => !(idiom === "mobile" && t.mobileOmit))
    .map(({ body, aside }) => ({ body, aside }));
  // 2026-09-13 → 2026-10-08: a mobile-only "Press and hold a show button for
  // more options." tip sat here while the long-press was the phone's
  // show-button gesture. The hold is retired (the row's corner × opens the
  // same sheet, and needs no teaching — Alborz's call), so the tip went
  // with it; the two platforms now share the desktop set.
  return tips;
}

/** The invited friend's first-visit tips (Alborz's copy, 2026-10-17): shown
 *  in place of a page's standard set on its first-visit auto-open, when the
 *  account joined from an invite whose inviter left a letter (lib/
 *  inviteeWelcome); the "?" afterwards brings back the standard set. The
 *  group room's first tip hangs under the show's own row. */
export type InviteeTipsCtx = { inviter: string; showName: string };
export function inviteeDashboardTips(w: InviteeTipsCtx): Tip[] {
  return [
    { body: "Welcome in. Your watch groups live here." },
    { body: `The letter ${w.inviter} wrote you about ${w.showName} is inside your watch group with them.` },
  ];
}
export function inviteeGroupRoomTips(w: InviteeTipsCtx): GroupRoomTipSticky[] {
  return [
    {
      body: `Welcome to your watch group with ${w.inviter}. The shows you’re watching and the shows you pitch collect here. ${w.showName} is ${w.inviter}’s first pick. Open it to find their letter.`,
      tilt: -2, top: "44%", left: "24%", seat: { anchor: "invitee-show", dx: 0, dy: 14, below: true },
    },
    {
      body: `“How We Watch TV” is where you’ll see how ${w.inviter} answered those first questions. It grows as you all answer — you’ll get more questions periodically.`,
      tilt: 2, top: "80%", left: "71%", anchor: "deck-dock",
    },
    {
      body: "Use the 💬 button to discuss what you want to watch next, or anything else that doesn’t risk spoilers — unlike the rest of Sidebar, the chat box isn’t spoiler-gated!",
      tilt: -2, top: "48%", left: "min(84vw, calc(100vw - 175px))", seat: { anchor: "pitched-rail", dx: 261, dy: 72 },
    },
  ];
}

// Seen flags are PER USER as of 2026-08-01 (Alborz's invitee-flow catch):
// the old unscoped keys meant a browser that had ever dismissed tips
// suppressed the auto-open for every LATER account created there — exactly
// the invitee-testing case. Legacy unscoped keys are deliberately ignored:
// honoring them would preserve the bug; the cost is post-launch accounts
// seeing their tips auto-open once more.
export function tipsSeenKey(page: TipsPage, userId: string): string {
  return `ns_tips_seen_${page}_${userId}`;
}

export function markTipsSeen(page: TipsPage, userId: string | null | undefined): void {
  if (!userId) return;
  try { localStorage.setItem(tipsSeenKey(page, userId), "1"); } catch { /* tolerate */ }
}

/** First-visit auto-open: never-dismissed BY THIS ACCOUNT and the account
 *  postdates launch. */
export function tipsDefaultOpen(page: TipsPage, userId: string | null | undefined, createdAtIso: string | null | undefined): boolean {
  if (!userId) return false;
  try { if (localStorage.getItem(tipsSeenKey(page, userId))) return false; } catch { /* tolerate */ }
  if (!createdAtIso) return false;
  return new Date(createdAtIso).getTime() >= TIPS_LAUNCH_MS;
}

/** The letter from Sidebar (Alborz 2026-09-26, copy from the letters
 *  canvas): the show room's explainer, leading the feed. It says the
 *  letters framing out loud and folds in what the progress-picker sticky
 *  used to say (the sticky and its copy retired with it). Rendered by
 *  SidebarLetter; "Dear {first name}," is the component's. */
export const ROOM_LETTER = {
  headline: "On Sidebar, you write letters to your friends — not reviews.",
  /** One line on its own (Alborz 2026-10-30): the permission for the voice friends already write in. */
  p0: "Write the way you’d talk to your friends.",
  p1: "Every letter in this room wears a stamp with the episode it was written from. Every member has a stamp of their own.",
  /** Its own paragraph (Alborz 2026-09-30). */
  p1b: "A letter stamped ahead of you stays sealed until you get there, and yours stay sealed for friends who are behind. Write as if everyone’s right where you are.",
  p2: "The progress picker up top is the most important part of this room. Every time you come in, make sure it matches how far you’ve watched, so the letters your friends leave you can open in time (and so your own writing doesn’t spoil them).",
  /** /m: the letter sits above the control card, so the picker is beneath it. */
  p2Mobile: "The progress picker just below is the most important part of this room. Every time you come in, make sure it matches how far you’ve watched, so the letters your friends leave you can open in time (and so your own writing doesn’t spoil them).",
  signoff: "— Sidebar",
  cta: "got it",
};
/** Per-user, same 2026-08-01 reasoning as tipsSeenKey. A NEW key (not the
 *  old sticky's), so everyone — testers who dismissed the sticky included —
 *  meets the letter once. */
export function roomLetterKey(userId: string): string {
  return `ns_letter_room_${userId}`;
}
