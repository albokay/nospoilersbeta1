# Sidebar — Technical State (2026-04-22)

> Living handoff document. Read this at the start of every session. Update it whenever architecture decisions are made. **This is the single source of truth** — `PROJECT_NOTES.md` was removed on 2026-04-20; don't recreate it.

---

## 1. Stack & Architecture

- **Frontend:** React 18 + TypeScript + Vite, single `App.tsx` shell that derives view state from URL via `react-router-dom` wildcard route. Top-level rendering is gated by (a) the **mobile lockout** (`isMobileLocked && !isAdmin` short-circuits everything at `window.innerWidth < 768`) and (b) **auth-routing effects** that redirect signed-out users off `/profile` → `/` and signed-in non-admins off `/` → `/profile` (admins exempt; `/invite/:token` exempt). See §8.
- **Backend:** Supabase (Postgres + Auth + Realtime + Edge Functions). One Edge Function: `send-invite` (Resend email).
- **Styling:** Single CSS string injected at boot from `src/styles/theme.ts`. DOS/canon palette, body-class context theming (`has-header`, `group-context`, `public-context`).
- **Hosting:** Netlify auto-deploy on push to `main` (see `CLAUDE.md`, `netlify.toml`).
- **Auth:** Supabase Auth via `src/lib/auth.tsx` `AuthProvider`. Session subscription updates `user`/`profile` globally.
- **State:** All major state lifted to `App.tsx` (~1367 lines): `progress`, `shows`, `repliesToUser`, `allFriendGroups`, likes, profile-tab data. No Redux/Zustand.
- **Data layer:** `src/lib/db.ts` (~1574 lines) — every Supabase call is here, with snake_case→camelCase mappers (`rowToThread`, `rowToReply`, `rowToFriendGroup`, `rowToInvitation`).
- **Rate-limit + length validation** wrap every write (`db.ts:12-37`).

## 2. Database Tables

| Table | Purpose | Notes |
|---|---|---|
| `profiles` | One per user; `is_seed` flag for fictional users; `is_admin` flag | RLS: public read, owner write |
| `shows` | Catalog (id text PK, name, seasons int[], tvmaze_id, status, is_hidden, last_synced_at, genres, tvmaze_type) | Real-time subscribed in App; TVMaze-synced via `refreshShowIfStale` |
| `threads` | Forum posts. `is_public` (replaces `is_private`), `is_deleted`, `is_edited`, `is_rewatch`, `rewatch_season/episode`, `is_moved`, `moved_context`, `source_thread_id` (clone→original) | RLS: auth read all, owner-only write |
| `replies` | Posts inside threads. `reply_to_id`, `group_id` (room-scoping), `reference_type`+`quoted_text`+`referenced_reply/thread_id`, `is_rewatch`, `rewatch_*` | |
| `progress` | One per (user, show). `season`, `episode`, `is_rewatching`, `rewatch_season/episode`, `highest_season/episode` | RLS: owner only; public read via `get_public_progress` RPC. Two protective triggers (zero-rollback + rewatch-rollback) |
| `browse_progress` | Silent progress for users browsing public conversations without onboarding | Pre-fills picker on return |
| `likes_threads` / `likes_replies` | Per-user like rows; counts denormalized via RPCs (`increment_*_likes`/`decrement_*_likes`) | RLS: owner only — no public counts by design |
| `friend_groups` | Friend rooms (uuid PK, show_id text, name, created_by, deleted_at) | show_id has NO FK (phase4-fix-fk) |
| `friend_group_members` | (group_id, user_id) | RLS: members can see, creator can add/remove, members can leave |
| `friend_group_departed_members` | "X has left the room" trail | |
| `group_threads` | (group_id, thread_id, shared_at) — many-to-many | A thread can live in many rooms + be public simultaneously |
| `invitations` | Single-use, expiring tokens for room invites | RPCs `get_invitation_by_token` + `accept_invitation` (SECURITY DEFINER) |
| `response_citations` | (citing_reply_id, cited_reply_id?, cited_thread_id?) — quote/link references | Best-effort inserts |
| `prompts` / `thread_prompts` | Writing prompts shown in composer + audit log | Admin-only writes; thread_prompts is best-effort |
| `feedback` | FeedbackWidget submissions. `user_id` nullable (anon submissions use `null` + `username="anon"`) | RLS: admin-only reads; `role anon` can insert rows where `user_id IS NULL` (`20260420_anon_feedback.sql`) |
| `rate_limits` (implied) | Backing the `check_rate_limit*` RPCs | |

## 3. Three Publishing Destinations

The compose dropdown in `ShowSection.tsx:258` holds `composeDestination: "private" | "public" | <groupId>`. On submit (`ShowSection.tsx:1209-1216`):

1. **Private journal** — `insertThread({ ...isPublic: false })`. No group link. Visible only to the author in their `/profile` journal tab. Spoiler-tagged at writer's progress at save time.
2. **Friend room** — `insertThread({ ...isPublic: false })` then `addThreadToGroup(threadId, groupId)`. Replies in this thread carry `group_id` matching the room. Visible to all room members; spoiler-filtered against each member's own progress.
3. **Public aggregation** — `insertThread({ ...isPublic: true })`. Shows on the show's aggregated public page (`fetchPublicThreadsForShow`, `db.ts:841`) and on the author's PublicProfilePage. Public replies have `group_id = null`.

### Two-instance clone model (partial UI exposure)

The clone infrastructure (`cloneThreadToPublic` at `db.ts:222`, `source_thread_id` column, `is_moved` flag, `markThreadMovedFromGroup` at `db.ts:271`) supports moving a thread from one destination to another by creating a public copy that points back at the original via `source_thread_id`. Replies stay isolated between the two instances.

**Currently exposed in the UI:**
- **Private journal → public** is a live, user-facing feature. Users can move (or share) a private journal entry to public; this creates the public clone with `source_thread_id` pointing at the journal original.

**Dormant code path (still in db.ts, no UI entry point):**
- **Friend room → anywhere** was removed from the UI. `markThreadMovedFromGroup` + the friend-room → public clone flow exist in `db.ts` but no component currently calls them. Friend-room threads are not movable from the room.

When touching this area: the private→public path is live and must keep working; the friend-room move path is dormant and safe to leave alone (or remove later if confirmed unneeded).

**Group-scoped reply counts** in `fetchGroupThreads` filter `replies.group_id === groupId` so seeded shared threads (TSP) don't bleed counts across rooms (`db.ts:1359-1364`).

## 4. Spoiler Filtering

The filter is one function — `src/lib/utils.ts:49`:

```ts
canView(t, p) = !!eff && (t.season < eff.s || (t.season === eff.s && t.episode <= eff.e))
```

…where `eff = effectiveProgress(p)` returns `{highestS, highestE}` if the viewer is rewatching, otherwise `{s, e}` (`utils.ts:39-47`). Comparison is **inclusive of the current episode** (you see posts at your episode).

**Tagging at write time:**
- `insertThread`/`insertReply` write `season`/`episode` from the writer's *current* progress (`ShowSection.tsx:1209` passes `threadData` built from `effectiveProgress`).
- `editThread`/`editReply` also accept `season`/`episode` and re-tag on save (`db.ts:164`, `db.ts:364`).

**Rewatch model** (the most subtle piece):
- A rewatcher's `s/e` is their rewatch position; their `highestS/E` is the spoiler ceiling.
- For *filtering* (what they see), `effectiveProgress` returns `highestS/E`.
- For *posting*, the post's `season/episode` filter tag = `highestS/E` (rewatchers post at their ceiling, so first-timers below that level can't see the post). The `rewatch_season/episode` columns store the rewatch position as display-only ("written on Sarah's rewatch of S01E02").
- Rewatch position is **monotonic** — DB trigger `progress_no_rewatch_rollback` (`20260417_rewatch_state.sql:33-58`) blocks backward moves while `is_rewatching=true`.
- **Auto-exit:** when `updateProgressFor` (`App.tsx:407-459`) detects the user moving strictly past `highestS/E`, it flips `is_rewatching=false`, nulls the rewatch fields, and bumps `highestS/E` to the new position. The trigger allows nulling because it only enforces while `is_rewatching=true`.

## 5. Zero-Progress Friend Room Feature

State `(season=0, episode=0)` represents "haven't started the show yet" — used to let users join a friend room or open a journal *before* watching anything.

- **Data:** No schema change; `progress.season/episode` are unconstrained ints. Trigger `progress_no_rollback_to_zero` (`20260417_zero_progress.sql:22-41`) blocks any update that returns to `(0,0)` once you've moved off it. Hard line.
- **UI gating:** The `allowZero` prop on `OneSelectProgress` shows the "haven't started" option, and there's defense-in-depth at `OneSelectProgress.tsx:71` — the option only renders if the *current* value is already zero. Once you move off zero, the option vanishes for good even if the caller still passes `allowZero={true}`.
- **Entry points:** SearchShows first-time picker (`allowZero` on the "first time" path, `SearchShows.tsx:514`), InviteAcceptPage (`InviteAcceptPage.tsx:243`), ShowSection's new-room creator (`ShowSection.tsx:1829`), and friend-room compose path (`ShowSection.tsx:1539`, `:1640`).
- **Filter behavior:** `canView` returns false at zero-progress (no posts visible — `0 < 0` and `0 === 0 && episode <= 0` both fail for any episode≥1). At zero, the room shows a "haven't started" empty state (`ShowSection.tsx:2242`) instead of the post stream.
- **Sidebar Protocol** seeding (`phase7-sidebar-protocol.sql:277`) provisions every new user with a TSP room and inserts `progress (s=1, e=0)` so the show appears in their list while they're still "haven't started episode 1".

## 6. Known Issues & Architectural Debt

