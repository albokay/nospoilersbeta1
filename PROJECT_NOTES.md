# Sidebar — Project Notes (Living Reference)

> Read this at the start of every session. Update it whenever architecture decisions are made.

---

## Stack & Deploy

- **Framework**: React 18 + TypeScript + Vite
- **Backend**: Supabase (Postgres + Auth + Realtime)
- **Styling**: Custom DOS-inspired theme injected via `src/styles/theme.ts` + `src/index.css`
- **Worktree**: `.claude/worktrees/great-euclid`
- **Deploy**: `git push origin claude/great-euclid:main` → Vercel auto-deploys

---

## Key Files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Root: auth, progress state, routing, show selection, beta note |
| `src/lib/db.ts` | All Supabase query functions (snake_case → camelCase mapped) |
| `src/lib/supabaseClient.ts` | Supabase client init |
| `src/styles/theme.ts` | Full CSS injected as a string — DOS palette, gradients, components |
| `src/index.css` | Minimal Tailwind base — do NOT add `body` rules here (conflicts with theme.ts) |
| `src/components/ShowSection.tsx` | Per-show forum: threads, replies, compose, edit, progress |
| `src/components/OneSelectProgress.tsx` | Progress picker (native select, desktop + mobile) |
| `src/components/LikeBadge.tsx` | Starring explanation popover |
| `src/components/FeedbackWidget.tsx` | User feedback submission widget |
| `src/components/AdminPage.tsx` | Admin feedback panel |
| `src/extensions/ExtensionDock.tsx` | "?" help button in top-left corner |

---

## Database Tables (Supabase)

### `shows`
- `id`, `name`, `seasons` (int[]), `tvmaze_id`, `status`, `is_hidden`, `last_synced_at`, `genres`, `tvmaze_type`
- Episode/season data synced from **TVMaze API**

### `threads`
- `id`, `show_id`, `season`, `episode`, `author_name`, `author_id`, `title`, `body`, `preview`
- `is_private`, `is_deleted`, `is_edited`, `updated_at`, `likes_count`

### `replies`
- `id`, `thread_id`, `show_id`, `season`, `episode`, `author_id`, `body`
- `is_edited`, `created_at`, `updated_at`

### `progress`
- `user_id`, `show_id`, `season`, `episode`
- Upserted on conflict `(user_id, show_id)`

### `likes` — thread and reply likes

### `feedback` — from FeedbackWidget

---

## Core Mechanics

### Spoiler filtering
- Posts (threads + replies) are tagged with `season` + `episode` at the writer's progress at time of creation
- Readers only see posts tagged at or below their own current progress
- Filtering happens **client-side** in `ShowSection` / `RepliesList`

### Progress state
- Stored in `progress` React state in `App.tsx` — plain `useState`, no localStorage
- Loaded from DB on login (`fetchProgress`), saved to DB on change (`upsertProgress`)
- Passed down as prop; updated via `updateProgressFor(showId, { s, e })`

### Edit functions (in `db.ts`)
- `editThread(threadId, title, body)` — updates title, body, preview, sets `is_edited: true`
- `editReply(replyId, body)` — updates body, sets `is_edited: true`
- **Planned**: both need to also update `season` + `episode` to writer's current progress at save time

### Body gradient
- Homepage: top-to-bottom `#c8e4b0 → --dos-bg`
- All other pages: bottom-to-top (via `body.has-header` class toggled in `App.tsx` useEffect based on `isHomepage`)

### Progress picker
- Desktop: native `<select>` with `<optgroup>` season dividers; closed state shows "you've watched: Sxx Exx"
- Mobile: same native select inline (no popup)
- Confirmation modal always shown on change

---

## Agreed Design Decisions

### Spoiler risk mitigations (implementation queue)

**#1 — Post editing retagged to current progress** *(next up)*
- Any save (new post or edit) tags with writer's current progress at moment of save
- `editThread` and `editReply` in `db.ts` need `season` + `episode` params added
- Warn user before saving an edit only if their progress has advanced since the post was written
- No warning if progress unchanged (e.g. fixing a typo)
- Call sites: wherever `editThread` / `editReply` are called in `ShowSection.tsx`

**#2 — Stale progress nudge**
- Track `lastVisit` timestamp in `localStorage` on each app load
- On next load, if gap > 12 hours, show nudge before user posts: "You watched more — everyone's looking forward to your new thoughts!"
- Compose window passively shows current progress as a reminder
- Progress update UI should feel celebratory, not administrative

**#3 — Re-watch mode** *(Option A)*
- User flow: in progress-setting UI, add "Are you re-watching this show?" toggle (only shown after progress is set)
- If yes: ask "How far did you watch before?" (`highest_progress`) and "How far are you on your re-watch?" (`rewatch_position`)
- New DB columns needed on `progress` table: `is_rewatching` (bool), `rewatch_season` + `rewatch_episode` (current position), `highest_season` + `highest_episode` (furthest ever watched)
- Re-watcher posts tagged at `highest_progress`, not `rewatch_position` → invisible to first-timers below that level
- Re-watchers get a special badge next to their name
- Forums can be filtered to "re-watchers only"
- Auto-flip back to regular mode when `rewatch_position` reaches `highest_progress` (they are no longer re-watching)
- If highest progress hasn't reached finale, they auto-flip at that point; site treats them as regular watcher from then on
- Episode totals per season come from TVMaze API (already in `shows.seasons` array)

**#4 — Progress rollback grace window**
- Allow self-revert within 3 minutes of setting progress, no review needed
- "I set the wrong episode" option added to existing "?" menu (`ExtensionDock.tsx`)
- Full petition flow (admin review) deferred for later

**#5 — First-time setup**
- Deferred — depends on homepage copy decisions first

---

## Stable Tags

| Tag | Commit | Description |
|-----|--------|-------------|
| `stable-pre-spoiler-mitigations` | `0a8e541` | Site as of April 7 2026, before spoiler mitigation work began |

---

## CSS Conventions

- 8px grid throughout
- `--dos-bg`, `--dos-fg`, `--dos-user`, `--dos-green` are the core palette vars (defined in `theme.ts`)
- `--dos-user` = canon dark blue (used for primary interactive elements)
- `--dos-green` = canon dark green
- `.prompt-ref` = full opacity `1` (published prompts)
- Visited entries: `opacity: 0.5`
- `.bannerRow1` padding: `8px 0` (desktop + mobile)
- `.bannerTitle` mobile: `17px`

---

## Notes / Watch-outs

- **Never add `body` rules in `index.css`** — they conflict with theme injection in `theme.ts`. The `text-ink` Tailwind class was causing dark text on the homepage until removed.
- **`scrollToShowTop`** uses `window.scrollTo({ top: 0 })` — do NOT use `bannerRef.getBoundingClientRect()` (sticky element returns wrong position when stuck)
- **`maximum-scale=1`** set in viewport meta to prevent iOS auto-zoom on input focus
