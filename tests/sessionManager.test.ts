/**
 * Tests for Session Manager
 */
import { SessionManager, SessionStorage } from '../logic/kostalApi/sessionManager';

// Mock the scramAuth module
jest.mock('../logic/kostalApi/scramAuth', () => ({
  performScramAuth: jest.fn(),
}));

import { performScramAuth } from '../logic/kostalApi/scramAuth';

describe('SessionManager', () => {
  let mockStorage: SessionStorage;
  let storeValues: Record<string, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    storeValues = {};

    mockStorage = {
      getStoreValue: jest.fn((key: string) => storeValues[key]),
      setStoreValue: jest.fn(async (key: string, value: unknown) => {
        storeValues[key] = value;
      }),
      log: jest.fn(),
      error: jest.fn(),
    };
  });

  describe('getSession', () => {
    test('returns cached session if available in memory', async () => {
      const sessionManager = new SessionManager('192.168.1.100', 'password', mockStorage);

      // Pre-populate the store with a session
      storeValues['_kostal_session'] = {
        sessionId: 'cached-session-123',
        createdAt: Date.now(),
      };

      // First call loads from storage into memory
      await sessionManager.getSession();

      // Second call should use in-memory cache (line 50)
      const session = await sessionManager.getSession();

      expect(session).toBe('cached-session-123');
      expect(performScramAuth).not.toHaveBeenCalled();
    });

    test('authenticates if no cached session', async () => {
      (performScramAuth as jest.Mock).mockResolvedValue('new-session-456');

      const sessionManager = new SessionManager('192.168.1.100', 'password', mockStorage);

      const session = await sessionManager.getSession();

      expect(session).toBe('new-session-456');
      expect(performScramAuth).toHaveBeenCalledWith('192.168.1.100', 'password', 'user');
      expect(storeValues['_kostal_session']).toEqual(
        expect.objectContaining({
          sessionId: 'new-session-456',
        }),
      );
    });

    test('throws error if credentials not configured', async () => {
      const sessionManager = new SessionManager('', '', mockStorage);

      await expect(sessionManager.getSession()).rejects.toThrow(
        'Inverter IP or password not configured',
      );
    });
  });

  describe('invalidateSession', () => {
    test('clears cached session', async () => {
      const sessionManager = new SessionManager('192.168.1.100', 'password', mockStorage);

      storeValues['_kostal_session'] = {
        sessionId: 'old-session',
        createdAt: Date.now(),
      };

      await sessionManager.invalidateSession();

      expect(storeValues['_kostal_session']).toBeNull();
    });
  });

  describe('updateCredentials', () => {
    test('updates credentials and clears in-memory cache', async () => {
      (performScramAuth as jest.Mock).mockResolvedValue('new-session');

      const sessionManager = new SessionManager('192.168.1.100', 'password', mockStorage);

      // First, get a session to populate the in-memory cache
      storeValues['_kostal_session'] = {
        sessionId: 'old-session',
        createdAt: Date.now(),
      };

      // Get session to load into memory
      const oldSession = await sessionManager.getSession();
      expect(oldSession).toBe('old-session');

      // Clear the persistent store and update credentials
      storeValues['_kostal_session'] = null;
      sessionManager.updateCredentials('192.168.1.200', 'newpassword');

      // Next getSession should authenticate with new credentials
      // because updateCredentials clears the in-memory cache
      const session = await sessionManager.getSession();

      expect(performScramAuth).toHaveBeenCalledWith('192.168.1.200', 'newpassword', 'user');
      expect(session).toBe('new-session');
    });
  });

  describe('isAuthError', () => {
    test('returns true for 401 status code', () => {
      const sessionManager = new SessionManager('192.168.1.100', 'password', mockStorage);
      const error = { statusCode: 401 };

      expect(sessionManager.isAuthError(error)).toBe(true);
    });

    test('returns true for 403 status code', () => {
      const sessionManager = new SessionManager('192.168.1.100', 'password', mockStorage);
      const error = { statusCode: 403 };

      expect(sessionManager.isAuthError(error)).toBe(true);
    });

    test('returns true for error message containing 401', () => {
      const sessionManager = new SessionManager('192.168.1.100', 'password', mockStorage);
      const error = new Error('Request failed with status 401');

      expect(sessionManager.isAuthError(error)).toBe(true);
    });

    test('returns false for other errors', () => {
      const sessionManager = new SessionManager('192.168.1.100', 'password', mockStorage);
      const error = { statusCode: 500 };

      expect(sessionManager.isAuthError(error)).toBe(false);
    });
  });

  describe('executeWithAuthRecovery', () => {
    test('executes API call successfully', async () => {
      storeValues['_kostal_session'] = {
        sessionId: 'valid-session',
        createdAt: Date.now(),
      };

      const sessionManager = new SessionManager('192.168.1.100', 'password', mockStorage);
      const apiCall = jest.fn().mockResolvedValue('api-result');

      const result = await sessionManager.executeWithAuthRecovery(apiCall, 'TEST');

      expect(result).toBe('api-result');
      expect(apiCall).toHaveBeenCalledWith('valid-session');
    });

    test('re-authenticates on 401 error and retries', async () => {
      storeValues['_kostal_session'] = {
        sessionId: 'expired-session',
        createdAt: Date.now(),
      };

      (performScramAuth as jest.Mock).mockResolvedValue('new-session');

      const sessionManager = new SessionManager('192.168.1.100', 'password', mockStorage);
      const apiCall = jest.fn()
        .mockRejectedValueOnce({ statusCode: 401 })
        .mockResolvedValueOnce('success-after-retry');

      const result = await sessionManager.executeWithAuthRecovery(apiCall, 'TEST');

      expect(result).toBe('success-after-retry');
      expect(apiCall).toHaveBeenCalledTimes(2);
      expect(performScramAuth).toHaveBeenCalled();
    });

    test('throws non-auth errors without retry', async () => {
      storeValues['_kostal_session'] = {
        sessionId: 'valid-session',
        createdAt: Date.now(),
      };

      const sessionManager = new SessionManager('192.168.1.100', 'password', mockStorage);
      const apiCall = jest.fn().mockRejectedValue(new Error('Network error'));

      await expect(
        sessionManager.executeWithAuthRecovery(apiCall, 'TEST'),
      ).rejects.toThrow('Network error');

      expect(apiCall).toHaveBeenCalledTimes(1);
      expect(performScramAuth).not.toHaveBeenCalled();
    });

    test('throws error when authentication already in progress', async () => {
      (performScramAuth as jest.Mock).mockImplementation(() => new Promise(() => {})); // Never resolves

      const sessionManager = new SessionManager('192.168.1.100', 'password', mockStorage);

      // Start authentication (will hang)
      const promise1 = sessionManager.getSession();

      // Try to authenticate again while first is in progress (line 71)
      await expect(sessionManager.getSession()).rejects.toThrow(
        'Authentication already in progress',
      );
    });

    test('uses default context parameter when not provided', async () => {
      storeValues['_kostal_session'] = {
        sessionId: 'valid-session',
        createdAt: Date.now(),
      };

      const sessionManager = new SessionManager('192.168.1.100', 'password', mockStorage);
      const apiCall = jest.fn().mockResolvedValue('api-result');

      // Call without context parameter - should use default 'API'
      const result = await sessionManager.executeWithAuthRecovery(apiCall);

      expect(result).toBe('api-result');
      expect(apiCall).toHaveBeenCalledWith('valid-session');
    });
  });
});

