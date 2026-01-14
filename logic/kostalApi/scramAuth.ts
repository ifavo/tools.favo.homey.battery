/**
 * SCRAM Authentication for Kostal Inverter
 * Implements SCRAM-SHA256 authentication as used by Kostal Web UI
 */
import crypto from 'crypto';
import type { AuthStartResponse, AuthFinishResponse, SessionResponse } from './types';

/**
 * Derive salted password using PBKDF2-SHA256
 */
export function pbkdf2SaltedPassword(
  password: string,
  saltBytes: Buffer,
  rounds: number,
): Buffer {
  return crypto.pbkdf2Sync(password, saltBytes, rounds, 32, 'sha256');
}

/**
 * Calculate HMAC-SHA256
 */
export function hmacSha256(keyBytes: Buffer, msg: string): Buffer {
  return crypto.createHmac('sha256', keyBytes).update(msg, 'utf8').digest();
}

/**
 * XOR two buffers
 */
export function xorBuffers(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.alloc(Math.min(a.length, b.length));
  for (let i = 0; i < out.length; i++) {
    out[i] = a[i] ^ b[i];
  }
  return out;
}

/**
 * Calculate client proof for SCRAM authentication
 */
export function clientProof(
  password: string,
  saltBytes: Buffer,
  rounds: number,
  authMsg: string,
): { salted: Buffer; clientKey: Buffer; storedKey: Buffer; proof: string } {
  const salted = pbkdf2SaltedPassword(password, saltBytes, rounds);
  const clientKey = hmacSha256(salted, 'Client Key');
  const storedKey = crypto.createHash('sha256').update(clientKey).digest();
  const clientSignature = crypto
    .createHmac('sha256', storedKey)
    .update(authMsg, 'utf8')
    .digest();

  const proof = xorBuffers(clientKey, clientSignature).toString('base64');
  return { salted, clientKey, storedKey, proof };
}

/**
 * Calculate expected server signature for verification
 */
export function expectedServerSignatureB64(
  salted: Buffer,
  authMsg: string,
): string {
  const serverKey = hmacSha256(salted, 'Server Key');
  return crypto
    .createHmac('sha256', serverKey)
    .update(authMsg, 'utf8')
    .digest('base64');
}

/**
 * Derive protocol key for session encryption
 * protocolKey = HMAC(storedKey, "Session Key" || authMsg || clientKey)
 */
export function deriveProtocolKey(
  storedKey: Buffer,
  authMsg: string,
  clientKey: Buffer,
): Buffer {
  const h = crypto.createHmac('sha256', storedKey);
  h.update('Session Key', 'utf8');
  h.update(authMsg, 'utf8');
  h.update(clientKey);
  return h.digest();
}

/**
 * Encrypt token using AES-256-GCM
 */
export function aesGcmEncrypt(
  plainText: string,
  keyBytes: Buffer,
): { iv: string; tag: string; payload: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, iv);

  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plainText, 'utf8')),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    payload: ciphertext.toString('base64'),
  };
}

/**
 * Build the auth message string for SCRAM
 */
export function buildAuthMessage(
  role: string,
  cNonce: string,
  sNonce: string,
  saltB64: string,
  iterations: number,
): string {
  return `n=${role},r=${cNonce},r=${sNonce},s=${saltB64},i=${iterations},c=biws,r=${sNonce}`;
}

/**
 * Perform full SCRAM authentication flow
 * Returns session ID on success
 */
export async function performScramAuth(
  ip: string,
  password: string,
  role: string = 'user',
): Promise<string> {
  // Step 1: Start authentication
  const cNonce = crypto.randomBytes(12).toString('base64');
  const startResponse = await fetch(`http://${ip}/api/v1/auth/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: role, nonce: cNonce }),
  });

  if (!startResponse.ok) {
    const text = await startResponse.text();
    throw new Error(`Auth start failed (${startResponse.status}): ${text}`);
  }

  const start = await startResponse.json() as AuthStartResponse;
  const { transactionId: txId, nonce: sNonce, salt: saltB64, rounds } = start;

  const saltBytes = Buffer.from(saltB64, 'base64');
  const iterations = parseInt(rounds, 10);

  // Build auth message
  const authMsg = buildAuthMessage(role, cNonce, sNonce, saltB64, iterations);

  // Calculate client proof
  const { salted, clientKey, storedKey, proof } = clientProof(
    password,
    saltBytes,
    iterations,
    authMsg,
  );

  // Step 2: Finish authentication
  const finishResponse = await fetch(`http://${ip}/api/v1/auth/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId: txId, proof }),
  });

  if (!finishResponse.ok) {
    const text = await finishResponse.text();
    throw new Error(`Auth finish failed (${finishResponse.status}): ${text}`);
  }

  const finish = await finishResponse.json() as AuthFinishResponse;

  if (!finish.token) {
    throw new Error('No token received from auth/finish');
  }

  // Verify server signature if provided
  if (finish.signature) {
    const expected = expectedServerSignatureB64(salted, authMsg);
    if (expected !== finish.signature) {
      throw new Error('Server signature mismatch - authentication invalid');
    }
  }

  // Step 3: Create session
  const protocolKey = deriveProtocolKey(storedKey, authMsg, clientKey);
  const encrypted = aesGcmEncrypt(finish.token, protocolKey);

  const sessionResponse = await fetch(`http://${ip}/api/v1/auth/create_session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transactionId: txId,
      iv: encrypted.iv,
      tag: encrypted.tag,
      payload: encrypted.payload,
    }),
  });

  if (!sessionResponse.ok) {
    const text = await sessionResponse.text();
    throw new Error(`Session creation failed (${sessionResponse.status}): ${text}`);
  }

  const session = await sessionResponse.json() as SessionResponse;

  if (!session.sessionId) {
    throw new Error('No sessionId received from auth/create_session');
  }

  return session.sessionId;
}

