'use strict';

import Homey from 'homey';
import { SessionManager } from '../../logic/kostalApi/sessionManager';
import {
  fetchBatteryStatus,
  setChargingSchedule,
  setChargingOff,
  buildSchedulePayload,
  buildChargingOffPayload,
  fetchSettings,
  setMinHomeConsumption,
} from '../../logic/kostalApi/apiClient';
import {
  buildPriceBasedSchedule,
  schedulesAreDifferent,
  formatScheduleForLog,
  SCHEDULE_VALUE_DEFAULT,
  SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE,
  SCHEDULE_VALUE_NO_CHARGE_DISALLOW_USE,
  SCHEDULE_VALUE_CHARGE_ALLOW_USE,
  SCHEDULE_VALUE_CHARGE_DISALLOW_USE,
  type DaySchedule,
} from '../../logic/kostalApi/scheduleBuilder';
import type { BatteryStatus, ChargingConfig, SettingsModule } from '../../logic/kostalApi/types';
import { SmardPriceSource } from '../../logic/lowPrice/sources/smard';
import { CachedPriceSource, type AppStorage } from '../../logic/lowPrice/sources/cachedPriceSource';
import type { PriceDataSource } from '../../logic/lowPrice/priceSource';
import type { PriceBlock } from '../../logic/lowPrice/types';
import { findCheapestBlocks } from '../../logic/lowPrice/findCheapestHours';
import { formatNextChargingTimes } from '../../logic/lowPrice/formatNextChargingTimes';
import { extractErrorMessage } from '../../logic/utils/errorUtils';
import {
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_HOUR,
} from '../../logic/utils/dateUtils';
import { detectTimeFrame, type TimeFrame } from '../../logic/utils/timeFrameDetector';

/**
 * Kostal Battery Device
 * Manages a Kostal inverter battery with status polling and price-based schedule control
 */
class KostalBatteryDevice extends Homey.Device {

  private sessionManager!: SessionManager;
  private priceSource!: PriceDataSource;
  private pollingInterval?: NodeJS.Timeout;
  private priceUpdateInterval?: NodeJS.Timeout;
  private minHomeConsumptionCheckInterval?: NodeJS.Timeout;

  private readonly POLL_INTERVAL = 60 * 1000; // 60 seconds
  private readonly PRICE_UPDATE_INTERVAL = MILLISECONDS_PER_HOUR; // Update schedule hourly
  private readonly MANUAL_OVERRIDE_DURATION = 15 * MILLISECONDS_PER_MINUTE;
  private readonly MIN_HOME_CONS_CHECK_INTERVAL = 15 * MILLISECONDS_PER_MINUTE; // Check every 15 minutes

  // Current settings (to detect changes and avoid unnecessary API calls)
  private currentSchedule?: DaySchedule;
  private currentConfig?: ChargingConfig;
  private manualOverrideTimestamp?: number;

