import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import {
  fetchShows,
  fetchProgress,
  setCanonPin,
  setShelfBlurb,
  setStoppedWatching,
  removeShowFromProfile,
  upsertRewatchStatus,
  setShelfOverride,
  setShelfPositions,
  fetchProfileThoughtsForOwner,
  insertProfileThought,
  updateProfileThought,
  deleteProfileThought,
  fetchAllFriendGroupsWithActivity,
  fetchPublicThreadsForUser,
  markOnboarded,
  type V2BlurbKind,
  type ShelfName,
} from "../../lib/db";
import type { Show } from "../../lib/db";
import type { ProgressEntry, ProfileThought, FriendGroup } from "../../types";
import V2Layout from "./V2Layout";
import SearchShows from "../SearchShows";
import Modal from "../Modal";
import ProfileThoughtsCompose, { type ProfileThoughtsComposeMode, type ProfileThoughtsSubmitPayload } from "./ProfileThoughtsCompose";
import ProfileThoughtsCarousel from "./ProfileThoughtsCarousel";
import OnboardingModal from "./OnboardingModal";
import ZigzagDivider from "./ZigzagDivider";
import SidebarAvatar from "../SidebarAvatar";
import TreatedArt from "../TreatedArt";
import { pickProfileThoughtPrompt } from "../../lib/profileThoughtPrompts";
import { preventLastWordOrphan } from "../../lib/utils";
import { Plus, Pin, Trash2, SquarePen, GripVertical, ChevronDown, ChevronUp, RefreshCw, ArrowRight, Pencil } from "lucide-react";
import Tooltip from "../Tooltip";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Shared profile-card style — sharp corners, transparent fill, 2px white
// outline. Lets the canon-yellow page bg show through; the white outline
// reads as a decisive frame without competing with the bg color or
// introducing any "middle transparency." .card class still applies;
// these inline styles override its radius (24) and bg.
const PROFILE_CARD: React.CSSProperties = {
  background: "transparent",
  border: "2px solid #fff",
  borderRadius: 0,
  boxShadow: "none",
};

// Dashed variant for "+ add a show" tile — telegraphs "click to add"
// against the same transparent + white visual language.
const PROFILE_ADD_TILE: React.CSSProperties = {
  background: "transparent",
  border: "2px dashed #fff",
  borderRadius: 0,
  boxShadow: "none",
};

type ShelfStatus = "watching" | "want" | "finished" | "stopped";

// Default (editable, clearable) blurb seeded on the TSP card at onboarding
// completion (sidebar_spec_onboarding_v03 §6).
const DEFAULT_TSP_BLURB =
  "Want to see a room in action? Take a look at this mock friend room for a mock show.";

// --- Onboarding reveal pacing + interrupt sensitivity (all tunable) ---------
// The reveal alternates discrete actions — fade · BEAT · scroll · settle · BEAT
// · fade … A scroll is given SCROLL_SETTLE + BEAT before the next fade, so the
// scroll fully stops and holds for a beat BEFORE its shelf fades in (they used
// to land near-simultaneously). A fade is given FADE + BEAT before the next
// scroll, so the pulse finishes and holds before we move on.
const REVEAL_FADE_MS = 850;           // fade-in duration
const REVEAL_BEAT_MS = 300;           // pause AFTER a fade finishes, before scrolling on
const REVEAL_SCROLL_SETTLE_MS = 550;  // time to let a smooth-scroll come to rest
const REVEAL_SCROLL_BEAT_MS = 300;    // pause AFTER a scroll lands, before its shelf fades in
const REVEAL_START_DELAY_MS = 400;
// Interrupt sensitivity. A single wheel event must exceed this |deltaY| to
// count as an intentional scroll — filters trackpad jitter / a barely-nudged
// mouse that used to kill the sequence. Clicks + (non-modifier) keypresses
// also cancel, but only after the grace window so an accidental input right as
// the reveal begins doesn't abort it.
const REVEAL_WHEEL_THRESHOLD = 28;
const REVEAL_GRACE_MS = 1000;

// Owner-view sort for "Thoughts on…" pieces. Per spec:
//   - The currently-featured public piece (most recent by last_published_at)
//     is first.
//   - All other pieces (private + older public) come behind it by
//     created_at desc.
// If the user has no public pieces, everything is just created_at desc.
function sortOwnerProfileThoughts(thoughts: ProfileThought[]): ProfileThought[] {
  const publicByPublished = thoughts
    .filter((t) => t.isPublic)
    .sort((a, b) => {
      const aT = a.lastPublishedAt ? new Date(a.lastPublishedAt).getTime() : 0;
      const bT = b.lastPublishedAt ? new Date(b.lastPublishedAt).getTime() : 0;
      return bT - aT;
    });
  const featured = publicByPublished[0] ?? null;
  const byCreatedDesc = (a: ProfileThought, b: ProfileThought) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (!featured) return [...thoughts].sort(byCreatedDesc);
  const rest = thoughts.filter((t) => t.id !== featured.id).sort(byCreatedDesc);
  return [featured, ...rest];
}

// Shelf classification. Priority order: explicit shelf_override (user's last
// manual choice via the V2 profile chevron-move) > stoppedWatching (V3
// close-show cascade) > progress-derived (s, e). Override takes precedence
// even over the stopped flag — a user can chevron-move a cascade-stopped show
// back to Watching/Want/Finished and the override wins for display.
function classifyShow(p: ProgressEntry, show: Show | undefined): ShelfStatus {
  if (p.shelfOverride) return p.shelfOverride;
  if (p.stoppedWatching) return "stopped";
  if (p.s === 0 && p.e === 0) return "want";
  if (show?.seasons && show.seasons.length > 0) {
    const finalS = show.seasons.length;
    const finalE = show.seasons[finalS - 1];
    const checkS = p.isRewatching ? (p.highestS ?? p.s) : p.s;
    const checkE = p.isRewatching ? (p.highestE ?? p.e) : p.e;
    if (checkS >= finalS && checkE >= finalE) return "finished";
  }
  return "watching";
}

// Sort a shelf's show-id list. If ANY row in the shelf has a non-null
// shelf_position, use position-mode (sort by position asc, nulls last). Else
// fall back to alphabetical, with canon-pin priority for Finished (legacy).
function sortShelf(
  sids: string[],
  shelf: ShelfStatus,
  shows: Show[],
  progress: Record<string, ProgressEntry>
): string[] {
  const byName = (a: string, b: string) => {
    const an = shows.find((s) => s.id === a)?.name ?? a;
    const bn = shows.find((s) => s.id === b)?.name ?? b;
    return an.localeCompare(bn);
  };
  const anyPositioned = sids.some((s) => progress[s]?.shelfPosition != null);
  if (anyPositioned) {
    return [...sids].sort((a, b) => {
      const pa = progress[a]?.shelfPosition;
      const pb = progress[b]?.shelfPosition;
      if (pa == null && pb == null) return byName(a, b);
      if (pa == null) return 1;
      if (pb == null) return -1;
      if (pa === pb) return byName(a, b);
      return pa - pb;
    });
  }
  if (shelf === "finished") {
    const pinned = sids.filter((sid) => progress[sid]?.canonPin).sort(byName);
    const unpinned = sids.filter((sid) => !progress[sid]?.canonPin).sort(byName);
    return [...pinned, ...unpinned];
  }
  return [...sids].sort(byName);
}

function progressShort(p: ProgressEntry): string {
  if (p.s === 0 && p.e === 0) return "haven't started";
  return `S${String(p.s).padStart(2, "0")} E${String(p.e).padStart(2, "0")}`;
}

function formatJoinedSince(createdAt?: string): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

// BioField removed 2026-05-12 — replaced by the "Thoughts on..." carousel
// (checkpoints 4 + 5). profiles.bio column kept dormant in DB; the bio-
// tolerant SELECT in auth.tsx still pulls it harmlessly. Drop the column +
// the auth-side fallback in a later pass if/when we're sure nothing reads
// the column anymore.

