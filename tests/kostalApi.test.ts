/**
 * Tests for Kostal API Client
 */
import {
  fetchBatteryStatus,
  buildChargingOnPayload,
  buildChargingOffPayload,
  buildSchedulePayload,
  fetchSettings,
  type BatteryStatus,
  type ChargingConfig,
} from '../logic/kostalApi/apiClient';
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
  });

  describe('buildChargingOnPayload', () => {
    test('builds correct payload with default values', () => {
      const config: ChargingConfig = {
        soc: 80,
        gridPower: 4000,
        minSoc: 10,
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
      const payload = buildChargingOffPayload(15);

      expect(payload).toHaveLength(2);

      // Check devices:local module
      const devicesLocal = payload.find((m) => m.moduleid === 'devices:local');
      expect(devicesLocal).toBeDefined();
      expect(devicesLocal?.settings).toContainEqual({ id: 'Battery:TimeControl:Enable', value: '0' });
      expect(devicesLocal?.settings).toContainEqual({ id: 'Battery:MinSoc', value: '15' });

      // Check scb:system module
      const scbSystem = payload.find((m) => m.moduleid === 'scb:system');
      expect(scbSystem).toBeDefined();
      expect(scbSystem?.settings).toContainEqual({ id: 'System:SubOperatingMode', value: '3' });
    });

    test('uses default minSoc when not provided', () => {
      const payload = buildChargingOffPayload();

      const devicesLocal = payload.find((m) => m.moduleid === 'devices:local');
      expect(devicesLocal?.settings).toContainEqual({ id: 'Battery:MinSoc', value: '15' });
    });
  });

  describe('buildSchedulePayload', () => {
    test('includes schedule and config values', () => {
      const config: ChargingConfig = {
        soc: 75,
        gridPower: 3500,
        minSoc: 10,
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
});

