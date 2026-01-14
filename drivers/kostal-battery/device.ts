'use strict';

import Homey from 'homey';
import { SessionManager } from '../../logic/kostalApi/sessionManager';
import {
  fetchBatteryStatus,
  setChargingSchedule,
  setChargingOff,
} from '../../logic/kostalApi/apiClient';
import {
  buildPriceBasedSchedule,
  schedulesAreDifferent,
  formatScheduleForLog,
  SCHEDULE_VALUE_CHARGE,
  SCHEDULE_VALUE_NORMAL,
  SCHEDULE_VALUE_AVOID,
  type DaySchedule,
} from '../../logic/kostalApi/scheduleBuilder';
import type { BatteryStatus, ChargingConfig } from '../../logic/kostalApi/types';
import { SmardPriceSource } from '../../logic/lowPrice/sources/smard';
import type { PriceDataSource } from '../../logic/lowPrice/priceSource';
import type { PriceBlock } from '../../logic/lowPrice/types';
import { findCheapestBlocks } from '../../logic/lowPrice/findCheapestHours';
import { formatNextChargingTimes } from '../../logic/lowPrice/formatNextChargingTimes';
import { extractErrorMessage } from '../../logic/utils/errorUtils';
import {
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_HOUR,
} from '../../logic/utils/dateUtils';

/**
 * Kostal Battery Device
 * Manages a Kostal inverter battery with status polling and price-based schedule control
 */
class KostalBatteryDevice extends Homey.Device {

  private sessionManager!: SessionManager;
  private priceSource!: PriceDataSource;
  private pollingInterval?: NodeJS.Timeout;
  private priceUpdateInterval?: NodeJS.Timeout;

  private readonly POLL_INTERVAL = 60 * 1000; // 60 seconds
  private readonly PRICE_UPDATE_INTERVAL = MILLISECONDS_PER_HOUR; // Update schedule hourly
  private readonly MANUAL_OVERRIDE_DURATION = 15 * MILLISECONDS_PER_MINUTE;

