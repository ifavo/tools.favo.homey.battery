'use strict';

import Homey from 'homey';
import { performScramAuth } from '../../logic/kostalApi/scramAuth';
import { testConnection } from '../../logic/kostalApi/apiClient';
import { extractErrorMessage } from '../../logic/utils/errorUtils';

/**
 * Kostal Battery Driver
 * Handles device pairing with IP/password configuration
 */
class KostalBatteryDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit(): Promise<void> {
    this.log('KostalBatteryDriver has been initialized');
  }

  /**
   * onPair is called when a user starts pairing
   */
  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    let ip = '';
    let password = '';
    let sessionId = '';

    // Handle credentials from the pairing view
    session.setHandler('configure', async (data: { ip: string; password: string }) => {
      this.log('[PAIR] Received configuration:', { ip: data.ip, password: '***' });

      ip = data.ip;
      password = data.password;

      if (!ip || !password) {
        throw new Error('IP address and password are required');
      }

      // Test connection by authenticating
      try {
        this.log('[PAIR] Testing SCRAM authentication...');
        sessionId = await performScramAuth(ip, password, 'user');
        this.log('[PAIR] Authentication successful');

        // Test reading battery status
        this.log('[PAIR] Testing battery status read...');
        const status = await testConnection(ip, sessionId);
        this.log(`[PAIR] Battery status: SoC=${status.soc}%, P=${status.power}W`);

        return {
          success: true,
          status: {
            soc: status.soc,
            power: status.power,
            voltage: status.voltage,
            current: status.current,
            cycles: status.cycles,
          },
        };
      } catch (error: unknown) {
        const errorMessage = extractErrorMessage(error);
        this.error('[PAIR] Configuration failed:', errorMessage);
        throw new Error(`Connection failed: ${errorMessage}`);
      }
    });

    // List devices - called after successful configuration
    session.setHandler('list_devices', async () => {
      if (!ip || !sessionId) {
        throw new Error('Please configure the inverter connection first');
      }

      this.log('[PAIR] Creating device for inverter at:', ip);

      return [
        {
          name: `Kostal Battery (${ip})`,
          data: {
            id: `kostal-${ip.replace(/\./g, '-')}`,
          },
          settings: {
            ip,
            password,
          },
          store: {
            _kostal_session: {
              sessionId,
              createdAt: Date.now(),
            },
          },
        },
      ];
    });
  }

}

module.exports = KostalBatteryDriver;

