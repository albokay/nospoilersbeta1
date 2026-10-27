/**
 * AskCard — the "Thoughts on…" card pinned at the top of a group's chat
 * (Alborz 2026-10-25, CP2; mockups claude.ai/artifact/4TwUHpFHbVvujUS25w4thT).
 *
 * One component for both idioms: the phone's chat page and the desktop
 * chat drawer mount it above the messages. It owns its own data: the
 * group's asks (newest first), the viewer's picture of the one on show,
 * the seen / opened stamps, and a live listen for takes.
 *
 * His rules: the card is OPEN on entering the chat when you have no take
 * yet, or when a take you can read is newer than the last time you had the
 * card open; otherwise it is folded to a one-line strip. The × folds it for
 * this visit only; the strip reopens it. Friends' takes are sealed rows
 * (red lock) until yours is in — the row policy enforces that; the card
 * only draws it. "Your take" is one line, sent from the card, once. A new
 * ask replaces the old one in the pin; ‹ › page back through earlier asks.
 *
 * `overlayInto` (the phone, Alborz 2026-10-26): the open card lays OVER the
 * chat's body — the messages and the field stay in place, dimmed under the
 * veil and unreachable — while the chat's head and the strip keep their
 * places; the × folds it. So an open card never squeezes the chat.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Lock } from "lucide-react";
import { E } from "../styles/editorial";
import { supabase } from "../lib/supabaseClient";
import { personDisplayName } from "../lib/groupNames";
import type { PeopleGroupMember } from "../types";
import {
  fetchGroupAsks, fetchAskState, sendAskTake, markAskSeen, markAskOpened, askOpensOnEntry,
  ASK_TAKE_MAX_LENGTH, type GroupAsk, type AskState,
} from "../lib/groupAsks";

type Member = Pick<PeopleGroupMember, "userId" | "username" | "displayName">;

const MONO: React.CSSProperties = { ...E.type.label10, color: E.color.inkMuted };

function askDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function AskCard({ groupId, userId, members, contactNames, overlayInto = null }: {
  groupId: string;
  userId: string;
  members: Member[];
  contactNames: Record<string, string>;
  /** The phone: the chat's body (messages + field), a positioned box the
   *  open card lays over; the strip stays in the stack above it. */
  overlayInto?: HTMLElement | null;
}) {
  const [asks, setAsks] = useState<GroupAsk[] | null>(null);
  const [index, setIndex] = useState(0);                      // 0 = the newest ask
  const [states, setStates] = useState<Record<string, AskState>>({});
  const [open, setOpen] = useState<boolean | null>(null);     // null until his rule has decided
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const G = E.space.gutter;

  const loadState = useCallback(async (ask: GroupAsk) => {
    const s = await fetchAskState(ask, userId);
    setStates((prev) => ({ ...prev, [ask.id]: s }));
    return s;
  }, [userId]);

  // Load the asks, the newest one's picture, stamp it seen, and decide open
  // or folded by his rule.
  useEffect(() => {
    let cancelled = false;
    setAsks(null); setIndex(0); setOpen(null); setText(""); setError(null);
    (async () => {
      try {
        const list = await fetchGroupAsks(groupId);
        if (cancelled) return;
        setAsks(list);
        if (!list.length) return;
        const s = await loadState(list[0]);
        if (cancelled) return;
        markAskSeen(list[0].id, userId).catch(() => { /* tolerate */ });
        const o = askOpensOnEntry(s);
        setOpen(o);
        if (o) markAskOpened(list[0].id, userId).catch(() => { /* tolerate */ });
      } catch (e) {
        console.error("[ask] load failed", e);
        if (!cancelled) setAsks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [groupId, userId, loadState]);

  const current = asks?.[index] ?? null;
  const state = current ? states[current.id] : undefined;

  // Live: a take you can read lands (the row policy decides which rows reach
  // you); coming back to the tab re-reads, which covers the sealed ones.
  useEffect(() => {
    if (!current) return;
    const ask = current;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const refresh = () => { if (!cancelled) loadState(ask).catch(() => { /* tolerate */ }); };
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) supabase.realtime.setAuth(session.access_token);
      } catch { /* tolerate */ }
      if (cancelled) return;
      channel = supabase
        .channel(`ask-takes-${ask.id}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "ask_takes", filter: `ask_id=eq.${ask.id}` }, refresh)
        .subscribe();
    })();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [current?.id, loadState]); // eslint-disable-line react-hooks/exhaustive-deps

  // While the newest ask's card is open on screen, everything on it counts as
  // seen: keep the opened stamp current as takes land.
  const visibleTakeCount = state?.takes.length ?? 0;
  useEffect(() => {
    if (open && current && index === 0 && state) markAskOpened(current.id, userId).catch(() => { /* tolerate */ });
  }, [open, current?.id, index, visibleTakeCount, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const memberById = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members]);
  const nameOf = (uid: string) => {
    if (uid === userId) return "You";
    const m = memberById.get(uid);
    return m ? personDisplayName(contactNames, uid, m.username, m.displayName) : "A friend";
  };

  const page = async (next: number) => {
    if (!asks || next < 0 || next >= asks.length) return;
    setIndex(next); setError(null);
    if (!states[asks[next].id]) loadState(asks[next]).catch(() => { /* tolerate */ });
  };

  const send = async () => {
    if (!current || busy) return;
    const body = text.trim();
    if (!body) return;
    setBusy(true); setError(null);
    try {
      await sendAskTake(current.id, userId, body);
      setText("");
      await loadState(current);
      markAskOpened(current.id, userId).catch(() => { /* tolerate */ });
    } catch (e) {
      console.error("[ask] send failed", e);
      setError("Couldn’t send. Try again?");
    } finally {
      setBusy(false);
    }
  };

  if (!asks || !asks.length || !current || open == null) return null;

  const newest = index === 0;
  const opener = <><em>Thoughts on</em> {current.prompt}.</>;

  // ── Folded: the one-line strip ────────────────────────────────────────
  const strip = (
      <button
        type="button" aria-expanded={false} aria-label="Open the Thoughts on card"
        onClick={() => { setOpen(true); setIndex(0); markAskOpened(asks[0].id, userId).catch(() => { /* tolerate */ }); }}
        style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, width: "100%", boxSizing: "border-box", padding: `0 ${G}px`, height: 54, background: E.color.cream, border: 0, borderBottom: `1px solid ${E.color.hairline}`, color: E.color.ink, textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
      >
        <span style={{ ...MONO, flexShrink: 0 }}>Pinned</span>
        <span style={{ flex: 1, minWidth: 0, fontFamily: E.font.display, fontSize: 15, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><em>Thoughts on</em> {asks[0].prompt}.</span>
        <span aria-hidden="true" style={{ fontSize: 9, color: E.color.inkMuted, flexShrink: 0 }}>▼</span>
      </button>
  );
  if (!open) return strip;

  // ── Open: the card ────────────────────────────────────────────────────
  const answered = state?.answerers ?? [];
  const answeredIds = new Set(answered.map((a) => a.userId));
  const takeBy = new Map((state?.takes ?? []).map((t) => [t.userId, t]));
  const mine = state?.mine ?? null;
  const rows: { userId: string; kind: "take" | "sealed" | "waiting"; body?: string }[] = [];
  for (const a of answered) {
    const t = takeBy.get(a.userId);
    rows.push(t ? { userId: a.userId, kind: "take", body: t.body } : { userId: a.userId, kind: "sealed" });
  }
  for (const m of members) if (!answeredIds.has(m.userId) && m.userId !== userId) rows.push({ userId: m.userId, kind: "waiting" });
  const total = members.length || answered.length;
  const inCount = answered.length;
  const allIn = total > 0 && inCount >= total;
  const headLabel = `From Sidebar · ${newest ? "pinned" : askDate(current.createdAt)}${asks.length > 1 ? ` · ${asks.length - index} of ${asks.length}` : ""}`;
  const hairRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, height: 40, borderBottom: `1px solid ${E.color.hairline}` };
  const nameCell: React.CSSProperties = { ...MONO, width: 56, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const arrow: React.CSSProperties = { width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", border: 0, padding: 0, cursor: "pointer", color: E.color.ink, fontSize: 18, lineHeight: 1 };

  const inner = (
        <div style={{ position: "relative", background: E.color.cream, border: `1px solid ${E.color.ink}`, padding: "14px 18px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {asks.length > 1 && (
              <button type="button" aria-label="Earlier ask" disabled={index >= asks.length - 1} onClick={() => page(index + 1)} style={{ ...arrow, marginLeft: -6, color: index >= asks.length - 1 ? "rgba(26,58,74,0.3)" : E.color.ink }}>‹</button>
            )}
            <span style={{ ...MONO, flex: 1, minWidth: 0 }}>{headLabel}</span>
            {asks.length > 1 && (
              <button type="button" aria-label="Later ask" disabled={index === 0} onClick={() => page(index - 1)} style={{ ...arrow, color: index === 0 ? "rgba(26,58,74,0.3)" : E.color.ink }}>›</button>
            )}
            {<button type="button" aria-label="Close" title="Close" onClick={() => { setOpen(false); setIndex(0); }} style={{ ...arrow, width: 28, height: 28, fontSize: 20, margin: "-4px -8px 0 0" }}>×</button>}
          </div>
          <div style={{ marginTop: 6, fontFamily: E.font.display, fontSize: 22, lineHeight: 1.25, color: E.color.ink, maxWidth: 300 }}>{opener}</div>

          <div style={{ marginTop: 14, borderTop: `1px solid ${E.color.hairline}` }}>
            {!state && <div style={{ ...MONO, height: 40, display: "flex", alignItems: "center" }}>…</div>}
            {state && rows.map((r) => {
              if (r.kind === "take") {
                return (
                  <div key={r.userId} style={{ padding: "10px 0", borderBottom: `1px solid ${E.color.hairline}` }}>
                    <div style={{ ...MONO, color: r.userId === userId ? E.color.identity : E.color.inkMuted }}>{nameOf(r.userId)}</div>
                    <div style={{ marginTop: 3, fontFamily: E.font.display, fontSize: 15, lineHeight: 1.5, color: E.color.ink, overflowWrap: "anywhere" }}>{r.body}</div>
                  </div>
                );
              }
              if (r.kind === "sealed") {
                return (
                  <div key={r.userId} style={hairRow}>
                    <span style={nameCell}>{nameOf(r.userId)}</span>
                    <span aria-hidden="true" style={{ flex: 1, height: 1, background: "repeating-linear-gradient(90deg, rgba(26,58,74,0.35) 0 6px, transparent 6px 11px)" }} />
                    <Lock size={16} strokeWidth={1.8} color={E.color.alert} aria-label="Sealed until your take is in" style={{ flexShrink: 0 }} />
                  </div>
                );
              }
              return (
                <div key={r.userId} style={hairRow}>
                  <span style={nameCell}>{nameOf(r.userId)}</span>
                  <span style={{ ...MONO, color: "rgba(26,58,74,0.45)" }}>hasn’t answered yet</span>
                </div>
              );
            })}
          </div>

          {state && !mine && (
            <>
              <label htmlFor={`ask-take-${current.id}`} style={{ ...E.type.label11, display: "block", marginTop: 14, color: E.color.ink }}>Your take</label>
              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <input
                  id={`ask-take-${current.id}`} type="text" value={text} maxLength={ASK_TAKE_MAX_LENGTH}
                  onChange={(e) => { setText(e.target.value); if (error) setError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                  placeholder="One line"
                  style={{ flex: 1, minWidth: 0, height: 44, boxSizing: "border-box", border: `1px solid ${E.color.ink}`, background: E.color.cream, color: E.color.ink, fontFamily: E.font.display, fontSize: 15, padding: "0 12px", outline: "none", borderRadius: 0, margin: 0 }}
                />
                <button type="button" onClick={send} disabled={busy || !text.trim()} style={{ height: 44, padding: "0 14px", background: E.color.ink, color: E.color.cream, border: 0, fontFamily: E.font.interface, fontWeight: 600, fontSize: 14, cursor: busy || !text.trim() ? "default" : "pointer", opacity: busy || !text.trim() ? 0.6 : 1, flexShrink: 0 }}>{busy ? "Sending…" : "Send →"}</button>
              </div>
              <div style={{ ...MONO, letterSpacing: "0.06em", marginTop: 10, color: error ? E.color.alert : E.color.inkMuted }}>{error ?? "Their takes open once yours is in."}</div>
            </>
          )}
          {state && mine && (
            <div style={{ ...MONO, letterSpacing: "0.06em", marginTop: 10 }}>{allIn ? "Everyone’s in." : `${inCount} of ${total} answered.`}</div>
          )}
        </div>
  );

  if (overlayInto) {
    // The phone: the strip holds its place under the head; the card lays
    // over the chat's body on the veil — messages and field dimmed and
    // unreachable behind it — and the × folds it (his notes, 2026-10-26).
    return (
      <>
        {strip}
        {createPortal(
          <div role="dialog" aria-label="Thoughts on" style={{ position: "absolute", inset: 0, zIndex: 5, background: E.color.veil, overflowY: "auto", WebkitOverflowScrolling: "touch" as any, padding: `16px ${G}px calc(24px + env(safe-area-inset-bottom, 0px))`, boxSizing: "border-box" }}>
            <div style={{ position: "relative" }}>
              <div aria-hidden="true" style={{ position: "absolute", left: 6, top: 6, right: -6, bottom: -6, background: E.color.friend }} />
              {inner}
            </div>
          </div>,
          overlayInto,
        )}
      </>
    );
  }
  return (
    <div style={{ flexShrink: 0, padding: `18px ${G}px 24px`, borderBottom: `1px solid ${E.color.hairline}` }}>
      <div style={{ position: "relative" }}>
        <div aria-hidden="true" style={{ position: "absolute", left: 6, top: 6, right: -6, bottom: -6, background: E.color.friend }} />
        {inner}
      </div>
    </div>
  );
}
