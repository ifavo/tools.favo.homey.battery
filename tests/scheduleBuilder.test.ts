/**
 * Tests for Schedule Builder
 */
import {
  buildPriceBasedSchedule,
  schedulesAreDifferent,
  createDefaultSchedule,
  formatScheduleForLog,
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
    test('sets cheapest blocks to 3', () => {
      // Monday Jan 6, 2025 00:00:00 UTC
      const baseTime = new Date('2025-01-06T00:00:00Z').getTime();

      // Create 96 blocks for Monday with prices 1-96
      const prices = Array.from({ length: 96 }, (_, i) => i + 1);
      const blocks = createDayPriceBlocks(0, baseTime, prices);

      const schedule = buildPriceBasedSchedule(blocks, {
        cheapestBlocksCount: 4,
        expensiveBlocksCount: 0,
        timezone: 'UTC',
      });

      // First 4 blocks should be '3' (cheapest)
      expect(schedule.mon[0]).toBe('3');
      expect(schedule.mon[1]).toBe('3');
      expect(schedule.mon[2]).toBe('3');
      expect(schedule.mon[3]).toBe('3');
      // Rest should be '2'
      expect(schedule.mon[4]).toBe('2');
      expect(schedule.mon[95]).toBe('2');
    });

    test('sets expensive blocks to 0', () => {
      const baseTime = new Date('2025-01-06T00:00:00Z').getTime();

      // Create 96 blocks for Monday with prices 1-96
      const prices = Array.from({ length: 96 }, (_, i) => i + 1);
      const blocks = createDayPriceBlocks(0, baseTime, prices);

      const schedule = buildPriceBasedSchedule(blocks, {
        cheapestBlocksCount: 4,
        expensiveBlocksCount: 4,
        timezone: 'UTC',
      });

      // First 4 blocks should be '3' (cheapest)
      expect(schedule.mon[0]).toBe('3');
      expect(schedule.mon[1]).toBe('3');
      expect(schedule.mon[2]).toBe('3');
      expect(schedule.mon[3]).toBe('3');
      // Last 4 blocks should be '0' (most expensive)
      expect(schedule.mon[92]).toBe('0');
      expect(schedule.mon[93]).toBe('0');
      expect(schedule.mon[94]).toBe('0');
      expect(schedule.mon[95]).toBe('0');
      // Middle blocks should be '2'
      expect(schedule.mon[50]).toBe('2');
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
        timezone: 'UTC',
      });

      // Both blocks should be '3' (cheap takes priority)
      expect(schedule.mon[0]).toBe('3');
      expect(schedule.mon[1]).toBe('3');
    });

    test('handles empty price blocks', () => {
      const schedule = buildPriceBasedSchedule([], {
        cheapestBlocksCount: 4,
        expensiveBlocksCount: 4,
        timezone: 'UTC',
      });

      // All days should be default '2's
      expect(schedule.mon).toBe('2'.repeat(96));
      expect(schedule.tue).toBe('2'.repeat(96));
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
      schedule2.mon = '3' + schedule2.mon.slice(1);

      expect(schedulesAreDifferent(schedule1, schedule2)).toBe(true);
    });
  });

  describe('createDefaultSchedule', () => {
    test('creates schedule with all 2s', () => {
      const schedule = createDefaultSchedule();

      expect(schedule.mon).toBe('2'.repeat(96));
      expect(schedule.tue).toBe('2'.repeat(96));
      expect(schedule.wed).toBe('2'.repeat(96));
      expect(schedule.thu).toBe('2'.repeat(96));
      expect(schedule.fri).toBe('2'.repeat(96));
      expect(schedule.sat).toBe('2'.repeat(96));
      expect(schedule.sun).toBe('2'.repeat(96));
    });
  });

  describe('formatScheduleForLog', () => {
    test('formats schedule summary correctly', () => {
      const schedule = createDefaultSchedule();
      // Modify one day
      schedule.mon = '3333' + '0000' + '2'.repeat(88);

      const log = formatScheduleForLog(schedule);

      expect(log).toContain('MON:4ch/88n/4av');
      expect(log).toContain('TUE:0ch/96n/0av');
    });
  });
});

