/**
 * End-to-end encryption for Direct Messages using ECDH + AES-GCM.
 *
 * How it works:
 *  1. Each user generates an ECDH P-256 key pair on first DM use.
 *  2. The public key (JWK) is stored in users.e2e_public_key in the DB.
 *  3. The private key is stored in localStorage (per-device).
 *  4. To encrypt a message to Person B:
 *       - Fetch Person B's public key from DB
 *       - Derive a shared AES key via ECDH(myPriv, theirPub)
 *       - Encrypt with AES-GCM → store IV + ciphertext (base64) in messages.content
 *  5. To decrypt: derive the same shared key and AES-GCM decrypt.
 *
 * Both sides can derive the identical shared secret independently — no
 * real-time key exchange needed.
 */

const CURVE = "P-256";
const LS_PRIV_KEY_PREFIX = "sw_e2e_priv_";   // localStorage key: sw_e2e_priv_<userId>
const LS_PUB_KEY_PREFIX  = "sw_e2e_pub_";    // localStorage key: sw_e2e_pub_<userId>

// ── Key generation ────────────────────────────────────────────

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: CURVE },
    true,
    ["deriveKey"]
  );
}

export async function exportPublicKeyJwk(pub: CryptoKey): Promise<string> {
  return JSON.stringify(await crypto.subtle.exportKey("jwk", pub));
}

export async function importPublicKeyJwk(jwk: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    JSON.parse(jwk),
    { name: "ECDH", namedCurve: CURVE },
    true,
    []
  );
}

export async function exportPrivateKeyJwk(priv: CryptoKey): Promise<string> {
  return JSON.stringify(await crypto.subtle.exportKey("jwk", priv));
}

export async function importPrivateKeyJwk(jwk: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    JSON.parse(jwk),
    { name: "ECDH", namedCurve: CURVE },
    true,
    ["deriveKey"]
  );
}

// ── Persistent key storage (localStorage) ────────────────────

export async function storeKeyPair(userId: string, pair: CryptoKeyPair): Promise<void> {
  const [pub, priv] = await Promise.all([
    exportPublicKeyJwk(pair.publicKey),
    exportPrivateKeyJwk(pair.privateKey),
  ]);
  localStorage.setItem(LS_PUB_KEY_PREFIX  + userId, pub);
  localStorage.setItem(LS_PRIV_KEY_PREFIX + userId, priv);
}

export async function loadPrivateKey(userId: string): Promise<CryptoKey | null> {
  const jwk = localStorage.getItem(LS_PRIV_KEY_PREFIX + userId);
  if (!jwk) return null;
  try {
    return await importPrivateKeyJwk(jwk);
  } catch {
    return null;
  }
}

export function loadStoredPublicKeyJwk(userId: string): string | null {
  return localStorage.getItem(LS_PUB_KEY_PREFIX + userId);
}

// ── High-level: load or create key pair ──────────────────────

/**
 * Returns the existing key pair from localStorage, or generates a new one.
 * Also returns the public key JWK so the caller can persist it to the DB.
 */
export async function loadOrGenerateKeyPair(
  userId: string
): Promise<{ pair: CryptoKeyPair; publicKeyJwk: string; isNew: boolean }> {
  const storedPub  = loadStoredPublicKeyJwk(userId);
  const storedPriv = await loadPrivateKey(userId);

  if (storedPub && storedPriv) {
    const pubKey = await importPublicKeyJwk(storedPub);
    return {
      pair: { publicKey: pubKey, privateKey: storedPriv },
      publicKeyJwk: storedPub,
      isNew: false,
    };
  }

  const pair = await generateKeyPair();
  const publicKeyJwk = await exportPublicKeyJwk(pair.publicKey);
  await storeKeyPair(userId, pair);
  return { pair, publicKeyJwk, isNew: true };
}

// ── Shared key derivation ─────────────────────────────────────

async function deriveSharedKey(myPrivKey: CryptoKey, theirPubKey: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: theirPubKey },
    myPrivKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ── Encrypt / decrypt ─────────────────────────────────────────

interface EncryptedPayload {
  iv: string;   // base64
  ct: string;   // base64 ciphertext
}

export async function encryptDM(
  plaintext: string,
  myPrivKey: CryptoKey,
  theirPubKeyJwk: string
): Promise<string> {
  const theirPub   = await importPublicKeyJwk(theirPubKeyJwk);
  const sharedKey  = await deriveSharedKey(myPrivKey, theirPub);
  const iv         = crypto.getRandomValues(new Uint8Array(12));
  const encoded    = new TextEncoder().encode(plaintext);
  const cipherBuf  = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, encoded);

  const payload: EncryptedPayload = {
    iv: bufToBase64(iv),
    ct: bufToBase64(new Uint8Array(cipherBuf)),
  };
  return JSON.stringify(payload);
}

export async function decryptDM(
  encryptedJson: string,
  myPrivKey: CryptoKey,
  theirPubKeyJwk: string
): Promise<string> {
  const { iv, ct } = JSON.parse(encryptedJson) as EncryptedPayload;
  const theirPub   = await importPublicKeyJwk(theirPubKeyJwk);
  const sharedKey  = await deriveSharedKey(myPrivKey, theirPub);
  const ivBuf      = base64ToBuf(iv).buffer as ArrayBuffer;
  const ctBuf      = base64ToBuf(ct).buffer as ArrayBuffer;
  const plainBuf   = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBuf }, sharedKey, ctBuf);
  return new TextDecoder().decode(plainBuf);
}

// ── Utils ─────────────────────────────────────────────────────

function bufToBase64(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf));
}

function base64ToBuf(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
