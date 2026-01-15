/**
 * Price Data Utilities
 *
 * Pure functions for converting and manipulating price data.
 * This module is isolated from Homey dependencies to enable comprehensive testing.
 */

import type { PriceBlock, PriceCache } from '../lowPrice/types';
import type { PriceDataEntry } from '../lowPrice/priceSource';

const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes in milliseconds

/**
 * Convert PriceDataEntry array to PriceCache
 * @param priceData - Array of price data entries
 * @returns PriceCache object with timestamp keys
 */
export function convertPriceDataToCache(priceData: Array<PriceDataEntry>): PriceCache {
  const cache: PriceCache = {};

  for (const entry of priceData) {
    const startTimestamp = new Date(entry.date).getTime();
    const endTimestamp = startTimestamp + BLOCK_DURATION_MS;

    cache[String(startTimestamp)] = {
      start: startTimestamp,
      end: endTimestamp,
      price: entry.price,
    };
  }

  return cache;
}

/**
 * Update cache with new price data, tracking statistics
 * @param cache - Existing price cache
 * @param priceData - New price data entries
 * @returns Updated cache and statistics
 */
export function updatePriceCache(
  cache: PriceCache,
  priceData: Array<PriceDataEntry>
): { cache: PriceCache; stats: { newBlocks: number; updatedBlocks: number; priceChanges: number } } {
  let newBlocks = 0;
  let updatedBlocks = 0;
  let priceChanges = 0;

  for (const entry of priceData) {
    const startTimestamp = new Date(entry.date).getTime();
    const endTimestamp = startTimestamp + BLOCK_DURATION_MS;

    const existingBlock = cache[String(startTimestamp)];
    const isUpdate = existingBlock !== undefined;

    cache[String(startTimestamp)] = {
      start: startTimestamp,
      end: endTimestamp,
      price: entry.price,
    };

    if (isUpdate) {
      updatedBlocks++;
      if (existingBlock.price !== entry.price) {
        priceChanges++;
      }
    } else {
      newBlocks++;
    }
  }

  return { cache, stats: { newBlocks, updatedBlocks, priceChanges } };
}
