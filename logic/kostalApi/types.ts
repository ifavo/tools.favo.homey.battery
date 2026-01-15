/**
 * Kostal API Types
 * TypeScript interfaces for Kostal Plenticore/PIKO IQ inverter API
 */

/**
 * Authentication start response from /auth/start
 */
export interface AuthStartResponse {
  transactionId: string;
  nonce: string;
  salt: string;
  rounds: string;
}

/**
 * Authentication finish response from /auth/finish
 */
export interface AuthFinishResponse {
  token: string;
  signature?: string;
}

/**
 * Session creation response from /auth/create_session
 */
export interface SessionResponse {
  sessionId: string;
}

/**
 * Process data value from the inverter
 */
export interface ProcessDataValue {
  id: string;
  unit: string;
  value: number;
}

/**
 * Process data module response
 */
export interface ProcessDataModule {
  moduleid: string;
  processdata: ProcessDataValue[];
}

/**
 * Battery status extracted from process data
 */
export interface BatteryStatus {
  soc: number;        // State of Charge (%)
  power: number;      // Power (W), negative = discharging
  voltage: number;    // Voltage (V)
  current: number;    // Current (A)
  cycles: number;     // Cycle count
}

/**
 * Setting value for PUT /settings
 */
export interface SettingValue {
  id: string;
  value: string;
}

/**
 * Settings module for PUT /settings
 */
export interface SettingsModule {
  moduleid: string;
  settings: SettingValue[];
}

/**
 * Charging configuration for turning charging on
 */
export interface ChargingConfig {
  soc: number;        // Target SoC to charge to (%)
  gridPower: number;  // Power to draw from grid (W)
  minSoc: number;     // Minimum SoC, won't discharge below this (%)
  minHomeConsumption: number;  // Minimum grid consumption threshold for battery discharge (W)
}

/**
 * Session data stored for caching
 */
export interface CachedSession {
  sessionId: string;
  createdAt: number;
}

/**
 * Kostal API error with optional status code
 */
export interface KostalApiError extends Error {
  statusCode?: number;
}

