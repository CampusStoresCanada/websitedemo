import type { EncryptedField, PlaceholderShape } from "./types";

// --- Server-side encryption (Node.js crypto) ---

/**
 * Generate a session-specific encryption key from user ID and a secret.
 * Uses HMAC-SHA256 to derive a 256-bit key.
 */
export async function generateSessionKey(
  userId: string,
  sessionSecret: string
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret + userId),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("csc-content-encryption"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * Export a CryptoKey to a base64 string for transmission to the client.
 */
export async function exportKeyToBase64(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey("raw", key);
  return bufferToBase64(exported);
}

/**
 * Import a base64 string back into a CryptoKey (client-side).
 */
export async function importKeyFromBase64(
  base64Key: string
): Promise<CryptoKey> {
  const keyBuffer = base64ToBuffer(base64Key);
  return crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

/**
 * Encrypt data using AES-256-GCM.
 */
export async function encryptPayload<T>(
  data: T,
  key: CryptoKey
): Promise<{ encrypted: string; iv: string }> {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(data));

  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );

  return {
    encrypted: bufferToBase64(ciphertext),
    iv: bufferToBase64(iv.buffer as ArrayBuffer),
  };
}

/**
 * Decrypt data using AES-256-GCM.
 */
export async function decryptPayload<T>(
  encrypted: string,
  iv: string,
  key: CryptoKey
): Promise<T> {
  const ciphertext = base64ToBuffer(encrypted);
  const ivBuffer = base64ToBuffer(iv);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBuffer },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintext)) as T;
}

/**
 * Create an encrypted field wrapper with placeholder metadata.
 * Server-side: encrypts the data and generates a placeholder shape.
 */
export async function createEncryptedField<T>(
  data: T,
  key: CryptoKey,
  placeholder: PlaceholderShape
): Promise<EncryptedField<T>> {
  const { encrypted, iv } = await encryptPayload(data, key);
  return { encrypted, iv, placeholder };
}

/**
 * Generate placeholder shape descriptors for blurred content previews.
 * These describe the structure of hidden content without revealing values.
 */
export function createPlaceholder(
  type: string,
  count: number,
  fieldWidths?: number[]
): PlaceholderShape {
  // Generate realistic-looking random widths if not provided
  const widths =
    fieldWidths ||
    Array.from({ length: count }, () => 60 + Math.floor(Math.random() * 140));

  return { type, count, fieldWidths: widths };
}

// --- Utility functions ---

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
