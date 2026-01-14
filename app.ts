'use strict';

import Homey from 'homey';
import { extractErrorMessage } from './logic/utils/errorUtils';

/**
 * Kostal Battery App
 * Controls battery charging on Kostal Plenticore/PIKO IQ inverters
 */
module.exports = class KostalBatteryApp extends Homey.App {

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