  // Current settings (to detect changes and avoid unnecessary API calls)
  private currentSchedule?: DaySchedule;
  private currentConfig?: ChargingConfig;
  private manualOverrideTimestamp?: number;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit(): Promise<void> {
    this.log('KostalBatteryDevice has been initialized');

    // Get connection settings
    const ip = this.getSetting('ip') as string;
    const password = this.getSetting('password') as string;

    if (!ip || !password) {
      this.setUnavailable('Inverter IP or password not configured').catch(() => {});
      return;
    }

    // Initialize session manager
    this.sessionManager = new SessionManager(ip, password, this);

    // Initialize SMARD price source
    this.priceSource = new SmardPriceSource('DE-LU');
    this.log('[PRICE] Using SMARD API as price data source');

    // Register capability listeners
    this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));

    // Start polling
    await this.startPolling();

    // Start price-based schedule updates
    const enableLowPrice = this.getSetting('enable_low_price_charging') as boolean;
    if (enableLowPrice) {
      await this.startScheduleUpdates();
    }

    this.log('[INIT] Device initialization completed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted(): Promise<void> {
    this.stopPolling();
    this.stopScheduleUpdates();
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

    // Handle low price charging toggle
    if (event.changedKeys.includes('enable_low_price_charging')) {
      const enabled = event.newSettings.enable_low_price_charging as boolean;
      if (enabled) {
        await this.startScheduleUpdates();
      } else {
        this.stopScheduleUpdates();
        // Turn off time control when disabling
        await this.setChargingOff();
      }
    }

    // If schedule-related settings changed, force schedule update
    const scheduleSettings = ['low_price_blocks_count', 'expensive_blocks_count'];
    const configSettings = ['min_soc', 'max_soc', 'watts'];
    const hasScheduleChange = scheduleSettings.some((s) => event.changedKeys.includes(s));
    const hasConfigChange = configSettings.some((s) => event.changedKeys.includes(s));

    if (hasScheduleChange || hasConfigChange) {
      // Clear cached values to force update
      if (hasScheduleChange) this.currentSchedule = undefined;
      if (hasConfigChange) this.currentConfig = undefined;

      const enabled = event.newSettings.enable_low_price_charging as boolean ?? this.getSetting('enable_low_price_charging');
      if (enabled) {
        await this.updateScheduleFromPrices();
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
      await this.setUnavailable(`Error: ${errorMessage.substring(0, 50)}`).catch(() => {});
    }
  }

  /**
   * Update device capabilities from battery status
   */
  async updateCapabilities(status: BatteryStatus): Promise<void> {
    await this.setCapabilityValue('measure_battery', status.soc).catch(() => {});
    await this.setCapabilityValue('measure_power', status.power).catch(() => {});
    await this.setCapabilityValue('measure_voltage', status.voltage).catch(() => {});
    await this.setCapabilityValue('measure_current', status.current).catch(() => {});
    // Note: cycles data is fetched but not displayed (no standard Homey capability)
  }

  /**
   * Handle onoff capability change (manual user control)
   */
  async onCapabilityOnOff(value: boolean): Promise<void> {
    this.log(`[ONOFF] Manual control: ${value}`);

    // Set manual override timestamp
    this.manualOverrideTimestamp = Date.now();

    try {
      if (value) {
        // When manually turning on, apply current schedule immediately
        await this.updateScheduleFromPrices();
      } else {
        await this.setChargingOff();
      }
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      this.error('[ONOFF] Failed to set charging state:', errorMessage);
      throw error;
    }
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

    await this.sessionManager.executeWithAuthRecovery(
      (sessionId) => setChargingOff(ip, sessionId, minSoc),
      'CHARGING_OFF',
    );

    await this.setCapabilityValue('onoff', false).catch(() => {});
    this.currentSchedule = undefined;
    this.currentConfig = undefined;
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
   * Update inverter schedule based on current prices
   */
  async updateScheduleFromPrices(): Promise<void> {
    try {
      const enableLowPrice = this.getSetting('enable_low_price_charging') as boolean;
      const cheapestBlocksCount = this.getSetting('low_price_blocks_count') as number || 8;
      const expensiveBlocksCount = this.getSetting('expensive_blocks_count') as number || 8;
      const timezone = this.getSetting('price_timezone') as string || this.homey.clock.getTimezone();

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
      await this.setCapabilityValue('next_charging_times', nextTimesText).catch(() => {});

      // Only update schedule if feature is enabled
      if (!enableLowPrice) {
        this.log('[PRICE] Low price charging disabled, skipping schedule update');
        return;
      }

      // Build price-based schedule
      this.log('[SCHEDULE] Building price-based schedule...');
      const newSchedule = buildPriceBasedSchedule(priceBlocks, {
        cheapestBlocksCount,
        expensiveBlocksCount,
        timezone,
      });

      // Log schedule summary for today
      const countChars = (s: string, c: string) => (s.match(new RegExp(c, 'g')) || []).length;
      const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
      const todayDayName = dayNames[new Date().getDay()];
      const todaySchedule = newSchedule[todayDayName];
      this.log(`[SCHEDULE] ${todayDayName.toUpperCase()}: ${countChars(todaySchedule, SCHEDULE_VALUE_CHARGE)} charge blocks, ${countChars(todaySchedule, SCHEDULE_VALUE_AVOID)} avoid blocks, ${countChars(todaySchedule, SCHEDULE_VALUE_NORMAL)} normal blocks`);

      // Build new config
      const ip = this.getSetting('ip') as string;
      const newConfig: ChargingConfig = {
        soc: this.getSetting('max_soc') as number || 80,
        gridPower: this.getSetting('watts') as number || 4000,
        minSoc: this.getSetting('min_soc') as number || 10,
      };

      // Check if schedule or config changed
      const scheduleChanged = !this.currentSchedule || schedulesAreDifferent(this.currentSchedule, newSchedule);
      const configChanged = !this.currentConfig ||
        this.currentConfig.soc !== newConfig.soc ||
        this.currentConfig.gridPower !== newConfig.gridPower ||
        this.currentConfig.minSoc !== newConfig.minSoc;

      if (!scheduleChanged && !configChanged) {
        this.log('[SCHEDULE] No changes detected, skipping API call (avoiding solar pause)');
        return;
      }

      // Log what changed
      const changes: string[] = [];
      if (scheduleChanged) changes.push('schedule');
      if (configChanged) changes.push('config');
      this.log(`[SCHEDULE] Changes detected: ${changes.join(', ')}`);

      this.log(`[SCHEDULE] Applying to inverter... (soc=${newConfig.soc}%, power=${newConfig.gridPower}W, minSoc=${newConfig.minSoc}%)`);

      await this.sessionManager.executeWithAuthRecovery(
        (sessionId) => setChargingSchedule(ip, sessionId, newConfig, newSchedule),
        'SCHEDULE',
      );

      this.currentSchedule = newSchedule;
      this.currentConfig = newConfig;
      await this.setCapabilityValue('onoff', true).catch(() => {});

      this.log(`[SCHEDULE] Successfully applied: ${formatScheduleForLog(newSchedule)}`);

    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      this.error('[SCHEDULE] Error updating schedule:', errorMessage);
      await this.setCapabilityValue('next_charging_times', `Error: ${errorMessage.substring(0, 30)}`).catch(() => {});
    }
  }

}

module.exports = KostalBatteryDevice;
