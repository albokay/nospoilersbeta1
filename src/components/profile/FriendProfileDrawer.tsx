/**
 * FriendProfileDrawer — THE desktop friend profile since 2026-09-08 pt 4:
 * clicking a friend's name slides this in from the right (the chat box's
 * geometry), yellow like the profile world, holding the narrow profile body
 * (canon + shelves + group actions). X closes it; so does any navigation
 * (opening a room or a group chat from inside it).
 * The full-page /pool/:username is retired — Sidebar is friends-only, so
 * there's no signed-out profile viewing on desktop. Mobile keeps its
 * full-screen surface (MobilePool), matching the mobile chat box.
 * Mounted by the pages that host name clicks (dashboard + show room);
 * opened from anywhere via openFriendProfile(username) (friendProfileBus).
 */
import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { CANON } from "../../styles/canon";
import { useAuth } from "../../lib/auth";
import { fetchPublicProfileByUsername, fetchContactNames } from "../../lib/db";
import LoadingDots from "../LoadingDots";
import FriendProfile from "./FriendProfile";
import { onOpenFriendProfile } from "./friendProfileBus";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

export default function FriendProfileDrawer() {
  const { user } = useAuth();
  const [username, setUsername] = useState<string | null>(null);
  // The username the resolved answer below is FOR — renders the loading line
  // until they match (no "couldn't find" flash, idempotent re-opens).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState<string>("");

  useEffect(() => onOpenFriendProfile((u) => setUsername(u)), []);

  // Navigating anywhere (open your room, open the group chat) closes it.
  const location = useLocation();
  const locKey = `${location.pathname}${location.search}`;
  const lastLoc = useRef(locKey);
  useEffect(() => {
    if (locKey !== lastLoc.current) { lastLoc.current = locKey; setUsername(null); }
  }, [locKey]);

  useEffect(() => {
    if (!username || loadedFor === username) return;
    let cancelled = false;
    (async () => {
      try {
        const prof = await fetchPublicProfileByUsername(username);
        if (!prof) { if (!cancelled) { setNotFound(true); setOwnerId(null); setLoadedFor(username); } return; }
        const cn = user ? await fetchContactNames(user.id).catch(() => ({} as Record<string, string>)) : {};
        if (cancelled) return;
        setOwnerId(prof.id);
        // Name chain (naming arc): viewer's contact name → their self-chosen
        // first name → the @handle.
        setOwnerName(cn[prof.id] ?? prof.displayName ?? `@${username}`);
        setNotFound(false);
        setLoadedFor(username);
      } catch { if (!cancelled) { setNotFound(true); setOwnerId(null); setLoadedFor(username); } }
    })();
    return () => { cancelled = true; };
  }, [username, loadedFor, user?.id]);

  if (!username) return null;
  const ready = loadedFor === username;
  return (
    <div style={panel}>
      <button style={closeX} title="close" onClick={() => setUsername(null)}>
        <X size={20} color={CANON.cream} />
      </button>
      <div style={{ padding: "56px 20px 48px", boxSizing: "border-box" }}>
        {!ready ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }} aria-busy="true">
            <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, color: CANON.cream }}>loading<LoadingDots /></span>
          </div>
        ) : notFound || !ownerId ? (
          <div style={{ textAlign: "center", marginTop: 40, color: CANON.cream, fontFamily: LORA, fontSize: 22, fontWeight: 700 }}>
            We couldn&rsquo;t find that person.
          </div>
        ) : (
          <FriendProfile ownerId={ownerId} ownerName={ownerName} narrow />
        )}
      </div>
    </div>
  );
}

const panel: React.CSSProperties = {
  // The chat box's geometry (chatPanel), yellow like the profile world; one
  // notch above the chat panel's z (70) so the drawer covers it when both
  // are up, and under the profile's own bubbles/cards (1000+).
  position: "fixed", top: 0, right: 0, bottom: 0, width: "min(440px, 44vw)",
  background: CANON.accent, zIndex: 80, boxShadow: "-12px 0 30px rgba(0,0,0,0.18)",
  overflowY: "auto",
};
const closeX: React.CSSProperties = {
  // Fixed (not absolute) so it stays put while the panel scrolls.
  position: "fixed", top: 16, right: 16, zIndex: 81, border: "none",
  background: "transparent", cursor: "pointer", padding: 6, lineHeight: 0,
};
