// ============================================================
// Web Push, standard crypto only (push notifications CP1, 2026-11-05).
//
// Sends one encrypted message to a browser's push address (a "device" row
// in push_devices). Two standards do the work:
//   • RFC 8291 + RFC 8188 (aes128gcm): the message is encrypted to the
//     device's own key, so the push service in between can't read it.
//   • RFC 8292 (VAPID): a short signed token proves the message comes from
//     Sidebar's key pair (the public half is baked into the app; the private
//     half lives only in the VAPID_PRIVATE_KEY secret).
//
// Written against WebCrypto (crypto.subtle) and fetch only, so it runs the
// same in Deno (the edge runtime) and Node (its local test) with no
// dependency. Kept small on purpose: it was checked by a local round trip (encrypt here, decrypt with the device side of RFC 8291) before CP1 shipped.
// ============================================================

export type PushDevice = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };
export type PushResult = { ok: boolean; status: number; gone: boolean; detail?: string };

const enc = new TextEncoder();

export function b64urlToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** The VAPID private key (32 raw bytes, base64url) as a signing key; the
 *  public key (65 raw bytes) supplies x and y. */
async function vapidSigningKey(v: VapidKeys): Promise<CryptoKey> {
  const pub = b64urlToBytes(v.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID public key must be 65 raw bytes");
  const jwk: JsonWebKey = {
    kty: "EC", crv: "P-256", ext: false,
    d: v.privateKey,
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** The VAPID token for one push service (its origin is the audience). */
export async function vapidToken(endpoint: string, v: VapidKeys, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: v.subject })));
  const unsigned = `${header}.${claims}`;
  const key = await vapidSigningKey(v);
  // WebCrypto's ECDSA signature is already raw r||s, which is what ES256 wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned)));
  return `${unsigned}.${bytesToB64url(sig)}`;
}

/** Encrypt `plaintext` to the device (RFC 8291, one aes128gcm record).
 *  `salt` and `serverKeys` are only passed by the test. */
export async function encryptPayload(
  device: PushDevice, plaintext: Uint8Array,
  opts: { salt?: Uint8Array; serverKeys?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(device.p256dh);
  const authSecret = b64urlToBytes(device.auth);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const server = opts.serverKeys ?? (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", server.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, server.privateKey, 256));

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // One record: the text, then the last-record delimiter (0x02).
  const record = concat(plaintext, new Uint8Array([2]));
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, record));

  const rs = 4096;
  const head = new Uint8Array(16 + 4 + 1);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, rs);
  head[20] = asPublic.length;
  return concat(head, asPublic, cipher);
}

/** Send one message. A 404/410 means the device is gone for good (the
 *  person turned notifications off in the browser, or uninstalled): the
 *  caller deletes its row. */
export async function sendPush(
  device: PushDevice, payload: unknown, v: VapidKeys,
  opts: { ttlSec?: number; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string } = {},
): Promise<PushResult> {
  try {
    const body = await encryptPayload(device, enc.encode(JSON.stringify(payload)));
    const jwt = await vapidToken(device.endpoint, v);
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": String(opts.ttlSec ?? 3 * 3600),
      "Urgency": opts.urgency ?? "normal",
      "Authorization": `vapid t=${jwt}, k=${v.publicKey}`,
    };
    if (opts.topic) headers["Topic"] = opts.topic;
    const res = await fetch(device.endpoint, { method: "POST", headers, body });
    const detail = res.ok ? undefined : (await res.text().catch(() => "")).slice(0, 300);
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, detail };
  } catch (e) {
    return { ok: false, status: 0, gone: false, detail: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}