  // Schedule values for time frame detection
  private cheapestBlocksValue?: string;
  private expensiveBlocksValue?: string;
  private standardStateValue?: string;
  private lastCheckedTimeFrame?: TimeFrame;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit(): Promise<void> {
    this.log('KostalBatteryDevice has been initialized');

    // Get connection settings
    const ip = this.getSetting('ip') as string;
    const password = this.getSetting('password') as string;

    if (!ip || !password) {
      this.setUnavailable('Inverter IP or password not configured').catch(() => { });
      return;
    }

    // Initialize session manager
    this.sessionManager = new SessionManager(ip, password, this);

    // Initialize SMARD price source with app-level caching (1 week TTL)
    const marketArea = 'DE-LU';
    const smardSource = new SmardPriceSource(marketArea);
    // Get app storage adapter (implements AppStorage interface)
    // Cast through unknown first to avoid TypeScript error about missing method
    const appStorage = (this.homey.app as unknown as { getAppStorage(): AppStorage }).getAppStorage();
    this.priceSource = new CachedPriceSource(smardSource, marketArea, appStorage);
    this.log('[PRICE] Using SMARD API as price data source with app-level caching');

    // Initialize last_api_update capability with default value
    // Setting it even if it exists is safe and ensures it's visible in Homey
    await this.setCapabilityValue('last_api_update', 'Never').catch(() => { });

    // Start polling
    await this.startPolling();

    // Start price-based schedule updates (always enabled)
    await this.startScheduleUpdates();

    // Start min home consumption check interval
    await this.startMinHomeConsumptionChecks();

    this.log('[INIT] Device initialization completed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted(): Promise<void> {
    this.stopPolling();
    this.stopScheduleUpdates();
    this.stopMinHomeConsumptionChecks();
    this.log('KostalBatteryDevice has been deleted');
  }

  /**
   * onSettings is called when the user updates the device settings.
   */
  async onSettings(event: {
    oldSettings: Record<string, unknown>;
    newSettings: Record<string, unknown>;
    changedKeys: string[];
  }): Promise<string | void> {
    this.log('[SETTINGS] Settings changed:', event.changedKeys);

    await this.logSettingsChangeDetails(event);

    // Validate SoC settings: min must be 5-100 (step 5), max must be >= min
    if (event.changedKeys.includes('min_soc') || event.changedKeys.includes('max_soc')) {
      const minSocRaw = event.newSettings.min_soc ?? this.getSetting('min_soc');
      const maxSocRaw = event.newSettings.max_soc ?? this.getSetting('max_soc');
      const minSoc = Number(minSocRaw);
      const maxSoc = Number(maxSocRaw);

      const isMinStepValid = minSoc >= 5 && minSoc <= 100 && minSoc % 5 === 0;
      if (!isMinStepValid) {
        return 'Minimum SoC must be between 5 and 100 in steps of 5.';
      }

      if (maxSoc < minSoc) {
        return 'Target SoC must be greater than or equal to Minimum SoC.';
      }
    }

    // Update session manager if credentials changed
    if (event.changedKeys.includes('ip') || event.changedKeys.includes('password')) {
      const ip = event.newSettings.ip as string;
      const password = event.newSettings.password as string;

      if (ip && password) {
        this.sessionManager.updateCredentials(ip, password);
        await this.sessionManager.invalidateSession();
        this.log('[SETTINGS] Credentials updated, session invalidated');
      }
    }

    // If schedule-related settings changed, force schedule update
    const scheduleSettings = [
      'low_price_blocks_count',
      'expensive_blocks_count',
      'cheapest_blocks_value',
      'expensive_blocks_value',
      'standard_state_value',
    ];
    const configSettings = ['min_soc', 'max_soc', 'watts', 'min_home_consumption'];
    const hasScheduleChange = scheduleSettings.some((s) => event.changedKeys.includes(s));
    const hasConfigChange = configSettings.some((s) => event.changedKeys.includes(s));

    if (hasScheduleChange || hasConfigChange) {
      // Clear cached values to force update
      if (hasScheduleChange) this.currentSchedule = undefined;
      if (hasConfigChange) this.currentConfig = undefined;

      // Always update schedule (feature is always enabled)
      await this.updateScheduleFromPrices(event.newSettings);
    }

    // If time-based discharge settings changed, trigger immediate check
    const dischargeSettings = [
      'min_home_consumption_cheapest',
      'min_home_consumption_standard',
      'min_home_consumption_expensive',
    ];
    const hasDischargeChange = dischargeSettings.some((s) => event.changedKeys.includes(s));

    if (hasDischargeChange) {
      // Reset last checked time frame to force immediate check
      this.lastCheckedTimeFrame = undefined;
      try {
        // Pass newSettings to use the updated values immediately
        await this.checkAndUpdateMinHomeConsumption(event.newSettings);
      } catch (error: unknown) {
        this.error('[SETTINGS] Failed to update min home consumption after settings change:', extractErrorMessage(error));
      }
    }
  }

  /**
   * Start polling for battery status
   */
  async startPolling(): Promise<void> {
    this.stopPolling();

    // Initial status refresh
    try {
      await this.refreshStatus();
      await this.setAvailable();
    } catch (error: unknown) {
      this.error('[POLLING] Initial status refresh failed:', extractErrorMessage(error));
    }

    // Set up interval
    this.pollingInterval = this.homey.setInterval(() => {
      this.refreshStatus().catch((error: unknown) => {
        this.error('[POLLING] Status refresh failed:', extractErrorMessage(error));
      });
    }, this.POLL_INTERVAL);

    this.log('[POLLING] Started polling interval');
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      this.homey.clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }
  }

