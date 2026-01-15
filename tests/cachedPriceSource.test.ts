/**
 * Tests for Cached Price Source
 */
import { CachedPriceSource, type AppStorage } from '../logic/lowPrice/sources/cachedPriceSource';
import type { PriceDataSource, PriceDataEntry } from '../logic/lowPrice/priceSource';
import { MILLISECONDS_PER_WEEK, MILLISECONDS_PER_HOUR } from '../logic/utils/dateUtils';

describe('CachedPriceSource', () => {
  let mockSource: jest.Mocked<PriceDataSource>;
  let mockStorage: jest.Mocked<AppStorage>;
  let storeValues: Record<string, unknown>;

  const mockPriceData: Array<PriceDataEntry> = [
    { date: '2025-01-01T00:00:00+01:00', price: 0.1 },
    { date: '2025-01-01T00:15:00+01:00', price: 0.12 },
    { date: '2025-01-01T00:30:00+01:00', price: 0.11 },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    storeValues = {};

    mockSource = {
      fetch: jest.fn(),
    };

    mockStorage = {
      getStoreValue: jest.fn((key: string) => storeValues[key]),
      setStoreValue: jest.fn(async (key: string, value: unknown) => {
        storeValues[key] = value;
      }),
      log: jest.fn(),
    };
  });

  describe('constructor', () => {
    test('creates instance with correct cache key', () => {
      const cachedSource = new CachedPriceSource(mockSource, 'DE-LU', mockStorage);
      expect(cachedSource).toBeInstanceOf(CachedPriceSource);
      // Cache key should be based on market area
      expect(mockStorage.getStoreValue).not.toHaveBeenCalled();
    });
  });

  describe('fetch', () => {
    test('returns cached data when cache is valid', async () => {
      const now = Date.now();
      const cachedData = {
        data: mockPriceData,
        timestamp: now - MILLISECONDS_PER_HOUR, // 1 hour ago (valid)
        marketArea: 'DE-LU',
      };
      storeValues['price_cache_DE-LU'] = cachedData;

      const cachedSource = new CachedPriceSource(mockSource, 'DE-LU', mockStorage);
      const result = await cachedSource.fetch();

      expect(result).toEqual(mockPriceData);
      expect(mockSource.fetch).not.toHaveBeenCalled();
      expect(mockStorage.getStoreValue).toHaveBeenCalledWith('price_cache_DE-LU');
      expect(mockStorage.log).toHaveBeenCalledWith(
        expect.stringContaining('[PRICE_CACHE] Cache hit'),
      );
    });

    test('fetches fresh data when cache is missing', async () => {
      (mockSource.fetch as jest.Mock).mockResolvedValue(mockPriceData);

      const cachedSource = new CachedPriceSource(mockSource, 'DE-LU', mockStorage);
      const result = await cachedSource.fetch();

      expect(result).toEqual(mockPriceData);
      expect(mockSource.fetch).toHaveBeenCalledTimes(1);
      expect(mockStorage.log).toHaveBeenCalledWith(
        expect.stringContaining('[PRICE_CACHE] Cache miss'),
      );
      expect(mockStorage.setStoreValue).toHaveBeenCalledWith(
        'price_cache_DE-LU',
        expect.objectContaining({
          data: mockPriceData,
          marketArea: 'DE-LU',
        }),
      );
    });

    test('fetches fresh data when cache is expired (older than 1 week)', async () => {
      const now = Date.now();
      const expiredCache = {
        data: mockPriceData,
        timestamp: now - MILLISECONDS_PER_WEEK - MILLISECONDS_PER_HOUR, // More than 1 week old
        marketArea: 'DE-LU',
      };
      storeValues['price_cache_DE-LU'] = expiredCache;

      const freshData: Array<PriceDataEntry> = [
        { date: '2025-01-08T00:00:00+01:00', price: 0.15 },
      ];
      (mockSource.fetch as jest.Mock).mockResolvedValue(freshData);

      const cachedSource = new CachedPriceSource(mockSource, 'DE-LU', mockStorage);
      const result = await cachedSource.fetch();

      expect(result).toEqual(freshData);
      expect(mockSource.fetch).toHaveBeenCalledTimes(1);
      expect(mockStorage.log).toHaveBeenCalledWith(
        expect.stringContaining('[PRICE_CACHE] Cache expired'),
      );
    });

    test('fetches fresh data when cache has invalid timestamp (future)', async () => {
      const now = Date.now();
      const invalidCache = {
        data: mockPriceData,
        timestamp: now + MILLISECONDS_PER_HOUR, // Future timestamp (negative age)
        marketArea: 'DE-LU',
      };
      storeValues['price_cache_DE-LU'] = invalidCache;

      (mockSource.fetch as jest.Mock).mockResolvedValue(mockPriceData);

      const cachedSource = new CachedPriceSource(mockSource, 'DE-LU', mockStorage);
      const result = await cachedSource.fetch();

      expect(result).toEqual(mockPriceData);
      expect(mockSource.fetch).toHaveBeenCalledTimes(1);
      expect(mockStorage.log).toHaveBeenCalledWith(
        expect.stringContaining('[PRICE_CACHE] Cache expired'),
      );
    });

    test('fetches fresh data when cache is missing data property', async () => {
      const invalidCache = {
        timestamp: Date.now(),
        marketArea: 'DE-LU',
        // Missing data property
      };
      storeValues['price_cache_DE-LU'] = invalidCache;

      (mockSource.fetch as jest.Mock).mockResolvedValue(mockPriceData);

      const cachedSource = new CachedPriceSource(mockSource, 'DE-LU', mockStorage);
      const result = await cachedSource.fetch();

      expect(result).toEqual(mockPriceData);
      expect(mockSource.fetch).toHaveBeenCalledTimes(1);
      expect(mockStorage.log).toHaveBeenCalledWith(
        expect.stringContaining('[PRICE_CACHE] Cache miss'),
      );
    });

    test('fetches fresh data when cache is missing timestamp property', async () => {
      const invalidCache = {
        data: mockPriceData,
        marketArea: 'DE-LU',
        // Missing timestamp property
      };
      storeValues['price_cache_DE-LU'] = invalidCache;

      (mockSource.fetch as jest.Mock).mockResolvedValue(mockPriceData);

      const cachedSource = new CachedPriceSource(mockSource, 'DE-LU', mockStorage);
      const result = await cachedSource.fetch();

      expect(result).toEqual(mockPriceData);
      expect(mockSource.fetch).toHaveBeenCalledTimes(1);
      expect(mockStorage.log).toHaveBeenCalledWith(
        expect.stringContaining('[PRICE_CACHE] Cache miss'),
      );
    });

    test('handles storage error when saving cache gracefully', async () => {
      (mockSource.fetch as jest.Mock).mockResolvedValue(mockPriceData);
      (mockStorage.setStoreValue as jest.Mock).mockRejectedValue(new Error('Storage full'));

      const cachedSource = new CachedPriceSource(mockSource, 'DE-LU', mockStorage);
      const result = await cachedSource.fetch();

      // Should still return data even if cache save fails
      expect(result).toEqual(mockPriceData);
      expect(mockStorage.log).toHaveBeenCalledWith(
        expect.stringContaining('[PRICE_CACHE] Failed to store cache'),
      );
    });

    test('uses different cache keys for different market areas', async () => {
      const now = Date.now();
      const cacheDE = {
        data: mockPriceData,
        timestamp: now - MILLISECONDS_PER_HOUR,
        marketArea: 'DE-LU',
      };
      const cacheAT = {
        data: [{ date: '2025-01-01T00:00:00+01:00', price: 0.2 }],
        timestamp: now - MILLISECONDS_PER_HOUR,
        marketArea: 'AT',
      };
      storeValues['price_cache_DE-LU'] = cacheDE;
      storeValues['price_cache_AT'] = cacheAT;

      const cachedSourceDE = new CachedPriceSource(mockSource, 'DE-LU', mockStorage);
      const resultDE = await cachedSourceDE.fetch();
      expect(resultDE).toEqual(mockPriceData);

      const cachedSourceAT = new CachedPriceSource(mockSource, 'AT', mockStorage);
      const resultAT = await cachedSourceAT.fetch();
      expect(resultAT).toEqual(cacheAT.data);

      expect(mockSource.fetch).not.toHaveBeenCalled();
    });

    test('logs cache age in hours', async () => {
      const now = Date.now();
      const ageHours = 5;
      const cachedData = {
        data: mockPriceData,
        timestamp: now - (ageHours * MILLISECONDS_PER_HOUR),
        marketArea: 'DE-LU',
      };
      storeValues['price_cache_DE-LU'] = cachedData;

      const cachedSource = new CachedPriceSource(mockSource, 'DE-LU', mockStorage);
      await cachedSource.fetch();

      expect(mockStorage.log).toHaveBeenCalledWith(
        expect.stringContaining(`age: ${ageHours}h`),
      );
    });

    test('caches fresh data after fetching', async () => {
      (mockSource.fetch as jest.Mock).mockResolvedValue(mockPriceData);

      const cachedSource = new CachedPriceSource(mockSource, 'DE-LU', mockStorage);
      await cachedSource.fetch();

      expect(mockStorage.setStoreValue).toHaveBeenCalledWith(
        'price_cache_DE-LU',
        expect.objectContaining({
          data: mockPriceData,
          marketArea: 'DE-LU',
          timestamp: expect.any(Number),
        }),
      );
      expect(mockStorage.log).toHaveBeenCalledWith(
        expect.stringContaining(`Cached ${mockPriceData.length} entries`),
      );
    });

    test('handles empty cache value (null)', async () => {
      storeValues['price_cache_DE-LU'] = null;

      (mockSource.fetch as jest.Mock).mockResolvedValue(mockPriceData);

      const cachedSource = new CachedPriceSource(mockSource, 'DE-LU', mockStorage);
      const result = await cachedSource.fetch();

      expect(result).toEqual(mockPriceData);
      expect(mockSource.fetch).toHaveBeenCalledTimes(1);
      expect(mockStorage.log).toHaveBeenCalledWith(
        expect.stringContaining('[PRICE_CACHE] Cache miss'),
      );
    });

    test('handles cache at exact 1 week boundary', async () => {
      const now = Date.now();
      // Cache exactly 1 week old (should be expired, as age < MILLISECONDS_PER_WEEK)
      const exactWeekCache = {
        data: mockPriceData,
        timestamp: now - MILLISECONDS_PER_WEEK,
        marketArea: 'DE-LU',
      };
      storeValues['price_cache_DE-LU'] = exactWeekCache;

      (mockSource.fetch as jest.Mock).mockResolvedValue(mockPriceData);

      const cachedSource = new CachedPriceSource(mockSource, 'DE-LU', mockStorage);
      const result = await cachedSource.fetch();

      // Age is exactly MILLISECONDS_PER_WEEK, which is NOT < MILLISECONDS_PER_WEEK
      // So it should be expired
      expect(result).toEqual(mockPriceData);
      expect(mockSource.fetch).toHaveBeenCalledTimes(1);
      expect(mockStorage.log).toHaveBeenCalledWith(
        expect.stringContaining('[PRICE_CACHE] Cache expired'),
      );
    });

    test('handles cache just under 1 week (still valid)', async () => {
      const now = Date.now();
      // Cache just under 1 week old (should be valid)
      const validCache = {
        data: mockPriceData,
        timestamp: now - MILLISECONDS_PER_WEEK + MILLISECONDS_PER_HOUR, // 1 hour less than 1 week
        marketArea: 'DE-LU',
      };
      storeValues['price_cache_DE-LU'] = validCache;

      const cachedSource = new CachedPriceSource(mockSource, 'DE-LU', mockStorage);
      const result = await cachedSource.fetch();

      expect(result).toEqual(mockPriceData);
      expect(mockSource.fetch).not.toHaveBeenCalled();
      expect(mockStorage.log).toHaveBeenCalledWith(
        expect.stringContaining('[PRICE_CACHE] Cache hit'),
      );
    });
  });
});
