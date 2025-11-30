/**
 * ID generation utilities
 */

let counter = 0;

/**
 * Generates a unique ID with a prefix
 */
export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  const count = (++counter).toString(36);
  return `${prefix}_${timestamp}${random}${count}`;
}

/**
 * Generates a job ID
 */
export function generateJobId(): string {
  return generateId('job');
}

/**
 * Generates a node ID
 */
export function generateNodeId(): string {
  return generateId('node');
}

