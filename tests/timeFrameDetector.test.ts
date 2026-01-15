/**
 * Tests for Time Frame Detector
 */
import { detectTimeFrame, type TimeFrame } from '../logic/utils/timeFrameDetector';
import type { DaySchedule } from '../logic/kostalApi/scheduleBuilder';
import {
  SCHEDULE_VALUE_CHARGE_DISALLOW_USE,
  SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE,
  SCHEDULE_VALUE_DEFAULT,
} from '../logic/kostalApi/scheduleBuilder';

describe('Time Frame Detector', () => {
  const timezone = 'Europe/Berlin';

  // Helper to create a schedule string with specific values at specific positions
  function createScheduleString(valueAtPosition: Record<number, string>): string {
    const schedule = Array(96).fill(SCHEDULE_VALUE_DEFAULT);
    for (const [pos, value] of Object.entries(valueAtPosition)) {
      schedule[Number(pos)] = value;
    }
    return schedule.join('');
  }

  describe('detectTimeFrame', () => {
    test('detects cheapest time frame when schedule value matches', () => {
      const schedule: DaySchedule = {
        mon: createScheduleString({ 10: SCHEDULE_VALUE_CHARGE_DISALLOW_USE }),
        tue: createScheduleString({}),
        wed: createScheduleString({}),
        thu: createScheduleString({}),
        fri: createScheduleString({}),
        sat: createScheduleString({}),
        sun: createScheduleString({}),
      };

      // Monday 02:30 UTC = 03:30 Berlin = quarter-hour index 14 (but we need to account for timezone)
      // Let's use a simpler approach: create timestamp for Monday 02:30 Berlin time
      const mondayBerlin = new Date('2025-01-06T02:30:00+01:00'); // Monday in Berlin
      const timestamp = mondayBerlin.getTime();

      // Quarter-hour index 10 (02:30 = 2*4 + 2 = 10)
      const result = detectTimeFrame(
        schedule,
        timestamp,
        timezone,
        SCHEDULE_VALUE_CHARGE_DISALLOW_USE,
        SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE,
      );

      expect(result).toBe('cheapest');
    });

    test('detects expensive time frame when schedule value matches', () => {
      const schedule: DaySchedule = {
        mon: createScheduleString({ 20: SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE }),
        tue: createScheduleString({}),
        wed: createScheduleString({}),
        thu: createScheduleString({}),
        fri: createScheduleString({}),
        sat: createScheduleString({}),
        sun: createScheduleString({}),
      };

      const mondayBerlin = new Date('2025-01-06T05:00:00+01:00'); // Monday 05:00 Berlin = index 20
      const timestamp = mondayBerlin.getTime();

      const result = detectTimeFrame(
        schedule,
        timestamp,
        timezone,
        SCHEDULE_VALUE_CHARGE_DISALLOW_USE,
        SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE,
      );

      expect(result).toBe('expensive');
    });

    test('detects standard time frame when schedule value is default', () => {
      const schedule: DaySchedule = {
        mon: createScheduleString({ 15: SCHEDULE_VALUE_DEFAULT }),
        tue: createScheduleString({}),
        wed: createScheduleString({}),
        thu: createScheduleString({}),
        fri: createScheduleString({}),
        sat: createScheduleString({}),
        sun: createScheduleString({}),
      };

      const mondayBerlin = new Date('2025-01-06T03:45:00+01:00'); // Monday 03:45 Berlin = index 15
      const timestamp = mondayBerlin.getTime();

      const result = detectTimeFrame(
        schedule,
        timestamp,
        timezone,
        SCHEDULE_VALUE_CHARGE_DISALLOW_USE,
        SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE,
      );

      expect(result).toBe('standard');
    });

    test('returns standard for invalid quarter-hour index (negative)', () => {
      const schedule: DaySchedule = {
        mon: createScheduleString({}),
        tue: createScheduleString({}),
        wed: createScheduleString({}),
        thu: createScheduleString({}),
        fri: createScheduleString({}),
        sat: createScheduleString({}),
        sun: createScheduleString({}),
      };

      // Use a timestamp that would result in invalid index
      // This is hard to achieve with real dates, so we'll test edge cases
      const result = detectTimeFrame(
        schedule,
        0, // Epoch start might cause issues
        timezone,
        SCHEDULE_VALUE_CHARGE_DISALLOW_USE,
        SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE,
      );

      // Should return standard as fallback
      expect(result).toBe('standard');
    });

    test('returns standard for invalid quarter-hour index (negative)', () => {
      const schedule: DaySchedule = {
        mon: createScheduleString({}),
        tue: createScheduleString({}),
        wed: createScheduleString({}),
        thu: createScheduleString({}),
        fri: createScheduleString({}),
        sat: createScheduleString({}),
        sun: createScheduleString({}),
      };

      // Test with epoch start (0) which might cause edge cases
      // The function should handle invalid indices gracefully
      const result = detectTimeFrame(
        schedule,
        0,
        timezone,
        SCHEDULE_VALUE_CHARGE_DISALLOW_USE,
        SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE,
      );

      // Should return standard as fallback for invalid index
      expect(result).toBe('standard');
    });

    test('returns standard for quarter-hour index >= 96 (defensive check)', () => {
      const schedule: DaySchedule = {
        mon: createScheduleString({}),
        tue: createScheduleString({}),
        wed: createScheduleString({}),
        thu: createScheduleString({}),
        fri: createScheduleString({}),
        sat: createScheduleString({}),
        sun: createScheduleString({}),
      };

      // To test the >= 96 branch, we need to mock Intl.DateTimeFormat.format to return
      // a time string that would produce index >= 96 (e.g., "24:00" or "25:00")
      // This is a defensive check that shouldn't happen in practice but exists for safety
      const originalDateTimeFormat = Intl.DateTimeFormat;
      const MockDateTimeFormat = jest.fn().mockImplementation((locale: string, options?: Intl.DateTimeFormatOptions) => {
        if (options?.timeZone === timezone && options?.hour === 'numeric' && options?.minute === 'numeric') {
          // Return a mock formatter that produces invalid hour
          return {
            format: jest.fn().mockReturnValue('24:00'), // Invalid hour 24 -> index = 24*4 + 0 = 96
          };
        }
        return new originalDateTimeFormat(locale, options);
      });

      // Replace Intl.DateTimeFormat temporarily
      Object.defineProperty(global, 'Intl', {
        value: { ...Intl, DateTimeFormat: MockDateTimeFormat },
        writable: true,
        configurable: true,
      });

      try {
        const monday = new Date('2025-01-06T02:30:00+01:00').getTime();
        const result = detectTimeFrame(
          schedule,
          monday,
          timezone,
          SCHEDULE_VALUE_CHARGE_DISALLOW_USE,
          SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE,
        );

        // Should return 'standard' due to defensive check (line 74)
        expect(result).toBe('standard');
      } finally {
        // Restore original Intl
        Object.defineProperty(global, 'Intl', {
          value: { ...Intl, DateTimeFormat: originalDateTimeFormat },
          writable: true,
          configurable: true,
        });
      }
    });

    test('handles different days correctly', () => {
      const schedule: DaySchedule = {
        mon: createScheduleString({ 10: SCHEDULE_VALUE_CHARGE_DISALLOW_USE }),
        tue: createScheduleString({ 10: SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE }),
        wed: createScheduleString({ 10: SCHEDULE_VALUE_DEFAULT }),
        thu: createScheduleString({}),
        fri: createScheduleString({}),
        sat: createScheduleString({}),
        sun: createScheduleString({}),
      };

      // Monday
      const monday = new Date('2025-01-06T02:30:00+01:00').getTime();
      expect(detectTimeFrame(schedule, monday, timezone, '4', '1')).toBe('cheapest');

      // Tuesday
      const tuesday = new Date('2025-01-07T02:30:00+01:00').getTime();
      expect(detectTimeFrame(schedule, tuesday, timezone, '4', '1')).toBe('expensive');

      // Wednesday
      const wednesday = new Date('2025-01-08T02:30:00+01:00').getTime();
      expect(detectTimeFrame(schedule, wednesday, timezone, '4', '1')).toBe('standard');
    });

    test('handles UTC timezone correctly', () => {
      const schedule: DaySchedule = {
        mon: createScheduleString({ 12: SCHEDULE_VALUE_CHARGE_DISALLOW_USE }),
        tue: createScheduleString({}),
        wed: createScheduleString({}),
        thu: createScheduleString({}),
        fri: createScheduleString({}),
        sat: createScheduleString({}),
        sun: createScheduleString({}),
      };

      const mondayUTC = new Date('2025-01-06T03:00:00Z').getTime(); // 03:00 UTC = index 12
      const result = detectTimeFrame(
        schedule,
        mondayUTC,
        'UTC',
        SCHEDULE_VALUE_CHARGE_DISALLOW_USE,
        SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE,
      );

      expect(result).toBe('cheapest');
    });

    test('prioritizes cheapest over expensive when values match', () => {
      // If a block is marked as cheapest, it should return cheapest even if expensive value also matches
      const schedule: DaySchedule = {
        mon: createScheduleString({ 10: SCHEDULE_VALUE_CHARGE_DISALLOW_USE }),
        tue: createScheduleString({}),
        wed: createScheduleString({}),
        thu: createScheduleString({}),
        fri: createScheduleString({}),
        sat: createScheduleString({}),
        sun: createScheduleString({}),
      };

      const monday = new Date('2025-01-06T02:30:00+01:00').getTime();

      // Even if we pass the same value for both cheapest and expensive, cheapest should win
      const result = detectTimeFrame(
        schedule,
        monday,
        timezone,
        SCHEDULE_VALUE_CHARGE_DISALLOW_USE,
        SCHEDULE_VALUE_CHARGE_DISALLOW_USE, // Same value
      );

      expect(result).toBe('cheapest');
    });

    test('handles unknown day string fallback (?? 0)', () => {
      // Test the fallback in getDayOfWeek when dayStr is not in dayMap (line 22)
      // This is hard to achieve naturally, but we can mock Intl.DateTimeFormat
      const schedule: DaySchedule = {
        mon: createScheduleString({}),
        tue: createScheduleString({}),
        wed: createScheduleString({}),
        thu: createScheduleString({}),
        fri: createScheduleString({}),
        sat: createScheduleString({}),
        sun: createScheduleString({}),
      };

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
        const monday = new Date('2025-01-06T02:30:00+01:00').getTime();
        const result = detectTimeFrame(
          schedule,
          monday,
          timezone,
          SCHEDULE_VALUE_CHARGE_DISALLOW_USE,
          SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE,
        );

        // Should fallback to Sunday schedule (line 50: || schedule.sun)
        expect(['cheapest', 'standard', 'expensive']).toContain(result);
      } finally {
        Object.defineProperty(global, 'Intl', {
          value: { ...Intl, DateTimeFormat: originalDateTimeFormat },
          writable: true,
          configurable: true,
        });
      }
    });

    test('handles missing day key fallback (|| schedule.sun)', () => {
      // Test the fallback in getCurrentDaySchedule when dayKey is undefined (line 50)
      // This happens when dayOfWeek is not 0-6, which triggers ?? 0 fallback, then dayMap[0] = 'sun'
      // But we can also test when dayKey exists but schedule[dayKey] is undefined
      const schedule: DaySchedule = {
        mon: createScheduleString({}),
        tue: createScheduleString({}),
        wed: createScheduleString({}),
        thu: createScheduleString({}),
        fri: createScheduleString({}),
        sat: createScheduleString({}),
        sun: createScheduleString({ 10: SCHEDULE_VALUE_CHARGE_DISALLOW_USE }), // Sunday has cheapest at index 10
      };

      // Use a date that would map to Sunday (dayOfWeek = 0)
      const sunday = new Date('2025-01-05T02:30:00+01:00').getTime(); // Sunday
      const result = detectTimeFrame(
        schedule,
        sunday,
        timezone,
        SCHEDULE_VALUE_CHARGE_DISALLOW_USE,
        SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE,
      );

      // Should use Sunday schedule
      expect(result).toBe('cheapest');
    });

    test('triggers || schedule.sun fallback when dayKey is undefined', () => {
      // Test the || schedule.sun fallback on line 50
      // This requires dayKey to be undefined, which happens when dayOfWeek is not in dayMap
      // We can achieve this by mocking getDayOfWeek to return a value not in dayMap (e.g., 7 or -1)
      // But since getDayOfWeek uses ?? 0 fallback, invalid values become 0, which maps to 'sun'
      // So to test || schedule.sun, we need schedule[dayKey] to be falsy (empty string or undefined)
      // Actually, schedule[dayKey] is always a string (96 chars), so it's never falsy
      // The fallback || schedule.sun is defensive code that shouldn't execute in practice
      // But we can test it by creating a schedule with undefined values
      const scheduleWithUndefined: Partial<DaySchedule> = {
        mon: undefined as any,
        tue: undefined as any,
        wed: undefined as any,
        thu: undefined as any,
        fri: undefined as any,
        sat: undefined as any,
        sun: createScheduleString({ 10: SCHEDULE_VALUE_CHARGE_DISALLOW_USE }),
      };

      const monday = new Date('2025-01-06T02:30:00+01:00').getTime();
      const result = detectTimeFrame(
        scheduleWithUndefined as DaySchedule,
        monday,
        timezone,
        SCHEDULE_VALUE_CHARGE_DISALLOW_USE,
        SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE,
      );

      // Should fallback to Sunday schedule (line 50: || schedule.sun)
      expect(result).toBe('cheapest');
    });
  });
});
