/**
 * Tests for battery utility functions
 */

import { isChargingFromPower } from '../logic/utils/batteryUtils';

describe('isChargingFromPower', () => {
  test('returns true for charging power below 10W', () => {
    expect(isChargingFromPower(-216)).toBe(true);
    expect(isChargingFromPower(-162)).toBe(true);
    expect(isChargingFromPower(-1000)).toBe(true);
    expect(isChargingFromPower(-0.1)).toBe(true);
    expect(isChargingFromPower(0)).toBe(true);
    expect(isChargingFromPower(0.01)).toBe(true);
    expect(isChargingFromPower(5)).toBe(true);
    expect(isChargingFromPower(9.99)).toBe(true);
  });

  test('returns false for higher positive power (discharging)', () => {
    expect(isChargingFromPower(10)).toBe(false);
    expect(isChargingFromPower(10.01)).toBe(false);
    expect(isChargingFromPower(162)).toBe(false);
    expect(isChargingFromPower(216)).toBe(false);
    expect(isChargingFromPower(1000)).toBe(false);
  });

  test('handles edge cases', () => {
    expect(isChargingFromPower(9.9999)).toBe(true);
    expect(isChargingFromPower(10.0001)).toBe(false);
  });
});
