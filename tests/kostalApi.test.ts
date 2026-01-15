/**
 * Tests for Kostal API Client
 */
import {
  fetchBatteryStatus,
  fetchExtendedStatus,
  buildChargingOnPayload,
  buildChargingOffPayload,
  buildSchedulePayload,
  fetchSettings,
  setChargingOn,
  setChargingOff,
  setChargingSchedule,
  testConnection,
  setMinHomeConsumption,
} from '../logic/kostalApi/apiClient';
import type { BatteryStatus, ChargingConfig } from '../logic/kostalApi/types';
import { createDefaultSchedule } from '../logic/kostalApi/scheduleBuilder';
import { type DaySchedule } from '../logic/kostalApi/scheduleBuilder';

// Mock fetch globally
global.fetch = jest.fn();

describe('Kostal API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('fetchBatteryStatus', () => {
    const mockIp = '192.168.5.48';
    const mockSessionId = 'test-session-123';

    const mockProcessDataResponse = [
      {
        moduleid: 'devices:local:battery',
        processdata: [
          { id: 'SoC', unit: '', value: 75.5 },
          { id: 'P', unit: '', value: 1234.5 },
          { id: 'U', unit: '', value: 195.3 },
          { id: 'I', unit: '', value: 6.32 },
          { id: 'Cycles', unit: '', value: 42 },
        ],
      },
    ];

    test('fetches battery status successfully', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify(mockProcessDataResponse)),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchBatteryStatus(mockIp, mockSessionId);

      expect(result.soc).toBe(75.5);
      expect(result.power).toBe(1234.5);
      expect(result.voltage).toBe(195.3);
      expect(result.current).toBe(6.32);
      expect(result.cycles).toBe(42);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        `http://${mockIp}/api/v1/processdata`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `Session ${mockSessionId}`,
          }),
        }),
      );
    });

    test('handles missing battery module', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify([
          { moduleid: 'devices:local:pv1', processdata: [] },
        ])),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await expect(fetchBatteryStatus(mockIp, mockSessionId)).rejects.toThrow(
        'Battery module not found',
      );
    });

    test('handles HTTP error', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('Unauthorized'),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await expect(fetchBatteryStatus(mockIp, mockSessionId)).rejects.toThrow('401');
    });

    test('handles missing values with defaults', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify([
          {
            moduleid: 'devices:local:battery',
            processdata: [
              { id: 'SoC', unit: '', value: 50 },
              // Other values missing
            ],
          },
        ])),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchBatteryStatus(mockIp, mockSessionId);

      expect(result.soc).toBe(50);
      expect(result.power).toBe(0);
      expect(result.voltage).toBe(0);
      expect(result.current).toBe(0);
      expect(result.cycles).toBe(0);
    });

    test('handles missing SoC value with ?? 0 fallback', async () => {
      // Test the ?? 0 fallback when SoC is missing from processdata
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify([
          {
            moduleid: 'devices:local:battery',
            processdata: [
              { id: 'P', unit: '', value: 1234.5 },
              { id: 'U', unit: '', value: 195.3 },
              { id: 'I', unit: '', value: 6.32 },
              { id: 'Cycles', unit: '', value: 42 },
              // SoC is missing - should use ?? 0 fallback
            ],
          },
        ])),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchBatteryStatus(mockIp, mockSessionId);

      // SoC should be 0 due to ?? 0 fallback
      expect(result.soc).toBe(0);
      expect(result.power).toBe(1234.5);
      expect(result.voltage).toBe(195.3);
      expect(result.current).toBe(6.32);
      expect(result.cycles).toBe(42);
    });

    test('handles missing power value with ?? 0 fallback', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify([
          {
            moduleid: 'devices:local:battery',
            processdata: [
              { id: 'SoC', unit: '', value: 75.5 },
              // P is missing - should use ?? 0 fallback
              { id: 'U', unit: '', value: 195.3 },
              { id: 'I', unit: '', value: 6.32 },
              { id: 'Cycles', unit: '', value: 42 },
            ],
          },
        ])),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchBatteryStatus(mockIp, mockSessionId);
      expect(result.power).toBe(0); // ?? 0 fallback
      expect(result.soc).toBe(75.5);
    });

    test('handles missing voltage value with ?? 0 fallback', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify([
          {
            moduleid: 'devices:local:battery',
            processdata: [
              { id: 'SoC', unit: '', value: 75.5 },
              { id: 'P', unit: '', value: 1234.5 },
              // U is missing - should use ?? 0 fallback
              { id: 'I', unit: '', value: 6.32 },
              { id: 'Cycles', unit: '', value: 42 },
            ],
          },
        ])),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchBatteryStatus(mockIp, mockSessionId);
      expect(result.voltage).toBe(0); // ?? 0 fallback
      expect(result.soc).toBe(75.5);
    });

    test('handles missing current value with ?? 0 fallback', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify([
          {
            moduleid: 'devices:local:battery',
            processdata: [
              { id: 'SoC', unit: '', value: 75.5 },
              { id: 'P', unit: '', value: 1234.5 },
              { id: 'U', unit: '', value: 195.3 },
              // I is missing - should use ?? 0 fallback
              { id: 'Cycles', unit: '', value: 42 },
            ],
          },
        ])),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchBatteryStatus(mockIp, mockSessionId);
      expect(result.current).toBe(0); // ?? 0 fallback
      expect(result.soc).toBe(75.5);
    });

    test('handles missing cycles value with ?? 0 fallback', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify([
          {
            moduleid: 'devices:local:battery',
            processdata: [
              { id: 'SoC', unit: '', value: 75.5 },
              { id: 'P', unit: '', value: 1234.5 },
              { id: 'U', unit: '', value: 195.3 },
              { id: 'I', unit: '', value: 6.32 },
              // Cycles is missing - should use ?? 0 fallback
            ],
          },
        ])),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchBatteryStatus(mockIp, mockSessionId);
      expect(result.cycles).toBe(0); // ?? 0 fallback
      expect(result.soc).toBe(75.5);
    });
  });

  describe('buildChargingOnPayload', () => {
    test('builds correct payload with default values', () => {
      const config: ChargingConfig = {
        soc: 80,
        gridPower: 4000,
        minSoc: 10,
        minHomeConsumption: 5000,
      };

      const payload = buildChargingOnPayload(config);

      expect(payload).toHaveLength(2);

      // Check devices:local module
      const devicesLocal = payload.find((m) => m.moduleid === 'devices:local');
      expect(devicesLocal).toBeDefined();
      expect(devicesLocal?.settings).toContainEqual({ id: 'Battery:TimeControl:Enable', value: '1' });
      expect(devicesLocal?.settings).toContainEqual({ id: 'EnergyMgmt:TimedBatCharge:Soc', value: '80' });
      expect(devicesLocal?.settings).toContainEqual({ id: 'EnergyMgmt:TimedBatCharge:GridPower', value: '4000' });
      expect(devicesLocal?.settings).toContainEqual({ id: 'Battery:MinSoc', value: '10' });
      expect(devicesLocal?.settings).toContainEqual({ id: 'Battery:MinHomeComsumption', value: '5000' });

      // Check scb:system module
      const scbSystem = payload.find((m) => m.moduleid === 'scb:system');
      expect(scbSystem).toBeDefined();
      expect(scbSystem?.settings).toContainEqual({ id: 'System:SubOperatingMode', value: '2' });
    });

    test('includes time control configs for all days', () => {
      const config: ChargingConfig = {
        soc: 80,
        gridPower: 4000,
        minSoc: 10,
        minHomeConsumption: 5000,
      };

      const payload = buildChargingOnPayload(config);
      const devicesLocal = payload.find((m) => m.moduleid === 'devices:local');

      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      for (const day of days) {
        const setting = devicesLocal?.settings.find((s) => s.id === `Battery:TimeControl:Conf${day}`);
        expect(setting).toBeDefined();
        expect(setting?.value).toHaveLength(96); // 96 quarter-hours in a day
      }
    });
  });

  describe('buildChargingOffPayload', () => {
    test('builds correct payload for turning off', () => {
      const payload = buildChargingOffPayload(15, 5000);

      expect(payload).toHaveLength(2);

      // Check devices:local module
      const devicesLocal = payload.find((m) => m.moduleid === 'devices:local');
      expect(devicesLocal).toBeDefined();
      expect(devicesLocal?.settings).toContainEqual({ id: 'Battery:TimeControl:Enable', value: '0' });
      expect(devicesLocal?.settings).toContainEqual({ id: 'Battery:MinSoc', value: '15' });
      expect(devicesLocal?.settings).toContainEqual({ id: 'Battery:MinHomeComsumption', value: '5000' });

      // Check scb:system module
      const scbSystem = payload.find((m) => m.moduleid === 'scb:system');
      expect(scbSystem).toBeDefined();
      expect(scbSystem?.settings).toContainEqual({ id: 'System:SubOperatingMode', value: '3' });
    });

    test('uses default minSoc when not provided', () => {
      const payload = buildChargingOffPayload();

      const devicesLocal = payload.find((m) => m.moduleid === 'devices:local');
      expect(devicesLocal?.settings).toContainEqual({ id: 'Battery:MinSoc', value: '15' });
      expect(devicesLocal?.settings).toContainEqual({ id: 'Battery:MinHomeComsumption', value: '5000' });
    });
  });

  describe('buildSchedulePayload', () => {
    test('includes schedule and config values', () => {
      const config: ChargingConfig = {
        soc: 75,
        gridPower: 3500,
        minSoc: 10,
        minHomeConsumption: 5000,
      };
      const schedule: DaySchedule = {
        mon: '2'.repeat(96),
        tue: '3'.repeat(96),
        wed: '0'.repeat(96),
        thu: '2'.repeat(96),
        fri: '2'.repeat(96),
        sat: '2'.repeat(96),
        sun: '2'.repeat(96),
      };

      const payload = buildSchedulePayload(config, schedule);
      const devicesLocal = payload.find((m) => m.moduleid === 'devices:local');

      expect(devicesLocal?.settings).toContainEqual({ id: 'Battery:MinSoc', value: '10' });
      expect(devicesLocal?.settings).toContainEqual({ id: 'EnergyMgmt:TimedBatCharge:Soc', value: '75' });
      expect(devicesLocal?.settings).toContainEqual({ id: 'EnergyMgmt:TimedBatCharge:GridPower', value: '3500' });
      expect(devicesLocal?.settings).toContainEqual({ id: 'Battery:MinHomeComsumption', value: '5000' });
      expect(devicesLocal?.settings).toContainEqual({ id: 'Battery:TimeControl:ConfTue', value: schedule.tue });
      expect(devicesLocal?.settings).toContainEqual({ id: 'Battery:TimeControl:ConfWed', value: schedule.wed });
    });
  });

  describe('fetchSettings', () => {
    const mockIp = '192.168.5.48';
    const mockSessionId = 'test-session-123';

    test('fetches settings successfully', async () => {
      const mockResponsePayload = [
        {
          moduleid: 'devices:local',
          settings: [
            { id: 'Battery:MinSoc', value: '10' },
            { id: 'EnergyMgmt:TimedBatCharge:GridPower', value: '4000.0' },
          ],
        },
      ];

      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify(mockResponsePayload)),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchSettings(mockIp, mockSessionId, [
        { moduleid: 'devices:local', settingids: ['Battery:MinSoc'] },
      ]);

      expect(result).toEqual(mockResponsePayload);
      expect(global.fetch).toHaveBeenCalledWith(
        `http://${mockIp}/api/v1/settings`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `Session ${mockSessionId}`,
          }),
        }),
      );
    });

    test('handles empty response body', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(''),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchSettings(mockIp, mockSessionId, [
        { moduleid: 'devices:local', settingids: ['Battery:MinSoc'] },
      ]);

      expect(result).toEqual({});
    });

    test('handles HTTP error', async () => {
      const mockResponse = {
        ok: false,
        status: 403,
        text: jest.fn().mockResolvedValue('Forbidden'),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await expect(fetchSettings(mockIp, mockSessionId, [
        { moduleid: 'devices:local', settingids: ['Battery:MinSoc'] },
      ])).rejects.toThrow('403');
    });
  });

  describe('setMinHomeConsumption', () => {
    const mockIp = '192.168.5.48';
    const mockSessionId = 'test-session-123';

    test('sends correct payload to update only MinHomeComsumption', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(''),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await setMinHomeConsumption(mockIp, mockSessionId, 5000);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe(`http://${mockIp}/api/v1/settings`);
      expect(callArgs[1]?.method).toBe('PUT');
      expect(callArgs[1]?.headers).toMatchObject({
        'Authorization': `Session ${mockSessionId}`,
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(callArgs[1]?.body);
      expect(body).toEqual([
        {
          moduleid: 'devices:local',
          settings: [
            { id: 'Battery:MinHomeComsumption', value: '5000' },
          ],
        },
      ]);
    });

    test('handles different values correctly', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(''),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await setMinHomeConsumption(mockIp, mockSessionId, 50);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body);
      expect(body[0].settings[0].value).toBe('50');
    });

    test('handles API errors', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Internal Server Error'),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await expect(setMinHomeConsumption(mockIp, mockSessionId, 1000)).rejects.toThrow(
        'Kostal API error 500',
      );
    });
  });

  describe('fetchExtendedStatus', () => {
    const mockIp = '192.168.5.48';
    const mockSessionId = 'test-session-123';

    const mockExtendedResponse = [
      {
        moduleid: 'devices:local:battery',
        processdata: [
          { id: 'SoC', unit: '', value: 75.5 },
          { id: 'P', unit: '', value: 1234.5 },
          { id: 'U', unit: '', value: 195.3 },
          { id: 'I', unit: '', value: 6.32 },
          { id: 'Cycles', unit: '', value: 42 },
        ],
      },
      {
        moduleid: 'devices:local:pv1',
        processdata: [
          { id: 'P', unit: '', value: 2000 },
          { id: 'I', unit: '', value: 10 },
          { id: 'U', unit: '', value: 200 },
        ],
      },
      {
        moduleid: 'devices:local:pv2',
        processdata: [
          { id: 'P', unit: '', value: 1500 },
          { id: 'I', unit: '', value: 7.5 },
          { id: 'U', unit: '', value: 200 },
        ],
      },
      {
        moduleid: 'devices:local',
        processdata: [
          { id: 'Home_P', unit: '', value: 3000 },
          { id: 'HomePv_P', unit: '', value: 2000 },
          { id: 'HomeBat_P', unit: '', value: 500 },
          { id: 'HomeGrid_P', unit: '', value: 500 },
        ],
      },
    ];

    test('fetches extended status successfully', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify(mockExtendedResponse)),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchExtendedStatus(mockIp, mockSessionId);

      expect(result.battery.soc).toBe(75.5);
      expect(result.battery.power).toBe(1234.5);
      expect(result.pv1.power).toBe(2000);
      expect(result.pv2.power).toBe(1500);
      expect(result.home.total).toBe(3000);
      expect(result.home.fromPv).toBe(2000);
      expect(result.home.fromBattery).toBe(500);
      expect(result.home.fromGrid).toBe(500);
    });

    test('handles missing modules gracefully', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify([
          { moduleid: 'devices:local:battery', processdata: [] },
        ])),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchExtendedStatus(mockIp, mockSessionId);

      expect(result.battery.soc).toBe(0);
      expect(result.pv1.power).toBe(0);
      expect(result.home.total).toBe(0);
    });
  });

  describe('setChargingOn', () => {
    const mockIp = '192.168.5.48';
    const mockSessionId = 'test-session-123';
    const mockConfig: ChargingConfig = {
      soc: 80,
      gridPower: 4000,
      minSoc: 10,
      minHomeConsumption: 1000,
    };

    test('sends correct payload to turn charging on', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(''),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await setChargingOn(mockIp, mockSessionId, mockConfig);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe(`http://${mockIp}/api/v1/settings`);
      expect(callArgs[1]?.method).toBe('PUT');
    });
  });

  describe('setChargingOff', () => {
    const mockIp = '192.168.5.48';
    const mockSessionId = 'test-session-123';

    test('sends correct payload to turn charging off with defaults', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(''),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await setChargingOff(mockIp, mockSessionId);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe(`http://${mockIp}/api/v1/settings`);
      expect(callArgs[1]?.method).toBe('PUT');
    });

    test('sends correct payload with custom values', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(''),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await setChargingOff(mockIp, mockSessionId, 20, 2000);

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('testConnection', () => {
    const mockIp = '192.168.5.48';
    const mockSessionId = 'test-session-123';

    test('returns battery status', async () => {
      const mockProcessDataResponse = [
        {
          moduleid: 'devices:local:battery',
          processdata: [
            { id: 'SoC', unit: '', value: 75.5 },
            { id: 'P', unit: '', value: 1234.5 },
            { id: 'U', unit: '', value: 195.3 },
            { id: 'I', unit: '', value: 6.32 },
            { id: 'Cycles', unit: '', value: 42 },
          ],
        },
      ];

      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify(mockProcessDataResponse)),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await testConnection(mockIp, mockSessionId);

      expect(result.soc).toBe(75.5);
      expect(result.power).toBe(1234.5);
    });
  });

  describe('setChargingSchedule', () => {
    const mockIp = '192.168.5.48';
    const mockSessionId = 'test-session-123';
    const mockConfig: ChargingConfig = {
      soc: 80,
      gridPower: 4000,
      minSoc: 10,
      minHomeConsumption: 1000,
    };
    const mockSchedule = createDefaultSchedule();

    test('sends correct payload to set schedule', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(''),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await setChargingSchedule(mockIp, mockSessionId, mockConfig, mockSchedule);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe(`http://${mockIp}/api/v1/settings`);
      expect(callArgs[1]?.method).toBe('PUT');
    });
  });

  describe('kostalRequest error handling', () => {
    const mockIp = '192.168.5.48';
    const mockSessionId = 'test-session-123';

    test('handles invalid JSON response - returns empty object', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue('invalid json{'),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      // When JSON parsing fails, kostalRequest catches the error and returns empty object {}
      // This tests the catch block at line 57
      // fetchBatteryStatus will then fail because {} is not an array (no .find method)
      await expect(fetchBatteryStatus(mockIp, mockSessionId)).rejects.toThrow(
        'response.find is not a function',
      );
    });

    test('handles empty response text - returns empty object', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(''),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      // Empty response text returns {} (line 51)
      // fetchBatteryStatus will then fail because {} is not an array (no .find method)
      await expect(fetchBatteryStatus(mockIp, mockSessionId)).rejects.toThrow(
        'response.find is not a function',
      );
    });

    test('handles response.text() error in error handler', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: jest.fn().mockRejectedValue(new Error('Failed to read response')),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      // When response.text() fails in error handler, it should catch and use 'Unknown error'
      await expect(fetchBatteryStatus(mockIp, mockSessionId)).rejects.toThrow(
        'Kostal API error 500',
      );
    });
  });

  describe('kostalRequest body parameter handling', () => {
    const mockIp = '192.168.5.48';
    const mockSessionId = 'test-session-123';

    test('body is always stringified', async () => {
      // Test that body is stringified when provided
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify([])),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const modules = [{ moduleid: 'devices:local', settingids: ['test'] }];
      await fetchSettings(mockIp, mockSessionId, modules);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      expect(callArgs[1]?.body).toBe(JSON.stringify(modules));
      expect(typeof callArgs[1]?.body).toBe('string');
    });
  });
});

