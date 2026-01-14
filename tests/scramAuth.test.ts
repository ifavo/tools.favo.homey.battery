/**
 * Tests for SCRAM Authentication
 */
import {
  pbkdf2SaltedPassword,
  hmacSha256,
  xorBuffers,
  clientProof,
  expectedServerSignatureB64,
  deriveProtocolKey,
  aesGcmEncrypt,
  buildAuthMessage,
} from '../logic/kostalApi/scramAuth';

describe('SCRAM Authentication', () => {
  describe('pbkdf2SaltedPassword', () => {
    test('generates consistent salted password', () => {
      const password = 'testpassword';
      const salt = Buffer.from('testsalt12345678');
      const rounds = 1000;

      const result1 = pbkdf2SaltedPassword(password, salt, rounds);
      const result2 = pbkdf2SaltedPassword(password, salt, rounds);

      expect(result1).toEqual(result2);
      expect(result1.length).toBe(32); // SHA-256 produces 32 bytes
    });

    test('different passwords produce different results', () => {
      const salt = Buffer.from('testsalt12345678');
      const rounds = 1000;

      const result1 = pbkdf2SaltedPassword('password1', salt, rounds);
      const result2 = pbkdf2SaltedPassword('password2', salt, rounds);

      expect(result1).not.toEqual(result2);
    });

    test('different salts produce different results', () => {
      const password = 'testpassword';
      const rounds = 1000;

      const result1 = pbkdf2SaltedPassword(password, Buffer.from('salt1234567890ab'), rounds);
      const result2 = pbkdf2SaltedPassword(password, Buffer.from('salt0987654321ab'), rounds);

      expect(result1).not.toEqual(result2);
    });
  });

  describe('hmacSha256', () => {
    test('generates consistent HMAC', () => {
      const key = Buffer.from('secretkey1234567');
      const message = 'test message';

      const result1 = hmacSha256(key, message);
      const result2 = hmacSha256(key, message);

      expect(result1).toEqual(result2);
      expect(result1.length).toBe(32);
    });

    test('different keys produce different results', () => {
      const message = 'test message';

      const result1 = hmacSha256(Buffer.from('key1234567890123'), message);
      const result2 = hmacSha256(Buffer.from('key0987654321098'), message);

      expect(result1).not.toEqual(result2);
    });
  });

  describe('xorBuffers', () => {
    test('XORs two equal-length buffers', () => {
      const a = Buffer.from([0x12, 0x34, 0x56, 0x78]);
      const b = Buffer.from([0x11, 0x22, 0x33, 0x44]);

      const result = xorBuffers(a, b);

      expect(result).toEqual(Buffer.from([0x03, 0x16, 0x65, 0x3c]));
    });

    test('handles different length buffers (uses shorter)', () => {
      const a = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a]);
      const b = Buffer.from([0x11, 0x22, 0x33]);

      const result = xorBuffers(a, b);

      expect(result.length).toBe(3);
    });

    test('XOR with same buffer produces zeros', () => {
      const a = Buffer.from([0x12, 0x34, 0x56, 0x78]);

      const result = xorBuffers(a, a);

      expect(result).toEqual(Buffer.from([0x00, 0x00, 0x00, 0x00]));
    });
  });

  describe('clientProof', () => {
    test('generates client proof components', () => {
      const password = 'testpassword';
      const salt = Buffer.from('testsalt12345678');
      const rounds = 1000;
      const authMsg = 'n=user,r=abc123,r=abc123xyz,s=dGVzdHNhbHQxMjM0NTY3OA==,i=1000,c=biws,r=abc123xyz';

      const result = clientProof(password, salt, rounds, authMsg);

      expect(result.salted).toBeDefined();
      expect(result.clientKey).toBeDefined();
      expect(result.storedKey).toBeDefined();
      expect(result.proof).toBeDefined();
      expect(typeof result.proof).toBe('string');
      expect(result.salted.length).toBe(32);
      expect(result.clientKey.length).toBe(32);
      expect(result.storedKey.length).toBe(32);
    });

    test('same inputs produce same proof', () => {
      const password = 'testpassword';
      const salt = Buffer.from('testsalt12345678');
      const rounds = 1000;
      const authMsg = 'test-auth-message';

      const result1 = clientProof(password, salt, rounds, authMsg);
      const result2 = clientProof(password, salt, rounds, authMsg);

      expect(result1.proof).toBe(result2.proof);
    });
  });

  describe('expectedServerSignatureB64', () => {
    test('generates server signature', () => {
      const salted = pbkdf2SaltedPassword('testpassword', Buffer.from('testsalt12345678'), 1000);
      const authMsg = 'test-auth-message';

      const signature = expectedServerSignatureB64(salted, authMsg);

      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);
    });

    test('same inputs produce same signature', () => {
      const salted = pbkdf2SaltedPassword('testpassword', Buffer.from('testsalt12345678'), 1000);
      const authMsg = 'test-auth-message';

      const sig1 = expectedServerSignatureB64(salted, authMsg);
      const sig2 = expectedServerSignatureB64(salted, authMsg);

      expect(sig1).toBe(sig2);
    });
  });

  describe('deriveProtocolKey', () => {
    test('derives protocol key', () => {
      const storedKey = Buffer.alloc(32, 0x42);
      const authMsg = 'test-auth-message';
      const clientKey = Buffer.alloc(32, 0x24);

      const protocolKey = deriveProtocolKey(storedKey, authMsg, clientKey);

      expect(protocolKey).toBeDefined();
      expect(protocolKey.length).toBe(32);
    });
  });

  describe('aesGcmEncrypt', () => {
    test('encrypts data and returns iv, tag, and payload', () => {
      const plainText = 'test-token-12345';
      const key = Buffer.alloc(32, 0x42);

      const result = aesGcmEncrypt(plainText, key);

      expect(result.iv).toBeDefined();
      expect(result.tag).toBeDefined();
      expect(result.payload).toBeDefined();
      expect(typeof result.iv).toBe('string');
      expect(typeof result.tag).toBe('string');
      expect(typeof result.payload).toBe('string');
    });

    test('produces different iv each time (random)', () => {
      const plainText = 'test-token-12345';
      const key = Buffer.alloc(32, 0x42);

      const result1 = aesGcmEncrypt(plainText, key);
      const result2 = aesGcmEncrypt(plainText, key);

      // IVs should be different (random)
      expect(result1.iv).not.toBe(result2.iv);
    });
  });

  describe('buildAuthMessage', () => {
    test('builds correct auth message format', () => {
      const role = 'user';
      const cNonce = 'clientnonce123';
      const sNonce = 'servernonce456';
      const saltB64 = 'c2FsdHZhbHVl';
      const iterations = 10000;

      const authMsg = buildAuthMessage(role, cNonce, sNonce, saltB64, iterations);

      expect(authMsg).toContain(`n=${role}`);
      expect(authMsg).toContain(`r=${cNonce}`);
      expect(authMsg).toContain(`r=${sNonce}`);
      expect(authMsg).toContain(`s=${saltB64}`);
      expect(authMsg).toContain(`i=${iterations}`);
      expect(authMsg).toContain('c=biws');
    });
  });
});

