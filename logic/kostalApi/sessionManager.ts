/**
 * Session Manager for Kostal API
 * Handles session caching and automatic re-authentication
 */
import { performScramAuth } from './scramAuth';
import type { CachedSession, KostalApiError } from './types';

/**
 * Interface for session storage (implemented by Homey device)
 */
export interface SessionStorage {
  getStoreValue(key: string): unknown;
  setStoreValue(key: string, value: unknown): Promise<void>;
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Session manager that handles authentication and session caching
 */
export class SessionManager {
  private ip: string;
  private password: string;
  private storage: SessionStorage;
  private cachedSession: CachedSession | null = null;
  private isAuthenticating: boolean = false;

  constructor(ip: string, password: string, storage: SessionStorage) {
    this.ip = ip;
    this.password = password;
    this.storage = storage;
  }

  /**
   * Update connection credentials
   */
  updateCredentials(ip: string, password: string): void {
    this.ip = ip;
    this.password = password;
    // Invalidate cached session when credentials change
    this.cachedSession = null;
  }

  /**
   * Get a valid session ID, authenticating if necessary
   */
  async getSession(): Promise<string> {
    // Check in-memory cache first
    if (this.cachedSession) {
      return this.cachedSession.sessionId;
    }

    // Check persistent storage
    const stored = this.storage.getStoreValue('_kostal_session') as CachedSession | null;
    if (stored && stored.sessionId) {
      this.cachedSession = stored;
      this.storage.log('[SESSION] Using cached session from storage');
      return stored.sessionId;
    }

    // Need to authenticate
    return this.authenticate();
  }

  /**
   * Perform authentication and cache the session
   */
  private async authenticate(): Promise<string> {
    // Prevent concurrent authentication attempts
    if (this.isAuthenticating) {
      throw new Error('Authentication already in progress');
    }

    this.isAuthenticating = true;

    try {
      if (!this.ip || !this.password) {
        throw new Error('Inverter IP or password not configured');
      }

      this.storage.log(`[SESSION] Authenticating to ${this.ip}...`);

      const sessionId = await performScramAuth(this.ip, this.password, 'user');

      // Cache the session
      const session: CachedSession = {
        sessionId,
        createdAt: Date.now(),
      };

      this.cachedSession = session;
      await this.storage.setStoreValue('_kostal_session', session);

      this.storage.log('[SESSION] Authentication successful, session cached');

      return sessionId;
    } finally {
      this.isAuthenticating = false;
    }
  }

  /**
   * Invalidate the current session (call after 401/403 error)
   */
  async invalidateSession(): Promise<void> {
    this.storage.log('[SESSION] Invalidating cached session');
    this.cachedSession = null;
    await this.storage.setStoreValue('_kostal_session', null);
  }

  /**
   * Check if an error is an authentication error (401/403)
   */
  isAuthError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const apiError = error as KostalApiError;
      if (apiError.statusCode === 401 || apiError.statusCode === 403) {
        return true;
      }
    }

    // Also check error message
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('401') || message.includes('403') || message.includes('Unauthorized');
  }

  /**
   * Execute an API call with automatic session refresh on 401/403
   * @param apiCall Function that takes sessionId and returns a promise
   * @param context Context string for logging
   * @returns Result of the API call
   */
  async executeWithAuthRecovery<T>(
    apiCall: (sessionId: string) => Promise<T>,
    context: string = 'API',
  ): Promise<T> {
    // Get session
    const sessionId = await this.getSession();

    try {
      // Try the API call
      return await apiCall(sessionId);
    } catch (error: unknown) {
      // Check if it's an auth error
      if (this.isAuthError(error)) {
        this.storage.log(`[${context}] Auth error detected, re-authenticating...`);

        // Invalidate session and re-authenticate
        await this.invalidateSession();
        const newSessionId = await this.authenticate();

        // Retry the API call once
        return apiCall(newSessionId);
      }

      // Not an auth error, re-throw
      throw error;
    }
  }
}
