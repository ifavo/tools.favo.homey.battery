'use strict';

import Homey from 'homey';
import { extractErrorMessage } from './logic/utils/errorUtils';
import type { AppStorage } from './logic/lowPrice/sources/cachedPriceSource';

/**
 * Kostal Battery App
 * Controls battery charging on Kostal Plenticore/PIKO IQ inverters
 */
module.exports = class KostalBatteryApp extends Homey.App {

  /**
   * Get app storage adapter that implements AppStorage interface
   * This provides app-level storage for price cache using Homey App Settings API
   * App Settings persist across app restarts and are only deleted when app is uninstalled
   * 
   * In SDK v3, ManagerSettings is accessed via this.homey.settings
   * - get() is synchronous and returns undefined if key doesn't exist
   * - set() is asynchronous and returns a Promise
   */
  getAppStorage(): AppStorage {
    const settings = this.homey.settings;
    return {
      getStoreValue: (key: string): unknown => {
        // get() is synchronous - returns value or undefined
        return settings.get(key);
      },
      setStoreValue: async (key: string, value: unknown): Promise<void> => {
        // set() is asynchronous - must await
        await settings.set(key, value);
      },
      log: (...args: unknown[]): void => {
        this.log(...args);
      },
    };
  }

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    // Set up global error handlers to prevent crashes
    process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
      this.error('[UNHANDLED] Unhandled promise rejection:', extractErrorMessage(reason));
    });

    process.on('uncaughtException', (error: Error) => {
      this.error('[UNHANDLED] Uncaught exception:', extractErrorMessage(error));
    });

    this.log('KostalBatteryApp has been initialized');
  }

};
