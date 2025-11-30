/**
 * Range adapter interface and built-in adapters
 */

import { Range } from '../types';

/**
 * Adapter for custom range types
 * Provides operations needed for splitting and comparison
 */
export interface RangeAdapter<T> {
  /**
   * Compare two values
   * @returns negative if a < b, 0 if a === b, positive if a > b
   */
  compare(a: T, b: T): number;

  /**
   * Calculate the size of a range
   * @returns numeric size (used for maxRangeSize checks)
   */
  size(range: Range<T>): number;

  /**
   * Calculate midpoint between two values
   * @returns value approximately halfway between start and end
   */
  midpoint(start: T, end: T): T;

  /**
   * Check if range is valid (start < end)
   */
  isValid(range: Range<T>): boolean;

  /**
   * Optional: Convert to string for logging
   */
  toString?(value: T): string;

  /**
   * Optional: Serialize value for storage
   */
  serialize?(value: T): string;

  /**
   * Optional: Deserialize value from storage
   */
  deserialize?(value: string): T;
}

/**
 * Number range adapter (default)
 */
export const NumberRangeAdapter: RangeAdapter<number> = {
  compare: (a, b) => a - b,

  size: (range) => Math.abs(range.end - range.start),

  midpoint: (start, end) => Math.floor((start + end) / 2),

  isValid: (range) => {
    return (
      Number.isFinite(range.start) &&
      Number.isFinite(range.end) &&
      range.start < range.end
    );
  },

  toString: (value) => value.toString(),

  serialize: (value) => value.toString(),

  deserialize: (value) => Number(value),
};

/**
 * BigInt range adapter
 */
export const BigIntRangeAdapter: RangeAdapter<bigint> = {
  compare: (a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  },

  size: (range) => {
    const diff = range.end - range.start;
    // Convert to number for size check (may lose precision for huge ranges)
    // For ranges larger than Number.MAX_SAFE_INTEGER, this is approximate
    if (diff > BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number.MAX_SAFE_INTEGER;
    }
    return Number(diff);
  },

  midpoint: (start, end) => (start + end) / 2n,

  isValid: (range) => range.start < range.end,

  toString: (value) => value.toString(),

  serialize: (value) => value.toString(),

  deserialize: (value) => BigInt(value),
};

/**
 * Date range adapter
 */
export const DateRangeAdapter: RangeAdapter<Date> = {
  compare: (a, b) => a.getTime() - b.getTime(),

  size: (range) => range.end.getTime() - range.start.getTime(),

  midpoint: (start, end) => {
    const mid = Math.floor((start.getTime() + end.getTime()) / 2);
    return new Date(mid);
  },

  isValid: (range) => range.start < range.end,

  toString: (value) => value.toISOString(),

  serialize: (value) => value.toISOString(),

  deserialize: (value) => new Date(value),
};

/**
 * String (lexicographic) range adapter
 * Useful for alphabetically ordered data, hash ranges, etc.
 */
export const StringRangeAdapter: RangeAdapter<string> = {
  compare: (a, b) => a.localeCompare(b),

  size: (range) => {
    // Approximate size based on string comparison
    // This is heuristic-based since true "distance" between strings is complex
    if (range.start === range.end) return 0;
    
    // For same-length strings, calculate character difference
    if (range.start.length === range.end.length) {
      let diff = 0;
      for (let i = 0; i < range.start.length; i++) {
        diff += range.end.charCodeAt(i) - range.start.charCodeAt(i);
      }
      return Math.abs(diff);
    }
    
    // For different lengths, use a heuristic
    const minLen = Math.min(range.start.length, range.end.length);
    let diff = 0;
    for (let i = 0; i < minLen; i++) {
      diff += range.end.charCodeAt(i) - range.start.charCodeAt(i);
    }
    diff += (range.end.length - range.start.length) * 128; // Average char code
    return Math.abs(diff);
  },

  midpoint: (start, end) => {
    // Find lexicographic midpoint
    const maxLen = Math.max(start.length, end.length);
    const startPadded = start.padEnd(maxLen, '\0');
    const endPadded = end.padEnd(maxLen, '\0');

    let mid = '';
    for (let i = 0; i < maxLen; i++) {
      const startCode = startPadded.charCodeAt(i);
      const endCode = endPadded.charCodeAt(i);
      const midCode = Math.floor((startCode + endCode) / 2);
      mid += String.fromCharCode(midCode);
    }

    return mid.replace(/\0+$/, ''); // Remove padding
  },

  isValid: (range) => range.start < range.end,

  toString: (value) => value,

  serialize: (value) => value,

  deserialize: (value) => value,
};

/**
 * Default adapter (Number)
 */
export const DefaultRangeAdapter = NumberRangeAdapter;

/**
 * Helper to get default adapter for a range type
 */
export function getDefaultAdapter<T>(sampleValue: T): RangeAdapter<T> {
  if (typeof sampleValue === 'number') {
    return NumberRangeAdapter as RangeAdapter<T>;
  }
  if (typeof sampleValue === 'bigint') {
    return BigIntRangeAdapter as RangeAdapter<T>;
  }
  if (sampleValue instanceof Date) {
    return DateRangeAdapter as RangeAdapter<T>;
  }
  if (typeof sampleValue === 'string') {
    return StringRangeAdapter as RangeAdapter<T>;
  }
  throw new Error(`No default adapter for type: ${typeof sampleValue}`);
}