  /**
   * Refresh battery status from inverter
   */
  async refreshStatus(): Promise<void> {
    try {
      const ip = this.getSetting('ip') as string;

      const status = await this.sessionManager.executeWithAuthRecovery(
        (sessionId) => fetchBatteryStatus(ip, sessionId),
        'STATUS',
      );

      await this.updateCapabilities(status);
      await this.setAvailable();

      this.log(`[STATUS] SoC=${status.soc}%, P=${status.power}W, U=${status.voltage}V, I=${status.current}A, Cycles=${status.cycles}`);
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      this.error('[STATUS] Error refreshing status:', errorMessage);
      await this.setUnavailable(`Error: ${errorMessage.substring(0, 50)}`).catch(() => { });
    }
  }

  /**
   * Update device capabilities from battery status
   */
  async updateCapabilities(status: BatteryStatus): Promise<void> {
    await this.setCapabilityValue('measure_battery', status.soc).catch(() => { });
    await this.setCapabilityValue('measure_power', status.power).catch(() => { });
    await this.setCapabilityValue('measure_voltage', status.voltage).catch(() => { });
    await this.setCapabilityValue('measure_current', status.current).catch(() => { });
    // Reflect charging state: power > 0 means charging, <= 0 means not charging
    const isCharging = status.power > 0;
    await this.setCapabilityValue('onoff', isCharging).catch(() => { });
    // Note: cycles data is fetched but not displayed (no standard Homey capability)
  }

  /**
   * Check if manual override is still active
   */
  isManualOverrideActive(): boolean {
    if (!this.manualOverrideTimestamp) {
      return false;
    }

    const elapsed = Date.now() - this.manualOverrideTimestamp;
    return elapsed < this.MANUAL_OVERRIDE_DURATION;
  }

  /**
   * Turn charging OFF (disable time control)
   */
  async setChargingOff(): Promise<void> {
    const ip = this.getSetting('ip') as string;
    const minSoc = this.getSetting('min_soc') as number || 10;
    const minHomeConsumption = this.getSetting('min_home_consumption') as number || 5000;

    const desiredSettings = buildChargingOffPayload(minSoc, minHomeConsumption);
    const shouldApply = await this.isSettingsChangeNeeded(ip, desiredSettings);
    if (!shouldApply) {
      this.currentSchedule = undefined;
      this.currentConfig = undefined;
      this.log('[CHARGING] Settings already match, skipping API call');
      return;
    }

    await this.sessionManager.executeWithAuthRecovery(
      (sessionId) => setChargingOff(ip, sessionId, minSoc, minHomeConsumption),
      'CHARGING_OFF',
    );

    this.currentSchedule = undefined;
    this.currentConfig = undefined;
    await this.updateLastApiUpdateTime();
    this.log('[CHARGING] Time control disabled');
  }

  /**
   * Start schedule update interval
   */
  async startScheduleUpdates(): Promise<void> {
    this.stopScheduleUpdates();

    // Initial schedule update
    try {
      await this.updateScheduleFromPrices();
    } catch (error: unknown) {
      this.error('[SCHEDULE] Initial schedule update failed:', extractErrorMessage(error));
    }

    // Set up hourly interval for schedule updates
    // This is less frequent since we're setting the full day's schedule
    this.priceUpdateInterval = this.homey.setInterval(() => {
      this.updateScheduleFromPrices().catch((error: unknown) => {
        this.error('[SCHEDULE] Schedule update failed:', extractErrorMessage(error));
      });
    }, this.PRICE_UPDATE_INTERVAL);

    this.log(`[SCHEDULE] Started schedule updates (every ${this.PRICE_UPDATE_INTERVAL / MILLISECONDS_PER_MINUTE} min)`);
  }

