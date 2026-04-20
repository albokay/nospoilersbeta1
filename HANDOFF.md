# Sidebar — Technical State (2026-04-20)

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
15. **Profile-load failure leaves signed-in non-admin on homepage** (`b0fe122`). The `/` → `/profile` redirect is gated on `user && profile && !isAdmin`. If the profile row never loads (network error, RLS failure, trigger race), the redirect never fires and the user stays on `/` viewing the anonymous homepage. Not an infinite loop and not a blank page — just a degraded state. Combined with the removal of the signed-in shortcut block on `/` (`3e77025`), such a user has no in-UI path to `/profile` except typing the URL. Escape hatch: `/profile` loads directly because the `!user` redirect fires only when user is truly null. If observed in practice, add a "still loading your profile… [retry]" fallback or stop gating the redirect on `profile`.
16. **Mobile lockout is viewport-based and has a small admin flash** (`bcf4589`). `isMobileLocked` tracks `window.innerWidth < 768`; the gate short-circuits rendering when `isMobileLocked && !isAdmin`. Admins signing in on mobile see ~200ms of the lockout screen before `profile` loads and `is_admin` resolves true. Phone-in-landscape slips through by design. Viewport threshold intentionally separate from the existing `isMobile` (≤600px, layout density only).

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

## Outstanding action items (carry across sessions)

- **`send-invite` edge function deploy** (from `5955ce9`, 2026-04-19). Server-side self-invite block lives in `supabase/functions/send-invite/index.ts` and still needs `supabase functions deploy send-invite` (or upload via the Supabase dashboard). `git status` shows the file as modified-and-undeployed. Client-side pre-check has shipped via Netlify, so self-invite is blocked client-side today — but a caller hitting the edge function directly would succeed until this deploys.
