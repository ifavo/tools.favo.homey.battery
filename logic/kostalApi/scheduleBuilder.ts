/**
 * Schedule Builder for Kostal Time Control
 * Generates day-specific time control configurations based on electricity prices
 */
import type { PriceBlock } from '../lowPrice/types';

// ============================================================================
// TIME CONTROL VALUES - Adjust these to change inverter behavior
// ============================================================================

/**
 * Value for default behavior (automatic operation)
 * Kostal TimeControl: "0" = default automatic operation
 */
export const SCHEDULE_VALUE_DEFAULT = '0';

/**
 * Value for no grid charge, battery can be used at home
 * Kostal TimeControl: "1" = do not charge from grid, allow battery use
 */
export const SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE = '1';

/**
 * Value for no grid charge, battery cannot be used at home
 * Kostal TimeControl: "2" = do not charge from grid, disallow battery use
 */
export const SCHEDULE_VALUE_NO_CHARGE_DISALLOW_USE = '2';

/**
 * Value for grid charge, battery can be used at home
 * Kostal TimeControl: "3" = charge from grid, allow battery use
 */
export const SCHEDULE_VALUE_CHARGE_ALLOW_USE = '3';

/**
 * Value for grid charge, battery cannot be used at home
 * Kostal TimeControl: "4" = charge from grid, disallow battery use
 */
export const SCHEDULE_VALUE_CHARGE_DISALLOW_USE = '4';

// ============================================================================

/**
 * Day schedule configuration (96 characters, one per 15-minute block)
 */
export interface DaySchedule {
  mon: string;
  tue: string;
  wed: string;
  thu: string;
  fri: string;
  sat: string;
  sun: string;
}

/**
 * Schedule configuration options
 */
export interface ScheduleOptions {
  /** Number of cheapest blocks to set as "4" (charge, disallow use) */
  cheapestBlocksCount: number;
  /** Number of most expensive blocks to set as "1" (no charge, allow use) */
  expensiveBlocksCount: number;
  /** Timezone for determining day boundaries */
  timezone: string;
}

/**
 * Default schedule - all blocks set to default operation
 */
const DEFAULT_SCHEDULE = SCHEDULE_VALUE_DEFAULT.repeat(96);

/**
 * Get the day of week (0=Sun, 1=Mon, ..., 6=Sat) in the specified timezone
 */
function getDayOfWeek(timestamp: number, timezone: string): number {
  const date = new Date(timestamp);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const dayStr = formatter.format(date);
  const dayMap: Record<string, number> = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6,
  };
  return dayMap[dayStr] ?? 0;
}

/**
 * Get the quarter-hour index (0-95) for a timestamp in the specified timezone
 */
function getQuarterHourIndex(timestamp: number, timezone: string): number {
  const date = new Date(timestamp);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const timeStr = formatter.format(date);
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 4 + Math.floor(minutes / 15);
}

/**
 * Build price-based schedule for all days of the week
 * 
 * @param priceBlocks - Array of price blocks (from price source)
 * @param options - Schedule configuration options
 * @returns Day schedule object with 96-character strings for each day
 */
