import React, { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowUp } from "lucide-react";
import { CANON } from "../styles/canon";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import { linkifyText } from "../lib/linkify";
import {
  fetchGroupMessages,
  sendGroupMessage,
  fetchPeopleGroupMembers,
  markGroupChatSeen,
  type GroupMessage,
} from "../lib/db";
import type { PeopleGroupMember } from "../types";

/**
 * MobileGroupChat (CP5) — the chat side of the group room's shows↔chat
 * toggle. Full-screen messaging surface (desktop: a right-hand panel).
 * Same behavior as desktop's chat: plain text, NOT spoiler-gated (the one
 * surface that acts like a normal chat app), URLs auto-linkified, realtime
 * via a filtered member-gated subscription, opening marks messages seen
 * (clears the new-message dots up the tree).
 */

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';
const C = {
  green: CANON.personal,
  sky: CANON.friend,
  blue: CANON.identity,
  cream: CANON.cream,
  midnight: CANON.dark,
};

export default function MobileGroupChat({ groupId }: { groupId: string }) {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const selfUserId = user?.id ?? "";

  const [members, setMembers] = useState<PeopleGroupMember[]>([]);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [input, setInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  const loadChat = useCallback(async () => {
    try { setMessages(await fetchGroupMessages(groupId)); } catch (e) { console.error("[m-chat] load failed", e); }
  }, [groupId]);

  // Load + realtime + mark-seen — mirrors desktop's open-chat effect.
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let nameById: Record<string, string> = {};

    (async () => {
      // Resolve author usernames for live rows from the member list (every
      // chat author is a member, so this covers them without a query).
      try {
        const ms = await fetchPeopleGroupMembers(groupId);
        if (cancelled) return;
        setMembers(ms);
        for (const m of ms) nameById[m.userId] = m.username;
      } catch { /* tolerate */ }

      // group_messages is member-gated RLS, so the realtime socket must carry
      // the user's token or it silently delivers nothing (same note as desktop).
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) supabase.realtime.setAuth(session.access_token);
      } catch { /* tolerate */ }
      if (cancelled) return;

      channel = supabase
        .channel(`m-group-chat-rt-${groupId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` },
          (payload) => {
            const r = payload.new as any;
            if (!r) return;
            setMessages((prev) => prev.some((m) => m.id === r.id) ? prev : [...prev, {
              id: r.id,
              authorId: r.author_id,
              username: nameById[r.author_id] ?? "unknown",
              body: r.body,
              createdAt: new Date(r.created_at).getTime(),
            }]);
          },
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn("[m-chat] realtime status:", status);
          }
        });
    })();

    loadChat();
    // Opening the chat clears its new-message dot.
    markGroupChatSeen(groupId).catch(() => { /* tolerate */ });

    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [groupId, user, authLoading, loadChat]);

  // Keep the chat scrolled to the newest message.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function sendChat() {
    if (!user || !input.trim()) return;
    const body = input.trim();
    setInput("");
    try {
      await sendGroupMessage(groupId, user.id, body);
      await loadChat();
    } catch (e) { console.error("[m-chat] send failed", e); }
  }

  if (authLoading) return null;
  if (!user) return <Navigate to="/m" replace />;

  const others = members.filter((m) => m.userId !== selfUserId);
  const connected = others.length ? others.map((m) => `@${m.username}`).join(", ") : "just you";

  return (
    <div style={page}>
      {/* ── Header (cream bar): back + connected-with line ── */}
      <div style={header}>
        <button style={iconBtn} title="back to group" onClick={() => navigate(`/m/group/${groupId}`)}>
          <ArrowLeft size={22} color={C.green} />
        </button>
        <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3, minWidth: 0 }}>
          <span style={{ color: C.blue }}>You're connected with:</span><br />
          <span style={{ color: C.green }}>{connected}</span>
        </div>
      </div>

      {/* ── Messages ── */}
      <div style={body} ref={bodyRef}>
        {messages.map((m) => {
          const mine = m.authorId === selfUserId;
          return (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", marginBottom: 12 }}>
              {!mine && <div style={{ fontSize: 11, color: C.cream, opacity: 0.85, marginBottom: 3 }}>{m.username}</div>}
              <div style={mine ? bubbleMine : bubbleOther}>{linkifyText(m.body)}</div>
            </div>
          );
        })}
      </div>

      {/* ── Input row (pinned) ── */}
      <div style={inputRow}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
          placeholder="message…"
          style={inputBox}
          className="m-input"
        />
        <button style={sendBtn} onClick={sendChat}><ArrowUp size={18} color={C.cream} /></button>
      </div>
    </div>
  );
}

// ── Styles (desktop chat panel colors, full-screen mobile shell) ────────────
const page: React.CSSProperties = {
  position: "fixed", inset: 0,
  height: "100dvh",
  display: "flex", flexDirection: "column",
  background: C.green,
  fontFamily: '"Inter", system-ui, sans-serif',
};
const header: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
  background: C.cream,
  padding: "calc(env(safe-area-inset-top, 0px) + 10px) 14px 10px 6px",
  flexShrink: 0,
};
const iconBtn: React.CSSProperties = {
  width: 44, height: 44, flexShrink: 0, border: "none", background: "transparent", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const body: React.CSSProperties = {
  flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch",
  padding: "20px 16px", display: "flex", flexDirection: "column",
};
const bubbleOther: React.CSSProperties = {
  background: C.sky, color: C.midnight, padding: "10px 14px", borderRadius: 16,
  maxWidth: "78%", fontSize: 14, lineHeight: 1.4, overflowWrap: "break-word",
};
const bubbleMine: React.CSSProperties = {
  background: C.cream, color: C.midnight, padding: "10px 14px", borderRadius: 16,
  maxWidth: "78%", fontSize: 14, lineHeight: 1.4, overflowWrap: "break-word",
};
const inputRow: React.CSSProperties = {
  display: "flex", gap: 8, alignItems: "center",
  padding: "12px 14px calc(env(safe-area-inset-bottom, 0px) + 12px)",
  background: C.cream, flexShrink: 0,
};
const inputBox: React.CSSProperties = {
  flex: 1, border: "none", borderRadius: 65, padding: "12px 18px",
  fontFamily: '"Inter", sans-serif', fontSize: 16, color: C.midnight,
  background: CANON.cream, outline: "none", minHeight: 44, boxSizing: "border-box",
  boxShadow: `inset 0 0 0 2px ${C.sky}`,
};
const sendBtn: React.CSSProperties = {
  border: "none", background: C.blue, borderRadius: "50%", width: 44, height: 44,
  display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "0 0 auto",
};