1. **Snake/camel mapping is manual.** Every column in db.ts is hand-mapped. Renaming any DB column silently breaks reads (field becomes `undefined`).
2. **`schema.sql` is stale.** It still defines `is_private` and lacks every phase 1–7 column. Phase migrations are the source of truth; new env spin-up needs `phase1` → `phase4*` → `phase5` → `phase6` → `phase7` → all `20260413/14/17_*` migrations applied in order.
3. **Compose auto-onboard is non-atomic.** Submitting a post for a show with no journal tab calls `createShow` then `updateProgressFor` then `insertThread` sequentially without transactional safety.
4. **Guest → login progress doesn't merge.** Guest's `progress` state is overwritten by DB `fetchProgress` on login; sessionStorage browse progress has separate per-show keys (`ns_browse_prog_<id>`) and is consulted only by the next browse intent.
5. **Citation inserts are best-effort** (`db.ts:944`). FK failure logs a warning but the reply still saves — can produce orphan quote references.
6. **Like counts aren't real-time.** Loaded once per login; no subscription. Multi-tab/multi-user lag is possible. (Counts also aren't shown in the UI by design — `LikeBadge.tsx`.)
7. **Thread previews are baked at write time** (`body.slice(0, 240)+…`). Edits regenerate; historical previews don't auto-refresh on logic changes.
8. **Friend-room → anywhere clone path is dormant.** `markThreadMovedFromGroup` and the friend-room → public clone flow have no UI callers. Either remove or document the intent if reviving.
9. **`fetchPublicThreadsForShow` filters seed-author client-side** by author field — flagged in the doc comment as wanting an `author_is_seed` column.
10. **Public-reply visibility on profiles** in `fetchPublicRepliesForUser` requires `t.isPublic` (`db.ts:880`). Intentional — private posts can't be replied to by others, so this filter is correct as-is.
11. **Profile-load race after signup** (deferred — V-5 from 2026-04-19 audit). After `signUp`, `loadProfile` runs (`auth.tsx:23-30`) — race possibility between auth.signUp completing and the profile-row trigger. Supabase `.single()` doesn't throw (returns `{data: null, error}`), so worst case is `setProfile(null)` and components see `user !== null && profile === null` briefly. Most components guard with `profile?.username` so they degrade gracefully. Worth verifying in practice on next signup that no UI flashes empty username; not blocking.
12. **Soft-deleted thread editing not blocked** (deferred — V-7 from 2026-04-19 audit). A soft-deleted thread (kept as a stub because it has replies) can still be reached by URL, and the edit UI in `InlineThreadView.tsx:209-244` doesn't check `thread.isDeleted` before allowing edits. Author can edit the stub's title/body via RLS. Probably harmless and possibly intentional (author can fix stub copy). Product call before fixing.
13. **`fetchUserShowActivity` reimplements `effectiveProgress` + `canView` inline** (`db.ts:400-424`). Rebuilds the rewatcher rule (`is_rewatching ? highest : current`) and the visibility comparison (`s < eff.s || (s === eff.s && e <= eff.e)`) locally instead of importing `effectiveProgress`/`canView` from `utils.ts`. Currently correct, but drift risk: if the rewatcher rule in `utils.ts` ever changes (e.g. new clause for "rewatcher past highest"), this site won't pick it up silently. Route through the shared helpers when next touched.
14. **Anon-feedback rate limit is client-side only** (`d680725`). On the anon path `insertFeedback` skips the auth-keyed `check_rate_limit` RPC because there's no `user_id` to key on; only the localStorage 8s cooldown in `FeedbackWidget` gates submissions. A caller who clears localStorage (or uses the Supabase client directly) can spam the `feedback` table with `user_id=null` rows. Accepted for beta traffic volumes — the RLS policy still scopes inserts to `user_id IS NULL`, so it can't impersonate real users. If abuse becomes an issue, add an IP-keyed rate limit via edge function or upstream (Supabase rate limit policy / CDN).
15. **Profile-load failure / dangling-token state** (`b0fe122`, mitigated by `e8bc94c` + `2d9575d`). The `/` → `/profile` redirect is gated on `user && profile && !isAdmin`. If the profile row never loads (network error, RLS failure, trigger race, or a beta-prep SQL reset that deleted the user's `auth.users` + `profiles` rows while the JWT persists in localStorage — i.e. "dangling token" state), the redirect never fires and the user stays on `/` viewing the anonymous homepage. Not an infinite loop and not a blank page — just a degraded state. Two layered mitigations now guarantee an escape hatch: (1) the Sign-out button on both auth clusters renders on `user` alone (previously `user && username`), so a dangling-token user sees it; (2) `signOut()` in `auth.tsx:87` tries global scope first then falls back to `{ scope: "local" }`, because the global logout calls `/auth/v1/logout` which 401s when the JWT references a deleted auth.users row and supabase-js would leave local state intact — the local-scope fallback clears localStorage regardless and fires `onAuthStateChange` with a null session. Before `2d9575d` the Sign-out button was visible but unresponsive for dangling tokens. These two together make the sign-out path bulletproof: the user can always leave a broken session, from any failure mode.
16. **Mobile lockout is viewport-based and has a small admin flash** (`bcf4589`). `isMobileLocked` tracks `window.innerWidth < 768`; the gate short-circuits rendering when `isMobileLocked && !isAdmin`. Admins signing in on mobile see ~200ms of the lockout screen before `profile` loads and `is_admin` resolves true. Phone-in-landscape slips through by design. Viewport threshold intentionally separate from the existing `isMobile` (≤600px, layout density only).
17. **ProfilePage tab cache is not invalidated on thread delete** (`baa3c9f`). `ProfilePage.tabDataCache` ([ProfilePage.tsx:99-122](src/components/ProfilePage.tsx:99)) caches per-tab data and only re-fetches on remount or when `activeTab` is missing from the cache. If the user deletes a thread in show-view and then switches back to the journal tab without a full page reload, the cached snapshot may still include the just-deleted thread. Applies to any deletion (has-replies soft-delete too), not just the new no-reply soft-delete path from `baa3c9f`. Pre-existing behavior — not a regression. Fix would be an explicit cache invalidation hook when a thread is deleted, wired through App state or a lightweight event bus. Not blocking for beta.
18. **DB accumulates soft-deleted thread tombstones** (`baa3c9f`). `deleteThread` now only soft-deletes, so no-reply deletions leave `is_deleted=true` rows (plus their `group_threads` / `response_citations` refs) in the DB forever. Read paths filter correctly so no UX bleed. Long-term, an admin sweep could hard-delete soft-deleted-no-reply rows older than N days; not needed for beta traffic volumes.

## 7. Recent work

### 2026-04-19 audit arc

A four-phase regression-prevention audit was run across the codebase this day. Triggered by a user-reported broken radio button (the "First time / Rewatching" toggle in the SearchShows onboarding modal silently swallowed clicks). Each audit found additional bugs of the same or adjacent classes.

**Audits performed:**

1. **Interactive components** — every form, radio, dropdown, button on the site checked for whether its handler actually wires up to the state it should mutate. Root cause of the radio bug found here: `.topHeaderWrap` has `pointer-events: none` with a narrow allowlist (`button` / `a` / `input` / `select` / `textarea` / `.brand` / `.splashSearchWrap` / `.profileChip`), and `pointer-events` inherits through the DOM past `position: fixed`. Modals nested in the header subtree silently swallowed clicks on any custom `<div>` click target (radios, click-to-close backdrops). Native form elements survived because they're allowlisted.

2. **Console errors** — pattern-based sweep for unhandled rejections, React dev warnings, undefined property accesses on data that may not be populated yet, useEffect cleanup issues, and `console.error` calls that fire under normal recoverable conditions.

3. **Critical user flows** — logic-trace audit of six flows: signup + onboarding (incl. TSP demo seeding), creating a friend room + inviting a friend, progress updating across all four sub-cases (first-time advance, rewatcher within highest, rewatcher transition out, zero → 1), posting in three destinations (private journal / friend room / public), accepting an invite (with/without prior progress for the show), and editing a post (re-tag interaction with spoiler filtering).

4. **Rewatcher principle sweep** — codebase-wide check that anything tagging, comparing, or filtering on the writer's spoiler-relevant position goes through `effectiveProgress` (returns `highestS/E` for rewatchers), not raw `.s/.e` (the rewatch position). Compose paths were correct; six edit/visibility-check sites were not.

**Commits (chronological):**

| Commit | Scope |
|---|---|
| `623f693` | Fix SearchShows modal: `createPortal` to escape `.topHeaderWrap`; add dev-time pointer-events audit (`src/lib/devHeaderAudit.ts`); remove dead `SINGLE_PAGE` constant + `App.before-narrative.tsx.bak` |
| `1a0953c` | Cancelled-flag pattern + `console.warn` cleanups: ProfilePage activity + per-tab fetch, SearchShows TVMaze debounce, `upsertBrowseProgress` |
| `9df4a0a` | `key={expandedShowId}` on `<ShowSection>` to force remount on show change — fixes stale-closure cross-show state leaks |
| `9f39153` | First HANDOFF.md refresh of this arc (at the time HANDOFF.md and PROJECT_NOTES.md were kept in sync; PROJECT_NOTES.md removed 2026-04-20 — HANDOFF.md is now the sole doc) |
| `c55ace5` | Rewatcher principle: 6 edit-tag and visibility-check sites in `InlineThreadView`, `RepliesList`, `ShowSection` routed through `effectiveProgress` |
| `0cab458` | TSP initial progress `(s=1, e=0) → (s=1, e=1)` so demo room lands populated; new migration `20260419_tsp_initial_progress.sql` includes function replacement + narrowly-filtered backfill |
| `ac43648` | Invite auto-accept race fix (key-based gate on `progressCheckedFor`); `addThreadToGroup` silent-failure now logs `console.warn` with context |
| `5955ce9` | Self-invite block (server-side in edge function + client-side pre-check); duplicate-invite copy updated; V-5/V-7 deferral notes added to §6 |

**Deferred items (still open):**

- **V-5** — profile-load race after signup. Low-confidence; worth eyeballing on next signup whether any UI flashes empty username. Documented in §6 item 11.
- **V-7** — soft-deleted thread editing not blocked. Product call — should authors be able to edit a stub? Documented in §6 item 12.
- **Prompt suggestion uses rewatch position** for matching ([ShowSection.tsx:1109, :1119](src/components/ShowSection.tsx:1109)). Explicitly kept as-is per product call: prompts match the user's current engagement context, not their spoiler ceiling.
- **Dead `viewerSeason/Episode` fallback in ResponseComposer** ([InlineThreadView.tsx:546-547](src/components/InlineThreadView.tsx:546)). `postTagSeason/Episode` props are always provided so this fallback never fires. Worth a small cleanup later but not a bug.

**Two-step deploys this arc required:**

- `0cab458` (TSP migration): SQL migration must be run manually in Supabase SQL editor — Netlify auto-deploy doesn't apply DB migrations. Verified `0` rows remaining at sentinel after run.
- `5955ce9` (self-invite): server-side block lives in the `send-invite` edge function and requires `supabase functions deploy send-invite` (or upload via the Supabase dashboard). Client-side pre-check ships immediately via Netlify push.

**Conventions established or reinforced this arc** are documented under "Component conventions" below: portal modals out of `.topHeaderWrap`, the `cancelled` flag pattern for async useEffects, `effectiveProgress` for rewatcher spoiler-context comparisons, `key={expandedShowId}` for per-show state isolation, the dev-time pointer-events audit.

### 2026-04-20 product-polish arc

A stretch of product-polish + routing-hardening commits landed the day after the audit arc. No single organizing theme — mix of UI copy/layout tweaks, new top-level gates (auth redirects + mobile lockout), a new auxiliary signal for show-tab ordering, and anonymous feedback support.

**Commits (chronological, doc-worthy only):**

| Commit | Scope |
|---|---|
| `248db55` | Docs: completed the 2026-04-19 audit arc recap (HANDOFF.md + PROJECT_NOTES.md — still two files at that point) |
| `546ec97` | Show-search modal now **session-pre-pops** first/rewatch + progress from `sessionStorage` when the modal is re-opened for a show the user previously exited via "See public conversations". New `sessionStorage` key family. Cancel paths still leave nothing stored. (Rest of the commit — welcome-copy, header-logo nav, tooltips, composer CTA, "Convert to →" rename — is cosmetic; not documented.) |
| `abaad8d` | **Show-tab ordering now includes visibility-gated friend activity.** `fetchUserShowActivity` ([db.ts:400-480](src/lib/db.ts:400)) folds in two new signals: (3) replies on user's own threads by others, (4) threads in user's friend rooms by others. Both filtered per-show through the user's effective progress (`is_rewatching ? highest : current`, with `canView`-equivalent visibility check). Extension queries wrapped in try/catch so any failure falls back to prior behavior. Plus new `markTabCreated`/`readTabCreated` localStorage helpers ([db.ts:534-552](src/lib/db.ts:534)) writing `ns_tab_created_<userId>_<showId>` on journal/friend-room creation + invite accept — `ProfilePage`'s `showTabOrder` uses this as the fallback when a show has no activity yet, so new tabs land at the front. Pre-existing tabs without a mark still fall back to 0 (unchanged behavior). See §6 item 13 for the drift-risk note (rewatcher logic reimplemented inline instead of imported from `utils.ts`). |
| `b0fe122` | **Auth-gated routing.** New `useEffect` in `App.tsx` ([App.tsx:576-596](src/App.tsx:576)): signed-out users on `/profile` → `/` (covers OS-signs-me-out / session expiry); signed-in non-admins on `/` → `/profile` (admins exempt so they can reach `/?admin`). `/invite/:token` exempt from the signed-out redirect so invite recipients can sign in to accept. Signed-in redirect gated on profile-row having loaded to avoid bouncing admins through `/profile` while `is_admin` resolves. See §6 item 15 for the failure-mode caveat (if profile never loads, user stays on `/` — not a loop, but degraded). Also: removed the one-time threads-explainer modal + its localStorage gate; removed "No responses yet." empty state inside open threads (kept in profile sections). |
| `d680725` | **Anonymous feedback.** `FeedbackWidget` no longer early-returns when `!user`; anon submitters send `user_id=null`, `username="anon"`. `insertFeedback` ([db.ts](src/lib/db.ts)) accepts `userId: string \| null` and **skips the auth-keyed `check_rate_limit` RPC on the anon path** (localStorage 8s cooldown in the widget still applies on both paths — see §6 item 14 for the bypassability caveat, accepted for beta). New migration `supabase/migrations/20260420_anon_feedback.sql` adds RLS policy allowing `role anon` to insert `feedback` rows where `user_id IS NULL`. SQL already run in Supabase dashboard per commit message. Also: admin-only BookOpen "journal" button added to the homepage fixed auth cluster (so admins can hop to `/profile` without typing the URL). Panel items prop type relaxed `string → React.ReactNode`. |
| `bcf4589` | **Mobile lockout.** Viewport `< 768px` shows a full-screen "not ready for your phone" screen (`src/components/MobileLockout.tsx`, canon-green fill + SidebarLogo + tagline) for non-admins. Admins (via `profile.is_admin`) bypass. New `isMobileLocked` state tracks the threshold; gate at the top of App's return short-circuits all other rendering when `isMobileLocked && !isAdmin`. **Introduces a second viewport breakpoint** (`768px`) distinct from the existing `isMobile` (≤600px, layout density only). Detection uses `window.innerWidth`, not user-agent — a desktop with a narrow window also sees the lockout (accepted edge case). Phone-in-landscape slips through by design. ~200ms lockout flash possible for admins while profile loads (§6 item 16). See §8 below for the top-level rendering-gate order. |

**Intentionally skipped (not doc-worthy):**

- `3e77025` — homepage narrative/panel copy rewrite + beta-letter widening + removal of dead signed-in-shortcut block on `/`. Pure copy/layout. Dead-block removal is consistent with `b0fe122`'s redirect rule (no signed-in non-admin should land on `/` anymore).
- `a5a5b9e` — one-line CSS tweak (`text-wrap: balance` on homepage panel text). Pure polish.
- Portions of `546ec97` (welcome-copy, header-logo click-to-profile, composer CTA, tooltip tightening, "Convert to →" rename, backward-progress confirm red) — copy/style only. Only the modal session pre-pop is documented.

**Deferred items added this arc (still open):**

- Drift risk in `fetchUserShowActivity` (rewatcher logic reimplemented inline — §6 item 13).
- Anon-feedback rate-limit bypassability (§6 item 14).
- Profile-load-failure → stuck on `/` (§6 item 15).
- Mobile-lockout admin-flash (§6 item 16).

**Two-step deploys this arc required:**

- `d680725` (anon feedback): RLS migration `20260420_anon_feedback.sql` must be run in Supabase SQL editor. Already applied per commit message.

**Conventions established or reinforced this arc:**

- **Top-level rendering gates** in `App.tsx` now run in a fixed order: (1) mobile lockout short-circuits everything when `isMobileLocked && !isAdmin`; (2) auth-routing effects redirect off `/profile` or `/` based on `user`/`profile`/`isAdmin`/`pathname`; (3) normal route rendering. Any new top-level gate should be added with awareness of this order — see §8.
- **Show-tab ordering signal model:** 4 DB-sourced signals (own threads, own replies, visible replies-to-user-by-others, visible group-threads-by-others) + 1 client-local signal (`markTabCreated` localStorage timestamp on creation). New creation paths should call `markTabCreated(userId, showId)` so the tab lands at the front before any real activity exists.
- **Feedback is now dual-path.** Auth path uses `check_rate_limit` RPC; anon path uses localStorage cooldown only. `insertFeedback`'s `userId` parameter is `string | null` — callers must pass `null` (not omit) on the anon path.

### 2026-04-20 evening arc — invite-flow polish + dangling-token trap + edge-function recovery

Triggered by a chain of failures that emerged while testing the end-to-end invite flow on production.

**Why this arc happened:** the `send-invite` edge function had been sitting undeployed since `5955ce9` (per the then-outstanding action item). When the user tried to send an invite, they got `"Edge Function returned a non-2xx status code"` — a generic wrapper message. Root cause turned out to be Supabase's ES256 JWT gateway rejecting every invocation before the function ran. Along the way: the client was throwing away the real error body; the invite-accept UX had three small polish gaps; a beta-prep SQL reset exposed a "dangling token" trap in both Sign-out UI gating and Sign-out logic; and the invite-accept → new-signup flow had a progress state-sync race that left the user on a blank screen.

**Commits (chronological):**

| Commit | Scope |
|---|---|
| `1c291d2` | `sendInvite` in `db.ts:1658` now parses the body out of `FunctionsHttpError.context` so the real edge-function error code + message reach the UI. Previously a non-2xx response surfaced as the generic wrapper message "Edge Function returned a non-2xx status code"; the function's actual `{ok: false, error, message}` JSON was being discarded. |
| `cf50e45` | Sync out-of-band CORS allowlist fix in `send-invite/index.ts` into git HEAD. Fix itself was already deployed; git was drifted. Hard-coded `https://beta.sidebar.com` (typo) replaced with small allowlist that echoes back matching Origin — covers prod + localhost. |
| `864ebc1` | Redeploy `send-invite` with **`--no-verify-jwt`** (Supabase CLI flag, version 10 on project). Supabase project is on asymmetric ES256 JWT signing keys; the Edge Functions gateway runtime only accepts HS256, and was 401'ing every invocation with `UNSUPPORTED_TOKEN_ALGORITHM`. Gateway JWT check is redundant — function already does `admin.auth.getUser(jwt)` internally. **Future redeploys must include `--no-verify-jwt`** or the function will 401 again. Docs updated in same commit. |
| `ce4fe78` | Invite-accept screen polish: (1) new `showChevron` prop on `OneSelectProgress` — strips native `<select>` arrow and overlays Lucide `ChevronDown` so affordance is consistent across browsers; (2) Join button restyled white-fill / canon-green-text (was canon-green on canon-green page, reading as plain text); (3) post-accept redirect changed from `/show/:id` (often an empty show page) to `/profile` with `state.activeTab = showId`. Only the Join button was restyled; Sign-in button deliberately left alone. |
| `e8bc94c` | Sign-out button on both auth clusters (homepage + non-homepage header) now renders on `user` alone, not `user && username`. Before: a dangling-token user with `user` truthy but `profile` null saw no auth controls at all — Sign-in needs `!user`, Sign-out needed `username`, Admin buttons need `isAdmin` derived from profile. After: Sign-out always renders when there's any session. |
| `c535cd3` | Docs-only: note the `e8bc94c` mitigation under §6 item 15 and expand the failure-mode list to include dangling-token (beta-prep SQL reset). |
| `2d9575d` | `signOut()` in `auth.tsx:87` refactor. Default `supabase.auth.signOut()` uses global scope → calls `/auth/v1/logout` → server 401s when JWT references deleted auth.users row → supabase-js doesn't clear local state → UI unresponsive. New implementation tries global first (for server-side refresh-token invalidation in the happy path), swallows any error, then unconditionally calls `{ scope: "local" }` which never touches the network and always clears localStorage. `onAuthStateChange` then fires with null session and the UI updates. Two try/catch blocks is slightly belt-and-suspenders but correct. |
| `a9bbc81` | `InviteAcceptPage.handleAccept` now uses `window.location.assign("/profile")` instead of SPA `navigate("/profile", { state: { activeTab: showId } })`. Fresh-signup race: `App.fetchProgress` runs once on `user?.id` change and returns empty for a brand-new user. `handleAccept` then writes a progress row via raw `upsertProgress` (DB-only, bypasses App's React state). On SPA-nav to `/profile`, ProfilePage reads stale `progress={}` → `showTabOrder=[]` → effect early-returns without setting active tab → blank green screen. Hard reload forces App to remount and re-run `fetchProgress`, picking up the new row. `markTabCreated` above already floats the show to position 0 in `showTabOrder` so default-pick selects it (no `state.activeTab` directive needed). Accepted the UX loss of a brief page reload — flow happens once per accepted invite, and the user just completed auth + onboarding + join, so the reload is imperceptible in context. |
| `e2a4177` | Invite-flow welcome copy + TSP fix + InviteAcceptPage polish. (1) TSP welcome always shows on empty TSP tab — drops the `visibleTabOrder.length === 1` guard at [ProfilePage.tsx:939](src/components/ProfilePage.tsx:939), so the canonical "Welcome to Sidebar." copy appears regardless of entry point or other tabs. Naturally disappears once the user writes their first post. (2) New `invitedMode` variant on `EmptyProfileWelcome` — rendered on the invited show's tab after an invite accept, with copy pointing the user at the friend-room button and nudging brand-new users toward the TSP tab first. (3) Detection via session-scoped flag: `InviteAcceptPage.handleAccept` writes `sessionStorage.ns_invite_welcome_<showId> = "1"`; ProfilePage reads it into `invitedMode`. Clears on browser close or first post (empty state stops rendering). (4) InviteAcceptPage icon `Clapperboard` → `MonitorPlay`. (5) Sign-in-to-accept button restyled to match Join (white fill, canon-green bold) — was canon-green-on-canon-green reading as plain text, matching the Join fix from `ce4fe78`. |
| `6061651` | Invite email full redesign (edge function template). Sender display `No Spoilers` → `Sidebar` (address `invites@sidebar.watch` unchanged); subject `[inviter] invited you to watch [show] together on Sidebar`; body is a canon-light-blue card (`#adc8d7`) on the existing dark outer bg, with 📺 emoji + bold heading referencing inviter + show, explainer paragraph, italic `talk. together. whenever.` tagline, canon-yellow (`#dea838`) pill CTA, and a three-line footer including the new "New to Sidebar? You'll be able to create an account when you accept." line. Room name dropped from email per spec. All styling inline for cross-client compatibility; emoji avoids the SVG-in-email problem. Base URL fallback `nospoilers.app` → `beta.sidebar.watch`. Initially plumbed `showName` client-side from `ShowSection` → `sendInvite` → function body; this was reverted by `de0b5b7` in favor of a server-side lookup. **Note for testers:** Gmail contact caching will keep displaying the previous "No Spoilers" sender name for recipients who'd received earlier emails from this address — it's a contact-record cache, not a code issue. Fix is to delete the contact at contacts.google.com or test with a fresh recipient. |
| `de0b5b7` | `send-invite` now looks up `showName` server-side from the `shows` table using `grp.show_id` (the function already fetches `friend_groups`, one more indexed SELECT is authoritative). Reverts the `showName` prop threading added in `6061651` — client state (`showsProp` on ShowSection) wasn't reliably populated at invite time (particularly for TVMaze-synced shows not in the seed fallback), causing the email to fall back to the generic "a show" phrasing. Server lookup is best-effort: if the show row is missing, template still renders with the fallback rather than blocking the invite. |
| `80299d9` | Onboarding default progress `(1,1)` → `(0,0)` so new users can start a journal / join a friend room before watching anything. (1) `firstTimeSel` and `rewatchSel` initial + reset + fresh-open defaults flipped to `{s:0, e:0}`. (2) `allowZero` prop added to the "How far are you on your rewatch?" select in [SearchShows.tsx:545](src/components/SearchShows.tsx:545) so the "Haven't started" option is visible and re-selectable on the rewatch path. `highestSel` (what's the furthest you watched last time?) stays at `{s:1, e:1}` — rewatch-validity requires highest > rewatch and (1,1) is the minimum allowable highest when rewatch is (0,0). Prior-session pre-pop paths unchanged. Opens up an "excited before watching" / "catch up with friends ahead of time" engagement mode. |
| `733e9d1` | Three polish changes. (1) `OneSelectProgress` chevron is now always rendered on the default (non-plain, non-compactLabel) pill path — `showChevron` prop removed from the API. Previously opt-in (only InviteAcceptPage passed it), so the same select rendered elsewhere (show-tab header, group-create modal, guest splash, TSP preview, rewatch controls) had no visible affordance on browsers that hide the native select arrow at the current font-size + padding (Safari in particular). The `plain` variant (in-modal) still uses its native arrow — different visual language. (2) Show-tab active-indicator icon `CircleDot` → `CircleChevronDown` in [ProfilePage.tsx:710](src/components/ProfilePage.tsx:710) — signals dropdown affordance. (3) Public-forum empty-state copy in [ShowSection.tsx:2271](src/components/ShowSection.tsx:2271) expanded: ellipsis added to the "only a matter of time" line, pioneer line now explains the mechanism — "When you post publicly on your profile, your writing shows up here." |
| `4362604` | Tooltip + sizing polish. (1) Journal friend-room button tooltip `(go to friend room)` → `Go to friend room.` (drop parens, capital G, period). (2) Create-another-friend-room tooltip split into two lines via `<br/>` in JSX `text` prop with `tooltipStyle={{ width: "auto", whiteSpace: "nowrap", padding: "6px 10px" }}` so the bubble hugs the text instead of using the default 230px fixed width. Single-room variant still renders on one line. (3) Homepage scroll-down arrow `<ArrowDown size={28}>` → `size={49}` (+75%). (4) Group-settings modal: both Send invite and Leave room buttons get `minWidth: 120` so they render identical width. Chose a shared floor rather than syncing one to the other so copy changes on either side don't desync the pair. |
| `6a873b9` | Profile pill extracted from the `.topHeaderRight` flex row into its own `position:fixed` element (`.topHeaderPillFixed`) so its right edge aligns with the journal's right edge on wide viewports instead of the viewport's right edge. Math: `.container` = `min(672px, 92vw)` centered + `.diaryOuter` with `.journalShift` extends 116px past container (width: `calc(100% + 116px)`, margin-left: 0), so diary right = `viewport/2 + 452`. Pill `right: max(14px, calc(50vw - 452px))`. Clamp to 14px fires below ~932px viewport (matches old behavior on narrow screens). Sign-out and admin gear stay anchored to the viewport's right edge (Option A per user spec — visually separates the pill as "part of the center content" and leaves the utility buttons at the viewport corner). Pill stays at `top: 14px` unchanged. Homepage `fixedAuthWrap` pill (signed-in admin on `/`) unchanged. Pill kept inside `.topHeaderWrap` so the existing `.profileChip` pointer-events allowlist rule still applies; z-index 1001 > wrap's 1000 so the fixed positioning layers correctly. Verified in preview at 1440 / 1000 / 932 / 800 — matched the math exactly on wide, clamped cleanly on narrow. |
| `88004ef` | Right cluster drops at narrow viewports so sign-out + admin don't overlap the pill. `@media(max-width:1133px){ .topHeaderRight{ margin-top:42px; } }`. 42 = pill height 34 + 8 gap. Initially picked 1133 to match the existing `--site-header-h` 56→96 breakpoint; `ef06114` tightened this per user feedback. |
| `ef06114` | Right-cluster drop breakpoint tightened `1133px` → `1077px` so the inline layout holds 56px longer as the window narrows before the cluster drops. Pure CSS single-number shift. |

**Deferred items added this arc (still open):** none.

**Two-step deploys this arc required:**

- `864ebc1` (send-invite): `supabase functions deploy send-invite --no-verify-jwt` — applied from CLI in session. Version 10 on project.
- `6061651` (send-invite): email template rewrite. `--no-verify-jwt`. Version 11.
- `de0b5b7` (send-invite): server-side `showName` lookup. `--no-verify-jwt`. Version 12.

**Conventions established or reinforced this arc:**

- **`supabase.functions.invoke` error handling.** Non-2xx responses surface as `FunctionsHttpError` with a generic wrapper message; the real body is on `error.context` (the raw `Response`). Any code calling `functions.invoke` and wanting to surface the server's error shape to the UI must parse `ctx.json()` — see `sendInvite` ([db.ts:1658](src/lib/db.ts:1658)) for the pattern.
- **`--no-verify-jwt` is required** for every edge function deploy while the project is on ES256 JWT keys and the runtime only supports HS256. Edge functions that need caller-auth must do their own JWT verification inside the function via `admin.auth.getUser(jwt)` (which `send-invite` already does). If a `supabase/config.toml` is added later, set `verify_jwt = false` per-function there.
- **`signOut()` must always clear local state.** Raw `supabase.auth.signOut()` is unsafe in any codebase with dangling-token exposure (deleted users, expired refresh tokens, offline clients). The pattern is: try global signOut for server-side invalidation, swallow errors, then always follow with `{ scope: "local" }` to guarantee client-side cleanup. See `auth.tsx:87`.
- **Hard reload after state-changing flows that bypass App state.** When a flow writes to the DB outside App's React state setters (e.g. `InviteAcceptPage` calling raw `upsertProgress`) and then navigates to a view that reads that state, prefer `window.location.assign(path)` over SPA `navigate(path)`. The alternative — threading a setter callback through multiple layers — is over-engineering for flows that run once per user. The reload is imperceptible in a context where the user is already transitioning between major phases (post-onboarding, post-accept, etc.).
- **`EmptyProfileWelcome` variant precedence** ([EmptyProfileWelcome.tsx](src/components/EmptyProfileWelcome.tsx)). Order: `isTsp` → `invitedMode && showName` → `showName` → generic. The TSP variant is the canonical first-run copy for the demo show — always renders on the empty TSP tab regardless of entry path. The invited variant is session-scoped via `sessionStorage.ns_invite_welcome_<showId>` set in `InviteAcceptPage.handleAccept`. New empty-state variants should slot into this precedence chain, not parallel to it.
- **Prefer server-side authoritative lookups for email / edge-function copy** over client-passed strings. When the function already has a foreign key (e.g. `grp.show_id`), one extra indexed SELECT is cheaper than the risk of the client's React state being stale or empty at invoke time. Reference: `send-invite` server-side `showName` lookup added in `de0b5b7` after `6061651`'s client-passed version failed silently for TVMaze-synced shows not in the client's active shows array. Fall back gracefully if the lookup misses — don't block the user action.
- **Onboarding defaults lean toward "zero friction"** — first-time and rewatch progress both default to `{s:0, e:0}` ("haven't started"), so a user can start a journal, create a friend room, or accept an invite before watching anything. This is intentional: Sidebar is pitched as a place friends can get excited together ahead of watching, not just after catching up. The `allowZero` prop on progress selects controls visibility of the option; `canView` already returns false at zero-progress so there's no spoiler risk.

### 2026-04-21 polish arc — rewatcher copy parity, email refinements, invite-modal UX

Small-scale refinements building on the invite/onboarding work from the evening arc.

**Commits (chronological):**

| Commit | Scope |
|---|---|
| `7894cea` | (1) Rewatcher tag-warning copy on the compose modal restructured in `ShowSection.tsx`: the parenthetical "(tagged at your highest prior progress as a re-watcher)" trailer replaced with a full sentence rewrite — "Your post is automatically marked to S/E — your highest prior progress as a re-watcher. It will only show to people who've watched at least that far." Conditional on `postProgress.isRewatching`; non-rewatch copy untouched. (2) Invite email outer body bg flipped `#0e0e10` → `#adc8d7` + dropped inner card border-radius/bg so the entire email space is canon-light-blue (Gmail was rendering the dark surround as black around the framed card). Added `Your friend room is called "${groupName}."` to the explainer paragraph. (3) HowItWorksV2 panel left-caption padding `"24px 24px 24px 4px"` → `"24px 32px"` (horizontal breathing room on both sides of the text block). |
| `2672028` | Three follow-ups to `7894cea` after user testing. (1) The rewatcher copy fix was missing in `ProfilePage.tsx`'s separate journal-compose modal — rewatchers writing in their private journal saw the non-rewatch copy. Mirror the same `isRewatching` ternary there. (2) Invite email body bg `#adc8d7` → `#ffffff` (Gmail was stripping the light-blue on `<body>`, rendering white in practice; make code match prod). Heading "to watch and discuss" → "to discuss" (shortened). (3) Group-settings invite modal polish: success text `var(--green)` → `#fff`; footer row changed from right-aligned Leave to space-between (Leave left, OK right — OK only after `inviteSuccess`, transparent bg + 2px white outline + white text + matches Leave's minWidth:120, closes modal); animated ellipsis during `inviteSubmitting` — three `<span class="invite-dot">` with staggered opacity keyframes (0s / 0.2s / 0.4s delays) in the spot the success message eventually replaces. Keyframe CSS added to `theme.ts` alongside the existing `flash-blink` block. |
| `2bfdd05` | Invite email: show name `<strong>` → `<strong><em>` (bold + italic). Subject unchanged — mail clients don't render HTML in subjects. Plain-text fallback unchanged (no italic in plain text). |

**Deferred items added this arc (still open):** none.

**Two-step deploys this arc required:**

- `7894cea` (send-invite): `--no-verify-jwt`. Version 13.
- `2672028` (send-invite): `--no-verify-jwt`. Version 14.
- `2bfdd05` (send-invite): `--no-verify-jwt`. Version 15.

**Conventions established or reinforced this arc:**

- **Rewatcher copy lives in two separate compose modals.** `ShowSection.tsx` (show-view / friend-room / public compose) and `ProfilePage.tsx` (journal-view private-entry compose) each have their own post-tag warning. Any change to one should cross-check the other. The pattern to match: a `postProgress.isRewatching` ternary, not a trailing conditional parenthetical, so the full sentence reads cleanly in both branches.
- **Email subjects are plain text** — no HTML, no CSS, no bold/italic. Any visual emphasis goes in the body only. Unicode italic characters are a technically-possible hack but cost screen-reader accessibility + search-match reliability; avoid.
- **Animated ellipsis pattern** — `.invite-dot` class with staggered `animation-delay` via `:nth-child(2)` / `:nth-child(3)` selectors, `invite-dot-fade` keyframes in `theme.ts`. Assumes three siblings under a common parent. Reusable for any "work in progress, success eventually" indicator — white, 12px, slot in where the terminal message will appear.

### 2026-04-21 — send-invite deploy hardening + DMARC cleanup

Small infra pass after the polish arc. Two pieces: a DMARC DNS cleanup (no code change) and a Supabase CLI config pin that removes the `--no-verify-jwt` footgun on `send-invite` deploys.

**Commits:**

| Commit | Scope |
|---|---|
| `029c4d2` | Add `supabase/config.toml` with `[functions.send-invite] verify_jwt = false`. Pins the setting the CLI previously required via the `--no-verify-jwt` flag on every deploy. Future `supabase functions deploy send-invite` reads the config and applies `verify_jwt = false` automatically, eliminating the "forgot the flag → invites silently 401 in prod" failure mode that had bitten redeploys repeatedly (see 2026-04-20 evening arc). §"Edge function deploy notes" updated to reflect the new deploy command. |

**DMARC DNS (not a commit — external DNS change):** `_dmarc.sidebar.watch` had accumulated two redundant/bad TXT records (GoDaddy's `p=quarantine` default pointing at `onsecureserver.net`, plus a placeholder `rua=mailto:dmarc@sidebar.watch` with no real mailbox). Per RFC 7489, more than one `_dmarc` record at a domain is treated as no policy at all — which is exactly what Gmail was reporting as DMARC FAIL. Cleaned up to a single record: `v=DMARC1; p=none; rua=mailto:akamalizad@gmail.com; aspf=r; adkim=r`. `p=none` is deliberate during rollout (reports without punishing edge-case legitimate mail); can escalate to `p=quarantine`/`p=reject` after a few weeks of clean reports. Verified via `dig TXT _dmarc.sidebar.watch +short` returning exactly one line.

**Deferred items added this arc:** none.

**Two-step deploys this arc required:**

- `029c4d2` (send-invite): a no-op "touch deploy" of the function was run in-session to verify `config.toml` is actually read by the CLI. Command: `supabase functions deploy send-invite --project-ref haepqyykmwnyyijkbvci` (no `--no-verify-jwt` flag). Succeeded; function is now version 16. **Verification:** `curl -X POST https://haepqyykmwnyyijkbvci.supabase.co/functions/v1/send-invite -H 'Content-Type: application/json' -d '{}'` returned `{"ok":false,"error":"missing_auth"}` (HTTP 401). That JSON shape is the function's own output from [index.ts:67](supabase/functions/send-invite/index.ts:67) — if the gateway were still verifying JWTs, the request would have been rejected before the function ran and we'd have seen a generic gateway error instead. So `verify_jwt = false` from `config.toml` is confirmed applied. Future deploys can drop the flag.

**Verification status:**

- ✅ `supabase/config.toml` → `verify_jwt = false` applied (confirmed via curl probe above).
- ✅ DMARC DNS cleanup → `dig TXT _dmarc.sidebar.watch +short` returns exactly one clean line.
- ⏳ DMARC: PASS in Gmail → pending a test invite to a fresh Gmail address (one that's never received from `invites@sidebar.watch`). Not yet verified at session close.

**Observations (no action needed):**

- **Gmail "trim quoted text" clipping on repeat test-invites.** After many test invites to the same Gmail inbox during this arc, Gmail started hiding the static bottom half of the email template (`talk. together. whenever.` tagline, CTA button, footer) behind a three-dots expand button. The dynamic top half (inviter name, show name, group name) stays visible. This is Gmail's per-sender-per-recipient cross-message content-dedup heuristic — it kicks in after repeated near-identical emails. Yahoo doesn't do this. **Not expected to affect real first-time recipients**, who have no prior content for Gmail to compare against. If a fresh-recipient test ever shows the clip, the standard fix is to add recipient-unique content near the footer (e.g., the invitee's email) to break the dedup. Parked pending that signal.

**Conventions established or reinforced this arc:**

- **Per-function edge config belongs in `supabase/config.toml`,** not in deploy-time flags. Any future edge function that needs non-default gateway behavior (JWT off, custom import map, timeouts) should be configured there. Flags are fragile because they depend on human memory across deploys; config files are durable because they're checked in.
- **Verify config-file changes by probing the live function after deploy.** After a CLI-config change that alters gateway behavior, a curl against the function endpoint (no auth, expect the function's own error shape, not a generic gateway reject) confirms the config was read. Much faster than sending a real invite through the UI.
- **Single `_dmarc` record only.** If DMARC-related DNS ever needs a change (new reporting address, policy escalation), *edit* the existing record — don't add a second one. Multiple records at `_dmarc.<domain>` are spec-treated as no policy.

### 2026-04-21 late — homepage panel polish + font-stack audit

Small-scale follow-ups after the DMARC/deploy-hardening pass.

**Commits:**

| Commit | Scope |
|---|---|
| `b4b9345` | HowItWorksV2 left-caption right padding 32 → 48px. More breathing room between the caption text's right edge and the white diagram card. Applies to all 5 explanation panels (shared style block at [HowItWorksV2.tsx:421](src/components/HowItWorksV2.tsx:421)). |
| `a53cc71` | Homepage panel 1 title "NO-SPOILER": regular hyphen replaced with non-breaking hyphen (U+2011, `\u2011`) at [HowItWorksV2.tsx:33](src/components/HowItWorksV2.tsx:33) so the token can't wrap mid-word. Now breaks at the preceding space: "HOW DO THE / NO-SPOILER / MECHANICS WORK?" |

**Font-stack audit finding (pre-Option-B):** The site loads **Inter + Nunito** from Google Fonts via a `<link>` in [index.html:11](index.html:11), and the body font stack at [theme.ts:199](src/styles/theme.ts:199) is `"Inter","Nunito",system-ui,-apple-system,...`. Per-element inspection in the running preview (`document.fonts` enumeration + `getComputedStyle` on the weight-900 panel title) confirmed that **Nunito never actually renders anywhere on the site today.** Every Nunito `@font-face` entry is `"status":"unloaded"`; only Inter 400 and Inter 600 have ever been fetched. Reason: CSS font-matching picks **family before weight** — Inter is first in every stack and at least partially loaded, so every element resolves to Inter. When a heavier weight (700-900) is requested for which Inter isn't loaded, the browser renders Inter 600 with *synthetic bold* rather than falling through to Nunito. Nunito would only render if Inter were entirely unavailable.

**Net effect today:** Nunito is dead weight in the CSS — declared, requested from Google Fonts' CSS response, but never produces a rendered pixel. Current bold/heavy display type is actually synthetic-bold Inter 600 (Chrome's faux-bold algorithm).

**Follow-up (coming in the next commit — Option B):** flip specific display-type selectors (panel titles, likely other h1-scale text) to a Nunito-first stack so Nunito actually renders on display elements. Gives the site two real typefaces: Inter for body/UI, Nunito for display. Alborz wants to see how Nunito reads in headings before deciding whether to keep it or instead drop Nunito entirely and add real Inter 700/800/900 weights (Option A).

**Deferred items added this arc:** none.

**Two-step deploys this arc required:** none.

**Conventions established or reinforced this arc:**

- **CSS font-matching = family-wins-over-weight.** When multiple families are in a stack and the first one is loaded for *any* weight, the browser locks to that family even if the *requested* weight isn't available — it synthesizes missing weights rather than falling through to later families. So a fallback font in the stack doesn't work as "use this for different weights"; fallbacks only kick in when the primary family fails entirely. To actually use a second typeface, declare it first in a targeted selector (heading-specific), not as a same-stack fallback.
- **Non-breaking hyphen (U+2011, `\u2011`)** is the minimal-change way to keep a hyphenated token from wrapping mid-word. Displays identically to a regular hyphen. Reach for it over `white-space: nowrap` spans when the hyphen lives inside a larger text block you don't want to restructure.
- **Verify "what's actually rendered" via `document.fonts` enumeration,** not just screenshots. Screenshots can't tell you whether a visibly-bold glyph is a real heavy-weight file or the browser's synthetic faux-bold. `document.fonts.check()` + iterating `document.fonts` for loaded-status is the definitive read. Useful any time you're reasoning about font stacks, fallback behavior, or "why doesn't X render."

### 2026-04-21 late-evening → 2026-04-22 — display-type experiment (Nunito → Lora), scope collapse, Nunito cleanup

Follow-up to the 2026-04-21 late font-stack audit. The audit had flagged Nunito as dead weight and outlined two paths: **Option A** (drop Nunito, add real Inter heavy weights) or **Option B** (flip specific display-type selectors to a Nunito-first stack so Nunito actually renders). This arc ran Option B with **Lora swapped in for Nunito** after one commit, expanded the editorial scope across many surfaces, then **collapsed back to a two-banner footprint** when the broader look didn't land. Nunito was then cleaned out of the codebase entirely (effectively Option A's first half, without the "add real Inter heavy weights" half — because the only heavy display type left on the site is the two surviving Lora banners).

**Commits (chronological):**

| Commit | Scope |
|---|---|
| `2db80e4` | HowItWorksV2 panel title element gets a Nunito-first `fontFamily` so the heading renders real Nunito 900 instead of synthetic-bold Inter 600. First in-product trial of the Option-B premise. Body caption below the title still inherits the outer Inter stack. |
| `5b430f4` | Swap display face Nunito → Lora (serif editorial). Panel title renders real Lora 700 (Lora's heaviest weight in the Google Fonts request); fontSize 24 → 28 to compensate for the lower numerical weight — serifs carry heft through stroke contrast, not numerical weight. Google Fonts `<link>` in [index.html](index.html) extended with Lora 400/500/600/700 + italic 400/700 alongside the existing Inter and Nunito requests. |
| `a617885` | Introduce `.editorial` class in [theme.ts](src/styles/theme.ts) (`font-family: "Lora", Georgia, ...`) and apply to seven targeted headings: ProfilePage "this is your journal" + 4 section headings (responses to you / your responses / your starred entries / your starred responses), ShowSection friend room banner, ShowSection show name banner (public forum). Both banner titles drop fontWeight 800 → 700 to match Lora's heaviest real weight. Homepage panel title reverted to Inter-first (display type on homepage stays sans-serif brand voice). Net: Lora narrowly scoped to seven editorial spots; entry titles, modal titles, buttons, body, homepage copy all Inter. |
| `20f0320` | Tune the seven editorial headings: bump sizes (ProfilePage journal 22→28, ProfilePage sections 18→20, both banners 22→28), weight 700/600 → 400 everywhere. `.editorial` class sets `font-weight: 400`; inline overrides on the 2 banner titles drop to 400 directly. All seven render real Lora 400. |
| `1c69ddd` | Extend Lora to three more spots: `.splashSearch::placeholder` ("find your show"), profile pill "you are {username}" label, profile pill "go to your journal" label. Only the placeholder hint is Lora; text the user types stays Inter. Both pill labels render real Lora 700 (inline fontWeight 700 preserved). |
| `32ebe3b` | Swap one spot for another: revert `.splashSearch::placeholder` Lora (back to Inter), add Lora to `.diaryTab` (journal show-name tabs). Inactive tab weight 500 (real Lora 500); active tab weight 800 → 700 so it renders real Lora 700 rather than synthetic bold. |
| `792f4fc` | Entry card titles (ShowSection show forum): fontSize 22 → 20, inline fontWeight 400 override on `.title`'s 600. ProfilePage diary-view card titles (fontSize 18, same `.title` class) untouched at this point. |
| `03ae6e0` | Revert `792f4fc` — restore entry card title to 22/600 to match InlineThreadView's in-thread title (also 22/600 via `.title`). |
| `a4a5f08` | Unify entry titles the other direction: **both** the show-forum card title AND the in-thread title drop to 20/400. Inline fontWeight 400 override on both surfaces. |
| `d00f622` | Complete entry-title unification: ProfilePage diary card titles (main list + starred entries) 18/600 → 20/400. All three entry-title surfaces now read identically. |
| `36279eb` | Border thinning experiment: ShowSection thread cards (all three state variants — new / isOwn / default) 4 → 2px; journal diary outer card (`.diaryCardWrap > .card` + its mobile `!important` override) 2 → 1px; `.diaryBackPage` 2 → 1px; `.diaryTab` inactive + active-bottom border 2 → 1px. Active-tab `margin-bottom: -3px` overlap left at -3px (calibrated for 2px; noted as tune-later if seam reads). |
| `fce0c1f` | Revert `36279eb` — borders all back to their original widths. Separately, bump three Lora editorial headings (ProfilePage journal heading + both ShowSection banner titles, all at fontSize 28) weight 400 → 600. All three now render real Lora 600 (weight is in the Google Fonts request); no synthetic bold. |
| `a7ac9a7` | **Collapse Lora scope to two banners.** Everything else reverts to pre-arc Inter: `.diaryTab` Lora removed (active weight 700 → 800); ProfilePage "this is your journal" 28/600 editorial → 22px, editorial class removed (inherits `.title`'s 600); ProfilePage 4 section headings 20 editorial → 18, editorial removed; ProfilePage entry card titles (main + starred) 20/400 → 18, inherits 600; ShowSection entry card title 20/400 → 22, inherits 600; InlineThreadView in-thread title 20/400 → 22, inherits 600; [App.tsx](src/App.tsx) profile pill labels — editorial class removed. **Two surviving Lora surfaces:** ShowSection friend room banner + ShowSection show name banner (public forum), both bumped 28 → 34px, keep `.editorial` + weight 600. |
| `da37df4` | **Nunito cleanup.** Remove Nunito from the Google Fonts `<link>` in [index.html:11](index.html:11); strip `"Nunito"` from the three font stacks that still referenced it ([theme.ts:199](src/styles/theme.ts:199), [HowItWorks.tsx:279](src/components/HowItWorks.tsx:279), [HowItWorksV2.tsx:354](src/components/HowItWorksV2.tsx:354)). `.editorial` Lora class stays (two banners use it); Lora stays in the Google Fonts link. |

**Final state:** Lora is used in exactly two places — the ShowSection friend room banner and the ShowSection show name banner (public forum) — both at 34px / weight 600 / `.editorial` class. Everything else is Inter. Nunito is no longer referenced anywhere in the codebase. The Google Fonts request now covers Inter (400/500/600) + Lora (400/500/600/700 + italic 400/700) only.

**Deferred items added this arc:** none.

**Two-step deploys this arc required:** none.

**Conventions established or reinforced this arc:**

- **Real weights only for display type.** Whenever a weight was applied to a Lora surface in this arc, it was checked against Lora's Google Fonts request (400/500/600/700) to ensure real-file rendering, not synthetic bold. Synthetic faux-bold looks worse on serifs than on sans — it muddies the stroke contrast that's carrying the editorial read in the first place. Any new editorial heading should either pick one of the four weights already in the request or extend the Google Fonts link in [index.html](index.html:11).
- **Serifs carry visual heft through stroke contrast, not numerical weight.** When swapping a sans-serif heavy weight to a serif at a lower numerical weight, bump font-size to compensate. In this arc: Lora 700 @ 28px replaced Nunito 900 @ 24px on the panel title (`5b430f4`); the two surviving banners sit at 34px / Lora 600 (`a7ac9a7`). Don't try to match "perceived weight" one-for-one across typeface classes.
- **When an editorial experiment doesn't land, revert narrowly.** `a7ac9a7` is the model: rather than a blanket revert of every font-related commit, it scopes the revert to the surfaces that didn't pay off and keeps the two spots that did. The `.editorial` class stays in [theme.ts](src/styles/theme.ts) — cheap to retain, easy to reapply if we ever expand scope again.
- **Font-arc and border-arc merged into one revert commit when scopes overlapped naturally.** `fce0c1f` reverted the border experiment and bumped three Lora weights in the same commit because all three weight bumps landed on surfaces already in the font arc's scope. Bundling only works when the two changes share a logical scope; prefer separate commits when they don't.

### 2026-04-22 — ShowSection banner title wrap + right-button alignment

Long show names (and friend room names) were rendering on one line at 34px Lora 600 and pushing the right-side "back to..." / "to friend rooms" button past the edge of the content column. "THE SIDEBAR PROTOCOL" (20 chars) fit fine; "GAME OF THRONES: INSIDE THE EPISODE" (35 chars) did not. Fix is layout-only — no changes to typography, icon sizing, or the content column itself.

**Commits:**

| Commit | Scope |
|---|---|
| `b76909e` | **Title flex-shrinks and wraps; button cannot be displaced.** In [ShowSection.tsx](src/components/ShowSection.tsx): (1) show-name banner span at ~line 1424 and friend-room banner outer div + title span at ~lines 1380–1401 change `flex: "0 0 auto"` → `"0 1 auto"` + `minWidth: 0` so the title can shrink below its content's natural width. Right-side button still has `flexShrink: 0` so it stays rigid. (2) `lineHeight: 1.05` on both title spans for tight 2-line leading; 1-line case unaffected. (3) Inner `alignItems: "center"` → `"flex-start"` on the title's inline-flex container so when the text wraps, the leading icon aligns with the first line instead of centering across both. Each leading icon gets a `marginTop` sized to match its previous centered position (Globe: 9, Users: 7, Settings gear: 8) so the 1-line case stays visually identical to the pre-fix centered alignment. (4) `overflowWrap: "break-word"` as a safety net for rare single-word titles that still exceed available width. (5) **Orphan prevention** via new `preventLastWordOrphan(s)` helper ([ShowSection.tsx:7](src/components/ShowSection.tsx:7)) — replaces the last space in the title with U+00A0 (non-breaking space) so the final two words stay glued; browser wraps at the previous space instead, guaranteeing ≥2 words on the last line whenever wrapping occurs. Applied to both banner title strings. |
| `34be1c7` | **Right-side button drops to the second line.** [theme.ts:316](src/styles/theme.ts:316) `.bannerRow1` `align-items: center` → `flex-end` so the button aligns with the bottom edge of the (possibly multi-line) title. Two-line case: button aligns with line 2. One-line case: button aligns with the title's baseline, visually very close to the previous centered position. Mobile rule (flex-direction: column) unchanged. |

**Wrap threshold.** Not a hard pixel value — it's whatever "available width after the right-side button" works out to for the current container. At the standard `min(672px, 92vw)` container with a ~180px button, that's ~475px of title width. "THE SIDEBAR PROTOCOL" at 34px Lora 600 fits on one line; "GAME OF THRONES: INSIDE THE EPISODE" does not and wraps to 2 lines. The threshold adapts to button width automatically — shorter right-side button gives the title more room. Trade-off: if the right-side button gets unusually long (long room name in a "back to ..." label), the threshold tightens and a borderline title could wrap. Accepted as correct behavior — wrapping the title is gentler than displacing a button.

**Deferred items added this arc:** none.

**Two-step deploys this arc required:** none.

**Conventions established or reinforced this arc:**

- **`preventLastWordOrphan` pattern for display text.** When a display-type surface allows word-wrap, guard the last-line-single-word case by replacing the final space with U+00A0 before rendering. Cheap, purely presentational, no runtime state. The helper lives in [ShowSection.tsx:7](src/components/ShowSection.tsx:7); if another banner or headline ever needs the same treatment, lift it to `src/lib/utils.ts` rather than duplicating. Works for ≥3-word titles (wraps at previous space, putting ≥2 words on line 2) and is a no-op for ≤2-word titles (they either fit on 1 line or — very rarely — both words break mid-word via `overflowWrap: break-word`).
- **Flex-shrinkable title, flex-rigid siblings.** The pattern for any banner-row layout where one item (the title) must yield to fit a rigid sibling (a button, pill, or control): title gets `flex: "0 1 auto"` + `minWidth: 0`, siblings keep `flexShrink: 0` + `whiteSpace: nowrap`. Without `minWidth: 0`, flex items default to `min-width: auto` which pins them to their content's min-content size and they won't shrink. This pair of rules is what lets the title wrap instead of overflowing the container.
- **Icon alignment across 1-line and 2-line cases.** When a leading icon must sit inside a title that might wrap, use `align-items: flex-start` on the inline-flex + a hand-tuned `marginTop` on the icon equal to `(line-box - icon) / 2`. This matches the visual position of `align-items: center` for the 1-line case while correctly aligning the icon with the first line in the 2-line case. Line-box = `fontSize × lineHeight`. For the banner titles (34px × 1.05 ≈ 36px), Globe 18 → margin-top 9, Users 22 → 7, Settings gear 20 → 8. Recompute if the title's font-size or line-height changes.
- **`.bannerRow1` cross-axis = `flex-end`.** When a banner title can be multi-line and a sibling control needs to feel like it's "with" the title, align the row to the bottom so the control follows the title's last line rather than centering in the combined box. Cheap one-line change in `theme.ts`.

### 2026-04-22 — deleteThread must soft-delete only (RLS-driven silent failure)

User report: could not delete own public/private posts — the card disappeared optimistically but came back on refresh or on navigating to the journal. Friend-room deletes produced a worse artifact: the post "turned into" a private journal entry the user also couldn't delete. The optimistic local state was misleading — the DB delete was silently failing against RLS.

**Root cause.** The `threads_delete` RLS policy at [20260413_enable_rls_all_tables.sql:87-89](supabase/migrations/20260413_enable_rls_all_tables.sql:87) restricts DELETE on `threads` to admins only (`USING (public.is_admin())`, comment: "hard delete reserved for admin cascade"). `deleteThread` in `db.ts` had a two-branch implementation:

1. Has replies → soft-delete via `UPDATE ... SET is_deleted = true` (owner-allowed by `threads_update` policy). Worked.
2. No replies → hard-delete cascade: `DELETE` `response_citations` → `replies` → `group_threads` → `threads`. The final `DELETE FROM threads` silently no-op'd against the admin-only RLS policy. **Supabase doesn't throw on RLS-filtered UPDATE/DELETE** (returns `{data: null, error: null}` with 0 rows affected), so no error propagated and no user-visible failure message fired.

For friend-room posts (the dramatic symptom): `group_threads.delete()` in step 2 succeeded (more permissive policy), severing the friend-room link, then `threads.delete()` silently failed. Result: a live thread with `is_public=false` and no `group_threads` row — rendering as a bogus private journal entry that the user couldn't escape (because re-deleting also silently failed the same way).

**Fix.** `deleteThread` now always soft-deletes — one `UPDATE threads SET is_deleted = true` statement, nothing else. All read paths already handle soft-deleted threads correctly: hide them when there are no replies ([fetchUserThreads:557](src/lib/db.ts:557), [fetchGroupThreads:1478](src/lib/db.ts:1478), [ShowSection:2162-2183](src/components/ShowSection.tsx:2162) returns null), render a stub anchor when the thread has replies ([InlineThreadView:395-425](src/components/InlineThreadView.tsx:395) + ShowSection). The `response_citations` / `replies` / `group_threads` cleanup was only needed for the hard-delete path and went away with it — the resulting tombstone rows are consistent with how has-replies soft-deletes already behaved.

**Commit:**

| Commit | Scope |
|---|---|
| `baa3c9f` | [db.ts:175-189](src/lib/db.ts:175): `deleteThread` collapses to a single `UPDATE ... SET is_deleted = true`. Drops the hard-delete branch + 4-step cleanup cascade. Added inline comment explaining the RLS constraint + the friend-room artifact. 13+/25- (net shrink). |

**Pre-existing audit coverage (no changes needed):**
- No realtime subscription on `threads` DELETE events (App.tsx realtime is shows-only + replies wildcard). No UI updates depended on the missing DELETE events.
- No admin-delete-others UI path through this function. InlineThreadView Delete button is scoped to `isOwn`. Admin bulk-purge (`adminDeleteShow`) is a separate code path that was and remains admin-only at the RLS level.
- All thread read surfaces filter `is_deleted` correctly — audited `fetchUserThreads`, `fetchUserShowActivity`, `fetchPublicThreadsForUser`, `fetchPublicThreadsForShow`, `fetchPublicRepliesForUser`, `fetchGroupThreads`, `fetchLikedThreads`, `fetchLikedReplies`, `fetchUserReplies`. `fetchThreadsForShow` intentionally doesn't filter but the renderer handles both cases.
- No tests exist to update.

**Deferred items added this arc (now in §6):**
- **§6 item 17** — ProfilePage tab cache isn't invalidated on thread delete. Pre-existing, applies to all deletion paths (not a regression from `baa3c9f`); a full refresh reflects the delete correctly.
- **§6 item 18** — DB accumulates soft-deleted thread tombstones now that no-reply deletes don't hard-remove. No UX impact (reads filter); could be swept periodically if cruft becomes a storage concern.

**Ghost threads from prior failed deletes.** Rows in the DB as `is_public=false` with no `group_threads` link and `is_deleted=false`, left by the pre-fix partial-success on friend-room delete. They appear in the user's journal. No migration shipped — the user can simply re-click Delete on each one now, and `deleteThread` will correctly soft-delete them. They'll then be filtered out by `fetchUserThreads`. If ghost volume is large for any user, a one-off SQL cleanup setting `is_deleted=true` WHERE `author_id = <user>` AND `is_public = false` AND `id NOT IN (SELECT thread_id FROM group_threads)` would catch them in one shot.

**Two-step deploys this arc required:** none.

**Conventions established or reinforced this arc:**

- **Supabase doesn't throw on RLS-filtered writes.** `UPDATE` or `DELETE` that matches zero rows due to RLS returns `{error: null, data: null}` — indistinguishable from a legitimate "no rows matched the WHERE clause." Any write that assumes "no error = success" is vulnerable to silent failure if the RLS policy is stricter than the caller expects. Defense: either (a) check `data.length` or equivalent affected-row count where the API supports it, (b) structure writes so the owner-path is the only reachable path (what this fix does — always use the `owner can UPDATE own rows` policy instead of the admin-only DELETE policy), or (c) add a round-trip verification read after sensitive writes. For Sidebar, option (b) is the right default.
- **Soft-delete as the sole user-facing delete surface.** For tables with tombstone semantics (threads, replies, feedback, etc.) where read paths already handle `is_deleted=true`, the UI "delete" action should always issue an UPDATE flipping the soft-delete flag, never a hard DELETE. Hard DELETE is reserved for admin cascades (show purge, user account deletion in the future). This keeps the RLS surface simple (admin-only on DELETE, owner on UPDATE) and eliminates the "partial success" failure mode where some cleanup steps pass and others silently fail.
- **"No replies, no trace" is achieved at the render layer, not the DB layer.** When the product requirement is "deleted threads with no replies should vanish entirely," the fix is filtering them out in reads (`fetchUserThreads` `.eq("is_deleted", false)`, `fetchGroupThreads` `if (t.is_deleted && replyCount === 0) continue`, ShowSection `return null`), not hard-deleting the row. The DB keeps tombstones; the user sees nothing. Trade-off is tombstone accumulation vs. bulletproof RLS — for beta, tombstones win.
- **Optimistic local state can mask persistence failures.** The `onThreadDelete` callback in [ShowSection.tsx:2079-2087](src/components/ShowSection.tsx:2079) marks `isDeleted: true` in local state immediately on user action. When the DB write silently fails, the local state diverges from the DB until the next fetch rehydrates. This is a general pattern trap: optimistic UIs benefit from either (a) a rollback-on-error hook (hard when the API doesn't surface the error) or (b) just not optimistically updating for operations whose failure mode is silent. Not changing the pattern here because it's otherwise responsive, but worth naming as a known category.

### Earlier (pre-audit, header/layout polish)

The stretch of commits before this audit arc landed a series of header/layout adjustments: **4feb4f1** added CLAUDE.md; **60808a5** bumped `--site-header-h` 56→96px at ≤1133px; **2a3d62b** kept the profile pill inline next to sign-out; **6dacde3** shifted the journal diary stack +56px right on desktop. Plus three reverts of earlier header experiments (**0a93496 / bdd2e72 / e461b52**) and the experiments themselves (**431f790 / 35746c5 / c8e092b / 0eed264 / e625d2c**). Net effect: fixed header is a single right cluster (pill + sign-out + admin), profile diary nudges right on desktop to align under the pill, narrow breakpoint reserves enough vertical space for the tall logo column.

---

## CSS conventions (carried forward)

- 8px grid throughout.
- `--dos-bg`, `--dos-fg`, `--dos-user`, `--dos-green` are the core palette vars (defined in `theme.ts`).
- `--dos-user` = canon dark blue (used for primary interactive elements).
- `--dos-green` = canon dark green.
- `.prompt-ref` = full opacity `1` (published prompts).
- Visited entries: `opacity: 0.5`.
- `.bannerRow1` padding: `8px 0` (desktop + mobile).
- `.bannerTitle` mobile: `17px`.

## Component conventions

- **`<ShowSection key={expandedShowId}>`** at [App.tsx:1136](src/App.tsx:1136). Forces a full remount on every show switch so internal state and effect closures can't leak across shows. Without the key the component instance was reused, and effects whose deps omitted `showId` (e.g. the green-highlight effect at ShowSection.tsx:993) would write to the previous show via stale closure. **Behavioral consequence:** local component state (compose draft, expanded thread, group selection) resets when the user switches shows. This is intentional — preserve it on any future refactor. If you ever need to keep state across shows, lift it to App or a context, don't remove the key.

- **`cancelled` flag pattern for async effects.** When a `useEffect` kicks off `fetch`/Supabase work and then writes to React state in `.then`, guard against unmount with:
  ```ts
  useEffect(() => {
    let cancelled = false;
    asyncWork().then(result => {
      if (cancelled) return;
      setSomething(result);
    }).catch(err => {
      if (cancelled) return;
      console.warn("...", err);
    });
    return () => { cancelled = true; };
  }, [...deps]);
  ```
  Currently used in [ShowSection.tsx:826](src/components/ShowSection.tsx:826) (`fetchThreadsForShow`), [ProfilePage.tsx:80, :98](src/components/ProfilePage.tsx:80) (activity load + per-tab Promise.all), [SearchShows.tsx:194](src/components/SearchShows.tsx:194) (debounced TVMaze fetch), [InviteAcceptPage.tsx:95](src/components/InviteAcceptPage.tsx:95) (progress probe). New async effects should follow this pattern unless the writes are to refs only.

- **Dev-time pointer-events audit.** [src/lib/devHeaderAudit.ts](src/lib/devHeaderAudit.ts) is loaded in dev only (via [src/index.tsx](src/index.tsx)) and warns when an element inside `.topHeaderWrap` ends up with computed `pointer-events: none` AND looks clickable (`cursor: pointer` or React `onClick`/`onMouseDown`). Catches the silent-click-swallow bug class — see the SearchShows onboarding-modal regression that motivated it. If you add a new clickable element to the header, either route it through one of the allowlisted tags/classes (`button`, `a`, `input`, `select`, `textarea`, `.brand`, `.splashSearchWrap`, `.profileChip`) or portal it to `document.body`.

- **`effectiveProgress` for rewatcher spoiler-context comparisons.** A rewatcher's spoiler context is always their `highestS/E`, never their rewatch position (`.s/.e`). The rewatch position is display-only — where they are on this trip — and has no bearing on what they actually know. Anything that **tags** content the rewatcher writes (so spoiler filtering can hide it from the unworthy), **compares** "has the writer learned more since they wrote this", or **filters** what the rewatcher is allowed to see must reference [`effectiveProgress(progressEntry)`](src/lib/utils.ts:39) from `src/lib/utils.ts`, which returns `{s: highestS, e: highestE}` for rewatchers and `{s, e}` otherwise. Bypassing this and reading raw `.s/.e` is a spoiler-leak bug for rewatchers — see commit `c55ace5` for six sites that had this and the fix shape. Note: the `rewatchSeason`/`rewatchEpisode` snapshot fields stored on posts ARE supposed to be the raw rewatch position (display-only "written on rewatch of S2E3") — those are the exception. `canView` already routes through `effectiveProgress` internally, so any caller passing a full `ProgressEntry` is automatically correct; the bug class lives where calling code reads `.s/.e` directly for tagging or comparison. **Drift watch:** `fetchUserShowActivity` ([db.ts:400-424](src/lib/db.ts:400)) reimplements this rule inline instead of importing the helpers — if `utils.ts` ever changes the rewatcher rule, update `fetchUserShowActivity` in the same pass (or route it through the shared helpers).

- **`markTabCreated(userId, showId)` on new-tab creation paths.** Journal creation, friend-room creation, and invite-accept all call `markTabCreated` ([db.ts:540](src/lib/db.ts:540)) to write a localStorage timestamp (`ns_tab_created_<userId>_<showId>`). `ProfilePage`'s `showTabOrder` uses this as the fallback when a show has no DB-side activity yet, so a just-created tab floats to the front. Any new path that creates a show-scoped tab for the user must call this helper or the new tab will sort to the back behind every pre-existing tab.

## 8. Top-level rendering gates (order matters)

`App.tsx` applies these gates in order before rendering any route content. Any new top-level gate should be added with awareness of where it sits in the chain:

1. **Mobile lockout** (`bcf4589`). If `isMobileLocked && !isAdmin`, render `<MobileLockout />` and short-circuit everything else — no header, no feedback widget, no sign-in, no invite-accept. Threshold: `window.innerWidth < 768`. Admins bypass. ~200ms flash possible for admins while profile loads (§6 item 16).
2. **Auth-routing redirects** (`b0fe122`, [App.tsx:576-596](src/App.tsx:576)). As an effect (doesn't block render on the first paint, but fires as soon as `authLoading` resolves): signed-out users on `/profile` → `/`; signed-in non-admins on `/` → `/profile`. Admins exempt. `/invite/:token` exempt. Signed-in redirect gated on `profile` being loaded (§6 item 15 for failure mode).
3. **Route rendering** — wildcard route in `App.tsx` derives view from `location.pathname`.

When adding new routes or gates:
- **Signed-in-only routes** should be added to the `/profile` family (the `!user` redirect already covers them collectively only if you wire up a similar check; do NOT copy the redirect inline without thinking about the `/invite/:token` exemption pattern).
- **Public-no-account routes** (like `/invite/:token`) must be exempted from the signed-out redirect explicitly.
- **Admin-only views** should gate on `profile?.is_admin` after profile loads; don't assume `user` alone means admin.

## Watch-outs

- **Never add `body` rules in `index.css`** — they conflict with theme injection in `theme.ts`. The `text-ink` Tailwind class was causing dark text on the homepage until removed.
- **`scrollToShowTop`** uses `window.scrollTo({ top: 0 })` — do NOT use `bannerRef.getBoundingClientRect()` (sticky element returns wrong position when stuck).
- **`maximum-scale=1`** set in viewport meta to prevent iOS auto-zoom on input focus.
- **Modals inside `.topHeaderWrap` must be portaled.** `.topHeaderWrap` has `pointer-events: none` with a narrow allowlist; an inline modal will silently swallow clicks on any custom `<div>` click target. Use `createPortal(..., document.body)` (see [SearchShows.tsx:438](src/components/SearchShows.tsx:438)) or the `Modal` component (which portals automatically).
- **Two viewport breakpoints, different purposes.** `isMobile` (≤600px) governs layout density (stacking, font sizes, padding). `isMobileLocked` (<768px) is the full site-gate for non-admins — at that width non-admins see only `<MobileLockout />`. Don't conflate them or add new behavior that assumes one implies the other. Phone-in-landscape (>768px) passes `isMobileLocked` but may still trigger `isMobile` layout.

## Deploy & git/build rules (from CLAUDE.md)

- Always work on `main` directly. Never use git worktrees.
- Always run `npm run build` before pushing. Never push a failing build.
- Never blanket `git checkout --theirs / --ours` for merge conflicts — resolve per-file.
- Verify current file state on `main` before editing.
- Deploy: `git push origin main` → Netlify auto-deploys.
- Revert: `git revert <sha> && git push origin main`.

## Future polish backlog

Non-urgent UI polish items captured but intentionally deferred. Pick up as spot-fixes or batch later.

### Animated loading ellipsis — remaining candidates

Reusable `<LoadingDots />` component lives at [src/components/LoadingDots.tsx](src/components/LoadingDots.tsx) and wraps the existing `.invite-dot` CSS. Applied in the first pass to: AuthModal sign-in/create button, `Loading your profile…`, both "Posting…" composer buttons (journal + show-view), FeedbackWidget `Sending…`, show-view thread-list + main-area `Loading…`, `Loading replies…`, `Loading profile…` (public profile). Remaining candidates from the 2026-04-22 audit — apply `<LoadingDots />` by keeping the verb/label and replacing the trailing `…` glyph with the component:

**Pattern A (pending-action button labels):**
- [ResponseComposer.tsx:289](src/components/ResponseComposer.tsx:289) — `Posting…` (inline thread reply)
- [ShowSection.tsx:1866](src/components/ShowSection.tsx:1866) — `Creating…` (friend-room create)
- [ShowSection.tsx:1920](src/components/ShowSection.tsx:1920) — `Saving…` (room rename)
- [ShowSection.tsx:2019](src/components/ShowSection.tsx:2019), [:2041](src/components/ShowSection.tsx:2041) — `Leaving…` (leave / delete-and-leave)
- [InlineThreadView.tsx:337](src/components/InlineThreadView.tsx:337), [:350](src/components/InlineThreadView.tsx:350) — `Saving…` (edit thread, both retag + no-retag variants)
- [ProfilePage.tsx:1283](src/components/ProfilePage.tsx:1283) — `Creating…` (room create from journal)
- [RepliesList.tsx:851](src/components/RepliesList.tsx:851), [:863](src/components/RepliesList.tsx:863) — `Saving…` (edit reply, both retag + no-retag variants)
- [AdminPage.tsx:683](src/components/AdminPage.tsx:683) — `Saving…` (prompt edit, admin-only — include if natural, not as a special case)

**Pattern B (standalone "Loading…" messages):**
- [SearchShows.tsx:530](src/components/SearchShows.tsx:530) — `Loading episode data…` (TVMaze season fetch in picker modal)
- [ShowSection.tsx:1888](src/components/ShowSection.tsx:1888), [:1971](src/components/ShowSection.tsx:1971) — `Loading…` (group settings modal body, member list)
- [InviteAcceptPage.tsx:171](src/components/InviteAcceptPage.tsx:171) — `Loading…` (invite token verification)
- [ProfilePage.tsx:920](src/components/ProfilePage.tsx:920) — `Loading…` (journal per-tab data)
- [AdminPage.tsx:350](src/components/AdminPage.tsx:350), [:578](src/components/AdminPage.tsx:578) — `Loading…` (admin feedback list, prompts list — same admin caveat as above)

**Explicitly out of scope:**
- Invite-send modal ([ShowSection.tsx:1950-1956](src/components/ShowSection.tsx:1950)) — already has the below-button three-dot block; product-approved, don't touch.
- BetaGate `checking…` ([BetaGate.tsx:55](src/components/BetaGate.tsx:55)) — leave as-is.

## Outstanding action items (carry across sessions)

_None currently._

## Edge function deploy notes

- **`send-invite`** runs with gateway JWT verification off. The setting is pinned in [`supabase/config.toml`](supabase/config.toml):
  ```toml
  [functions.send-invite]
  verify_jwt = false
  ```
  Reason: the Supabase project is on asymmetric JWT signing keys (ES256) and the Edge Functions gateway on this runtime only accepts HS256 — gateway-level JWT verification was blocking every invocation with `UNSUPPORTED_TOKEN_ALGORITHM: Unsupported JWT algorithm ES256`. The function does its own JWT verification inside the code via `admin.auth.getUser(jwt)` ([index.ts:78](supabase/functions/send-invite/index.ts:78)), so the gateway check is redundant.
- **Deploy command:** `supabase functions deploy send-invite` — no flags needed. CLI ≥ 1.x reads `supabase/config.toml` and applies `verify_jwt = false` automatically. Verified on CLI 2.90.0.
- **Prior state (historical context):** before `supabase/config.toml` existed, each deploy required `supabase functions deploy send-invite --no-verify-jwt`. Several redeploys forgot the flag and had to be redone (see 2026-04-20 evening arc in §7). The config file eliminates that failure mode.
- If the project later migrates back to HS256 legacy keys (or Supabase's runtime adds ES256 support at the gateway), the `verify_jwt = false` pin in `config.toml` can be revisited. Until then, do not remove.
