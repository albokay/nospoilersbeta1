/**
 * push — notifications on this device (push notifications CP1, 2026-11-05).
 *
 * One switch per device, in the account card: a phone and a laptop are
 * turned on and off separately (the permission belongs to the device).
 * Turning it on asks the browser, registers the background worker
 * (public/sw.js, push only), and saves this device's push address
 * (save_push_device). Turning it off, or signing out, forgets the device.
 *
 * iPhones only get web push inside the installed app (Home Screen); in a
 * Safari tab the card points to the "Get Sidebar as an app" drawer instead.
 */
import { supabase } from "./supabaseClient";
import { isStandalone } from "./installPrompt";

/** The public half of Sidebar's key pair (the private half is the
 *  VAPID_PRIVATE_KEY secret on the send-pushes function). Public by design;
 *  send-pushes carries the same string. */
export const VAPID_PUBLIC_KEY = "BEy3WeEFKAm1M-dRFil1GlxWYC_2-KyMF8srQj15R8DgHvluVlUZ1--5GSpvxu5DlrtAcrlBJWoZGgsnJQZ3gZM";

export type PushState =
  | "unsupported"    // this browser has no web push
  | "needs-install"  // an iPhone/iPad outside the installed app
  | "blocked"        // the person said no in the browser; only its settings can undo it
  | "off"
  | "on";

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function supported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

async function existingSubscription(): Promise<PushSubscription | null> {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

async function saveDevice(sub: PushSubscription): Promise<void> {
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  let tz: string | null = null;
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null; } catch { /* tolerate */ }
  const { error } = await supabase.rpc("save_push_device", {
    p_endpoint: j.endpoint ?? "",
    p_p256dh: j.keys?.p256dh ?? "",
    p_auth: j.keys?.auth ?? "",
    p_time_zone: tz,
    p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

/** Where this device stands. */
export async function pushState(): Promise<PushState> {
  if (isIOS() && !isStandalone()) return "needs-install";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  try {
    return (await existingSubscription()) ? "on" : "off";
  } catch {
    return "off";
  }
}

/** Turn this device on. Call straight from the tap: iPhones only show the
 *  permission question in direct answer to one, so it's asked first. */
export async function turnPushOn(): Promise<PushState> {
  if (!supported()) return isIOS() && !isStandalone() ? "needs-install" : "unsupported";
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  const reg = await navigator.serviceWorker.ready;
  const key = keyBytes(VAPID_PUBLIC_KEY);
  let sub = await reg.pushManager.getSubscription();
  // An address made with another key pair can't be reused; start fresh.
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
    try { await sub.unsubscribe(); } catch { /* tolerate */ }
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  try {
    await saveDevice(sub);
  } catch (e) {
    // Not saved means nothing will ever arrive: don't leave it half on.
    try { await sub.unsubscribe(); } catch { /* tolerate */ }
    throw e;
  }
  return "on";
}

/** Turn this device off: forget it on Sidebar's side, then in the browser. */
export async function turnPushOff(): Promise<PushState> {
  const sub = await existingSubscription();
  if (sub) {
    try { await supabase.from("push_devices").delete().eq("endpoint", sub.endpoint); } catch { /* tolerate */ }
    try { await sub.unsubscribe(); } catch { /* tolerate */ }
  }
  return pushState();
}

/** Sign-out: the device stops getting this account's pushes. Never holds
 *  sign-out up for long, never throws. */
export async function pushOffForSignOut(): Promise<void> {
  try {
    if (!supported() || !(await navigator.serviceWorker.getRegistration("/"))) return;
    await Promise.race([turnPushOff(), new Promise((r) => setTimeout(r, 1500))]);
  } catch { /* tolerate */ }
}

/** On sign-in: a device that's on is saved again under whoever is signed in
 *  now (a device that changed hands moves to the new account; the time zone
 *  stays current). Quiet; never asks anything. */
export async function syncPushDevice(): Promise<void> {
  try {
    if (!supported() || Notification.permission !== "granted") return;
    const sub = await existingSubscription();
    if (sub) await saveDevice(sub);
  } catch { /* tolerate */ }
}

/** The test push (admins, account card): one notification to every device
 *  this account has turned on. Returns how many it reached. */
export async function sendTestPush(): Promise<{ sent: number; devices: number }> {
  const { data, error } = await supabase.functions.invoke("send-pushes", { body: { test: true } });
  if (error) throw error;
  const results = Array.isArray(data?.results) ? data.results : [];
  return { sent: Number(data?.sent ?? 0), devices: results.length };
}
