/**
 * Cached Price Source Wrapper
 * Adds app-level caching to any PriceDataSource with a 1-week TTL
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
   */
  async fetch(): Promise<Array<PriceDataEntry>> {
    const now = Date.now();

    // Check cache
    const cached = this.storage.getStoreValue(this.cacheKey) as CachedPriceData | null;

    if (cached && cached.data && cached.timestamp) {
      const age = now - cached.timestamp;
      if (age < MILLISECONDS_PER_WEEK && age >= 0) {
        // Cache is valid (less than 1 week old and not in the future)
        this.storage.log(`[PRICE_CACHE] Cache hit for ${this.marketArea} (age: ${Math.round(age / MILLISECONDS_PER_HOUR)}h)`);
        return cached.data;
      } else {
        // Cache expired or invalid timestamp
        this.storage.log(`[PRICE_CACHE] Cache expired for ${this.marketArea} (age: ${Math.round(age / MILLISECONDS_PER_HOUR)}h)`);
      }
    } else {
      // No cache found
      this.storage.log(`[PRICE_CACHE] Cache miss for ${this.marketArea}`);
    }

    // Fetch fresh data from source
    const freshData = await this.source.fetch();

    // Store in cache
    const cacheData: CachedPriceData = {
      data: freshData,
      timestamp: now,
      marketArea: this.marketArea,
    };

    try {
      await this.storage.setStoreValue(this.cacheKey, cacheData);
      this.storage.log(`[PRICE_CACHE] Cached ${freshData.length} entries for ${this.marketArea}`);
    } catch (error) {
      // Log error but don't fail the fetch
      this.storage.log(`[PRICE_CACHE] Failed to store cache for ${this.marketArea}: ${error}`);
    }

    return freshData;
  }
}
