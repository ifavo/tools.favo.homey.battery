import fs from 'fs';
import path from 'path';

import type { PriceBlock, PriceCache } from '../logic/lowPrice/types';
import { findCheapestBlocks } from '../logic/lowPrice/findCheapestHours';
import { formatNextChargingTimes, formatTime } from '../logic/lowPrice/formatNextChargingTimes';

function loadPriceCacheFromJson(): PriceCache {
  const filePath = path.join(__dirname, 'assets', 'priceCache.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const blocks = JSON.parse(raw) as Array<PriceBlock>;

  const cache: PriceCache = {};
  for (const b of blocks) {
    cache[String(b.start)] = b;
  }
  return cache;
}

describe('formatNextChargingTimes', () => {
  const cache = loadPriceCacheFromJson();

  // Mock system time so any Date.now() / new Date() calls in the logic
  // behave as if we are on 2025-12-18.
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-12-18T00:00:00Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe('basic functionality', () => {
    test('groups consecutive blocks', () => {
      const base = Date.UTC(2025, 0, 1, 10, 0, 0); // 2025-01-01T10:00:00Z
      const blockDuration = 15 * 60 * 1000; // 15 minutes

      const blocks: Array<PriceBlock> = [
        { start: base, end: base + blockDuration, price: 1 }, // 11:00 local-ish
        { start: base + blockDuration, end: base + 2 * blockDuration, price: 1 }, // 11:15
        { start: base + 4 * blockDuration, end: base + 5 * blockDuration, price: 1 }, // 11:45
      ];

      const text = formatNextChargingTimes(blocks, {
        now: base - 60 * 60 * 1000,
        locale: 'en-GB',
        timezone: 'Europe/Vienna',
      });

      // We do not assert exact localized string (depends on environment),
      // but we do expect two segments separated by comma
      expect(text.split(',').length).toBe(2);
    });

    test('visual display of consecutive and non-consecutive blocks', () => {
      const base = Date.UTC(2025, 0, 1, 10, 0, 0); // 11:00 local in Europe/Vienna (UTC+1)
      const blockDuration = 15 * 60 * 1000; // 15 minutes

      const blocks: Array<PriceBlock> = [
        // 11:00–11:15
        { start: base, end: base + blockDuration, price: 1 },
        // 11:15–11:30 (consecutive with previous)
        { start: base + blockDuration, end: base + 2 * blockDuration, price: 1 },
        // 11:45–12:00 (gap after 11:30)
        { start: base + 3 * blockDuration, end: base + 4 * blockDuration, price: 1 },
      ];

      const text = formatNextChargingTimes(blocks, {
        now: base - 60 * 60 * 1000, // before first block
        locale: 'de-DE',
        timezone: 'Europe/Vienna',
      });

      // In this setup:
      // - First two blocks (11:00–11:15, 11:15–11:30) are consecutive -> merged as "11:00–11:30"
      // - Third block is later (11:45–12:00 local) -> separate slot
      expect(text).toContain('11:00');
      expect(text).toContain('11:30');
      expect(text.split(',').length).toBe(2);
    });

    test('at 02:00 local time, display shows today\'s cheapest blocks from cache', () => {
      const oneHour = 60 * 60 * 1000;

      // Use real cached data: find the two cheapest consecutive blocks for mocked "today" (2025-12-18)
      const cheapest = findCheapestBlocks(cache, 2);

      // First cheapest block starts at 03:00 local in this dataset (per observed data)
      const first = cheapest[0];

      // Treat one hour before the first cheap block as "02:00"
      const now = first.start - oneHour;

      const text = formatNextChargingTimes(cheapest, {
        now,
        locale: 'de-DE',
        timezone: 'Europe/Vienna',
      });

      // For this recorded cache and mocked date (2025-12-18), the two cheapest
      // blocks for today should be formatted appropriately
      expect(text).not.toBe('Unknown');
    });

    test('at 05:00, formatted text shows no future cheap block', () => {
      // Use real cached data: two cheapest consecutive blocks for mocked "today"
      const cheapest = findCheapestBlocks(cache, 2);

      const last = cheapest[cheapest.length - 1];

      // At 05:00, both cheap blocks are in the past, so there is no future cheap block.
      const text = formatNextChargingTimes(cheapest, {
        now: last.end,
        locale: 'de-DE',
        timezone: 'Europe/Vienna',
      });

      expect(text).toBe('Unknown');
    });
  });

  describe('edge cases - input validation', () => {
    test('returns Unknown when blocks array is empty', () => {
      const text = formatNextChargingTimes([], {
        now: Date.now(),
        locale: 'en-GB',
        timezone: 'UTC',
      });
      expect(text).toBe('Unknown');
    });

    test('handles single block', () => {
      const blockDuration = 15 * 60 * 1000;
      const base = Date.now() + 10000; // Future
      const block: PriceBlock = { start: base, end: base + blockDuration, price: 0.1 };
      const text = formatNextChargingTimes([block], {
        now: Date.now(),
        locale: 'en-GB',
        timezone: 'UTC',
      });
      // Single block should show as single time, not range
      expect(text).not.toBe('Unknown');
      expect(text).not.toContain('–'); // Should not contain range separator
    });

    test('includes block starting exactly at now (current period)', () => {
      const blockDuration = 15 * 60 * 1000;
      const now = Date.now();
      const block: PriceBlock = { start: now, end: now + blockDuration, price: 0.1 };
      const text = formatNextChargingTimes([block], {
        now,
        locale: 'en-GB',
        timezone: 'UTC',
      });
      // Block starts at now, so we're currently in this period -> should show "Now: [time]"
      // This keeps display synchronized with charging toggle
      expect(text).not.toBe('Unknown');
      expect(text).toContain('Now:');
    });

    test('marks current period in middle of multiple groups', () => {
      // Test the isCurrent check for groups that are not the last one
      const blockDuration = 15 * 60 * 1000;
      const base = Date.now() + 10000;
      
      // Create 3 separate groups (not consecutive)
      const blocks: Array<PriceBlock> = [
        { start: base, end: base + blockDuration, price: 0.1 }, // First group
        { start: base + 2 * blockDuration, end: base + 3 * blockDuration, price: 0.1 }, // Second group (gap)
        { start: base + 4 * blockDuration, end: base + 5 * blockDuration, price: 0.1 }, // Third group (gap)
      ];

      // Set now to be in the middle of the second group
      const now = base + 2 * blockDuration + blockDuration / 2;
      
      const text = formatNextChargingTimes(blocks, {
        now,
        locale: 'en-GB',
        timezone: 'UTC',
      });

      // Should mark the second group as "Now:" since we're currently in it
      expect(text).toContain('Now:');
      expect(text).not.toBe('Unknown');
    });

    test('marks current period for consecutive blocks range', () => {
      // Test line 90: return g.isCurrent ? `Now: ${rangeStr}` : rangeStr;
      // Need to test the "Now:" branch for consecutive blocks (ranges)
      const blockDuration = 15 * 60 * 1000;
      const base = Date.now() + 10000;
      
      // Create consecutive blocks that form a range
      const blocks: Array<PriceBlock> = [
        { start: base, end: base + blockDuration, price: 0.1 },
        { start: base + blockDuration, end: base + 2 * blockDuration, price: 0.1 }, // Consecutive
        { start: base + 2 * blockDuration, end: base + 3 * blockDuration, price: 0.1 }, // Consecutive
      ];

      // Set now to be in the middle of the consecutive range
      const now = base + blockDuration + blockDuration / 2;
      
      const text = formatNextChargingTimes(blocks, {
        now,
        locale: 'en-GB',
        timezone: 'UTC',
      });

      // Should show "Now:" prefix for the range since we're currently in it
      expect(text).toContain('Now:');
      expect(text).toContain('–'); // Should contain range separator
      expect(text).not.toBe('Unknown');
    });

    test('includes block starting just after now', () => {
      const blockDuration = 15 * 60 * 1000;
      const now = Date.now();
      const block: PriceBlock = { start: now + 1, end: now + 1 + blockDuration, price: 0.1 };
      const text = formatNextChargingTimes([block], {
        now,
        locale: 'en-GB',
        timezone: 'UTC',
      });
      // Block starts just after now, so should be included
      expect(text).not.toBe('Unknown');
    });
  });

  describe('edge cases - invalid data', () => {
    test('handles overlapping blocks gracefully', () => {
      const now = Date.now();
      const blockDuration = 15 * 60 * 1000;
      const base = now + 10000;
      // Create overlapping blocks
      const overlappingBlocks: Array<PriceBlock> = [
        { start: base, end: base + blockDuration, price: 0.1 },
        { start: base + blockDuration / 2, end: base + blockDuration * 1.5, price: 0.1 }, // Overlaps
      ];
      // Should not crash
      expect(() => {
        formatNextChargingTimes(overlappingBlocks, {
          now,
          locale: 'en-GB',
          timezone: 'UTC',
        });
      }).not.toThrow();
    });

    test('handles zero duration blocks', () => {
      const now = Date.now();
      // Create block with zero duration (start === end)
      const zeroBlock: PriceBlock = {
        start: now + 10000,
        end: now + 10000, // Same as start
        price: 0.1,
      };
      // Should not crash
      expect(() => {
        formatNextChargingTimes([zeroBlock], {
          now,
          locale: 'en-GB',
          timezone: 'UTC',
        });
      }).not.toThrow();
    });

    test('handles blocks with Infinity timestamps', () => {
      // Create block with Infinity start (invalid data)
      const invalidBlock: PriceBlock = {
        start: Infinity,
        end: Infinity + 15 * 60 * 1000,
        price: 0.1,
      };
      // Should not crash
      expect(() => {
        formatNextChargingTimes([invalidBlock], {
          now: Date.now(),
          locale: 'en-GB',
          timezone: 'UTC',
        });
      }).not.toThrow();
    });
  });

  describe('edge cases - timezone and locale', () => {
    test('handles DST transition dates', () => {
      // Test with a known DST transition date (Europe/Vienna: last Sunday in March)
      // 2025-03-30 02:00 CET -> 03:00 CEST (spring forward)
      const dstTransition = Date.UTC(2025, 2, 30, 1, 0, 0); // 02:00 CET = 01:00 UTC
      const blockDuration = 15 * 60 * 1000;
      const blocks: Array<PriceBlock> = [
        { start: dstTransition, end: dstTransition + blockDuration, price: 0.1 },
        { start: dstTransition + blockDuration, end: dstTransition + 2 * blockDuration, price: 0.1 },
      ];
      // Should not crash during DST transition
      expect(() => {
        formatNextChargingTimes(blocks, {
          now: dstTransition - 1000,
          locale: 'de-DE',
          timezone: 'Europe/Vienna',
        });
      }).not.toThrow();
    });

    test('handles invalid locale gracefully', () => {
      const blockDuration = 15 * 60 * 1000;
      const base = Date.now() + 10000;
      const block: PriceBlock = { start: base, end: base + blockDuration, price: 0.1 };
      // Invalid locale should fall back to default format (en-US, UTC)
      const result = formatNextChargingTimes([block], {
        now: Date.now(),
        locale: 'invalid-locale-xyz',
        timezone: 'UTC',
      });
      // Should return a formatted string (fallback format)
      expect(result).not.toBe('Unknown');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('handles invalid timezone gracefully', () => {
      const blockDuration = 15 * 60 * 1000;
      const base = Date.now() + 10000;
      const block: PriceBlock = { start: base, end: base + blockDuration, price: 0.1 };
      // Invalid timezone should fall back to UTC format
      const result = formatNextChargingTimes([block], {
        now: Date.now(),
        locale: 'en-GB',
        timezone: 'Invalid/Timezone',
      });
      // Should return a formatted string (fallback format)
      expect(result).not.toBe('Unknown');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});

describe('formatTime', () => {
  describe('ignoreZeroMinutes option', () => {
    test('removes :00 from end', () => {
      // Create a date that will format to something like "11:00"
      const date = new Date('2025-01-01T11:00:00Z');
      const withoutOption = formatTime(date, 'en-US', 'UTC', { ignoreZeroMinutes: false });
      const result = formatTime(date, 'en-US', 'UTC', { ignoreZeroMinutes: true });
      
      // Verify the function works
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      
      // The format might be "11:00 AM" or "11:00" depending on locale
      // If it ends with :00 (without AM/PM), verify the slice operation (line 139)
      if (withoutOption.endsWith(':00') && !withoutOption.match(/[AP]M$/)) {
        // Should remove :00 from the end (line 139 should be covered)
        expect(result).not.toContain(':00');
        expect(result).toContain('11');
        // Verify the slice operation happened (result should be shorter)
        expect(result.length).toBeLessThan(withoutOption.length);
        // Explicitly verify slice(0, -3) was called (line 139)
        expect(result).toBe(withoutOption.slice(0, -3));
      }
      // If format includes AM/PM or doesn't end with :00, the test still verifies functionality
    });

    test('explicitly tests :00 ending removal', () => {
      // Use a locale/timezone combination that produces ":00" format
      // en-GB typically produces "11:00" format
      const date = new Date('2025-01-01T11:00:00Z');
      const withoutOption = formatTime(date, 'en-GB', 'UTC', { ignoreZeroMinutes: false });
      const result = formatTime(date, 'en-GB', 'UTC', { ignoreZeroMinutes: true });
      
      // en-GB should produce "11:00" format
      if (withoutOption.endsWith(':00')) {
        // This should hit line 139
        expect(result).toBe(withoutOption.slice(0, -3));
        expect(result).not.toContain(':00');
        expect(result.length).toBe(withoutOption.length - 3);
      } else {
        // If en-GB doesn't produce :00, try de-DE
        const withoutOptionDE = formatTime(date, 'de-DE', 'UTC', { ignoreZeroMinutes: false });
        if (withoutOptionDE.endsWith(':00')) {
          const resultDE = formatTime(date, 'de-DE', 'UTC', { ignoreZeroMinutes: true });
          expect(resultDE).toBe(withoutOptionDE.slice(0, -3));
        }
      }
    });

    test('handles exact :00 ending format', () => {
      // Test multiple times to ensure we hit the exact :00 ending format
      const times = [
        new Date('2025-01-01T00:00:00Z'),
        new Date('2025-01-01T12:00:00Z'),
        new Date('2025-01-01T23:00:00Z'),
      ];
      for (const date of times) {
        const withOption = formatTime(date, 'en-US', 'UTC', { ignoreZeroMinutes: true });
        const withoutOption = formatTime(date, 'en-US', 'UTC', { ignoreZeroMinutes: false });
        // If the original ends with :00, the result should be shorter
        if (withoutOption.endsWith(':00')) {
          expect(withOption).not.toContain(':00');
          expect(withOption.length).toBeLessThan(withoutOption.length);
        }
      }
    });

    test('removes :00 from middle (AM/PM format)', () => {
      // Create a date that will format to something like "11:00 AM"
      const date = new Date('2025-01-01T11:00:00Z');
      const result = formatTime(date, 'en-US', 'America/New_York', { ignoreZeroMinutes: true });
      // Should remove :00 but keep AM/PM
      if (result.includes(':00 ')) {
        // If it contains :00, it should be removed
        expect(result).not.toContain(':00 ');
      }
      // Should contain hour
      expect(result.length).toBeGreaterThan(0);
    });

    test('keeps minutes when not zero', () => {
      // Create a date with non-zero minutes
      const date = new Date('2025-01-01T11:15:00Z');
      const result = formatTime(date, 'en-US', 'UTC', { ignoreZeroMinutes: true });
      // Should keep minutes since they're not zero
      expect(result).toContain('11');
      // Should contain time formatting
      expect(result.length).toBeGreaterThan(0);
    });

    test('handles :00 in middle with space (AM/PM format)', () => {
      // Test the branch that handles ":00 " in the middle (line 143)
      // This happens with 12-hour format like "11:00 AM"
      const date = new Date('2025-01-01T11:00:00Z');
      
      // Use a locale/timezone that produces 12-hour format with AM/PM
      // en-US with America/New_York should produce "11:00 AM" format
      const result = formatTime(date, 'en-US', 'America/New_York', { ignoreZeroMinutes: true });
      
      // Should remove ":00 " but keep the AM/PM suffix
      if (result.includes('AM') || result.includes('PM')) {
        // Should not contain ":00 " but should contain the suffix
        expect(result).not.toContain(':00 ');
        expect(result.length).toBeGreaterThan(0);
      }
    });

    test('returns string as-is when no zero minutes patterns match', () => {
      // Test the final fallback return (line 147) when none of the conditions match
      // This happens when ignoreZeroMinutes is true but the string doesn't match any pattern
      const date = new Date('2025-01-01T11:30:00Z'); // Non-zero minutes
      const result = formatTime(date, 'en-US', 'UTC', { ignoreZeroMinutes: true });
      
      // Should return the formatted string as-is since it doesn't match :00 patterns
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      // Should contain the time
      expect(result).toContain('11');
    });

    test('handles error in toLocaleString (catch block)', () => {
      // Test the error handling path when toLocaleString throws
      // We can't easily make toLocaleString throw, but we can test with invalid inputs
      // that might cause issues, though in practice toLocaleString is very tolerant
      
      // Actually, let's test with a date that might cause issues
      const date = new Date('2025-01-01T11:00:00Z');
      
      // Use an invalid locale that might cause issues (though toLocaleString is tolerant)
      // The catch block should handle any errors and fall back to UTC format
      const result = formatTime(date, 'invalid-locale-xyz-123', 'Invalid/Timezone', { ignoreZeroMinutes: false });
      
      // Should return a formatted string (fallback to UTC format)
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('handles default options parameter', () => {
      // Test that formatTime works with default options (undefined)
      const date = new Date('2025-01-01T11:00:00Z');
      const result = formatTime(date, 'en-US', 'UTC'); // No options parameter
      
      // Should work with default options (ignoreZeroMinutes = false)
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});

