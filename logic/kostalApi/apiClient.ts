/**
 * Kostal API Client
 * Functions for interacting with Kostal Plenticore/PIKO IQ inverter
 */
import type {
  ProcessDataModule,
  BatteryStatus,
  SettingsModule,
  ChargingConfig,
  KostalApiError,
} from './types';
import { type DaySchedule, SCHEDULE_VALUE_CHARGE_DISALLOW_USE } from './scheduleBuilder';

/**
 * All charge values for 24 hours (96 quarter-hours) - enables TimeControl for all times
 * Used for manual "always charge" mode
 */
const TIME_CONTROL_ALL_ENABLED = SCHEDULE_VALUE_CHARGE_DISALLOW_USE.repeat(96);

/**
 * Make an authenticated request to the Kostal API
 */
async function kostalRequest<T>(
  ip: string,
  sessionId: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `http://${ip}/api/v1${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': `Session ${sessionId}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    const error = new Error(`Kostal API error ${response.status}: ${text}`) as KostalApiError;
    error.statusCode = response.status;
    throw error;
  }

  const responseText = await response.text();
  if (!responseText) {
    return {} as T;
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Fetch battery status from the inverter
 */
export async function fetchBatteryStatus(
  ip: string,
  sessionId: string,
): Promise<BatteryStatus> {
  const query = [
    {
      moduleid: 'devices:local:battery',
      processdataids: ['P', 'I', 'U', 'SoC', 'Cycles'],
    },
  ];

  const response = await kostalRequest<ProcessDataModule[]>(
    ip,
    sessionId,
    'POST',
    '/processdata',
    query,
  );

  // Find battery module in response
  const batteryModule = response.find((m) => m.moduleid === 'devices:local:battery');

  if (!batteryModule || !batteryModule.processdata) {
    throw new Error('Battery module not found in processdata response');
  }

  // Extract values into a map
  const values: Record<string, number> = {};
  for (const item of batteryModule.processdata) {
    values[item.id] = item.value;
  }

  return {
    soc: values['SoC'] ?? 0,
    power: values['P'] ?? 0,
    voltage: values['U'] ?? 0,
    current: values['I'] ?? 0,
    cycles: values['Cycles'] ?? 0,
  };
}

/**
 * Fetch extended status including PV and AC data
 */
export async function fetchExtendedStatus(
  ip: string,
  sessionId: string,
): Promise<{
  battery: BatteryStatus;
  pv1: { power: number; current: number; voltage: number };
  pv2: { power: number; current: number; voltage: number };
  home: { total: number; fromPv: number; fromBattery: number; fromGrid: number };
}> {
  const query = [
    { moduleid: 'devices:local:pv1', processdataids: ['P', 'I', 'U'] },
    { moduleid: 'devices:local:pv2', processdataids: ['P', 'I', 'U'] },
    {
      moduleid: 'devices:local',
      processdataids: ['Home_P', 'HomePv_P', 'HomeBat_P', 'HomeGrid_P'],
    },
    {
      moduleid: 'devices:local:battery',
      processdataids: ['P', 'I', 'U', 'SoC', 'Cycles'],
    },
  ];

  const response = await kostalRequest<ProcessDataModule[]>(
    ip,
    sessionId,
    'POST',
    '/processdata',
    query,
  );

  // Helper to extract values from a module
  const extractValues = (moduleid: string): Record<string, number> => {
    const module = response.find((m) => m.moduleid === moduleid);
    const values: Record<string, number> = {};
    if (module && module.processdata) {
      for (const item of module.processdata) {
        values[item.id] = item.value;
      }
    }
    return values;
  };

  const batteryValues = extractValues('devices:local:battery');
  const pv1Values = extractValues('devices:local:pv1');
  const pv2Values = extractValues('devices:local:pv2');
  const homeValues = extractValues('devices:local');

  return {
    battery: {
      soc: batteryValues['SoC'] ?? 0,
      power: batteryValues['P'] ?? 0,
      voltage: batteryValues['U'] ?? 0,
      current: batteryValues['I'] ?? 0,
      cycles: batteryValues['Cycles'] ?? 0,
    },
    pv1: {
      power: pv1Values['P'] ?? 0,
      current: pv1Values['I'] ?? 0,
      voltage: pv1Values['U'] ?? 0,
    },
    pv2: {
      power: pv2Values['P'] ?? 0,
      current: pv2Values['I'] ?? 0,
      voltage: pv2Values['U'] ?? 0,
    },
    home: {
      total: homeValues['Home_P'] ?? 0,
      fromPv: homeValues['HomePv_P'] ?? 0,
      fromBattery: homeValues['HomeBat_P'] ?? 0,
      fromGrid: homeValues['HomeGrid_P'] ?? 0,
    },
  };
}

/**
 * Build settings payload for turning grid charging ON
 */
export function buildChargingOnPayload(config: ChargingConfig): SettingsModule[] {
  return [
    {
      moduleid: 'devices:local',
      settings: [
        { id: 'Battery:MinHomeComsumption', value: String(config.minHomeConsumption) },
        { id: 'Battery:MinSoc', value: String(config.minSoc) },
        { id: 'EnergyMgmt:AcStorage', value: '0' },

        { id: 'Battery:TimeControl:Enable', value: '1' },
        { id: 'EnergyMgmt:TimedBatCharge:Soc', value: String(config.soc) },
        { id: 'EnergyMgmt:TimedBatCharge:GridPower', value: String(config.gridPower) },
        { id: 'EnergyMgmt:TimedBatCharge:WD_Soc', value: String(config.soc) },
        { id: 'EnergyMgmt:TimedBatCharge:WD_GridPower', value: String(config.gridPower) },

        { id: 'Battery:TimeControl:ConfMon', value: TIME_CONTROL_ALL_ENABLED },
        { id: 'Battery:TimeControl:ConfTue', value: TIME_CONTROL_ALL_ENABLED },
        { id: 'Battery:TimeControl:ConfWed', value: TIME_CONTROL_ALL_ENABLED },
        { id: 'Battery:TimeControl:ConfThu', value: TIME_CONTROL_ALL_ENABLED },
        { id: 'Battery:TimeControl:ConfFri', value: TIME_CONTROL_ALL_ENABLED },
        { id: 'Battery:TimeControl:ConfSat', value: TIME_CONTROL_ALL_ENABLED },
        { id: 'Battery:TimeControl:ConfSun', value: TIME_CONTROL_ALL_ENABLED },
      ],
    },
    {
      moduleid: 'scb:system',
      settings: [{ id: 'System:SubOperatingMode', value: '2' }],
    },
  ];
}

/**
 * Build settings payload for turning grid charging OFF
 */
export function buildChargingOffPayload(minSoc: number = 15, minHomeConsumption: number = 5000): SettingsModule[] {
  return [
    {
      moduleid: 'devices:local',
      settings: [
        { id: 'Battery:MinHomeComsumption', value: String(minHomeConsumption) },
        { id: 'Battery:MinSoc', value: String(minSoc) },
        { id: 'EnergyMgmt:AcStorage', value: '0' },
        { id: 'Battery:TimeControl:Enable', value: '0' },
      ],
    },
    {
      moduleid: 'scb:system',
      settings: [{ id: 'System:SubOperatingMode', value: '3' }],
    },
  ];
}

/**
 * Fetch settings values from the inverter
 */
export async function fetchSettings(
  ip: string,
  sessionId: string,
  modules: Array<{ moduleid: string; settingids: string[] }>,
): Promise<SettingsModule[]> {
  return kostalRequest<SettingsModule[]>(ip, sessionId, 'POST', '/settings', modules);
}

/**
 * Turn grid charging ON
 */
export async function setChargingOn(
  ip: string,
  sessionId: string,
  config: ChargingConfig,
): Promise<void> {
  const payload = buildChargingOnPayload(config);
  await kostalRequest(ip, sessionId, 'PUT', '/settings', payload);
}

/**
 * Turn grid charging OFF
 */
export async function setChargingOff(
  ip: string,
  sessionId: string,
  minSoc: number = 15,
  minHomeConsumption: number = 5000,
): Promise<void> {
  const payload = buildChargingOffPayload(minSoc, minHomeConsumption);
  await kostalRequest(ip, sessionId, 'PUT', '/settings', payload);
}

/**
 * Test connection to the inverter (used during pairing)
 * Returns battery status if successful
 */
export async function testConnection(
  ip: string,
  sessionId: string,
): Promise<BatteryStatus> {
  return fetchBatteryStatus(ip, sessionId);
}

/**
 * Build settings payload for price-based schedule
 * Uses day-specific time control configurations based on price data
 */
export function buildSchedulePayload(
  config: ChargingConfig,
  schedule: DaySchedule,
): SettingsModule[] {
  return [
    {
      moduleid: 'devices:local',
      settings: [
        { id: 'Battery:MinHomeComsumption', value: String(config.minHomeConsumption) },
        { id: 'Battery:MinSoc', value: String(config.minSoc) },
        { id: 'EnergyMgmt:AcStorage', value: '0' },

        { id: 'Battery:TimeControl:Enable', value: '1' },
        { id: 'EnergyMgmt:TimedBatCharge:Soc', value: String(config.soc) },
        { id: 'EnergyMgmt:TimedBatCharge:GridPower', value: String(config.gridPower) },
        { id: 'EnergyMgmt:TimedBatCharge:WD_Soc', value: String(config.soc) },
        { id: 'EnergyMgmt:TimedBatCharge:WD_GridPower', value: String(config.gridPower) },

        // Price-based day schedules
        { id: 'Battery:TimeControl:ConfMon', value: schedule.mon },
        { id: 'Battery:TimeControl:ConfTue', value: schedule.tue },
        { id: 'Battery:TimeControl:ConfWed', value: schedule.wed },
        { id: 'Battery:TimeControl:ConfThu', value: schedule.thu },
        { id: 'Battery:TimeControl:ConfFri', value: schedule.fri },
        { id: 'Battery:TimeControl:ConfSat', value: schedule.sat },
        { id: 'Battery:TimeControl:ConfSun', value: schedule.sun },
      ],
    },
    {
      moduleid: 'scb:system',
      settings: [{ id: 'System:SubOperatingMode', value: '2' }],
    },
  ];
}

/**
 * Set price-based charging schedule
 * Updates time control configuration based on day-ahead prices
 */
export async function setChargingSchedule(
  ip: string,
  sessionId: string,
  config: ChargingConfig,
  schedule: DaySchedule,
): Promise<void> {
  const payload = buildSchedulePayload(config, schedule);
  await kostalRequest(ip, sessionId, 'PUT', '/settings', payload);
}

