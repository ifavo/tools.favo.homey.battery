/**
 * Battery Utilities
 *
 * Pure functions for battery-related calculations.
 * This module is isolated from Homey dependencies to enable comprehensive testing.
 */

/**
 * Determine if battery is charging based on power value
 * Negative power = charging (power flowing into battery)
 * Positive power = discharging (power flowing out of battery)
 * Zero power = idle (not charging)
 *
 * @param power - Battery power in watts (negative = charging, positive = discharging)
 * @returns true if battery is charging, false otherwise
 */
export function isChargingFromPower(power: number): boolean {
  return power < 0;
}