  /**
   * Stop schedule updates
   */
  stopScheduleUpdates(): void {
    if (this.priceUpdateInterval) {
      this.homey.clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = undefined;
    }
  }

  /**
   * Start min home consumption check interval
   */
  async startMinHomeConsumptionChecks(): Promise<void> {
    this.stopMinHomeConsumptionChecks();

    // Initial check
    try {
      await this.checkAndUpdateMinHomeConsumption();
    } catch (error: unknown) {
      this.error('[MIN_HOME_CONS] Initial check failed:', extractErrorMessage(error));
    }

    // Set up 15-minute interval
    this.minHomeConsumptionCheckInterval = this.homey.setInterval(() => {
      this.checkAndUpdateMinHomeConsumption().catch((error: unknown) => {
        this.error('[MIN_HOME_CONS] Check failed:', extractErrorMessage(error));
      });
    }, this.MIN_HOME_CONS_CHECK_INTERVAL);

    this.log(`[MIN_HOME_CONS] Started check interval (every ${this.MIN_HOME_CONS_CHECK_INTERVAL / MILLISECONDS_PER_MINUTE} min)`);
  }

  /**
   * Stop min home consumption checks
   */
  stopMinHomeConsumptionChecks(): void {
    if (this.minHomeConsumptionCheckInterval) {
      this.homey.clearInterval(this.minHomeConsumptionCheckInterval);
      this.minHomeConsumptionCheckInterval = undefined;
    }
  }

  /**
   * Get the desired min home consumption value for the current time frame
   * @param settingsOverride - Optional settings override to use instead of getSetting()
   */
  private getCurrentTimeFrameValue(settingsOverride?: Record<string, unknown>): number | null {
    if (!this.currentSchedule || !this.cheapestBlocksValue || !this.expensiveBlocksValue) {
      // Fallback to legacy setting if schedule not available
      const legacyValue = settingsOverride?.min_home_consumption ?? this.getSetting('min_home_consumption');
      return (legacyValue as number) || 50;
    }

    const timezone = this.resolveTimezone(
      (settingsOverride?.price_timezone ?? this.getSetting('price_timezone')) as string,
    );
    const now = Date.now();
    const timeFrame = detectTimeFrame(
      this.currentSchedule,
      now,
      timezone,
      this.cheapestBlocksValue,
      this.expensiveBlocksValue,
    );

    let settingKey: string;
    switch (timeFrame) {
      case 'cheapest':
        settingKey = 'min_home_consumption_cheapest';
        break;
      case 'expensive':
        settingKey = 'min_home_consumption_expensive';
        break;
      case 'standard':
      default:
        settingKey = 'min_home_consumption_standard';
        break;
    }

    // Use override if provided, otherwise get from settings
    const value = settingsOverride?.[settingKey] ?? this.getSetting(settingKey);
    if (value !== undefined && value !== null) {
      return Number(value);
    }

    // Fallback to legacy setting
    const legacyValue = settingsOverride?.min_home_consumption ?? this.getSetting('min_home_consumption');
    return (legacyValue as number) || 50;
  }

