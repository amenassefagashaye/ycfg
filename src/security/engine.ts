/**
 * @license
 * Eras-Birhan Pharmaceuticals Stock Management System (EBP-SMS)
 * Production Offline Security Engine
 * Cryptographic Authentication, AES-256-GCM Storage, Anti-Tampering, Device Authorization & Audit
 */

// Helper to access Web Crypto in both browser and Node.js environments
export function getCrypto(): Crypto {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  // In Node.js environment
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require('crypto');
    return nodeCrypto.webcrypto as Crypto;
  } catch {
    throw new Error('Web Crypto API not available in current environment');
  }
}

// Byte array to hex conversion
export function buf2hex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Hex string to byte array
export function hex2buf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Base64 encode
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Base64 decode
export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================================
// PART 3: OFFLINE PASSWORD HASHING (PBKDF2-HMAC-SHA-256)
// ============================================================

export const PBKDF2_ITERATIONS = 100000;
export const SALT_LENGTH = 16;
export const KEY_LENGTH = 32;

/**
 * Hash a password using PBKDF2-HMAC-SHA-256 with a unique random salt
 */
export async function hashPassword(
  password: string,
  saltHex?: string,
  iterations = PBKDF2_ITERATIONS
): Promise<{ hashString: string; saltHex: string; hashHex: string }> {
  const crypto = getCrypto();
  let salt: Uint8Array;
  if (saltHex) {
    salt = hex2buf(saltHex);
  } else {
    salt = new Uint8Array(SALT_LENGTH);
    crypto.getRandomValues(salt as any);
  }

  const enc = new TextEncoder();
  const passKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256'
    },
    passKey,
    KEY_LENGTH * 8
  );

  const derivedHex = buf2hex(derivedBits);
  const finalSaltHex = buf2hex(salt);
  const hashString = `pbkdf2:${iterations}:${finalSaltHex}:${derivedHex}`;

  return { hashString, saltHex: finalSaltHex, hashHex: derivedHex };
}

/**
 * Verify a candidate password against stored hash or legacy fallback
 */
export async function verifyPassword(
  candidate: string,
  storedHashOrPlain: string,
  legacyDefault?: string
): Promise<{ verified: boolean; needsUpgrade: boolean; newHashString?: string }> {
  if (!storedHashOrPlain) return { verified: false, needsUpgrade: false };

  // Check if already PBKDF2 format
  if (storedHashOrPlain.startsWith('pbkdf2:')) {
    const parts = storedHashOrPlain.split(':');
    if (parts.length === 4) {
      const iterations = parseInt(parts[1], 10);
      const saltHex = parts[2];
      const expectedHashHex = parts[3];

      const res = await hashPassword(candidate, saltHex, iterations);
      const verified = res.hashHex === expectedHashHex;
      return { verified, needsUpgrade: false };
    }
  }

  // Legacy plaintext match (backward compatibility for smooth upgrade)
  if (candidate === storedHashOrPlain || (legacyDefault && candidate === legacyDefault)) {
    const upgraded = await hashPassword(candidate);
    return { verified: true, needsUpgrade: true, newHashString: upgraded.hashString };
  }

  return { verified: false, needsUpgrade: false };
}

// ============================================================
// PART 5: LOCAL DATA ENCRYPTION (AES-256-GCM)
// ============================================================

export interface EncryptedPayload {
  v: number;
  alg: string;
  iv: string; // 12-byte hex
  tag: string; // 16-byte hex
  ct: string; // base64 ciphertext
}

/**
 * Derive an AES-256-GCM CryptoKey from a secret string and salt
 */
