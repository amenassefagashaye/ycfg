import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  deriveEncryptionKey,
  encryptRecord,
  decryptRecord,
  sha256,
  computeAuditHash,
  verifyAuditChain,
  AuditRecord,
  checkPermission,
  sanitizeSpreadsheetCell,
  checkLoginRateLimit,
  recordLoginAttempt,
  LockoutState,
  generateDeviceUUID,
  isDeviceAuthorized,
  DeviceRecord
} from './security/engine';

test('PBKDF2 password hashing & verification', async () => {
  const pwd = 'TestPassword!2026';
  const hashed = await hashPassword(pwd);

  assert.ok(hashed.hashString.startsWith('pbkdf2:100000:'));
  assert.equal(hashed.saltHex.length, 32); // 16 bytes = 32 hex chars

  // Correct verification
  const checkPass = await verifyPassword(pwd, hashed.hashString);
  assert.equal(checkPass.verified, true);
  assert.equal(checkPass.needsUpgrade, false);

  // Wrong password
  const checkFail = await verifyPassword('WrongPassword', hashed.hashString);
  assert.equal(checkFail.verified, false);

  // Legacy plaintext backward compatibility & upgrade
  const legacyCheck = await verifyPassword('kpi2123', 'kpi2123');
  assert.equal(legacyCheck.verified, true);
  assert.equal(legacyCheck.needsUpgrade, true);
  assert.ok(legacyCheck.newHashString?.startsWith('pbkdf2:'));
});

test('AES-256-GCM record encryption, decryption and authentication tag check', async () => {
  const key = await deriveEncryptionKey('super-session-secret', '0123456789abcdef0123456789abcdef');
  const record = {
    id: 101,
    name: 'Amoxicillin 500mg',
    price: 150.75,
    batch: 'BATCH-2026-X'
  };

  const encrypted = await encryptRecord(record, key);
  assert.equal(encrypted.alg, 'AES-256-GCM');
  assert.equal(encrypted.iv.length, 24); // 12 bytes = 24 hex
  assert.equal(encrypted.tag.length, 32); // 16 bytes = 32 hex
  assert.ok(encrypted.ct.length > 0);

  // Decrypt successfully
  const decrypted = await decryptRecord<typeof record>(encrypted, key);
  assert.deepEqual(decrypted, record);

  // Tamper detection: modify ciphertext and expect failure
  const tampered = { ...encrypted, ct: encrypted.ct.slice(0, -4) + 'AAAA' };
  await assert.rejects(
    async () => {
      await decryptRecord(tampered, key);
    },
    /operation failed|bad decrypt|tag mismatch|failed/i
  );
});

test('Audit log hash-chain integrity & tamper detection', async () => {
  const log1: AuditRecord = {
    id: 1,
    timestamp: '2026-11-04T10:00:00Z',
    eventType: 'login',
    action: 'admin_login',
    branch: 'pharmacy',
    user: 'admin',
    role: 'admin',
    prevHash: 'GENESIS_EBP_SMS_2026'
  };
  log1.hash = await computeAuditHash(log1);

  const log2: AuditRecord = {
    id: 2,
    timestamp: '2026-11-04T10:05:00Z',
    eventType: 'purchase',
    action: 'stock_in',
    itemName: 'Paracetamol',
    quantity: 50,
    branch: 'pharmacy',
    user: 'admin',
    role: 'admin',
    details: { cost: 500 },
    prevHash: log1.hash
  };
  log2.hash = await computeAuditHash(log2);

  const log3: AuditRecord = {
    id: 3,
    timestamp: '2026-11-04T10:10:00Z',
    eventType: 'sale',
    action: 'stock_out',
    itemName: 'Paracetamol',
    quantity: 10,
    branch: 'pharmacy',
    user: 'admin',
    role: 'admin',
    details: { total: 150 },
    prevHash: log2.hash
  };
  log3.hash = await computeAuditHash(log3);

  const chain = [log1, log2, log3];
  const check = await verifyAuditChain(chain);
  assert.equal(check.valid, true);
  assert.equal(check.totalChecked, 3);

  // Tamper log 2 quantity and expect verification to fail
  const tamperedChain = [log1, { ...log2, quantity: 9999 }, log3];
  const tamperedCheck = await verifyAuditChain(tamperedChain);
  assert.equal(tamperedCheck.valid, false);
  assert.equal(tamperedCheck.brokenAtId, 2);
});