export function buildPriceBasedSchedule(
  priceBlocks: PriceBlock[],
  options: ScheduleOptions,
): DaySchedule {
  const { cheapestBlocksCount, expensiveBlocksCount, timezone } = options;

  // Initialize schedules for each day with default values
  const schedules: Record<number, string[]> = {
    0: DEFAULT_SCHEDULE.split(''), // Sunday
    1: DEFAULT_SCHEDULE.split(''), // Monday
    2: DEFAULT_SCHEDULE.split(''), // Tuesday
    3: DEFAULT_SCHEDULE.split(''), // Wednesday
    4: DEFAULT_SCHEDULE.split(''), // Thursday
    5: DEFAULT_SCHEDULE.split(''), // Friday
    6: DEFAULT_SCHEDULE.split(''), // Saturday
  };

  // Group blocks by day
  const blocksByDay: Record<number, PriceBlock[]> = {
    0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [],
  };

  for (const block of priceBlocks) {
    const dayOfWeek = getDayOfWeek(block.start, timezone);
    blocksByDay[dayOfWeek].push(block);
  }

  // Process each day
  for (let day = 0; day < 7; day++) {
    const dayBlocks = blocksByDay[day];
    if (dayBlocks.length === 0) continue;

    // Sort by price to find cheapest and most expensive
    const sortedByPrice = [...dayBlocks].sort((a, b) => a.price - b.price);

    // Get cheapest blocks (set to charge from grid)
    const cheapestBlocks = sortedByPrice.slice(0, cheapestBlocksCount);
    for (const block of cheapestBlocks) {
      const quarterHourIndex = getQuarterHourIndex(block.start, timezone);
      if (quarterHourIndex >= 0 && quarterHourIndex < 96) {
        schedules[day][quarterHourIndex] = SCHEDULE_VALUE_CHARGE_DISALLOW_USE;
      }
    }

    // Get most expensive blocks (set to avoid grid)
    if (expensiveBlocksCount > 0) {
      const expensiveBlocks = sortedByPrice.slice(-expensiveBlocksCount);
      for (const block of expensiveBlocks) {
        const quarterHourIndex = getQuarterHourIndex(block.start, timezone);
        if (quarterHourIndex >= 0 && quarterHourIndex < 96) {
          // Only set to avoid if not already charging (cheap takes priority)
          if (schedules[day][quarterHourIndex] !== SCHEDULE_VALUE_CHARGE_DISALLOW_USE) {
            schedules[day][quarterHourIndex] = SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE;
          }
        }
      }
    }
  }

  return {
    sun: schedules[0].join(''),
    mon: schedules[1].join(''),
    tue: schedules[2].join(''),
    wed: schedules[3].join(''),
    thu: schedules[4].join(''),
    fri: schedules[5].join(''),
    sat: schedules[6].join(''),
  };
}

/**
 * Check if a schedule is different from another
 */
export function schedulesAreDifferent(a: DaySchedule, b: DaySchedule): boolean {
  return a.mon !== b.mon || a.tue !== b.tue || a.wed !== b.wed ||
         a.thu !== b.thu || a.fri !== b.fri || a.sat !== b.sat || a.sun !== b.sun;
}

/**
 * Create a default schedule (all "0"s for default operation)
 */
export function createDefaultSchedule(): DaySchedule {
  return {
    mon: DEFAULT_SCHEDULE,
    tue: DEFAULT_SCHEDULE,
    wed: DEFAULT_SCHEDULE,
    thu: DEFAULT_SCHEDULE,
    fri: DEFAULT_SCHEDULE,
    sat: DEFAULT_SCHEDULE,
    sun: DEFAULT_SCHEDULE,
  };
}

/**
 * Format schedule for logging (shows count of each type)
 */
export function formatScheduleForLog(schedule: DaySchedule): string {
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const summary: string[] = [];

  for (const day of days) {
    const s = schedule[day];
    const chargeDisallowRegex = new RegExp(SCHEDULE_VALUE_CHARGE_DISALLOW_USE, 'g');
    const chargeAllowRegex = new RegExp(SCHEDULE_VALUE_CHARGE_ALLOW_USE, 'g');
    const noChargeAllowRegex = new RegExp(SCHEDULE_VALUE_NO_CHARGE_ALLOW_USE, 'g');
    const noChargeDisallowRegex = new RegExp(SCHEDULE_VALUE_NO_CHARGE_DISALLOW_USE, 'g');
    const defaultRegex = new RegExp(SCHEDULE_VALUE_DEFAULT, 'g');
    const countChargeDisallow = (s.match(chargeDisallowRegex) || []).length;
    const countChargeAllow = (s.match(chargeAllowRegex) || []).length;
    const countNoChargeAllow = (s.match(noChargeAllowRegex) || []).length;
    const countNoChargeDisallow = (s.match(noChargeDisallowRegex) || []).length;
    const countDefault = (s.match(defaultRegex) || []).length;
    summary.push(
      `${day.toUpperCase()}:${countChargeDisallow}cd/${countChargeAllow}ca/`
      + `${countNoChargeAllow}nca/${countNoChargeDisallow}ncd/${countDefault}def`,
    );
  }

  return summary.join(' ');
}

