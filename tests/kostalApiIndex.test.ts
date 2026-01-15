/**
 * Tests for Kostal API Index exports
 * Verifies that all exports are accessible
 */
import * as kostalApi from '../logic/kostalApi';

describe('Kostal API Index', () => {
  test('exports scramAuth functions', () => {
    expect(kostalApi).toHaveProperty('performScramAuth');
  });

  test('exports sessionManager', () => {
    expect(kostalApi).toHaveProperty('SessionManager');
  });

  test('exports apiClient functions', () => {
    expect(kostalApi).toHaveProperty('fetchBatteryStatus');
    expect(kostalApi).toHaveProperty('fetchExtendedStatus');
    expect(kostalApi).toHaveProperty('setChargingOn');
    expect(kostalApi).toHaveProperty('setChargingOff');
    expect(kostalApi).toHaveProperty('setMinHomeConsumption');
  });

  test('exports scheduleBuilder functions', () => {
    expect(kostalApi).toHaveProperty('buildPriceBasedSchedule');
    expect(kostalApi).toHaveProperty('createDefaultSchedule');
  });

  test('module can be imported without errors', () => {
    // Just verify the module exports something
    expect(Object.keys(kostalApi).length).toBeGreaterThan(0);
  });
});