export async function deriveEncryptionKey(
  secret: string,
  saltHex: string
): Promise<CryptoKey> {
  const crypto = getCrypto();
  const enc = new TextEncoder();
  const salt = hex2buf(saltHex);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 50000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a serializable data object with AES-256-GCM using unique nonce
 */
export async function encryptRecord(
  data: unknown,
  key: CryptoKey
): Promise<EncryptedPayload> {
  const crypto = getCrypto();
  const enc = new TextEncoder();
  const plaintext = enc.encode(JSON.stringify(data));

  // Unique 12-byte IV for every encryption call (vital for GCM security)
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const ciphertextWithTag = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
      tagLength: 128
    },
    key,
    plaintext
  );

  const ctBytes = new Uint8Array(ciphertextWithTag);
  // In Web Crypto AES-GCM, the 16-byte authentication tag is appended at the end of ciphertext
  const tagBytes = ctBytes.slice(ctBytes.length - 16);
  const dataBytes = ctBytes.slice(0, ctBytes.length - 16);

  return {
    v: 1,
    alg: 'AES-256-GCM',
    iv: buf2hex(iv),
    tag: buf2hex(tagBytes),
    ct: bytesToBase64(dataBytes)
  };
}

/**
 * Decrypt an AES-256-GCM record and verify authenticity
 */
export async function decryptRecord<T = unknown>(
  payload: EncryptedPayload,
  key: CryptoKey
): Promise<T> {
  const crypto = getCrypto();
  const iv = hex2buf(payload.iv);
  const dataBytes = base64ToBytes(payload.ct);
  const tagBytes = hex2buf(payload.tag);

  // Recombine data and tag for Web Crypto SubtleCrypto.decrypt
  const combined = new Uint8Array(dataBytes.length + tagBytes.length);
  combined.set(dataBytes, 0);
  combined.set(tagBytes, dataBytes.length);

  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
      tagLength: 128
    },
    key,
    combined
  );

  const dec = new TextDecoder();
  return JSON.parse(dec.decode(decryptedBuffer)) as T;
}

// ============================================================
// PART 6 & 11: CRYPTOGRAPHIC HASH CHAIN & ANTI-TAMPER AUDIT
// ============================================================

export interface AuditRecord {
  id: number;
  timestamp: string;
  eventType: string;
  action: string;
  itemName?: string;
  itemId?: number;
  quantity?: number;
  branch: string;
  user: string;
  role: string;
  deviceId?: string;
  details?: Record<string, unknown> | string;
  prevHash: string;
  hash?: string;
}

/**
 * Compute SHA-256 hash of a text string
 */
export async function sha256(text: string): Promise<string> {
  const crypto = getCrypto();
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return buf2hex(digest);
}

/**
 * Compute tamper-evident hash for an audit record linked to prevHash
 */
export async function computeAuditHash(
  record: Omit<AuditRecord, 'hash'>
): Promise<string> {
  const payload = [
    record.id,
    record.timestamp,
    record.eventType,
    record.action,
    record.itemName || '',
    record.quantity || 0,
    record.branch,
    record.user,
    record.role,
    record.deviceId || '',
    typeof record.details === 'object' ? JSON.stringify(record.details) : record.details || '',
    record.prevHash
  ].join('|');

  return sha256(payload);
}

/**
 * Verify integrity of an entire hash-chained audit log
 */
export async function verifyAuditChain(
  chain: AuditRecord[]
): Promise<{ valid: boolean; brokenAtId?: number; totalChecked: number }> {
  if (!chain || chain.length === 0) {
    return { valid: true, totalChecked: 0 };
  }

  // Chain is stored in chronological order or reverse. If items have decreasing IDs, reverse it for check
  const sorted = [...chain].sort((a, b) => a.id - b.id);

  let expectedPrevHash = 'GENESIS_EBP_SMS_2026';

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];

    // Verify link to previous item
    if (i > 0) {
      if (item.prevHash !== expectedPrevHash) {
        return { valid: false, brokenAtId: item.id, totalChecked: i };
      }
    }

    // Verify self hash
    const computed = await computeAuditHash(item);
    if (item.hash && item.hash !== computed) {
      return { valid: false, brokenAtId: item.id, totalChecked: i };
    }

    expectedPrevHash = item.hash || computed;
  }

  return { valid: true, totalChecked: sorted.length };
}

// ============================================================
// PART 4: DEVICE AUTHORIZATION & RECOVERY
// ============================================================

