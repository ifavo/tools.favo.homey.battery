/**
 * Cached Price Source Wrapper
 * Adds app-level caching to any PriceDataSource with a 1-week TTL
 * Implements rotating cache that merges new data and removes old entries
 */
import type { PriceDataEntry, PriceDataSource } from '../priceSource';
import { MILLISECONDS_PER_WEEK, MILLISECONDS_PER_HOUR } from '../../utils/dateUtils';

/**
 * Interface for app storage access
 */
export interface AppStorage {
  getStoreValue(key: string): unknown;
  setStoreValue(key: string, value: unknown): Promise<void>;
  log(...args: unknown[]): void;
}

/**
 * Cached price data structure
 */
interface CachedPriceData {
  data: Array<PriceDataEntry>;
  timestamp: number; // Unix timestamp in milliseconds
  marketArea: string;
}

/**
 * Get the start of today (midnight) in milliseconds
 */
function getTodayStart(now: number = Date.now()): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}

/**
 * Merge new price data with existing cache data
 * - New data overwrites existing data for the same timestamps
 * - Removes data older than today (rotating storage)
 * - Keeps today and future days
 * @param existingData - Existing cached price data
 * @param newData - Fresh price data from source
 * @param now - Current timestamp
 * @returns Merged price data array
 */
function mergePriceData(
  existingData: Array<PriceDataEntry>,
  newData: Array<PriceDataEntry>,
  now: number,
): Array<PriceDataEntry> {
  const todayStart = getTodayStart(now);

  // Create a map of existing data by timestamp (for deduplication)
  const existingMap = new Map<string, PriceDataEntry>();
  for (const entry of existingData) {
    const entryTime = new Date(entry.date).getTime();
    // Only keep existing data from today or future (remove old data)
    if (entryTime >= todayStart) {
      existingMap.set(entry.date, entry);
    }
  }

  // Overwrite with new data (new data takes precedence)
  for (const entry of newData) {
    existingMap.set(entry.date, entry);
  }

  // Convert back to array and sort by date
  const merged = Array.from(existingMap.values());
  merged.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return merged;
}

/**
 * Cached Price Source wrapper that adds app-level caching to any PriceDataSource
 */
export class CachedPriceSource implements PriceDataSource {
  private readonly source: PriceDataSource;
  private readonly marketArea: string;
  private readonly storage: AppStorage;
  private readonly cacheKey: string;

  /**
   * Create a cached price source wrapper
   * @param source - The underlying price data source to wrap
   * @param marketArea - Market area identifier (e.g., 'DE-LU')
   * @param storage - App storage interface for caching
   */
  constructor(source: PriceDataSource, marketArea: string, storage: AppStorage) {
    this.source = source;
    this.marketArea = marketArea;
    this.storage = storage;
    this.cacheKey = `price_cache_${marketArea}`;
  }

  /**
   * Fetch price data, using cache if available and valid
   * Merges new data with existing cache and removes old entries (rotating storage)
   * @param forceRefresh - If true, bypass cache check but still merge with existing cache
   */
  async fetch(forceRefresh: boolean = false): Promise<Array<PriceDataEntry>> {
    const now = Date.now();
    let existingData: Array<PriceDataEntry> = [];

    // If force refresh is requested, skip cache check but still load existing data for merging
    if (!forceRefresh) {
      // Check cache
      const cached = this.storage.getStoreValue(this.cacheKey) as CachedPriceData | null;

      if (cached && cached.data && cached.timestamp) {
        const age = now - cached.timestamp;
        if (age < MILLISECONDS_PER_WEEK && age >= 0) {
          // Cache is valid (less than 1 week old and not in the future)
          this.storage.log(`[PRICE_CACHE] Cache hit for ${this.marketArea} (age: ${Math.round(age / MILLISECONDS_PER_HOUR)}h)`);
          return cached.data;
        }
        // Cache expired but we'll still use existing data for merging
        this.storage.log(`[PRICE_CACHE] Cache expired for ${this.marketArea} (age: ${Math.round(age / MILLISECONDS_PER_HOUR)}h), will merge with fresh data`);
        existingData = cached.data || [];
      } else {
        // No cache found
        this.storage.log(`[PRICE_CACHE] Cache miss for ${this.marketArea}`);
      }
    } else {
      // Force refresh: load existing cache for merging but don't return it
      const cached = this.storage.getStoreValue(this.cacheKey) as CachedPriceData | null;
      if (cached && cached.data) {
        existingData = cached.data;
        this.storage.log(`[PRICE_CACHE] Force refresh requested for ${this.marketArea}, will merge with existing cache`);
      } else {
        this.storage.log(`[PRICE_CACHE] Force refresh requested for ${this.marketArea}, no existing cache to merge`);
      }
    }

    // Fetch fresh data from source
    const freshData = await this.source.fetch();

    // Merge new data with existing cache (removes old data, keeps today and future)
    const mergedData = mergePriceData(existingData, freshData, now);

    const removedCount = existingData.length + freshData.length - mergedData.length;
    if (removedCount > 0) {
      this.storage.log(`[PRICE_CACHE] Removed ${removedCount} old entries (before today)`);
    }
    if (mergedData.length > freshData.length) {
      this.storage.log(`[PRICE_CACHE] Merged cache: ${existingData.length} existing + ${freshData.length} new = ${mergedData.length} total`);
    }

    // Store merged data in cache
    const cacheData: CachedPriceData = {
      data: mergedData,
      timestamp: now,
      marketArea: this.marketArea,
    };

    try {
      await this.storage.setStoreValue(this.cacheKey, cacheData);
      this.storage.log(`[PRICE_CACHE] Cached ${mergedData.length} entries for ${this.marketArea}`);
    } catch (error) {
      // Log error but don't fail the fetch
      this.storage.log(`[PRICE_CACHE] Failed to store cache for ${this.marketArea}: ${error}`);
    }

    return mergedData;
  }
}
