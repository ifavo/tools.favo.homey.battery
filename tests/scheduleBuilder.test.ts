/**
 * Tests for Schedule Builder
 */
import {
  buildPriceBasedSchedule,
  schedulesAreDifferent,
  createDefaultSchedule,
  formatScheduleForLog,
  SCHEDULE_VALUE_CHARGE_DISALLOW_USE,
  SCHEDULE_VALUE_DEFAULT,
  SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE,
  type DaySchedule,
} from '../logic/kostalApi/scheduleBuilder';
import type { PriceBlock } from '../logic/lowPrice/types';

describe('Schedule Builder', () => {
  const timezone = 'Europe/Berlin';

  // Helper to create price blocks for a specific day
  function createDayPriceBlocks(
    dayOffset: number,
    baseTime: number,
    prices: number[],
  ): PriceBlock[] {
    const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
    const startOfDay = baseTime + dayOffset * 24 * 60 * 60 * 1000;

    return prices.map((price, index) => ({
      start: startOfDay + index * FIFTEEN_MINUTES_MS,
      end: startOfDay + (index + 1) * FIFTEEN_MINUTES_MS,
      price,
    }));
  }

  describe('buildPriceBasedSchedule', () => {
    test('sets cheapest blocks to charge disallow value', () => {
      // Monday Jan 6, 2025 00:00:00 UTC
      const baseTime = new Date('2025-01-06T00:00:00Z').getTime();

      // Create 96 blocks for Monday with prices 1-96
      const prices = Array.from({ length: 96 }, (_, i) => i + 1);
      const blocks = createDayPriceBlocks(0, baseTime, prices);

      const schedule = buildPriceBasedSchedule(blocks, {
        cheapestBlocksCount: 4,
        expensiveBlocksCount: 0,
        cheapestBlocksValue: '4',
        expensiveBlocksValue: '1',
        standardStateValue: '0',
        timezone: 'UTC',
      });

      // First 4 blocks should be charge value (cheapest)
      expect(schedule.mon[0]).toBe(SCHEDULE_VALUE_CHARGE_DISALLOW_USE);
      expect(schedule.mon[1]).toBe(SCHEDULE_VALUE_CHARGE_DISALLOW_USE);
      expect(schedule.mon[2]).toBe(SCHEDULE_VALUE_CHARGE_DISALLOW_USE);
      expect(schedule.mon[3]).toBe(SCHEDULE_VALUE_CHARGE_DISALLOW_USE);
      // Rest should be default value
      expect(schedule.mon[4]).toBe(SCHEDULE_VALUE_DEFAULT);
      expect(schedule.mon[95]).toBe(SCHEDULE_VALUE_DEFAULT);
    });

    test('sets expensive blocks to no charge allow value', () => {
      const baseTime = new Date('2025-01-06T00:00:00Z').getTime();

      // Create 96 blocks for Monday with prices 1-96
      const prices = Array.from({ length: 96 }, (_, i) => i + 1);
      const blocks = createDayPriceBlocks(0, baseTime, prices);

      const schedule = buildPriceBasedSchedule(blocks, {
        cheapestBlocksCount: 4,
        expensiveBlocksCount: 4,
        cheapestBlocksValue: '4',
        expensiveBlocksValue: '1',
        standardStateValue: '0',
        timezone: 'UTC',
      });

      // First 4 blocks should be charge value (cheapest)
      expect(schedule.mon[0]).toBe(SCHEDULE_VALUE_CHARGE_DISALLOW_USE);
      expect(schedule.mon[1]).toBe(SCHEDULE_VALUE_CHARGE_DISALLOW_USE);
      expect(schedule.mon[2]).toBe(SCHEDULE_VALUE_CHARGE_DISALLOW_USE);
      expect(schedule.mon[3]).toBe(SCHEDULE_VALUE_CHARGE_DISALLOW_USE);
      // Last 4 blocks should be no charge allow value (most expensive)
      expect(schedule.mon[92]).toBe(SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE);
      expect(schedule.mon[93]).toBe(SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE);
      expect(schedule.mon[94]).toBe(SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE);
      expect(schedule.mon[95]).toBe(SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE);
      // Middle blocks should be default value
      expect(schedule.mon[50]).toBe(SCHEDULE_VALUE_DEFAULT);
    });

    test('cheapest blocks take priority over expensive', () => {
      const baseTime = new Date('2025-01-06T00:00:00Z').getTime();

      // Create blocks where same block would be both cheapest and expensive
      // (edge case with very few blocks)
      const prices = [1, 2]; // Only 2 blocks
      const blocks = createDayPriceBlocks(0, baseTime, prices);

      const schedule = buildPriceBasedSchedule(blocks, {
        cheapestBlocksCount: 2,
        expensiveBlocksCount: 2,
        cheapestBlocksValue: '4',
        expensiveBlocksValue: '1',
        standardStateValue: '0',
        timezone: 'UTC',
      });

      // Both blocks should be charge value (cheap takes priority)
      expect(schedule.mon[0]).toBe(SCHEDULE_VALUE_CHARGE_DISALLOW_USE);
      expect(schedule.mon[1]).toBe(SCHEDULE_VALUE_CHARGE_DISALLOW_USE);
    });

    test('handles empty price blocks', () => {
      const schedule = buildPriceBasedSchedule([], {
        cheapestBlocksCount: 4,
        expensiveBlocksCount: 4,
        cheapestBlocksValue: '4',
        expensiveBlocksValue: '1',
        standardStateValue: '0',
        timezone: 'UTC',
      });

      // All days should be default normal values
      expect(schedule.mon).toBe(SCHEDULE_VALUE_DEFAULT.repeat(96));
      expect(schedule.tue).toBe(SCHEDULE_VALUE_DEFAULT.repeat(96));
    });

    test('creates correct schedule length', () => {
      const schedule = createDefaultSchedule();

      expect(schedule.mon.length).toBe(96);
      expect(schedule.tue.length).toBe(96);
      expect(schedule.wed.length).toBe(96);
      expect(schedule.thu.length).toBe(96);
      expect(schedule.fri.length).toBe(96);
      expect(schedule.sat.length).toBe(96);
      expect(schedule.sun.length).toBe(96);
    });
  });

  describe('schedulesAreDifferent', () => {
    test('returns false for identical schedules', () => {
      const schedule1 = createDefaultSchedule();
      const schedule2 = createDefaultSchedule();

      expect(schedulesAreDifferent(schedule1, schedule2)).toBe(false);
    });

    test('returns true for different schedules', () => {
      const schedule1 = createDefaultSchedule();
      const schedule2 = createDefaultSchedule();
      schedule2.mon = SCHEDULE_VALUE_CHARGE_DISALLOW_USE + schedule2.mon.slice(1);

      expect(schedulesAreDifferent(schedule1, schedule2)).toBe(true);
    });
  });

  describe('createDefaultSchedule', () => {
    test('creates schedule with all default values', () => {
      const schedule = createDefaultSchedule();

      expect(schedule.mon).toBe(SCHEDULE_VALUE_DEFAULT.repeat(96));
      expect(schedule.tue).toBe(SCHEDULE_VALUE_DEFAULT.repeat(96));
      expect(schedule.wed).toBe(SCHEDULE_VALUE_DEFAULT.repeat(96));
      expect(schedule.thu).toBe(SCHEDULE_VALUE_DEFAULT.repeat(96));
      expect(schedule.fri).toBe(SCHEDULE_VALUE_DEFAULT.repeat(96));
      expect(schedule.sat).toBe(SCHEDULE_VALUE_DEFAULT.repeat(96));
      expect(schedule.sun).toBe(SCHEDULE_VALUE_DEFAULT.repeat(96));
    });
  });

  describe('formatScheduleForLog', () => {
    test('formats schedule summary correctly', () => {
      const schedule = createDefaultSchedule();
      // Modify one day
      schedule.mon = SCHEDULE_VALUE_CHARGE_DISALLOW_USE.repeat(4)
        + SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE.repeat(4)
        + SCHEDULE_VALUE_DEFAULT.repeat(88);

      const log = formatScheduleForLog(schedule);

      expect(log).toContain('MON:4cd/0ca/4nca/0ncd/88def');
      expect(log).toContain('TUE:0cd/0ca/0nca/0ncd/96def');
    });
  });
});