test('Spreadsheet formula injection sanitization', () => {
  assert.equal(sanitizeSpreadsheetCell('=1+1'), '"\'=1+1"');
  assert.equal(sanitizeSpreadsheetCell('+cmd|/c calc'), '"\'+cmd|/c calc"');
  assert.equal(sanitizeSpreadsheetCell('-SUM(A1:A10)'), '"\'-SUM(A1:A10)"');
  assert.equal(sanitizeSpreadsheetCell('@evil.com'), '"\'@evil.com"');
  assert.equal(sanitizeSpreadsheetCell('Regular Medicine Name'), '"Regular Medicine Name"');
  assert.equal(sanitizeSpreadsheetCell('Normal "Quoted" Item'), '"Normal ""Quoted"" Item"');
});

test('Rate limiting and temporary account lockout', () => {
  let state: LockoutState = { failedAttempts: 0, lockedUntil: null, lastAttempt: null };

  // First 4 failed attempts should still be allowed
  for (let i = 1; i <= 4; i++) {
    state = recordLoginAttempt(state, false);
    const check = checkLoginRateLimit(state);
    assert.equal(check.allowed, true);
    assert.equal(state.failedAttempts, i);
  }

  // 5th failed attempt triggers lockout
  state = recordLoginAttempt(state, false);
  const lockedCheck = checkLoginRateLimit(state);
  assert.equal(lockedCheck.allowed, false);
  assert.ok(lockedCheck.remainingSeconds! > 0);

  // Successful login resets attempts
  state = recordLoginAttempt(state, true);
  assert.equal(state.failedAttempts, 0);
  assert.equal(state.lockedUntil, null);
  assert.equal(checkLoginRateLimit(state).allowed, true);
});

test('Device authorization check and device UUID generation', () => {
  const uuid = generateDeviceUUID();
  assert.ok(uuid.startsWith('DEV-'));

  const devices: DeviceRecord[] = [
    {
      deviceId: uuid,
      deviceName: 'Admin Primary Terminal',
      fingerprint: 'fp-1234',
      registeredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      authorizedBy: 'Master Admin',
      status: 'authorized',
      isPrimary: true
    },
    {
      deviceId: 'DEV-ROGUE-000',
      deviceName: 'Unknown Device',
      fingerprint: 'fp-rogue',
      registeredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      authorizedBy: 'none',
      status: 'revoked'
    }
  ];

  assert.equal(isDeviceAuthorized(uuid, devices), true);
  assert.equal(isDeviceAuthorized('DEV-ROGUE-000', devices), false);
  assert.equal(isDeviceAuthorized('DEV-UNKNOWN', devices), false);
});

test('Role-Based Access Control (RBAC) permission validation', () => {
  // Admin has full access
  assert.equal(checkPermission('admin', 'manage_settings'), true);
  assert.equal(checkPermission('admin', 'clear_all_data'), true);
  assert.equal(checkPermission('admin', 'view_audit'), true);
  assert.equal(checkPermission('admin', 'view_review'), true);

  // Ordinary user has operational access only
  assert.equal(checkPermission('user', 'register_item'), true);
  assert.equal(checkPermission('user', 'process_sale'), true);
  assert.equal(checkPermission('user', 'deduct_stock'), true);
  assert.equal(checkPermission('user', 'manage_settings'), false);
  assert.equal(checkPermission('user', 'clear_all_data'), false);
  assert.equal(checkPermission('user', 'view_audit'), false);
  assert.equal(checkPermission('user', 'view_review'), false);

  // Unauthenticated user has zero permissions
  assert.equal(checkPermission(null, 'register_item'), false);
  assert.equal(checkPermission(undefined, 'process_sale'), false);
});