  /**
   * Check current inverter setting and update if needed
   * @param settingsOverride - Optional settings override to use instead of getSetting()
   */
  async checkAndUpdateMinHomeConsumption(settingsOverride?: Record<string, unknown>): Promise<void> {
    if (!this.currentSchedule || !this.cheapestBlocksValue || !this.expensiveBlocksValue) {
      this.log('[MIN_HOME_CONS] Schedule not available, skipping check');
      return;
    }

    const ip = this.getSetting('ip') as string;
    if (!ip) {
      this.log('[MIN_HOME_CONS] IP not configured, skipping check');
      return;
    }

    const desiredValue = this.getCurrentTimeFrameValue(settingsOverride);
    if (desiredValue === null) {
      this.log('[MIN_HOME_CONS] Could not determine desired value, skipping check');
      return;
    }

    const timezone = this.resolveTimezone(this.getSetting('price_timezone'));
    const now = Date.now();
    const currentTimeFrame = detectTimeFrame(
      this.currentSchedule,
      now,
      timezone,
      this.cheapestBlocksValue,
      this.expensiveBlocksValue,
    );

    try {
      // Fetch current inverter setting
      const currentModules = await this.sessionManager.executeWithAuthRecovery(
        (sessionId) => fetchSettings(ip, sessionId, [
          {
            moduleid: 'devices:local',
            settingids: ['Battery:MinHomeComsumption'],
          },
        ]),
        'MIN_HOME_CONS_CHECK',
      );

      const currentSetting = currentModules[0]?.settings?.find(
        (s) => s.id === 'Battery:MinHomeComsumption',
      );

      const currentValue = currentSetting ? Number(currentSetting.value) : null;

      if (currentValue === null) {
        this.log('[MIN_HOME_CONS] Could not read current inverter setting');
        return;
      }

      // Compare values (with small tolerance for floating point)
      if (Math.abs(currentValue - desiredValue) < 0.5) {
        this.log(
          `[MIN_HOME_CONS] Setting already correct: ${currentValue}W (time frame: ${currentTimeFrame})`,
        );
        this.lastCheckedTimeFrame = currentTimeFrame;
        return;
      }

      // Update setting
      const timeFrameChanged = this.lastCheckedTimeFrame !== currentTimeFrame;
      if (timeFrameChanged) {
        this.log(
          `[MIN_HOME_CONS] Time frame changed to ${currentTimeFrame}, updating from ${currentValue}W to ${desiredValue}W`,
        );
      } else {
        this.log(
          `[MIN_HOME_CONS] Setting differs from desired value, updating from ${currentValue}W to ${desiredValue}W (time frame: ${currentTimeFrame})`,
        );
      }

      await this.sessionManager.executeWithAuthRecovery(
        (sessionId) => setMinHomeConsumption(ip, sessionId, desiredValue),
        'MIN_HOME_CONS_UPDATE',
      );

      this.lastCheckedTimeFrame = currentTimeFrame;
      await this.updateLastApiUpdateTime();

      this.log(`[MIN_HOME_CONS] Successfully updated to ${desiredValue}W`);
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      this.error(`[MIN_HOME_CONS] Error checking/updating setting: ${errorMessage}`);
      throw error;
    }
  }

  private resolveTimezone(value: unknown): string {
    const timezone = typeof value === 'string' ? value.trim() : '';
    return timezone || this.homey.clock.getTimezone();
  }

  private async logSettingsChangeDetails(event: {
    oldSettings: Record<string, unknown>;
    newSettings: Record<string, unknown>;
    changedKeys: string[];
  }): Promise<void> {
    const ip = this.getSetting('ip') as string;
    if (!ip || event.changedKeys.length === 0) {
      return;
    }

    const inverterSettingMap: Record<string, string[]> = {
      min_soc: ['Battery:MinSoc'],
      max_soc: ['EnergyMgmt:TimedBatCharge:Soc', 'EnergyMgmt:TimedBatCharge:WD_Soc'],
      watts: ['EnergyMgmt:TimedBatCharge:GridPower', 'EnergyMgmt:TimedBatCharge:WD_GridPower'],
      min_home_consumption: ['Battery:MinHomeComsumption'],
    };

    const settingIds = event.changedKeys
      .flatMap((key) => inverterSettingMap[key] || [])
      .filter((id, index, list) => list.indexOf(id) === index);

    if (settingIds.length === 0) {
      this.log('[SETTINGS] No inverter settings to compare for changed keys');
      return;
    }

    try {
      const currentModules = await this.sessionManager.executeWithAuthRecovery(
        (sessionId) => fetchSettings(ip, sessionId, [
          {
            moduleid: 'devices:local',
            settingids: settingIds,
          },
        ]),
        'SETTINGS_READ',
      );

      const currentSettings = currentModules[0]?.settings ?? [];
      const currentMap = new Map(currentSettings.map((setting) => [setting.id, setting.value]));

      for (const key of event.changedKeys) {
        const desiredValue = event.newSettings[key];
        const mappedIds = inverterSettingMap[key];
        if (!mappedIds) {
          this.log(`[SETTINGS] ${key}: desired=${String(desiredValue)} (no inverter mapping)`);
          continue;
        }

        const currentValues = mappedIds.map((id) => `${id}=${currentMap.get(id) ?? 'missing'}`).join(', ');
        this.log(`[SETTINGS] ${key}: desired=${String(desiredValue)} inverter={${currentValues}}`);
      }
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      this.error('[SETTINGS] Failed to read current inverter settings:', errorMessage);
    }
  }

