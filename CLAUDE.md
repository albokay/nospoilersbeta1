# Sidebar — Claude instructions

## NEVER use git worktrees — STOP IMMEDIATELY IF IN ONE

**Absolute rule.** Never read, edit, run, build, preview, or run any command against paths inside `.claude/worktrees/`. Always operate on `main` in the main repo at `/Users/alborzkamalizad/Downloads/no-spoilers-v072-fullui-ready/`.

**If you find yourself working in a worktree at any point, STOP immediately.** Tell the user the session is in a worktree and ask them to start a new session from the main repo path. Do not try to "just use absolute paths" to work around it — the chat indicator and session state will still show the worktree branch, which the user does not want. Full stop until a fresh session is started from main.

If a session launches with CWD inside a worktree:
- The chat indicator will show the worktree branch (e.g. `claude/foo-bar ← claude/foo-bar`). The user wants to see `main ← main`.
- Surface this to the user in the first response. Offer to remove the worktree via `git worktree remove <path>` so the next session starts clean.
- Until the session is restarted from main, do not silently proceed with work.

The only exception is an explicit per-request instruction from the user like "use the worktree for this." That authorization is for that one request only, not standing.

---

## Deploy

Push to main — auto-deploy is configured on the hosting platform:
```
git push origin main
```
The site rebuilds and deploys after each push.

## Git & build rules

1. **Always work on `main` directly.**
2. **Always run `npm run build` before pushing.** Never push a failing build.
3. **Never blanket `git checkout --theirs` / `--ours`** for merge conflicts — resolve per-file.
4. **Verify current file state on `main` before editing** — don't assume parity with a worktree or older snapshot.

## Revert path

Every deploy is a single commit. Revert is always `git revert <sha> && git push origin main` — the auto-deploy rolls back. History is preserved.
