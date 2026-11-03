/**
 * GroupChatDrawer — the group's chat drawer opened from INSIDE a show room
 * (the landing-rule arc's CP2, 2026-11-02: chat lives in both places). Its
 * own loading, realtime, optimistic send and mark-seen, the way the phone's
 * chat page (MobileGroupChat) carries its own; the group room's drawer in
 * DashboardPage keeps its own state too. Same messages, same send.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  fetchGroupMessages, sendGroupMessage, fetchPeopleGroupMembers, fetchPeopleGroupsForUser, fetchMyGroupJoinOrder, fetchContactNames, markGroupChatSeen,
  type GroupMessage,
} from "../../lib/db";
import { personDisplayName, groupGenericName } from "../../lib/groupNames";
import type { PeopleGroup, PeopleGroupMember } from "../../types";
import { Drawer, ChatMessages, ChatComposer, type ChatRow } from "./Overlays";
import AskCard from "../AskCard";

export default function GroupChatDrawer({ groupId, userId, onClose }: { groupId: string; userId: string; onClose: () => void }) {
  const [members, setMembers] = useState<PeopleGroupMember[]>([]);
  const [contactNames, setContactNames] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [input, setInput] = useState("");
  const [group, setGroup] = useState<PeopleGroup | null>(null);
  const [viewerNumber, setViewerNumber] = useState<number | undefined>(undefined);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const bodyRef = useRef<HTMLDivElement>(null);

  const loadChat = useCallback(async () => {
    try { setMessages(await fetchGroupMessages(groupId)); } catch (e) { console.error("[room-chat] load failed", e); }
  }, [groupId]);

  // Load + realtime + mark-seen (the phone chat page's effect).
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const nameById: Record<string, string> = {};
    (async () => {
      try {
        const ms = await fetchPeopleGroupMembers(groupId);
        if (cancelled) return;
        setMembers(ms);
        for (const m of ms) nameById[m.userId] = m.username;
      } catch { /* tolerate */ }
      fetchContactNames(userId).then((cn) => { if (!cancelled) setContactNames(cn); }).catch(() => { /* tolerate */ });
      Promise.all([fetchPeopleGroupsForUser(userId), fetchMyGroupJoinOrder(userId)])
        .then(([gs, jo]) => {
          if (cancelled) return;
          setGroup(gs.find((g) => g.id === groupId) ?? null);
          const sorted = gs.map((g) => ({ id: g.id, j: jo[g.id] ?? 0 })).sort((a, b) => a.j - b.j);
          const idx = sorted.findIndex((g) => g.id === groupId);
          if (idx >= 0) setViewerNumber(idx + 1);
        })
        .catch(() => { /* tolerate */ });
      // group_messages is member-gated RLS: the socket must carry the token.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) supabase.realtime.setAuth(session.access_token);
      } catch { /* tolerate */ }
      if (cancelled) return;
      channel = supabase
        .channel(`room-group-chat-rt-${groupId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` },
          (payload) => {
            const r = payload.new as any;
            if (!r) return;
            setMessages((prev) => {
              if (prev.some((m) => m.id === r.id)) return prev;
              const row: GroupMessage = { id: r.id, authorId: r.author_id, username: nameById[r.author_id] ?? "…", displayName: null, body: r.body, createdAt: new Date(r.created_at).getTime() };
              const ti = prev.findIndex((m) => m.id.startsWith("temp-") && m.authorId === r.author_id && m.body === r.body);
              if (ti !== -1) { const next = prev.slice(); next[ti] = row; return next; }
              return [...prev, row];
            });
          },
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.warn("[room-chat] realtime status:", status);
        });
    })();
    void loadChat();
    markGroupChatSeen(groupId).catch(() => { /* tolerate */ });
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [groupId, userId, loadChat]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Optimistic echo; a failure keeps the ghost with "not sent · retry".
  async function sendBody(body: string) {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMessages((prev) => [...prev, { id: tempId, authorId: userId, username: "", displayName: null, body, createdAt: Date.now() }]);
    try {
      const sent = await sendGroupMessage(groupId, userId, body);
      setMessages((prev) => prev.some((m) => m.id === sent.id)
        ? prev.filter((m) => m.id !== tempId)
        : prev.map((m) => (m.id === tempId ? { ...m, id: sent.id, createdAt: sent.createdAt } : m)));
    } catch (e) {
      console.error("[room-chat] send failed", e);
      setFailed((prev) => new Set(prev).add(tempId));
    }
  }
  function retry(tempId: string, body: string) {
    setMessages((prev) => prev.filter((m) => m.id !== tempId));
    setFailed((prev) => { const n = new Set(prev); n.delete(tempId); return n; });
    void sendBody(body);
  }
  async function send() {
    const body = input.trim();
    if (!body) return;
    setInput("");
    await sendBody(body);
  }

  const others = members.filter((m) => m.userId !== userId);
  const connected: React.ReactNode = others.length
    ? others.map((m) => personDisplayName(contactNames, m.userId, m.username, m.displayName)).join(", ")
    : <em>(your friends haven&rsquo;t joined yet)</em>;
  const rows: ChatRow[] = messages.map((m) => ({
    id: m.id, mine: m.authorId === userId, name: personDisplayName(contactNames, m.authorId, m.username, m.displayName), body: m.body,
    pending: m.id.startsWith("temp-"), failed: failed.has(m.id), onRetry: () => retry(m.id, m.body),
  }));
  return (
    <Drawer
      onClose={onClose}
      zIndex={1300}
      label="Chat"
      title={`${group ? groupGenericName(group, viewerNumber) : "Group"} chat`}
      caption={<>with {connected} &middot; not spoiler-gated</>}
      bodyStyle={{ padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
      foot={<ChatComposer value={input} onChange={setInput} onSend={send} />}
    >
      <AskCard groupId={groupId} userId={userId} members={members} contactNames={contactNames} />
      <ChatMessages rows={rows} bodyRef={bodyRef} empty={<>Nothing here yet. Remember, chat isn&rsquo;t spoiler-gated.</>} />
    </Drawer>
  );
}
