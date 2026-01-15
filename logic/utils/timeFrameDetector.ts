/**
 * Time Frame Detector
 * Determines which price-based time frame the current time belongs to
 */
import type { DaySchedule } from '../kostalApi/scheduleBuilder';

export type TimeFrame = 'cheapest' | 'standard' | 'expensive';

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
 * Get the schedule string for the current day
 */
function getCurrentDaySchedule(schedule: DaySchedule, timestamp: number, timezone: string): string {
  const dayOfWeek = getDayOfWeek(timestamp, timezone);
  const dayMap: Record<number, keyof DaySchedule> = {
    0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat',
  };
  const dayKey = dayMap[dayOfWeek];
  return schedule[dayKey] || schedule.sun;
}

/**
 * Determine which time frame the current time belongs to
 * 
 * @param schedule - Current day schedule
 * @param timestamp - Current timestamp in milliseconds
 * @param timezone - Timezone for determining day boundaries
 * @param cheapestBlocksValue - Schedule value used for cheapest blocks (e.g., '4')
 * @param expensiveBlocksValue - Schedule value used for most expensive blocks (e.g., '1')
 * @returns Time frame: 'cheapest', 'standard', or 'expensive'
 */
export function detectTimeFrame(
  schedule: DaySchedule,
  timestamp: number,
  timezone: string,
  cheapestBlocksValue: string,
  expensiveBlocksValue: string,
): TimeFrame {
  const daySchedule = getCurrentDaySchedule(schedule, timestamp, timezone);
  const quarterHourIndex = getQuarterHourIndex(timestamp, timezone);

  if (quarterHourIndex < 0 || quarterHourIndex >= 96) {
    return 'standard';
  }

  const scheduleValue = daySchedule[quarterHourIndex];

  if (scheduleValue === cheapestBlocksValue) {
    return 'cheapest';
  }

  if (scheduleValue === expensiveBlocksValue) {
    return 'expensive';
  }

  return 'standard';
}