// Show-name link with dashed underline + canon-green tooltip. Each shelf
// section's title-row show name routes through this so the click target,
// the underline affordance, and the tooltip stay consistent across all
// four shelves. Tooltip uses text-wrap: balance for even line distribution
// regardless of show-name length.
function ShowNameLink({
  showName,
  showId,
  style,
  as = "span",
  navigate,
}: {
  showName: string;
  showId: string;
  style?: React.CSSProperties;
  /** "div" for shelves where the show name occupies its own block (Finished
   *  Watching uses a div for layout reasons); "span" everywhere else. */
  as?: "span" | "div";
  navigate: (path: string, opts?: { state?: unknown }) => void;
}) {
  const Tag = as;
  return (
    <Tooltip
      text={
        <>
          Go to your journal page for{" "}
          <span style={{ fontStyle: "italic" }}>{showName}</span>.
        </>
      }
      direction="above"
      align="left"
      portal
      tooltipStyle={{ background: "#355eb8", color: "#fff", textWrap: "balance" as React.CSSProperties["textWrap"] }}
    >
      <Tag
        onClick={() => navigate(`/journal`, { state: { activeTab: showId } })}
        style={{
          ...style,
          cursor: "pointer",
          textDecoration: "underline dashed",
          textUnderlineOffset: 4,
        }}
      >
        {showName}
      </Tag>
    </Tooltip>
  );
}

