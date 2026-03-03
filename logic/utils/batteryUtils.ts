/**
 * Battery Utilities
 *
 * Pure functions for battery-related calculations.
 * This module is isolated from Homey dependencies to enable comprehensive testing.
 */

/**
 * Determine if battery is charging based on power value.
 *
 * Values below 10 W are treated as charging, to account for small
 * inverter overhead where a tiny positive flow is still effectively
 * keeping the battery running.
 *
 * @param power - Battery power in watts (negative = charging, positive = discharging)
 * @returns true if battery is charging, false otherwise
 */
export function isChargingFromPower(power: number): boolean {
  return power < 10;
}
