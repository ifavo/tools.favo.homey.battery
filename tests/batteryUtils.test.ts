/**
 * Tests for battery utility functions
 */

import { isChargingFromPower } from '../logic/utils/batteryUtils';

describe('isChargingFromPower', () => {
  test('returns true for negative power (charging)', () => {
    expect(isChargingFromPower(-216)).toBe(true);
    expect(isChargingFromPower(-162)).toBe(true);
    expect(isChargingFromPower(-1000)).toBe(true);
    expect(isChargingFromPower(-0.1)).toBe(true);
  });

  test('returns false for positive power (discharging)', () => {
    expect(isChargingFromPower(216)).toBe(false);
    expect(isChargingFromPower(162)).toBe(false);
    expect(isChargingFromPower(1000)).toBe(false);
    expect(isChargingFromPower(0.1)).toBe(false);
  });

  test('returns false for zero power (idle)', () => {
    expect(isChargingFromPower(0)).toBe(false);
  });

  test('handles edge cases', () => {
    expect(isChargingFromPower(-0.0001)).toBe(true);
    expect(isChargingFromPower(0.0001)).toBe(false);
  });
});