// Section divider rendered between the four V2 self-profile shelves.
// 52×52 canon-block (same shape as SidebarLogo's BLOCKS, borderRadius 15)
// in one of the 5 canon palette colors. Hover reveals a canon-yellow up
// chevron; click triggers the same two-phase bounce used by V2RoomMap
// rating cells (instant scale 1.12 → 150ms ease-out back to 1) and
// smooth-scrolls the page to the top. Color is picked per-mount by the
// parent so all dividers on the page can be guaranteed distinct.
const HOME_DIVIDER_COLORS = ["#f45028", "#adc8d7", "#355eb8", "#7abd8e", "#fffaf0"] as const;
export function pickDistinctDividerColors(n: number): string[] {
  // Fisher-Yates shuffle of the palette, take first n. Safe for n ≤ 5
  // (we currently use 4 — one divider per shelf).
  const pool = [...HOME_DIVIDER_COLORS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

export function HomeDivider({ color }: { color: string }) {
  const [hovered, setHovered] = useState(false);
  function handleClick() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Scroll to top"
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      style={{
        width: 52,
        height: 52,
        background: color,
        borderRadius: 15,
        margin: "32px auto",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {hovered && <ChevronUp size={24} color="#dea838" strokeWidth={2.5} />}
    </div>
  );
}

// Inline editable blurb. Click pencil → text field; Enter / blur saves;
// Esc cancels. Whitespace-only saves as null per setShelfBlurb's contract.
// Friend-room CTA rendered below show cards on each shelf. Mirrors the
// visitor-profile "go to your friend room" button styling (canon
// light-blue fill + outline, white text). When the user has multiple
// rooms for a show, the button toggles a dropdown picker; click-outside
// closes it. When there are zero rooms for the show, renders null.
function FriendRoomCTA({
  rooms,
  navigate,
}: {
  rooms: FriendGroup[];
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!rooms || rooms.length === 0) return null;

  const buttonStyle: React.CSSProperties = {
    fontSize: 12,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#adc8d7",
    border: "2px solid #adc8d7",
    color: "#fff",
  };

  if (rooms.length === 1) {
    const room = rooms[0];
    return (
      <button
        className="btn h40"
        onClick={() => navigate(`/room/${room.id}`)}
        style={buttonStyle}
      >
        <ArrowRight size={13} /> go to your friend room
      </button>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        className="btn h40"
        onClick={() => setOpen((o) => !o)}
        style={buttonStyle}
      >
        <ArrowRight size={13} /> go to your friend room
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            background: "var(--dos-bg)",
            borderRadius: 10,
            padding: 8,
            zIndex: 30,
            boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
            minWidth: 240,
          }}
        >
          {rooms.map((g) => (
            <button
              key={g.id}
              className="btn"
              onClick={() => {
                setOpen(false);
                navigate(`/room/${g.id}`);
              }}
              style={{
                fontSize: 13,
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                width: "100%",
                background: "#adc8d7",
                color: "#fff",
                border: "none",
              }}
            >
              <ArrowRight size={14} color="#fff" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: "center", margin: "0 8px", overflow: "hidden", textOverflow: "ellipsis" }}>
                {g.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Per-show shelf CTAs: the friend-room button(s) followed by a
// "go to your public writing" button (transparent fill, white outline/text,
// same size as the friend-room button) when the user has public writing for
// the show. Renders nothing when neither applies.
function ShelfCTAs({
  showId,
  rooms,
  hasPublicWriting,
  username,
  navigate,
}: {
  showId: string;
  rooms: FriendGroup[] | undefined;
  hasPublicWriting: boolean;
  username: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const hasRooms = !!rooms && rooms.length > 0;
  if (!hasRooms && !hasPublicWriting) return null;
  return (
    <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {hasRooms && <FriendRoomCTA rooms={rooms!} navigate={navigate} />}
      {hasPublicWriting && (
        <button
          className="btn h40"
          onClick={() => navigate(`/u/${username}/show/${showId}/posts`)}
          style={{
            fontSize: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            border: "2px solid #fff",
            color: "#fff",
          }}
        >
          <ArrowRight size={13} /> go to your public writing
        </button>
      )}
    </div>
  );
}

function BlurbField({
  kind,
  value,
  placeholder,
  italic,
  onSaved,
  userId,
  showId,
}: {
  kind: V2BlurbKind;
  value: string | undefined;
  placeholder: string;
  italic?: boolean;
  onSaved: (next: string | undefined) => void;
  userId: string;
  showId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  async function commit() {
    if (saving) return;
    const next = draft.trim();
    if ((next || "") === (value ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await setShelfBlurb(userId, showId, kind, next || null);
      onSaved(next || undefined);
      setEditing(false);
    } catch (err) {
      console.warn("setShelfBlurb failed (recoverable):", err);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <textarea
        autoFocus
        className="card"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            commit();
          }
        }}
        placeholder={placeholder}
        maxLength={280}
        style={{
          width: "100%",
          minHeight: 60,
          fontSize: 15,
          lineHeight: 1.5,
          fontFamily: "Lora, Georgia, serif",
          fontStyle: italic ? "italic" : "normal",
          color: "var(--dos-fg)",
          background: "rgba(255,255,255,0.18)",
          border: "2px solid #fff",
          borderRadius: 14,
          padding: 12,
          resize: "vertical",
          outline: "none",
        }}
      />
    );
  }

  const isPlaceholder = !value;

  return (
    <div
      onClick={() => setEditing(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") setEditing(true); }}
      style={{
        cursor: "text",
        fontFamily: italic ? "Lora, Georgia, serif" : undefined,
        fontStyle: italic ? "italic" : undefined,
        fontSize: 15,
        lineHeight: 1.5,
        // Placeholders read as "placeholder" via the gray COLOR alone;
        // dropping the 0.7 opacity matches the user's "full opacity for
        // all blurb text" direction.
        color: isPlaceholder ? "var(--dos-gray)" : "var(--dos-fg)",
        opacity: 1,
      }}
    >
      {value || placeholder}
      {/* Trailing pencil icon — signals the blurb is editable. Inline so
          it sits at the end of whatever line the text wraps to. Click
          on icon enters edit mode via the parent div's onClick. */}
      <Pencil
        size={12}
        style={{ marginLeft: 6, opacity: 0.6, verticalAlign: "middle" }}
      />
    </div>
  );
}

export default function V2ProfileSelfPage() {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();

  // === First-login onboarding (sidebar_spec_onboarding_v03) ================
  // The paged modal + reveal open over this profile when the user has never
  // onboarded (profiles.onboarded_at IS NULL). Seed/fictional users are
  // excluded. onboardingDoneRef latches once the flow completes so the
  // open-effect can't re-fire during the async markOnboarded + refreshProfile
  // window (onboarded_at is still null until refreshProfile lands).
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const onboardingDoneRef = useRef(false);
  // Hides the V2Layout chrome logo while the onboarding modal is up (the modal
  // shows its own logo). Set false as the modal fades so the chrome logo fades
  // into the corner at the same time. Default false (normal visits show it).
  const [chromeLogoHidden, setChromeLogoHidden] = useState(false);

  // --- The self-assembling reveal (spec §4) -------------------------------
  // Beats: 1 = thoughts panel, 2 = watching shelf, 3 = want shelf,
  // 4 = finished shelf, 5 = top chrome (pairedHeader). revealStep === null
  // means "normal" (everything visible); a number means the reveal is in
  // progress and content whose beat <= revealStep is shown. Runs once, right
  // after onboarding completes, and bows out on any genuine user input.
  // revealStep: which beats are currently shown (0 = frame-only, 1..5 = beats,
  //   null = everything visible / normal). Set to 0 the moment the modal opens
  //   so the profile behind is frame-only from the start — nothing shows
  //   through the modal and nothing fades OUT when it closes.
  // revealActive: true ONLY while the timed beat sequence is running. Gates the
  //   interrupt listeners (so clicks/scrolls INSIDE the modal don't count) and
  //   selects the pulse animation vs. plain visible.
  const [revealStep, setRevealStep] = useState<number | null>(null);
  const [revealActive, setRevealActive] = useState(false);
  const revealTimers = useRef<number[]>([]);
  const revealStartRef = useRef(0);
  const thoughtsRef = useRef<HTMLElement | null>(null);
  const watchingRef = useRef<HTMLElement | null>(null);
  const wantRef = useRef<HTMLElement | null>(null);
  const finishedRef = useRef<HTMLElement | null>(null);

  const revealShown = (beat: number) => revealStep === null || revealStep >= beat;
  const revealStyle = (beat: number): React.CSSProperties => {
    if (!revealShown(beat)) {
      // Hidden — INSTANT, no transition. Dropping into frame-only (when the
      // modal opens) must not animate existing content fading away; that was
      // the pre-reveal flash. The reveal only ever fades content IN.
      return { opacity: 0, transform: "translateY(12px)", pointerEvents: "none" };
    }
    if (!revealActive) {
      // Normal mode, or after the reveal finishes / is cancelled: just visible.
      return { opacity: 1 };
    }
    // Mid-reveal, this beat is now visible → play the double-pulse fade-in.
    return { animation: `reveal-pulse-in ${REVEAL_FADE_MS}ms ease both` };
  };
  function clearRevealTimers() { revealTimers.current.forEach((t) => clearTimeout(t)); revealTimers.current = []; }
  function endReveal() { clearRevealTimers(); setRevealActive(false); setRevealStep(null); }
  function scrollToRef(ref: React.RefObject<HTMLElement | null>) {
    const el = ref.current;
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  }
  function startReveal() {
    clearRevealTimers();
    window.scrollTo({ top: 0, behavior: "auto" });
    setRevealStep(0);
    setRevealActive(true);
    revealStartRef.current = performance.now();
    // Each fade and each scroll is its OWN discrete action. The gap AFTER an
    // action depends on its kind: a scroll gets SCROLL_SETTLE + BEAT (let it
    // come fully to rest and hold a beat before the next fade); a fade gets
    // FADE + BEAT (let the pulse finish and hold before scrolling on). The
    // "thoughts" beat has NO scroll — it fades in with the page at the top.
    const steps: Array<{ kind: "fade" | "scroll" | "end"; run: () => void }> = [
      { kind: "fade",   run: () => setRevealStep(1) },                                 // thoughts (at top, no scroll)
      { kind: "scroll", run: () => scrollToRef(watchingRef) },
      { kind: "fade",   run: () => setRevealStep(2) },                                 // watching
      { kind: "scroll", run: () => scrollToRef(wantRef) },
      { kind: "fade",   run: () => setRevealStep(3) },                                 // want
      { kind: "scroll", run: () => scrollToRef(finishedRef) },
      { kind: "fade",   run: () => setRevealStep(4) },                                 // finished
      { kind: "scroll", run: () => window.scrollTo({ top: 0, behavior: "smooth" }) },  // back to top
      { kind: "fade",   run: () => setRevealStep(5) },                                 // top chrome
      { kind: "end",    run: () => { setRevealActive(false); setRevealStep(null); } }, // done — fully interactive
    ];
    let t = REVEAL_START_DELAY_MS;
    steps.forEach((step) => {
      revealTimers.current.push(window.setTimeout(step.run, t) as unknown as number);
      t += step.kind === "scroll"
        ? REVEAL_SCROLL_SETTLE_MS + REVEAL_SCROLL_BEAT_MS  // scroll lands, short beat, then the fade
        : REVEAL_FADE_MS + REVEAL_BEAT_MS;                 // fade finishes, then a beat, then the scroll
    });
  }
  // Interruptible — but only by a clearly INTENTIONAL gesture, and only after a
  // short grace window, so a barely-nudged mouse / trackpad jitter no longer
  // aborts the sequence mid-way. We don't listen for 'scroll' so our own
  // smooth-scrolls can't self-cancel. On cancel, everything fades to visible.
  useEffect(() => {
    if (!revealActive) return;
    const pastGrace = () => performance.now() - revealStartRef.current >= REVEAL_GRACE_MS;
    const onWheel = (e: WheelEvent) => {
      if (pastGrace() && Math.abs(e.deltaY) >= REVEAL_WHEEL_THRESHOLD) endReveal();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!pastGrace()) return;
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
      endReveal();
    };
    const onPointer = () => { if (pastGrace()) endReveal(); };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [revealActive]);
  useEffect(() => () => clearRevealTimers(), []);

  // Open the onboarding modal for never-onboarded users — and immediately drop
  // the profile behind into frame-only (revealStep 0) so nothing shows through
  // the modal's translucent backdrop / margins, and there's nothing to fade
  // OUT when it closes (the reveal only ever fades content IN). revealActive
  // stays false here, so interactions inside the modal don't trip the
  // interrupt listeners.
  useEffect(() => {
    if (authLoading || !user || !profile) return;
    if (onboardingDoneRef.current) return;
    if (profile.is_seed) return;
    if (profile.onboarded_at == null) {
      setOnboardingOpen(true);
      setRevealStep(0);
      setChromeLogoHidden(true);
    }
  }, [authLoading, user, profile]);

  // Called while the modal is STILL fully visible (before it fades). Stamps
  // onboarded_at, seeds the TSP blurb, refreshes the profile, and — crucially —
  // refetches + applies the new profile data so the frame behind the modal is
  // at its FINAL layout (stats line, zigzag, shelf heights all settled) before
  // the modal dissolves. That kills the post-close pop-in / page-length jump.
  // revealStep is already 0 (frame-only) from the open effect, so the loaded
  // content stays hidden, ready for the reveal's fade-ins.
  async function handleOnboardingComplete() {
    onboardingDoneRef.current = true;
    setRevealStep(0);
    if (user) {
      try { await markOnboarded(user.id); } catch (e) { console.warn("markOnboarded failed:", e); }
      if (progress["tsp"] && !progress["tsp"].watchingQuote) {
        try { await setShelfBlurb(user.id, "tsp", "watching_quote", DEFAULT_TSP_BLURB); } catch { /* best-effort */ }
      }
      try { await refreshProfile(); } catch { /* non-fatal */ }
      try { applyProfileData(await fetchAllProfileData(user.id)); } catch (e) { console.warn("profile refetch failed:", e); }
    }
  }

  // Called after the modal has finished fading out. The frame is already fully
  // laid out (handleOnboardingComplete loaded the data), so we just unmount the
  // now-invisible modal and start the beat sequence.
  function handleRevealStart() {
    setOnboardingOpen(false);
    startReveal();
  }

  // Four distinct canon-block colors for the shelf section dividers (one
  // each before Watching Now / Want / Finished / Stopped). Picked once at
  // mount via useState initializer — stable as the user scrolls, re-rolls
  // on next page visit. The thoughts↔meta-prose divider is the zigzag
  // line (ZigzagDivider), not a canon block.
  const [dividerColors] = useState<string[]>(() => pickDistinctDividerColors(4));

  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  // Which shelf's inline "+ add a show" tile is currently expanded (only one
  // at a time). null = all collapsed. Want, Watching, and Finished each get a
  // tile (the latter two only when they have no real show — onboarding spec).
  const [addOpenShelf, setAddOpenShelf] = useState<ShelfStatus | null>(null);

  // Treated art — random show pick from this profile's progress list,
  // locked once when progress data first loads. Stable for the life of
  // this mount; revisit / remount picks a fresh show. "tsp" is the
  // onboarding seed show and isn't shown on the public profile, so
  // it's filtered out of the candidate pool too.
  const [artShowId, setArtShowId] = useState<string | null>(null);
  useEffect(() => {
    if (artShowId) return;
    const candidates = Object.keys(progress).filter((s) => s !== "tsp");
    if (candidates.length === 0) return;
    setArtShowId(candidates[Math.floor(Math.random() * candidates.length)]);
  }, [progress, artShowId]);

  // "Remove this show from profile" — small Trash button on every show
  // card opens a confirmation modal. On confirm, runs
  // removeShowFromProfile (room cascade + DELETE progress row) and prunes
  // the show from local state so the shelf re-renders without it. Threads
  // and replies on the show are NOT touched.
  const [removeShowId, setRemoveShowId] = useState<string | null>(null);
  const [removeSubmitting, setRemoveSubmitting] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // "Thoughts on..." state — owner's pieces, compose-modal state, and a
  // cycling-prompt suggestion shared between the empty state and the
  // below-carousel "write a new one" affordance.
  const [thoughts, setThoughts] = useState<ProfileThought[]>([]);
  const [thoughtsLoaded, setThoughtsLoaded] = useState(false);
  const [composeOpen, setComposeOpen] = useState<{
    mode: ProfileThoughtsComposeMode;
    initialContent: { titleCompletion: string; body: string } | null;
    editingId?: string;
  } | null>(null);
  const [cyclingPrompt, setCyclingPrompt] = useState<string>(() => pickProfileThoughtPrompt(null));

  // All friend rooms the user belongs to, fetched once on mount and
  // grouped per-show. Powers the "go to your friend room" buttons on
  // shelf cards. One query at page load (cheap) avoids per-card lazy
  // fetches and keeps the render synchronous.
  const [allUserRooms, setAllUserRooms] = useState<FriendGroup[]>([]);
  // Shows this user has (non-deleted) public writing for — drives the
  // "go to your public writing" CTA on shelf cards.
  const [publicWritingShows, setPublicWritingShows] = useState<Set<string>>(new Set());

  // Fetch the full profile data set. Pure (no state writes) so it can be
  // awaited from both the mount effect AND the onboarding-complete path.
  async function fetchAllProfileData(uid: string) {
    const [s, p, t, rooms, publicThreads] = await Promise.all([
      fetchShows(),
      fetchProgress(uid),
      fetchProfileThoughtsForOwner(uid),
      fetchAllFriendGroupsWithActivity(uid),
      fetchPublicThreadsForUser(uid),
    ]);
    return {
      shows: s,
      progress: p,
      thoughts: t,
      rooms,
      publicWriting: new Set(publicThreads.filter((th) => !th.isDeleted).map((th) => th.showId)),
    };
  }
  function applyProfileData(d: Awaited<ReturnType<typeof fetchAllProfileData>>) {
    setShows(d.shows);
    setProgress(d.progress);
    setThoughts(d.thoughts);
    setAllUserRooms(d.rooms);
    setPublicWritingShows(d.publicWriting);
    setThoughtsLoaded(true);
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchAllProfileData(user.id)
      .then((d) => { if (!cancelled) applyProfileData(d); })
      .catch((err) => {
        if (cancelled) return;
        console.warn("V2ProfileSelfPage bootstrap failed:", err);
        // Unblock empty-state rendering even on partial failure.
        setThoughtsLoaded(true);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  // Per-show friend-rooms lookup. Built from allUserRooms once, used by
  // shelf cards to render the friend-room CTA per show (single → button,
  // multiple → dropdown).
  const roomsByShow = useMemo(() => {
    const m = new Map<string, FriendGroup[]>();
    for (const room of allUserRooms) {
      const arr = m.get(room.showId) ?? [];
      arr.push(room);
      m.set(room.showId, arr);
    }
    return m;
  }, [allUserRooms]);

  // === Thoughts on... handlers ============================================

  const sortedThoughts = useMemo(() => sortOwnerProfileThoughts(thoughts), [thoughts]);

  function handleWriteNew() {
    // Seed the modal with whatever prompt the user is currently looking at
    // via the cycling-prompt UI. Modal's own ↻ button can cycle further.
    setComposeOpen({
      mode: "create",
      initialContent: { titleCompletion: cyclingPrompt, body: "" },
    });
  }

  function handleEditThought(t: ProfileThought) {
    setComposeOpen({
      mode: t.isPublic ? "edit-public" : "edit-private",
      initialContent: { titleCompletion: t.titleCompletion, body: t.body },
      editingId: t.id,
    });
  }

  async function handleComposeSubmit(payload: ProfileThoughtsSubmitPayload) {
    if (!user || !composeOpen) return;
    if (composeOpen.editingId) {
      const editingThought = thoughts.find((t) => t.id === composeOpen.editingId);
      const wasPublic = editingThought?.isPublic ?? false;
      const transitionToPublic = !wasPublic && payload.isPublic;
      const updated = await updateProfileThought(composeOpen.editingId, {
        titleCompletion: payload.titleCompletion,
        body: payload.body,
        // Omit isPublic in edit-public mode — destination is locked to
        // featured and can't change, so we skip the spurious write. In
        // edit-private mode the toggle could go either way; pass it through.
        ...(composeOpen.mode === "edit-public" ? {} : { isPublic: payload.isPublic }),
        bumpPublishedAt: transitionToPublic,
      });
      setThoughts((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } else {
      const inserted = await insertProfileThought({
        authorId: user.id,
        titleCompletion: payload.titleCompletion,
        body: payload.body,
        isPublic: payload.isPublic,
      });
      setThoughts((prev) => [inserted, ...prev]);
    }
  }

  async function handlePublishThought(t: ProfileThought) {
    if (!user) return;
    const updated = await updateProfileThought(t.id, {
      isPublic: true,
      bumpPublishedAt: true,
    });
    setThoughts((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function handleDeleteThought(t: ProfileThought) {
    await deleteProfileThought(t.id);
    setThoughts((prev) => prev.filter((x) => x.id !== t.id));
  }

  // Inline-compose submit handler — used by the empty-state inline form.
  // Always create (no edit path); always create new thought. After a
  // successful insert, thoughts.length > 0 → the empty-state branch
  // unmounts and the carousel takes over (existing behavior). The modal
  // path uses handleComposeSubmit (which routes editingId too).
  async function handleInlineThoughtSubmit(payload: ProfileThoughtsSubmitPayload) {
    if (!user) return;
    const inserted = await insertProfileThought({
      authorId: user.id,
      titleCompletion: payload.titleCompletion,
      body: payload.body,
      isPublic: payload.isPublic,
    });
    setThoughts((prev) => [inserted, ...prev]);
  }

  function cyclePromptSuggestion() {
    setCyclingPrompt((cur) => pickProfileThoughtPrompt(cur));
  }

  const buckets = useMemo(() => {
    const out: Record<ShelfStatus, string[]> = { watching: [], want: [], finished: [], stopped: [] };
    for (const sid of Object.keys(progress)) {
      // TSP (Sidebar Protocol demo show). Per the onboarding spec (§6) it
      // surfaces in the OWNER's Watching-now shelf once they've onboarded —
      // and only until they stop watching it (the stop-watching cascade sets
      // stoppedWatching, at which point it drops off the profile entirely; it
      // never appears on the Stopped shelf — the user "graduates" past it).
      // Still hidden from the public/visitor profile unconditionally
      // (V2ProfileVisitorPage filters it). A non-onboarded owner doesn't see
      // it either (it's part of the post-onboarding furniture).
      if (sid === "tsp") {
        if (profile?.onboarded_at && !progress[sid]?.stoppedWatching) out.watching.push(sid);
        continue;
      }
      const p = progress[sid];
      const show = shows.find((s) => s.id === sid);
      out[classifyShow(p, show)].push(sid);
    }
    // Per-shelf sort: position-mode if any row has a position, else
    // alphabetical (with pin priority retained for finished as legacy).
    out.watching = sortShelf(out.watching, "watching", shows, progress);
    out.want = sortShelf(out.want, "want", shows, progress);
    out.finished = sortShelf(out.finished, "finished", shows, progress);
    out.stopped = sortShelf(out.stopped, "stopped", shows, progress);
    return out;
  }, [progress, shows, profile?.onboarded_at]);

  // Finished shelf paging: when there are more than 6 finished shows,
  // collapse to the first 6 by default with a "see all N shows" button.
  // Click expands to show all; "show fewer" collapses back.
  const FINISHED_COLLAPSED_LIMIT = 6;
  const [showAllFinished, setShowAllFinished] = useState(false);
  const finishedDisplay = buckets.finished.length > FINISHED_COLLAPSED_LIMIT && !showAllFinished
    ? buckets.finished.slice(0, FINISHED_COLLAPSED_LIMIT)
    : buckets.finished;

  if (!authLoading && !user) {
    return <V2Layout palette="profile"><div /></V2Layout>;
  }

  function updateLocalProgress(showId: string, patch: Partial<ProgressEntry>) {
    setProgress((prev) => ({ ...prev, [showId]: { ...prev[showId], ...patch } }));
  }

  // === Edit / move / reorder state =========================================
  //
  // editingShelves: which shelves are in edit mode. Independent per-shelf
  //   toggles via the SquarePen button in each ShelfHead.
  // openChevronSid: which ticket's move-to dropdown is open (single, since
  //   the dropdown is portal-free + opening another auto-closes the prior).
  const [editingShelves, setEditingShelves] = useState<Set<ShelfStatus>>(new Set());
  const [openChevronSid, setOpenChevronSid] = useState<string | null>(null);

  function toggleShelfEdit(shelf: ShelfStatus) {
    setEditingShelves((prev) => {
      const next = new Set(prev);
      if (next.has(shelf)) next.delete(shelf);
      else next.add(shelf);
      return next;
    });
    // Closing the chevron when exiting edit mode is implicit — the dropdown
    // only renders when its ticket is in edit mode.
    setOpenChevronSid(null);
  }

  // Chevron-move: write shelf_override + clear shelf_position (the row enters
  // its new shelf with no explicit position; lands at the end alphabetically
  // until the user drag-reorders the new shelf). Optimistic local update so
  // the ticket appears on the new shelf immediately.
  async function handleMoveToShelf(showId: string, target: ShelfName) {
    if (!user) return;
    setOpenChevronSid(null);
    try {
      await setShelfOverride(user.id, showId, target);
      updateLocalProgress(showId, { shelfOverride: target, shelfPosition: null });
    } catch (err) {
      console.warn("setShelfOverride failed:", err);
    }
  }

  // dnd-kit sensors. PointerSensor with activationConstraint avoids
  // hijacking clicks on the chevron/grip; KeyboardSensor is the standard
  // accessibility add.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Drag-end handler builder: returns a handler scoped to a specific shelf.
  // On drop, computes the new ordering for that shelf, optimistically updates
  // local positions, then writes positions for ALL items in that shelf.
  function makeDragEndHandler(shelf: ShelfStatus) {
    return async function handleDragEnd(ev: DragEndEvent) {
      const { active, over } = ev;
      if (!user || !over || active.id === over.id) return;
      const current = buckets[shelf];
      const oldIndex = current.indexOf(String(active.id));
      const newIndex = current.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      const reordered = arrayMove(current, oldIndex, newIndex);
      // Optimistic: assign 0..N positions locally, then persist.
      setProgress((prev) => {
        const next = { ...prev };
        reordered.forEach((sid, i) => {
          if (next[sid]) next[sid] = { ...next[sid], shelfPosition: i };
        });
        return next;
      });
      try {
        await setShelfPositions(
          user.id,
          reordered.map((sid, i) => ({ showId: sid, position: i }))
        );
      } catch (err) {
        console.warn("setShelfPositions failed:", err);
      }
    };
  }

  // Reusable inline "+ add a show" tile (Want shelf always; Watching/Finished
  // when they have no real show — onboarding spec "stay permanently"). Opens
  // SearchShows inline; on pick, persists progress, refetches, and lands the
  // user on the new show's journal tab (matches the existing add-tile flow).
  function renderAddTile(shelf: ShelfStatus, label: string) {
    if (addOpenShelf !== shelf) {
      return (
        <button
          onClick={() => setAddOpenShelf(shelf)}
          className="card"
          style={{
            ...PROFILE_ADD_TILE,
            padding: "14px 22px",
            width: "100%",
            textAlign: "left",
            cursor: "pointer",
            fontFamily: "Lora, Georgia, serif",
            fontStyle: "italic",
            fontSize: 15,
            color: "var(--dos-fg)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Plus size={16} color="currentColor" /> {label}
        </button>
      );
    }
    return (
      <div className="card" style={{ ...PROFILE_CARD, padding: "16px 22px" }}>
        <SearchShows
          shows={shows}
          progress={progress}
          onShowCreated={async (s, entry) => {
            // Persist the entry from the modal (createShow alone writes no
            // progress row), refetch, then land on the new show's journal tab.
            if (!user) return;
            try {
              await upsertRewatchStatus(user.id, s.id, entry);
            } catch (err) {
              console.warn("upsertRewatchStatus failed:", err);
            }
            const next = await fetchProgress(user.id);
            setProgress(next);
            setAddOpenShelf(null);
            navigate("/journal", { state: { activeTab: s.id } });
          }}
          onReopenJournal={async (showId) => {
            if (user && progress[showId]?.stoppedWatching) {
              try {
                await setStoppedWatching(user.id, showId, false);
              } catch (err) {
                console.warn("clear-stopped failed:", err);
              }
            }
            navigate(`/journal`, { state: { activeTab: showId } });
          }}
          onAuthRequired={() => navigate("/")}
          placeholder="find a show"
        />
        <button
          onClick={() => setAddOpenShelf(null)}
          className="btn h40"
          style={{ marginTop: 12, fontSize: 12 }}
        >
          cancel
        </button>
      </div>
    );
  }

  return (
    <V2Layout
      palette="profile"
      pairedHeader={{
        left: "this is your public profile",
        rightLabel: "go to your journal",
        rightTo: "/journal",
      }}
      pairedHeaderHidden={!revealShown(5)}
      chromeLogoHidden={chromeLogoHidden}
    >
      {/* === PROFILE IDENTITY ===
          Centered, full column width — visual parity with the visitor view
          (V2ProfileVisitorPage). The pairedHeader ("this is your public
          profile" / "go to your journal") in V2Layout stays where it is;
          this header sits below it spanning the column. */}
      <header style={{ textAlign: "center", paddingTop: 24, marginBottom: 56 }}>
        <div style={{ display: "inline-block", marginBottom: 18 }}>
          <SidebarAvatar userId={user?.id} username={profile?.username ?? undefined} size={88} />
        </div>
        <h1
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontWeight: 600,
            fontSize: 48,
            letterSpacing: "0.02em",
            lineHeight: 1.05,
            color: "var(--dos-fg)",
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          @{profile?.username ?? "—"}
        </h1>
      </header>

      {/* === THOUGHTS ON... ===
          The carousel sits at the top of the profile (per spec). When the
          owner has no pieces, renders an empty state with a cycling prompt
          suggestion + "write a thought" CTA. When populated, the carousel
          renders + a soft "write a new one" affordance below it (also with
          the cycling prompt, shared state). The compose modal is mounted
          at the bottom of this component as a fixed-position overlay. */}
      {thoughtsLoaded && user && (
        <section ref={thoughtsRef as React.RefObject<HTMLElement>} style={{ marginBottom: 40, textAlign: "center", ...revealStyle(1) }}>
          {thoughts.length === 0 ? (
            // Empty state: inline version of the Thoughts-on compose modal.
            // Two destination-implicit buttons ("post privately" / "post to
            // your profile") submit directly in one click. As soon as the
            // first thought is inserted, thoughts.length > 0 → the carousel
            // branch below takes over. The modal continues to handle
            // subsequent "write a new one" flows from the populated state.
            <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "left" }}>
              <ProfileThoughtsCompose
                inline
                mode="create"
                initialContent={null}
                onSubmit={handleInlineThoughtSubmit}
                onClose={() => {}}
              />
            </div>
          ) : (
            <>
              <ProfileThoughtsCarousel
                thoughts={sortedThoughts}
                ownerMode
                ownerHandlers={{
                  onEdit: handleEditThought,
                  onPublish: handlePublishThought,
                  onDelete: handleDeleteThought,
                }}
              />
              {/* Soft below-carousel "write a new one" with a cycling prompt
                  suggestion. Order: write-new link → Thoughts on prompt →
                  cycle circle. Always present, never demanding.
                  Outer alignItems=baseline so when the prompt wraps to a
                  second line, the writeNew link stays on the first baseline
                  rather than centering vertically with a 2-line prompt. */}
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 10, marginTop: 16, flexWrap: "wrap", opacity: 0.9 }}>
                <button
                  onClick={handleWriteNew}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--dos-fg)",
                    fontFamily: "Lora, Georgia, serif",
                    fontStyle: "italic",
                    fontSize: 14,
                    cursor: "pointer",
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  <span style={{ textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 4 }}>
                    write a new one?
                  </span>
                  <ArrowRight size={14} color="currentColor" />
                </button>
                {/* Prompt as a single flex item that takes the remaining
                    width; its text content wraps freely at spaces, but the
                    LAST 3 WORDS + refresh circle are wrapped in a nowrap
                    inline-flex so only that tail drops to line 2 if needed.
                    Prompts shorter than 3 words become the entire tail. */}
                {(() => {
                  const TAIL_WORDS = 3;
                  const parts = cyclingPrompt.split(" ");
                  const tailStart = Math.max(0, parts.length - TAIL_WORDS);
                  const promptPrefix = parts.slice(0, tailStart).join(" ");
                  const promptTail = parts.slice(tailStart).join(" ");
                  return (
                    <span style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 14, color: "var(--dos-fg)", flex: "1 1 0", minWidth: 0 }}>
                      Thoughts on{promptPrefix ? <>{" "}{promptPrefix}</> : null}{" "}
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                        {promptTail}…
                        <button
                          onClick={cyclePromptSuggestion}
                          aria-label="cycle prompt"
                          title="cycle to another prompt"
                          style={{
                            width: 22,
                            height: 22,
                            background: "#fff",
                            border: "none",
                            borderRadius: "50%",
                            color: "#7abd8e",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            flexShrink: 0,
                            verticalAlign: "middle",
                          }}
                        >
                          <RefreshCw size={12} color="currentColor" strokeWidth={2.5} />
                        </button>
                      </span>
                    </span>
                  );
                })()}
              </div>
            </>
          )}
        </section>
      )}

      {thoughtsLoaded && user && (
        <div style={{ maxWidth: 252, margin: "96px auto 32px" }}>
          <ZigzagDivider />
        </div>
      )}

      {/* === META PROSE — watch-status counts row. Tightened margins so
          this line, the zigzag above, the canon-block divider below, and
          the "WATCHING NOW" heading after it all read as one visual unit
          (per mockup). 32px gaps between each step in the cluster. */}
      <p
        style={{
          textAlign: "center",
          margin: "0 0 32px",
          fontFamily: "Lora, Georgia, serif",
          fontStyle: "italic",
          fontSize: 16,
          color: "var(--dos-gray)",
          lineHeight: 1.5,
        }}
      >
        <strong style={{ fontStyle: "normal", fontWeight: 600, color: "var(--dos-fg)" }}>
          {Object.keys(progress).filter((s) => s !== "tsp").length} shows
        </strong>
        {" · "}
        <strong style={{ fontStyle: "normal", fontWeight: 600, color: "var(--dos-fg)" }}>
          {buckets.watching.length} watching now
        </strong>
        {" · "}
        <strong style={{ fontStyle: "normal", fontWeight: 600, color: "var(--dos-fg)" }}>
          {buckets.want.length} want to watch
        </strong>
        {user?.created_at ? ` · on Sidebar since ${formatJoinedSince(user.created_at)}` : ""}
      </p>

      {/* === WATCHING NOW — always rendered: frame for the reveal + a
          permanent add-tile when there's no real (non-TSP) show. TSP lives
          here post-onboarding. Heading stays visible (frame); only the
          content fades during the reveal (beat 2). === */}
      <section ref={watchingRef as React.RefObject<HTMLElement>} style={{ marginBottom: 56 }}>
          <HomeDivider color={dividerColors[0]} />
          <ShelfHead
            eyebrow="what you're in the middle of:"
            title="Watching Now"
            editing={editingShelves.has("watching")}
            onToggleEdit={() => toggleShelfEdit("watching")}
          />
          <div style={revealStyle(2)}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={makeDragEndHandler("watching")}>
            <SortableContext items={buckets.watching} strategy={verticalListSortingStrategy}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
                {buckets.watching.map((sid) => {
                  const show = shows.find((s) => s.id === sid);
                  const p = progress[sid];
                  if (!show || !p || !user) return null;
                  const isEditing = editingShelves.has("watching");
                  return (
                    <SortableCard
                      key={sid}
                      sid={sid}
                      editing={isEditing}
                      currentShelf="watching"
                      chevronOpen={openChevronSid === sid}
                      onChevronToggle={() => setOpenChevronSid((cur) => (cur === sid ? null : sid))}
                      onMoveToShelf={(target) => handleMoveToShelf(sid, target)}
                      className="card"
                      style={{
                        ...PROFILE_CARD,
                        padding: isEditing ? "22px 80px 36px 26px" : "22px 26px 36px",
                        position: "relative",
                      }}
                    >
                      <DeleteShowButton onClick={() => { setRemoveShowId(sid); setRemoveError(null); }} />
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                        <div style={{ display: "inline-flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                          <ShowNameLink
                            showName={show.name}
                            showId={sid}
                            style={{ fontSize: 22, fontWeight: 600, color: "var(--dos-fg)", lineHeight: 1.2 }}
                            navigate={navigate}
                          />
                          <ProgressBadge progress={p} />
                        </div>
                        {p.isRewatching && <span style={{ fontSize: 12, color: "var(--dos-gray)", fontStyle: "italic" }}>rewatch</span>}
                      </div>
                      <div
                        style={{
                          paddingLeft: 14,
                          borderLeft: `2px solid ${progress[sid]?.watchingQuote ? "#355eb8" : "rgba(0,0,0,0.12)"}`,
                        }}
                      >
                        <BlurbField
                          kind="watching_quote"
                          value={p.watchingQuote}
                          placeholder="add a first impression…"
                          italic
                          userId={user.id}
                          showId={sid}
                          onSaved={(v) => updateLocalProgress(sid, { watchingQuote: v })}
                        />
                      </div>
                      <ShelfCTAs
                        showId={sid}
                        rooms={roomsByShow.get(sid)}
                        hasPublicWriting={publicWritingShows.has(sid)}
                        username={profile?.username ?? ""}
                        navigate={navigate}
                      />
                    </SortableCard>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
          {buckets.watching.filter((s) => s !== "tsp").length === 0 && (
            <div style={{ marginTop: 14 }}>
              {renderAddTile("watching", "add a show you're watching")}
            </div>
          )}
          </div>
        </section>

      {/* === WANT TO WATCH (always renders for the + add tile) === */}
      <section ref={wantRef as React.RefObject<HTMLElement>} style={{ marginBottom: 56 }}>
        <HomeDivider color={dividerColors[1]} />
        <ShelfHead
          eyebrow="on your watch list:"
          title="Want to Watch"
          editing={editingShelves.has("want")}
          onToggleEdit={() => toggleShelfEdit("want")}
        />
        <div style={revealStyle(3)}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={makeDragEndHandler("want")}>
          <SortableContext items={buckets.want} strategy={verticalListSortingStrategy}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {buckets.want.map((sid) => {
                const show = shows.find((s) => s.id === sid);
                const p = progress[sid];
                if (!show || !p || !user) return null;
                const isEditing = editingShelves.has("want");
                return (
                  <SortableCard
                    key={sid}
                    sid={sid}
                    editing={isEditing}
                    currentShelf="want"
                    chevronOpen={openChevronSid === sid}
                    onChevronToggle={() => setOpenChevronSid((cur) => (cur === sid ? null : sid))}
                    onMoveToShelf={(target) => handleMoveToShelf(sid, target)}
                    className="card"
                    style={{
                      ...PROFILE_CARD,
                      padding: isEditing ? "14px 80px 14px 22px" : "14px 60px 14px 22px",
                      position: "relative",
                    }}
                  >
                    <DeleteShowButton onClick={() => { setRemoveShowId(sid); setRemoveError(null); }} />
                    <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 14 }}>
                      <ShowNameLink
                        showName={show.name}
                        showId={sid}
                        style={{ fontSize: 17, fontWeight: 600, color: "var(--dos-fg)" }}
                        navigate={navigate}
                      />
                      <span style={{ flex: 1, minWidth: 200 }}>
                        <BlurbField
                          kind="want_reason"
                          value={p.wantReason}
                          placeholder="add a reason…"
                          italic
                          userId={user.id}
                          showId={sid}
                          onSaved={(v) => updateLocalProgress(sid, { wantReason: v })}
                        />
                      </span>
                    </div>
                    <ShelfCTAs
                      showId={sid}
                      rooms={roomsByShow.get(sid)}
                      hasPublicWriting={publicWritingShows.has(sid)}
                      username={profile?.username ?? ""}
                      navigate={navigate}
                    />
                  </SortableCard>
                );
              })}

          {/* + add tile — opens inline SearchShows (defaults to (0,0) so a
              pick lands as want-to-watch). Shared renderer; see renderAddTile. */}
          {renderAddTile("want", "add a show to your list")}
            </div>
          </SortableContext>
        </DndContext>
        </div>
      </section>

      {/* === FINISHED WATCHING — always rendered: frame for the reveal +
          permanent add-tile when empty. Heading stays visible (frame); only
          the content fades during the reveal (beat 4). === */}
      <section ref={finishedRef as React.RefObject<HTMLElement>} style={{ marginBottom: 56 }}>
          <HomeDivider color={dividerColors[2]} />
          <ShelfHead
            eyebrow="shows you've completed:"
            title="Finished Watching"
            editing={editingShelves.has("finished")}
            onToggleEdit={() => toggleShelfEdit("finished")}
          />
          <div style={revealStyle(4)}>
          {buckets.finished.length === 0 && (
            <div style={{ marginBottom: 12 }}>
              {renderAddTile("finished", "add a show to your list")}
            </div>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={makeDragEndHandler("finished")}>
            <SortableContext items={finishedDisplay} strategy={rectSortingStrategy}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                {finishedDisplay.map((sid) => {
                  const show = shows.find((s) => s.id === sid);
                  const p = progress[sid];
                  if (!show || !p || !user) return null;
                  const pinned = !!p.canonPin;
                  const isEditing = editingShelves.has("finished");
                  return (
                    <SortableCard
                      key={sid}
                      sid={sid}
                      editing={isEditing}
                      currentShelf="finished"
                      chevronOpen={openChevronSid === sid}
                      onChevronToggle={() => setOpenChevronSid((cur) => (cur === sid ? null : sid))}
                      onMoveToShelf={(target) => handleMoveToShelf(sid, target)}
                      className="card"
                      style={{
                        ...PROFILE_CARD,
                        // In edit mode, extra right padding clears the top-right edit overlay
                        // AND the leftward-shifted Pin button (see Pin style below).
                        padding: isEditing ? "20px 130px 36px 22px" : "20px 22px 36px",
                        position: "relative",
                      }}
                    >
                  <DeleteShowButton onClick={() => { setRemoveShowId(sid); setRemoveError(null); }} />
                  <button
                    onClick={async () => {
                      try {
                        await setCanonPin(user.id, sid, !pinned);
                        updateLocalProgress(sid, { canonPin: !pinned });
                      } catch (err) {
                        console.warn("setCanonPin failed:", err);
                      }
                    }}
                    title={pinned ? "in your canon — click to remove" : "add to your canon"}
                    style={{
                      position: "absolute",
                      top: 14,
                      // Shift leftward when editing so the top-right edit overlay (grip +
                      // chevron, ~52px wide at right:8) has room to sit. Non-edit position
                      // unchanged.
                      right: isEditing ? 70 : 14,
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: pinned ? "4px 10px" : 4,
                      borderRadius: 9999,
                      color: pinned ? "var(--danger)" : "var(--dos-gray)",
                      fontFamily: pinned ? "Lora, Georgia, serif" : undefined,
                      fontStyle: pinned ? "italic" : undefined,
                      fontWeight: pinned ? 500 : undefined,
                      fontSize: pinned ? 13 : undefined,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    {pinned ? "canon" : <Pin size={14} color="currentColor" />}
                  </button>
                      <ShowNameLink
                        showName={show.name}
                        showId={sid}
                        as="div"
                        style={{ fontSize: 18, fontWeight: 600, color: "var(--dos-fg)", lineHeight: 1.2, paddingRight: 64, marginBottom: 10 }}
                        navigate={navigate}
                      />
                      <BlurbField
                        kind="canon_take"
                        value={p.canonTake}
                        placeholder="add a take…"
                        italic
                        userId={user.id}
                        showId={sid}
                        onSaved={(v) => updateLocalProgress(sid, { canonTake: v })}
                      />
                      <ShelfCTAs
                        showId={sid}
                        rooms={roomsByShow.get(sid)}
                        hasPublicWriting={publicWritingShows.has(sid)}
                        username={profile?.username ?? ""}
                        navigate={navigate}
                      />
                    </SortableCard>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
          {/* See-all expand/collapse — only render when there are more
              than 6 shows; expanded view shows all, collapsed shows the
              first 6. The button toggles. (Both rendered states live
              here so finishedDisplay above is sliced accordingly.) */}
          {buckets.finished.length > 6 && (
            <div style={{ textAlign: "center", marginTop: 18 }}>
              <button
                className="btn h40"
                onClick={() => setShowAllFinished((v) => !v)}
              >
                {showAllFinished
                  ? `show fewer`
                  : `see all ${buckets.finished.length} ${buckets.finished.length === 1 ? "show" : "shows"}`}
              </button>
            </div>
          )}
          </div>
        </section>

      {/* === STOPPED WATCHING ===
          Same double-column grid as Finished Watching for shelf parity:
          repeat(auto-fit, minmax(280px, 1fr)) collapses to single column
          on narrow viewports. Title + "stopped at SXXEXX" inline like
          the Watching Now title row, then the blurb below. */}
      {buckets.stopped.length > 0 && (
        <section style={{ marginBottom: 56 }}>
          <HomeDivider color={dividerColors[3]} />
          <ShelfHead
            eyebrow="shows you've stopped, for now:"
            title="Stopped Watching"
            editing={editingShelves.has("stopped")}
            onToggleEdit={() => toggleShelfEdit("stopped")}
          />
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={makeDragEndHandler("stopped")}>
            <SortableContext items={buckets.stopped} strategy={rectSortingStrategy}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                {buckets.stopped.map((sid) => {
                  const show = shows.find((s) => s.id === sid);
                  const p = progress[sid];
                  if (!show || !p || !user) return null;
                  const isEditing = editingShelves.has("stopped");
                  return (
                    <SortableCard
                      key={sid}
                      sid={sid}
                      editing={isEditing}
                      currentShelf="stopped"
                      chevronOpen={openChevronSid === sid}
                      onChevronToggle={() => setOpenChevronSid((cur) => (cur === sid ? null : sid))}
                      onMoveToShelf={(target) => handleMoveToShelf(sid, target)}
                      className="card"
                      style={{
                        ...PROFILE_CARD,
                        padding: isEditing ? "20px 80px 36px 22px" : "20px 22px 36px",
                        position: "relative",
                      }}
                    >
                      <DeleteShowButton onClick={() => { setRemoveShowId(sid); setRemoveError(null); }} />
                      <div style={{ display: "inline-flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
                        <ShowNameLink
                          showName={show.name}
                          showId={sid}
                          style={{ fontSize: 18, fontWeight: 600, color: "var(--dos-fg)", lineHeight: 1.2 }}
                          navigate={navigate}
                        />
                        <span style={{ fontSize: 12, color: "var(--dos-gray)", fontStyle: "italic" }}>stopped at {progressShort(p)}</span>
                      </div>
                      <BlurbField
                        kind="stopped_reason"
                        value={p.stoppedReason}
                        placeholder="add a reason…"
                        italic
                        userId={user.id}
                        showId={sid}
                        onSaved={(v) => updateLocalProgress(sid, { stoppedReason: v })}
                      />
                      <ShelfCTAs
                        showId={sid}
                        rooms={roomsByShow.get(sid)}
                        hasPublicWriting={publicWritingShows.has(sid)}
                        username={profile?.username ?? ""}
                        navigate={navigate}
                      />
                    </SortableCard>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </section>
      )}

      {/* Delete-show-from-profile confirmation modal — same Modal shape
          as the V3 stop-watching modal (rounded card, no outline, Inter
          text). On confirm, removeShowFromProfile runs the room cascade
          and DELETEs the user's progress row; the show vanishes from
          every shelf. Threads + replies on the show are untouched. */}
      {removeShowId && user && profile && (() => {
        const sid = removeShowId;
        const sName = shows.find((s) => s.id === sid)?.name ?? sid;
        const closeIfIdle = () => { if (!removeSubmitting) { setRemoveShowId(null); setRemoveError(null); } };
        return (
          <Modal onClose={closeIfIdle} width="min(440px,92vw)">
            <div style={{ padding: "16px 12px 12px" }}>
              <p style={{ margin: "0 0 12px", fontSize: 17, lineHeight: 1.5, fontWeight: 600 }}>
                Remove <em>{sName}</em> from your profile?
              </p>
              <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.5, opacity: 0.85 }}>
                The show vanishes from every shelf. You'll leave any friend rooms on this show and need to be re-invited. Your journal entries and posts on the show stay where they are.
              </p>
              {removeError && (
                <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--danger)" }}>{removeError}</p>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  className="btn"
                  style={{ fontSize: 14, background: "transparent", border: "2px solid var(--danger)", color: "var(--danger)" }}
                  onClick={closeIfIdle}
                  disabled={removeSubmitting}
                >
                  Cancel
                </button>
                <button
                  className="btn"
                  style={{ fontSize: 14, background: "var(--danger)", border: "2px solid var(--danger)", color: "#fff" }}
                  disabled={removeSubmitting}
                  onClick={async () => {
                    if (!user || !profile || !sid) return;
                    setRemoveSubmitting(true);
                    setRemoveError(null);
                    try {
                      await removeShowFromProfile(user.id, profile.username, sid);
                      // Prune from local state so the shelf re-renders
                      // without the show. App-level progress will refresh
                      // on the next navigation; this gives immediate
                      // feedback in the current view.
                      setProgress((prev) => {
                        const next = { ...prev };
                        delete next[sid];
                        return next;
                      });
                      setRemoveShowId(null);
                      setRemoveSubmitting(false);
                    } catch (err: any) {
                      console.warn("removeShowFromProfile failed:", err);
                      setRemoveError(err?.message || "Couldn't remove. Try again.");
                      setRemoveSubmitting(false);
                    }
                  }}
                >
                  {removeSubmitting ? "Removing…" : "Remove"}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* Thoughts on... compose modal — full-screen overlay. Mounted at the
          bottom of the V2Layout children so its position:fixed escapes the
          page's content flow. State is null when closed; an object with
          mode + initialContent + (optional) editingId when open. */}
      {composeOpen && (
        <ProfileThoughtsCompose
          mode={composeOpen.mode}
          initialContent={composeOpen.initialContent}
          onSubmit={handleComposeSubmit}
          onClose={() => setComposeOpen(null)}
        />
      )}

      {/* Treated art — fixed to viewport bottom-corner, random show
          picked from this profile's progress list. Renders nothing
          until artShowId is set (i.e. until progress data lands).
          See src/components/TreatedArt.tsx for per-mount semantics. */}
      <TreatedArt key={artShowId ?? "pending"} showId={artShowId} anchor="fixed" />

      {/* First-login onboarding modal (sidebar_spec_onboarding_v03). Opens
          over this profile for never-onboarded users; portals to body. */}
      {onboardingOpen && user && (
        <OnboardingModal
          onComplete={handleOnboardingComplete}
          onRevealStart={handleRevealStart}
          onFadeStart={() => setChromeLogoHidden(false)}
        />
      )}
    </V2Layout>
  );
}

function ShelfHead({
  eyebrow,
  title,
  editing,
  onToggleEdit,
}: {
  eyebrow: string;
  title: string;
  editing?: boolean;
  onToggleEdit?: () => void;
}) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 15, color: "var(--dos-gray)", marginBottom: 4 }}>
        {eyebrow}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ fontFamily: "Lora, Georgia, serif", fontWeight: 600, fontSize: 28, letterSpacing: "0.04em", color: "var(--dos-fg)", textTransform: "uppercase", margin: 0 }}>
          {title}
        </h2>
        {onToggleEdit && (
          <button
            onClick={onToggleEdit}
            aria-label={editing ? "done editing" : "edit shelf"}
            title={editing ? "exit edit mode" : "edit / reorder this shelf"}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--dos-gray)",
              padding: 4,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "Lora, Georgia, serif",
              fontStyle: "italic",
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            {editing ? "done?" : <SquarePen size={16} color="currentColor" />}
          </button>
        )}
      </div>
    </div>
  );
}

// === SortableCard ============================================================
//
// Thin wrapper that participates in dnd-kit when its shelf is in edit mode.
// When editing, overlays a GripVertical (drag handle) + ChevronDown (move-to
// dropdown trigger) in the top-left corner of the card. The chevron's
// dropdown is rendered as a sibling absolute-positioned panel below the
// trigger; only one dropdown is open at a time (parent-managed).
function SortableCard({
  sid,
  editing,
  currentShelf,
  chevronOpen,
  onChevronToggle,
  onMoveToShelf,
  className,
  style,
  children,
}: {
  sid: string;
  editing: boolean;
  currentShelf: ShelfStatus;
  chevronOpen: boolean;
  onChevronToggle: () => void;
  onMoveToShelf: (target: ShelfName) => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sid,
    disabled: !editing,
  });
  const wrapperStyle: React.CSSProperties = {
    ...style,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    // Lift the card above siblings when its chevron dropdown is open so the
    // menu (which extends below the card border) isn't clipped by the next
    // card down. Drag-time priority kept too.
    zIndex: chevronOpen ? 30 : (isDragging ? 10 : undefined),
  };
  return (
    <article ref={setNodeRef} className={className} style={wrapperStyle}>
      {editing && (
        <EditCornerOverlay
          dragAttributes={attributes}
          dragListeners={listeners}
          currentShelf={currentShelf}
          chevronOpen={chevronOpen}
          onChevronToggle={onChevronToggle}
          onMoveToShelf={onMoveToShelf}
        />
      )}
      {children}
    </article>
  );
}

const SHELF_LABELS: Record<ShelfStatus, string> = {
  watching: "Watching Now",
  want: "Want to Watch",
  finished: "Finished Watching",
  stopped: "Stopped Watching",
};

function EditCornerOverlay({
  dragAttributes,
  dragListeners,
  currentShelf,
  chevronOpen,
  onChevronToggle,
  onMoveToShelf,
}: {
  dragAttributes: any;
  dragListeners: any;
  currentShelf: ShelfStatus;
  chevronOpen: boolean;
  onChevronToggle: () => void;
  onMoveToShelf: (target: ShelfName) => void;
}) {
  const others = (Object.keys(SHELF_LABELS) as ShelfStatus[]).filter((s) => s !== currentShelf);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!chevronOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(e.target as Node)) onChevronToggle();
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [chevronOpen, onChevronToggle]);
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        zIndex: 5,
      }}
    >
      <button
        {...dragAttributes}
        {...dragListeners}
        aria-label="drag to reorder"
        title="drag to reorder"
        style={{
          background: "transparent",
          border: "none",
          padding: 4,
          color: "#f45028",
          cursor: "grab",
          touchAction: "none",
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        <GripVertical size={16} color="currentColor" />
      </button>
      <div ref={dropdownRef} style={{ position: "relative", display: "inline-flex" }}>
        <button
          onClick={(e) => { e.stopPropagation(); onChevronToggle(); }}
          aria-label="move to another shelf"
          title="move to another shelf"
          style={{
            background: "transparent",
            border: "none",
            padding: 4,
            color: "#f45028",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          <ChevronDown size={16} color="currentColor" />
        </button>
        {chevronOpen && (
          <div
            role="menu"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              minWidth: 220,
              background: "#355eb8",
              border: "none",
              borderRadius: 23,
              boxShadow: "0 8px 23px rgba(0,0,0,0.15)",
              padding: 14,
              zIndex: 20,
            }}
          >
            <div style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 13, color: "#fff", padding: "0 6px 10px" }}>
              move to:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {others.map((target) => (
                <button
                  key={target}
                  onClick={() => onMoveToShelf(target)}
                  style={{
                    background: "transparent",
                    border: "2px solid #fff",
                    borderRadius: 9999,
                    padding: "8px 14px",
                    textAlign: "center",
                    fontFamily: "Inter, sans-serif",
                    fontSize: 14,
                    fontWeight: 500,
                    color: "#fff",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.18)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                >
                  {SHELF_LABELS[target]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Small absolute-positioned trash button rendered on every show card.
// Opens the confirmation modal via the parent's onClick. Subtle (gray
// + low opacity) so it doesn't compete with the canon Pin or the show
// title; gains a hover state via title attribute. Bottom-right rather
// than top-right because Finished cards already have the Pin in the
// top-right corner.
function DeleteShowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Remove this show from your profile"
      aria-label="Remove from profile"
      style={{
        position: "absolute",
        bottom: 10,
        right: 12,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 6,
        borderRadius: 9999,
        color: "var(--dos-gray)",
        opacity: 0.55,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
      }}
    >
      <Trash2 size={14} color="currentColor" />
    </button>
  );
}

// Plain-text watch-progress indicator. Was a green pill; pills suggest
// interactability and this badge is read-only, so the new spec switches
// to inline text. Mono-spaced via Inter's tabular numerals reads as a
// label without competing visually with adjacent interactive pills.
function ProgressBadge({ progress }: { progress: ProgressEntry }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: "var(--dos-fg)",
        fontSize: 13,
        fontWeight: 500,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {progressShort(progress)}
    </span>
  );
}