export interface DeviceRecord {
  deviceId: string;
  deviceName: string;
  fingerprint: string;
  registeredAt: string;
  lastSeenAt: string;
  authorizedBy: string;
  status: 'authorized' | 'pending' | 'revoked';
  isPrimary?: boolean;
}

export function generateDeviceUUID(): string {
  const crypto = getCrypto();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // RFC4122 version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC4122 variant
  const hex = buf2hex(bytes);
  return `DEV-${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}`;
}

export function isDeviceAuthorized(
  currentDeviceId: string,
  devices: DeviceRecord[]
): boolean {
  if (!devices || devices.length === 0) return true; // First boot / initialization
  const found = devices.find(d => d.deviceId === currentDeviceId);
  return !!found && found.status === 'authorized';
}

// ============================================================
// PART 8: ROLE-BASED ACCESS CONTROL (RBAC)
// ============================================================

export type UserRole = 'admin' | 'user';

export type SensitiveOperation =
  | 'register_item'
  | 'edit_item'
  | 'process_sale'
  | 'deduct_stock'
  | 'verify_balance'
  | 'view_review'
  | 'view_audit'
  | 'update_audit_findings'
  | 'manage_settings'
  | 'export_data'
  | 'import_data'
  | 'backup_data'
  | 'restore_data'
  | 'clear_all_data'
  | 'manage_devices'
  | 'share_telegram';

const ROLE_PERMISSIONS: Record<UserRole, SensitiveOperation[]> = {
  admin: [
    'register_item',
    'edit_item',
    'process_sale',
    'deduct_stock',
    'verify_balance',
    'view_review',
    'view_audit',
    'update_audit_findings',
    'manage_settings',
    'export_data',
    'import_data',
    'backup_data',
    'restore_data',
    'clear_all_data',
    'manage_devices',
    'share_telegram'
  ],
  user: [
    'register_item',
    'process_sale',
    'deduct_stock',
    'export_data',
    'share_telegram'
  ]
};

export function checkPermission(
  role: UserRole | null | undefined,
  operation: SensitiveOperation
): boolean {
  if (!role) return false;
  const allowed = ROLE_PERMISSIONS[role] || [];
  return allowed.includes(operation);
}

// ============================================================
// PART 9: DATA THEFT & CSV/SPREADSHEET FORMULA INJECTION DEFENSE
// ============================================================

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Sanitize cell values against CSV/Excel formula injection (DDE attacks)
 */
export function sanitizeSpreadsheetCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = String(value);

  // If starts with trigger characters, prepend single quote
  if (str.length > 0 && FORMULA_TRIGGERS.includes(str.charAt(0))) {
    str = `'${str}`;
  }

  // Escape internal double quotes for CSV
  return `"${str.replace(/"/g, '""')}"`;
}

// ============================================================
// PART 3: RATE LIMITING & LOCKOUT TRACKER
// ============================================================

export interface LockoutState {
  failedAttempts: number;
  lockedUntil: number | null;
  lastAttempt: number | null;
}

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export function checkLoginRateLimit(
  state: LockoutState
): { allowed: boolean; remainingSeconds?: number; message?: string } {
  const now = Date.now();
  if (state.lockedUntil && now < state.lockedUntil) {
    const remainingSeconds = Math.ceil((state.lockedUntil - now) / 1000);
    return {
      allowed: false,
      remainingSeconds,
      message: `Account temporarily locked due to repeated failed logins. Please wait ${remainingSeconds} seconds.`
    };
  }
  return { allowed: true };
}

export function recordLoginAttempt(
  state: LockoutState,
  success: boolean
): LockoutState {
  const now = Date.now();
  if (success) {
    return { failedAttempts: 0, lockedUntil: null, lastAttempt: now };
  }

  const newAttempts = state.failedAttempts + 1;
  const lockedUntil = newAttempts >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_DURATION_MS : null;

  return {
    failedAttempts: newAttempts,
    lockedUntil,
    lastAttempt: now
  };
}