  private normalizeSettingValue(value: string): string | number {
    const trimmed = value.trim();
    const isNumeric = /^-?\d+(\.\d+)?$/.test(trimmed) && trimmed.length <= 10;
    if (isNumeric) {
      return Number(trimmed);
    }
    return trimmed;
  }

  private areSettingValuesEqual(desired: string, current: string): boolean {
    const desiredValue = this.normalizeSettingValue(desired);
    const currentValue = this.normalizeSettingValue(current);
    if (typeof desiredValue === 'number' && typeof currentValue === 'number') {
      return desiredValue === currentValue;
    }
    return String(desiredValue) === String(currentValue);
  }

  private async isSettingsChangeNeeded(
    ip: string,
    desiredModules: SettingsModule[],
  ): Promise<boolean> {
    const query = desiredModules.map((module) => ({
      moduleid: module.moduleid,
      settingids: module.settings.map((setting) => setting.id),
    }));

    const currentModules = await this.sessionManager.executeWithAuthRecovery(
      (sessionId) => fetchSettings(ip, sessionId, query),
      'SETTINGS_CHECK',
    );

    const differences: Array<{
      moduleid: string;
      id: string;
      desired: string;
      current: string;
    }> = [];

    let needsChange = false;

    for (const desiredModule of desiredModules) {
      const currentModule = currentModules.find((module) => module.moduleid === desiredModule.moduleid);
      if (!currentModule) {
        for (const desiredSetting of desiredModule.settings) {
          differences.push({
            moduleid: desiredModule.moduleid,
            id: desiredSetting.id,
            desired: desiredSetting.value,
            current: 'missing',
          });
        }
        needsChange = true;
        continue;
      }

      for (const desiredSetting of desiredModule.settings) {
        const currentSetting = currentModule.settings?.find((setting) => setting.id === desiredSetting.id);
        if (!currentSetting) {
          differences.push({
            moduleid: desiredModule.moduleid,
            id: desiredSetting.id,
            desired: desiredSetting.value,
            current: 'missing',
          });
          needsChange = true;
          continue;
        }

        if (!this.areSettingValuesEqual(desiredSetting.value, currentSetting.value)) {
          differences.push({
            moduleid: desiredModule.moduleid,
            id: desiredSetting.id,
            desired: desiredSetting.value,
            current: currentSetting.value,
          });
          needsChange = true;
        }
      }
    }

    if (differences.length > 0) {
      const diffText = differences
        .map((diff) => `${diff.moduleid}.${diff.id}: ${diff.current} -> ${diff.desired}`)
        .join(', ');
      this.log(`[SETTINGS_CHECK] Differences detected: ${diffText}`);
    } else {
      this.log('[SETTINGS_CHECK] No differences detected');
    }

    return needsChange;
  }

  /**
   * Update the last API update time capability with current timestamp
   */
  async updateLastApiUpdateTime(): Promise<void> {
    try {
      const timezone = this.resolveTimezone(this.getSetting('price_timezone'));
      const now = new Date();

      // Format timestamp using the correct timezone and as ISO string (without ms and Z)
      const dateInTz = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const iso = dateInTz.toISOString();
      const formattedTime = iso.slice(0, 19).replace('T', ' ');

      await this.setCapabilityValue('last_api_update', formattedTime);

      const triggerCard = this.homey.flow.getDeviceTriggerCard('last_api_update_changed');
      await triggerCard.trigger(this, { last_api_update: formattedTime });

      this.log(`[API_UPDATE] Last API update time set to: ${formattedTime}`);
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      this.error('[API_UPDATE] Failed to update last API update time:', errorMessage);
    }
  }

