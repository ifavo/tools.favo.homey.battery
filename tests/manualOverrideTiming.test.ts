/**
 * Tests for Manual Override Timing Logic
 */

import {
  MANUAL_OVERRIDE_DURATION,
  LOG_INTERVAL,
  isManualOverrideActive,
  calculateRemainingMinutes,
  calculateExpirationTime,
  shouldLogRemainingTime,
  shouldLogExpiration,
  getManualOverrideState,
} from '../logic/manualOverride/timing';

describe('Manual Override Timing Logic', () => {
  const now = 1000000000; // Fixed timestamp for consistent testing

  describe('isManualOverrideActive', () => {
    test('returns false when timestamp is undefined', () => {
      expect(isManualOverrideActive(undefined, now)).toBe(false);
    });

    test('returns true when override is just set', () => {
      const timestamp = now;
      expect(isManualOverrideActive(timestamp, now)).toBe(true);
    });

    test('returns true when override is within duration', () => {
      const timestamp = now - (MANUAL_OVERRIDE_DURATION / 2);
      expect(isManualOverrideActive(timestamp, now)).toBe(true);
    });

    test('returns false when override has expired', () => {
      const timestamp = now - MANUAL_OVERRIDE_DURATION;
      expect(isManualOverrideActive(timestamp, now)).toBe(false);
    });

    test('returns false when override expired long ago', () => {
      const timestamp = now - (MANUAL_OVERRIDE_DURATION * 2);
      expect(isManualOverrideActive(timestamp, now)).toBe(false);
    });

    test('returns true when 1 second before expiry', () => {
      const timestamp = now - (MANUAL_OVERRIDE_DURATION - 1000);
      expect(isManualOverrideActive(timestamp, now)).toBe(true);
    });

    test('returns false when exactly at expiry', () => {
      const timestamp = now - MANUAL_OVERRIDE_DURATION;
      expect(isManualOverrideActive(timestamp, now)).toBe(false);
    });

    test('returns false when 1 second after expiry', () => {
      const timestamp = now - (MANUAL_OVERRIDE_DURATION + 1000);
      expect(isManualOverrideActive(timestamp, now)).toBe(false);
    });

    test('handles future timestamps (edge case)', () => {
      const timestamp = now + 1000;
      expect(isManualOverrideActive(timestamp, now)).toBe(true);
    });
  });

  describe('calculateRemainingMinutes', () => {
    test('returns 0 when timestamp is undefined', () => {
      expect(calculateRemainingMinutes(undefined, now)).toBe(0);
    });

    test('returns full duration when just set', () => {
      const timestamp = now;
      const remaining = calculateRemainingMinutes(timestamp, now);
      expect(remaining).toBe(15); // 15 minutes
    });

    test('calculates remaining minutes correctly', () => {
      const timestamp = now - (5 * 60 * 1000); // 5 minutes ago
      const remaining = calculateRemainingMinutes(timestamp, now);
      expect(remaining).toBe(10); // 10 minutes remaining
    });

    test('returns 0 when expired', () => {
      const timestamp = now - MANUAL_OVERRIDE_DURATION;
      const remaining = calculateRemainingMinutes(timestamp, now);
      expect(remaining).toBe(0);
    });

    test('returns 0 when expired long ago', () => {
      const timestamp = now - (MANUAL_OVERRIDE_DURATION * 2);
      const remaining = calculateRemainingMinutes(timestamp, now);
      expect(remaining).toBe(0);
    });

    test('rounds up to next minute', () => {
      const timestamp = now - (14 * 60 * 1000 + 30 * 1000); // 14.5 minutes ago
      const remaining = calculateRemainingMinutes(timestamp, now);
      expect(remaining).toBe(1); // Rounds up to 1 minute
    });

    test('handles 1 second remaining', () => {
      const timestamp = now - (MANUAL_OVERRIDE_DURATION - 1000);
      const remaining = calculateRemainingMinutes(timestamp, now);
      expect(remaining).toBe(1); // Rounds up to 1 minute
    });

    test('handles exactly at expiry', () => {
      const timestamp = now - MANUAL_OVERRIDE_DURATION;
      const remaining = calculateRemainingMinutes(timestamp, now);
      expect(remaining).toBe(0);
    });

    test('handles very small remaining time', () => {
      const timestamp = now - (MANUAL_OVERRIDE_DURATION - 100); // 100ms remaining
      const remaining = calculateRemainingMinutes(timestamp, now);
      expect(remaining).toBe(1); // Rounds up to 1 minute
    });
  });

  describe('calculateExpirationTime', () => {
    test('returns 0 when timestamp is undefined', () => {
      // Function returns 0 instead of undefined for consistency with other functions
      expect(calculateExpirationTime(undefined)).toBe(0);
    });

    test('calculates expiration time correctly', () => {
      const timestamp = now;
      const expiration = calculateExpirationTime(timestamp);
      expect(expiration).toBe(now + MANUAL_OVERRIDE_DURATION);
    });

    test('calculates expiration for past timestamp', () => {
      const timestamp = now - (5 * 60 * 1000);
      const expiration = calculateExpirationTime(timestamp);
      expect(expiration).toBe(timestamp + MANUAL_OVERRIDE_DURATION);
    });

    test('calculates expiration for future timestamp', () => {
      const timestamp = now + (5 * 60 * 1000);
      const expiration = calculateExpirationTime(timestamp);
      expect(expiration).toBe(timestamp + MANUAL_OVERRIDE_DURATION);
    });
  });

  describe('shouldLogRemainingTime', () => {
    test('returns true when lastLogTime is undefined', () => {
      expect(shouldLogRemainingTime(undefined, now)).toBe(true);
    });

    test('returns true when log interval has passed', () => {
      const lastLogTime = now - (LOG_INTERVAL + 1000);
      expect(shouldLogRemainingTime(lastLogTime, now)).toBe(true);
    });

    test('returns false when log interval has not passed', () => {
      const lastLogTime = now - (LOG_INTERVAL - 1000);
      expect(shouldLogRemainingTime(lastLogTime, now)).toBe(false);
    });

    test('returns false when just logged', () => {
      const lastLogTime = now;
      expect(shouldLogRemainingTime(lastLogTime, now)).toBe(false);
    });

    test('returns true at exact log interval boundary', () => {
      const lastLogTime = now - LOG_INTERVAL;
      expect(shouldLogRemainingTime(lastLogTime, now)).toBe(true);
    });

    test('returns true when 1ms after log interval', () => {
      const lastLogTime = now - (LOG_INTERVAL + 1);
      expect(shouldLogRemainingTime(lastLogTime, now)).toBe(true);
    });

    test('returns false when 1ms before log interval', () => {
      const lastLogTime = now - (LOG_INTERVAL - 1);
      expect(shouldLogRemainingTime(lastLogTime, now)).toBe(false);
    });
  });

  describe('shouldLogExpiration', () => {
    test('returns true when lastExpirationLog is undefined', () => {
      const expirationTime = now + MANUAL_OVERRIDE_DURATION;
      expect(shouldLogExpiration(undefined, expirationTime)).toBe(true);
    });

    test('returns true when lastExpirationLog is before expiration', () => {
      const lastExpirationLog = now - 1000;
      const expirationTime = now + 1000;
      expect(shouldLogExpiration(lastExpirationLog, expirationTime)).toBe(true);
    });

    test('returns false when lastExpirationLog is after expiration', () => {
      const lastExpirationLog = now + 1000;
      const expirationTime = now - 1000;
      expect(shouldLogExpiration(lastExpirationLog, expirationTime)).toBe(false);
    });

    test('returns false when lastExpirationLog equals expiration', () => {
      const expirationTime = now;
      expect(shouldLogExpiration(now, expirationTime)).toBe(false);
    });

    test('returns true for new expiration after old one', () => {
      const oldExpiration = now - 1000;
      const newExpiration = now + 1000;
      expect(shouldLogExpiration(oldExpiration, newExpiration)).toBe(true);
    });

    test('returns false for old expiration after new one', () => {
      const oldExpiration = now + 1000;
      const newExpiration = now - 1000;
      expect(shouldLogExpiration(oldExpiration, newExpiration)).toBe(false);
    });
  });

  describe('getManualOverrideState', () => {
    test('returns inactive state when timestamp is undefined', () => {
      const state = getManualOverrideState(undefined, now);
      expect(state).toEqual({
        isActive: false,
        remainingMinutes: 0,
        timeSinceManual: 0,
        expirationTime: 0,
      });
    });

    test('returns active state when just set', () => {
      const timestamp = now;
      const state = getManualOverrideState(timestamp, now);
      expect(state.isActive).toBe(true);
      expect(state.remainingMinutes).toBe(15);
      expect(state.timeSinceManual).toBe(0);
      expect(state.expirationTime).toBe(now + MANUAL_OVERRIDE_DURATION);
    });

    test('returns correct state when partially expired', () => {
      const timestamp = now - (5 * 60 * 1000); // 5 minutes ago
      const state = getManualOverrideState(timestamp, now);
      expect(state.isActive).toBe(true);
      expect(state.remainingMinutes).toBe(10);
      expect(state.timeSinceManual).toBe(5 * 60 * 1000);
      expect(state.expirationTime).toBe(timestamp + MANUAL_OVERRIDE_DURATION);
    });

    test('returns inactive state when expired', () => {
      const timestamp = now - MANUAL_OVERRIDE_DURATION;
      const state = getManualOverrideState(timestamp, now);
      expect(state.isActive).toBe(false);
      expect(state.remainingMinutes).toBe(0);
      expect(state.timeSinceManual).toBe(MANUAL_OVERRIDE_DURATION);
      expect(state.expirationTime).toBe(timestamp + MANUAL_OVERRIDE_DURATION);
    });

    test('returns inactive state when expired long ago', () => {
      const timestamp = now - (MANUAL_OVERRIDE_DURATION * 2);
      const state = getManualOverrideState(timestamp, now);
      expect(state.isActive).toBe(false);
      expect(state.remainingMinutes).toBe(0);
      expect(state.timeSinceManual).toBe(MANUAL_OVERRIDE_DURATION * 2);
      expect(state.expirationTime).toBe(timestamp + MANUAL_OVERRIDE_DURATION);
    });

    test('handles edge case at 1 second before expiry', () => {
      const timestamp = now - (MANUAL_OVERRIDE_DURATION - 1000);
      const state = getManualOverrideState(timestamp, now);
      expect(state.isActive).toBe(true);
      expect(state.remainingMinutes).toBe(1);
      expect(state.timeSinceManual).toBe(MANUAL_OVERRIDE_DURATION - 1000);
    });

    test('handles edge case at exact expiry', () => {
      const timestamp = now - MANUAL_OVERRIDE_DURATION;
      const state = getManualOverrideState(timestamp, now);
      expect(state.isActive).toBe(false);
      expect(state.remainingMinutes).toBe(0);
      expect(state.timeSinceManual).toBe(MANUAL_OVERRIDE_DURATION);
    });

    test('handles edge case at 1 second after expiry', () => {
      const timestamp = now - (MANUAL_OVERRIDE_DURATION + 1000);
      const state = getManualOverrideState(timestamp, now);
      expect(state.isActive).toBe(false);
      expect(state.remainingMinutes).toBe(0);
      expect(state.timeSinceManual).toBe(MANUAL_OVERRIDE_DURATION + 1000);
    });

    test('calculates remaining minutes correctly for various times', () => {
      const testCases = [
        { minutesAgo: 0, expectedRemaining: 15 },
        { minutesAgo: 1, expectedRemaining: 14 },
        { minutesAgo: 5, expectedRemaining: 10 },
        { minutesAgo: 10, expectedRemaining: 5 },
        { minutesAgo: 14, expectedRemaining: 1 },
        { minutesAgo: 15, expectedRemaining: 0 },
        { minutesAgo: 20, expectedRemaining: 0 },
      ];

      testCases.forEach(({ minutesAgo, expectedRemaining }) => {
        const timestamp = now - (minutesAgo * 60 * 1000);
        const state = getManualOverrideState(timestamp, now);
        expect(state.remainingMinutes).toBe(expectedRemaining);
        expect(state.isActive).toBe(minutesAgo < 15);
      });
    });

    test('uses default Date.now() when now parameter is not provided', () => {
      const timestamp = Date.now() - (5 * 60 * 1000);
      
      // Call without now parameter - should use Date.now() internally
      const state1 = getManualOverrideState(timestamp);
      const state2 = getManualOverrideState(timestamp, Date.now());
      
      // Both should be similar (within 1 second due to execution time)
      expect(Math.abs(state1.timeSinceManual - state2.timeSinceManual)).toBeLessThan(1000);
    });
  });

  describe('default parameter coverage', () => {
    test('isManualOverrideActive uses default Date.now()', () => {
      const timestamp = Date.now() - (5 * 60 * 1000);
      const result = isManualOverrideActive(timestamp);
      expect(typeof result).toBe('boolean');
    });

    test('calculateRemainingMinutes uses default Date.now()', () => {
      const timestamp = Date.now() - (5 * 60 * 1000);
      const result = calculateRemainingMinutes(timestamp);
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    });

    test('shouldLogRemainingTime uses default Date.now()', () => {
      const lastLogTime = Date.now() - (LOG_INTERVAL + 1000);
      const result = shouldLogRemainingTime(lastLogTime);
      expect(typeof result).toBe('boolean');
    });

    test('getManualOverrideState handles undefined expirationTime fallback', () => {
      // When manualOverrideTimestamp is undefined, calculateExpirationTime returns 0
      // So expirationTime should be 0
      const state = getManualOverrideState(undefined, now);
      expect(state.expirationTime).toBe(0);
      expect(state.isActive).toBe(false);
      expect(state.remainingMinutes).toBe(0);
      expect(state.timeSinceManual).toBe(0);
    });

    test('getManualOverrideState expirationTime uses calculated value', () => {
      // When manualOverrideTimestamp is provided, calculateExpirationTime returns a number
      const timestamp = now;
      const state = getManualOverrideState(timestamp, now);
      expect(state.expirationTime).toBe(now + MANUAL_OVERRIDE_DURATION);
      expect(state.expirationTime).not.toBe(0);
    });

    test('getManualOverrideState expirationTime uses calculated value (not fallback)', () => {
      // Test the other branch of line 121: when calculateExpirationTime returns a number
      // This ensures both branches of the || operator are covered
      const timestamp = now;
      const state = getManualOverrideState(timestamp, now);
      
      // Should use the calculated expiration time, not the fallback
      expect(state.expirationTime).toBe(now + MANUAL_OVERRIDE_DURATION);
      expect(state.expirationTime).not.toBe(0);
    });
  });
});

