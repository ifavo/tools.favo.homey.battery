/**
 * Tests for Schedule Builder
 */
import {
  buildPriceBasedSchedule,
  schedulesAreDifferent,
  createDefaultSchedule,
  formatScheduleForLog,
  SCHEDULE_VALUE_CHARGE_DISALLOW_USE,
  SCHEDULE_VALUE_CHARGE_ALLOW_USE,
  SCHEDULE_VALUE_DEFAULT,
  SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE,
  SCHEDULE_VALUE_NO_CHARGE_DISALLOW_USE,
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

    test('handles match returning null (|| [] fallback)', () => {
      // Test the || [] fallback when match returns null
      // This happens when a schedule value doesn't appear in the string
      const schedule = createDefaultSchedule();
      
      // Create a schedule with a custom value that won't match any regex
      schedule.mon = 'X'.repeat(96); // Custom value that won't match any schedule value regex
      
      const log = formatScheduleForLog(schedule);
      
      // Should handle gracefully with 0 counts for all schedule values
      expect(log).toContain('MON:0cd/0ca/0nca/0ncd/0def');
      expect(typeof log).toBe('string');
    });

    test('handles all schedule value types in formatScheduleForLog', () => {
      // Test that all schedule value types are counted correctly
      const schedule = createDefaultSchedule();
      
      // Create a schedule with all value types
      schedule.mon = SCHEDULE_VALUE_CHARGE_DISALLOW_USE.repeat(10)
        + SCHEDULE_VALUE_CHARGE_ALLOW_USE.repeat(10)
        + SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE.repeat(10)
        + SCHEDULE_VALUE_NO_CHARGE_DISALLOW_USE.repeat(10)
        + SCHEDULE_VALUE_DEFAULT.repeat(56);

      const log = formatScheduleForLog(schedule);

      expect(log).toContain('MON:10cd/10ca/10nca/10ncd/56def');
    });
  });

  describe('getDayOfWeek fallback', () => {
    test('handles unknown day string fallback (?? 0)', () => {
      // Test the fallback in getDayOfWeek when dayStr is not in dayMap
      // This requires mocking Intl.DateTimeFormat to return an invalid day string
      const baseTime = new Date('2025-01-06T00:00:00Z').getTime();
      const prices = Array.from({ length: 96 }, (_, i) => i + 1);
      const blocks = createDayPriceBlocks(0, baseTime, prices);

      const originalDateTimeFormat = Intl.DateTimeFormat;
      const MockDateTimeFormat = jest.fn().mockImplementation((locale: string, options?: Intl.DateTimeFormatOptions) => {
        if (options?.weekday === 'short') {
          return {
            format: jest.fn().mockReturnValue('Invalid'), // Not in dayMap
          };
        }
        return new originalDateTimeFormat(locale, options);
      });

      Object.defineProperty(global, 'Intl', {
        value: { ...Intl, DateTimeFormat: MockDateTimeFormat },
        writable: true,
        configurable: true,
      });

      try {
        // Should not crash and should fallback to Sunday (day 0)
        const schedule = buildPriceBasedSchedule(blocks, {
          cheapestBlocksCount: 4,
          expensiveBlocksCount: 0,
          cheapestBlocksValue: '4',
          expensiveBlocksValue: '1',
          standardStateValue: '0',
          timezone: 'UTC',
        });

        // Should produce a valid schedule (fallback to Sunday)
        expect(schedule.mon).toBeDefined();
        expect(schedule.mon.length).toBe(96);
      } finally {
        Object.defineProperty(global, 'Intl', {
          value: { ...Intl, DateTimeFormat: originalDateTimeFormat },
          writable: true,
          configurable: true,
        });
      }
    });
  });
});

