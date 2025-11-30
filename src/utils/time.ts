/**
 * Time utilities
 */

/**
 * Returns the current timestamp in milliseconds
 */
export function now(): number {
  return Date.now();
}

/**
 * Formats a duration in milliseconds to a human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(2)}m`;
  return `${(ms / 3600000).toFixed(2)}h`;
}

/**
 * Calculates elapsed time from a start timestamp
 */
export function elapsed(startTime: number): number {
  return now() - startTime;
}