  /**
   * Update inverter schedule based on current prices
   */
  async updateScheduleFromPrices(
    settingsOverride: Partial<Record<string, unknown>> = {},
  ): Promise<void> {
    try {
      const cheapestBlocksCount = Number(
        settingsOverride.low_price_blocks_count ?? this.getSetting('low_price_blocks_count') ?? 8,
      );
      const expensiveBlocksCount = Number(
        settingsOverride.expensive_blocks_count ?? this.getSetting('expensive_blocks_count') ?? 8,
      );
      const cheapestBlocksValue = String(
        settingsOverride.cheapest_blocks_value ?? this.getSetting('cheapest_blocks_value') ?? '4',
      );
      const expensiveBlocksValue = String(
        settingsOverride.expensive_blocks_value ?? this.getSetting('expensive_blocks_value') ?? '1',
      );
      const standardStateValue = String(
        settingsOverride.standard_state_value ?? this.getSetting('standard_state_value') ?? '0',
      );
      const timezone = this.resolveTimezone(
        settingsOverride.price_timezone ?? this.getSetting('price_timezone'),
      );

      // Store schedule values for time frame detection
      this.cheapestBlocksValue = cheapestBlocksValue;
      this.expensiveBlocksValue = expensiveBlocksValue;
      this.standardStateValue = standardStateValue;

      this.log(`[PRICE] Fetching prices... (cheapest=${cheapestBlocksCount}, expensive=${expensiveBlocksCount}, tz=${timezone})`);

      // Fetch prices
      const now = Date.now();
      const priceData = await this.priceSource.fetch();

      this.log(`[PRICE] Received ${priceData.length} price entries from SMARD`);

      if (priceData.length === 0) {
        this.error('[PRICE] No price data available!');
        return;
      }

      // Convert PriceDataEntry to PriceBlock format
      const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
      const priceBlocks: PriceBlock[] = [];
      const cache: Record<string, PriceBlock> = {};

      for (const entry of priceData) {
        const start = new Date(entry.date).getTime();
        const end = start + FIFTEEN_MINUTES_MS;
        const block: PriceBlock = { start, end, price: entry.price };
        priceBlocks.push(block);
        cache[String(start)] = block;
      }

      // Log price range
      const prices = priceBlocks.map((b) => b.price).sort((a, b) => a - b);
      const minPrice = prices[0];
      const maxPrice = prices[prices.length - 1];
      this.log(`[PRICE] Price range: ${minPrice?.toFixed(2)} - ${maxPrice?.toFixed(2)} EUR/MWh`);

      // Find cheapest blocks for display
      const cheapest = findCheapestBlocks(cache, cheapestBlocksCount, now);
      this.log(`[PRICE] Found ${cheapest.length} cheapest blocks (wanted ${cheapestBlocksCount})`);

      if (cheapest.length > 0) {
        const cheapestTimes = cheapest.slice(0, 3).map((b) => {
          const d = new Date(b.start);
          return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')} (${b.price.toFixed(2)})`;
        }).join(', ');
        this.log(`[PRICE] Next cheap times: ${cheapestTimes}${cheapest.length > 3 ? '...' : ''}`);
      }

      // Update next charging times display
      const nextTimesText = formatNextChargingTimes(cheapest, {
        now,
        locale: 'de-DE',
        timezone,
      });
      await this.setCapabilityValue('next_charging_times', nextTimesText).catch(() => { });

      // Build price-based schedule
      this.log('[SCHEDULE] Building price-based schedule...');
      const newSchedule = buildPriceBasedSchedule(priceBlocks, {
        cheapestBlocksCount,
        expensiveBlocksCount,
        cheapestBlocksValue,
        expensiveBlocksValue,
        standardStateValue,
        timezone,
      });

      // Log schedule summary for today
      const countChars = (s: string, c: string) => (s.match(new RegExp(c, 'g')) || []).length;
      const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
      const todayDayName = dayNames[new Date().getDay()];
      const todaySchedule = newSchedule[todayDayName];
      const chargeDisallowCount = countChars(todaySchedule, SCHEDULE_VALUE_CHARGE_DISALLOW_USE);
      const chargeAllowCount = countChars(todaySchedule, SCHEDULE_VALUE_CHARGE_ALLOW_USE);
      const noChargeAllowCount = countChars(todaySchedule, SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE);
      const noChargeDisallowCount = countChars(todaySchedule, SCHEDULE_VALUE_NO_CHARGE_DISALLOW_USE);
      const defaultCount = countChars(todaySchedule, SCHEDULE_VALUE_DEFAULT);
      this.log(
        `[SCHEDULE] ${todayDayName.toUpperCase()}: `
        + `${chargeDisallowCount} charge_disallow, ${chargeAllowCount} charge_allow, `
        + `${noChargeAllowCount} no_charge_allow, ${noChargeDisallowCount} no_charge_disallow, `
        + `${defaultCount} default`,
      );

      // Build new config
      const ip = this.getSetting('ip') as string;
      const newConfig: ChargingConfig = {
        soc: Number(settingsOverride.max_soc ?? this.getSetting('max_soc') ?? 80),
        gridPower: Number(settingsOverride.watts ?? this.getSetting('watts') ?? 4000),
        minSoc: Number(settingsOverride.min_soc ?? this.getSetting('min_soc') ?? 10),
        minHomeConsumption: Number(settingsOverride.min_home_consumption ?? this.getSetting('min_home_consumption') ?? 5000),
      };

      // Check if schedule or config changed
      const scheduleChanged = !this.currentSchedule || schedulesAreDifferent(this.currentSchedule, newSchedule);
      const configChanged = !this.currentConfig
        || this.currentConfig.soc !== newConfig.soc
        || this.currentConfig.gridPower !== newConfig.gridPower
        || this.currentConfig.minSoc !== newConfig.minSoc
        || this.currentConfig.minHomeConsumption !== newConfig.minHomeConsumption;

      if (!scheduleChanged && !configChanged) {
        this.log('[SCHEDULE] No changes detected, skipping API call (avoiding solar pause)');
        return;
      }

      // Log what changed
      const changes: string[] = [];
      if (scheduleChanged) changes.push('schedule');
      if (configChanged) changes.push('config');
      this.log(`[SCHEDULE] Changes detected: ${changes.join(', ')}`);

      this.log(`[SCHEDULE] Applying to inverter... (soc=${newConfig.soc}%, power=${newConfig.gridPower}W, minSoc=${newConfig.minSoc}%, minHomeConsumption=${newConfig.minHomeConsumption}W)`);

      const desiredSettings = buildSchedulePayload(newConfig, newSchedule);
      const shouldApply = await this.isSettingsChangeNeeded(ip, desiredSettings);
      if (!shouldApply) {
        this.currentSchedule = newSchedule;
        this.currentConfig = newConfig;
        this.log('[SCHEDULE] Inverter settings already match, skipping API call');
        return;
      }

      await this.sessionManager.executeWithAuthRecovery(
        (sessionId) => setChargingSchedule(ip, sessionId, newConfig, newSchedule),
        'SCHEDULE',
      );

      this.currentSchedule = newSchedule;
      this.currentConfig = newConfig;
      await this.updateLastApiUpdateTime();

      this.log(`[SCHEDULE] Successfully applied: ${formatScheduleForLog(newSchedule)}`);

      // Check and update min home consumption after schedule update
      try {
        await this.checkAndUpdateMinHomeConsumption();
      } catch (error: unknown) {
        this.error('[SCHEDULE] Failed to update min home consumption after schedule update:', extractErrorMessage(error));
      }

    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      this.error('[SCHEDULE] Error updating schedule:', errorMessage);
      await this.setCapabilityValue('next_charging_times', `Error: ${errorMessage.substring(0, 30)}`).catch(() => { });
    }
  }

}

module.exports = KostalBatteryDevice;
