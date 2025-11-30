/**
 * Core types for the recursive range scheduler
 */

/**
 * Represents a generic range over type T
 * @template T The type of values in the range (default: number)
 */
export interface Range<T = number> {
  start: T;
  end: T;
}

/**
 * Status of a range node
 */
export enum NodeStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  DONE = 'done',
  SKIPPED = 'skipped',
  ERROR = 'error',
}

/**
 * Status of a job
 */
export enum JobStatus {
  CREATED = 'created',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
  PARTIALLY_FAILED = 'partially_failed',
}

/**
 * Flags passed to shouldProcess callback
 */
export interface ProcessFlags {
  depth: number;
  path: number[];  // Path from root (0 = left, 1 = right)
  isLeaf: boolean;
}

/**
 * Callback to determine if a range should be processed
 * @template T The type of values in the range
 */
export type ShouldProcessCallback<T = number> = (
  range: Range<T>,
  flags: ProcessFlags
) => boolean | Promise<boolean>;

/**
 * Callback to execute work on a range
 * @template T The type of values in the range
 */
export type WorkCallback<T = number> = (
  range: Range<T>,
  context: WorkContext
) => void | Promise<void>;

/**
 * Context provided to work callback
 */
export interface WorkContext {
  jobId: string;
  nodeId: string;
  signal: AbortSignal;
  attempt: number;
  logger?: Logger;
}

/**
 * Logger interface
 */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  backoffMs?: number | ((attempt: number) => number);
  backoffType?: 'fixed' | 'exponential' | 'linear';
}

/**
 * Retry history entry
 */
export interface RetryAttempt {
  attempt: number;
  error: string;
  timestamp: number;
  durationMs?: number;
}

/**
 * Configuration for a range job
 * @template T The type of values in the range (default: number)
 */
export interface RangeJobConfig<T = number> {
  range: Range<T>;
  maxRangeSize: number;  // Maximum size before splitting
  maxDepth?: number;     // Maximum tree depth to prevent excessive splitting
  shouldProcess?: ShouldProcessCallback<T>;
  work: WorkCallback<T>;
  maxConcurrency?: number;  // Max concurrent workers
  retry?: RetryConfig;      // Retry configuration
  metadata?: Record<string, unknown>;
  failureThreshold?: number; // Percentage of failures allowed (0-100)
  rangeAdapter?: any;  // RangeAdapter<T> - typed as any to avoid circular dependency
}

/**
 * Represents a node in the range tree
 * @template T The type of values in the range (default: number)
 */
export interface RangeNode<T = number> {
  id: string;
  jobId: string;
  range: Range<T>;
  status: NodeStatus;
  depth: number;
  path: number[];
  parentId: string | null;
  leftChildId: string | null;
  rightChildId: string | null;
  isLeaf: boolean;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
  // Retry fields
  attempts: number;
  maxAttempts: number;
  lastAttemptAt?: number;
  nextRetryAt?: number;
  retryHistory: RetryAttempt[];
  // Heartbeat for stale detection
  lastHeartbeat?: number;
}

/**
 * Represents a range job
 * @template T The type of values in the range (default: number)
 */
export interface RangeJob<T = number> {
  id: string;
  config: RangeJobConfig<T>;
  status: JobStatus;
  rootNodeId: string;
  stats: JobStats;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  pausedAt?: number;
}

/**
 * Statistics for a job
 */
export interface JobStats {
  totalNodes: number;
  pendingNodes: number;
  runningNodes: number;
  doneNodes: number;
  skippedNodes: number;
  errorNodes: number;
  rangeProcessed: number;  // Total range units processed (done)
  rangeSkipped: number;     // Total range units skipped
  rangeTotal: number;       // Total range size
  // Performance metrics
  totalAttempts: number;
  avgNodeLatencyMs: number;
  p95NodeLatencyMs?: number;
  throughputPerMinute: number;
  startTime?: number;
  endTime?: number;
}

/**
 * Snapshot of a range tree for inspection
 * @template T The type of values in the range (default: number)
 */
export interface RangeTreeSnapshot<T = number> {
  jobId: string;
  rootNode: RangeNodeSnapshot<T>;
}

/**
 * Snapshot of a single node (recursive structure)
 * @template T The type of values in the range (default: number)
 */
export interface RangeNodeSnapshot<T = number> {
  id: string;
  range: Range<T>;
  status: NodeStatus;
  depth: number;
  isLeaf: boolean;
  error?: string;
  leftChild?: RangeNodeSnapshot<T>;
  rightChild?: RangeNodeSnapshot<T>;
}

/**
 * Events emitted by the scheduler
 */
export enum SchedulerEvent {
  JOB_CREATED = 'job:created',
  JOB_STARTED = 'job:started',
  JOB_PAUSED = 'job:paused',
  JOB_RESUMED = 'job:resumed',
  JOB_CANCELLED = 'job:cancelled',
  JOB_COMPLETED = 'job:completed',
  JOB_FAILED = 'job:failed',
  JOB_PARTIALLY_FAILED = 'job:partially_failed',
  NODE_CREATED = 'node:created',
  NODE_SPLIT = 'node:split',
  NODE_SKIPPED = 'node:skipped',
  NODE_STARTED = 'node:started',
  NODE_COMPLETED = 'node:completed',
  NODE_FAILED = 'node:failed',
  NODE_RETRYING = 'node:retrying',
  NODE_STALE = 'node:stale',
  STATS_UPDATED = 'stats:updated',
  METRICS_UPDATED = 'metrics:updated',
}

/**
 * Event data for different event types
 */
export interface EventData {
  [SchedulerEvent.JOB_CREATED]: { jobId: string; job: RangeJob<any> };
  [SchedulerEvent.JOB_STARTED]: { jobId: string };
  [SchedulerEvent.JOB_PAUSED]: { jobId: string };
  [SchedulerEvent.JOB_RESUMED]: { jobId: string };
  [SchedulerEvent.JOB_CANCELLED]: { jobId: string };
  [SchedulerEvent.JOB_COMPLETED]: { jobId: string; stats: JobStats };
  [SchedulerEvent.JOB_FAILED]: { jobId: string; error: string };
  [SchedulerEvent.JOB_PARTIALLY_FAILED]: { jobId: string; stats: JobStats };
  [SchedulerEvent.NODE_CREATED]: { jobId: string; nodeId: string; node: RangeNode<any> };
  [SchedulerEvent.NODE_SPLIT]: { jobId: string; nodeId: string; leftId: string; rightId: string };
  [SchedulerEvent.NODE_SKIPPED]: { jobId: string; nodeId: string };
  [SchedulerEvent.NODE_STARTED]: { jobId: string; nodeId: string; attempt: number };
  [SchedulerEvent.NODE_COMPLETED]: { jobId: string; nodeId: string; durationMs: number; attempt?: number };
  [SchedulerEvent.NODE_FAILED]: { jobId: string; nodeId: string; error: string; attempt: number };
  [SchedulerEvent.NODE_RETRYING]: { jobId: string; nodeId: string; attempt: number; nextRetryMs: number };
  [SchedulerEvent.NODE_STALE]: { jobId: string; nodeId: string; staleDurationMs: number };
  [SchedulerEvent.STATS_UPDATED]: { jobId: string; stats: JobStats };
  [SchedulerEvent.METRICS_UPDATED]: { jobId: string; metrics: PerformanceMetrics };
}

/**
 * Generic event listener type
 */
export type EventListener<T = unknown> = (data: T) => void | Promise<void>;

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  throughputPerSecond: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  successRate: number;
  retryRate: number;
}

/**
 * Storage adapter interface for extensibility
 * Note: Uses any for generic type to avoid complex generic constraints
 */
export interface StorageAdapter {
  // Job operations
  saveJob(job: RangeJob<any>): Promise<void>;
  getJob(jobId: string): Promise<RangeJob<any> | null>;
  updateJob(jobId: string, updates: Partial<RangeJob<any>>): Promise<void>;
  deleteJob(jobId: string): Promise<void>;
  getAllJobs(): Promise<RangeJob<any>[]>;
  
  // Node operations
  saveNode(node: RangeNode<any>): Promise<void>;
  getNode(nodeId: string): Promise<RangeNode<any> | null>;
  updateNode(nodeId: string, updates: Partial<RangeNode<any>>): Promise<void>;
  deleteNode(nodeId: string): Promise<void>;
  getNodesByJob(jobId: string): Promise<RangeNode<any>[]>;
  getNodesByStatus(jobId: string, status: NodeStatus): Promise<RangeNode<any>[]>;
  
  // Batch operations
  saveNodes(nodes: RangeNode<any>[]): Promise<void>;
  updateNodes(updates: Array<{ nodeId: string; updates: Partial<RangeNode<any>> }>): Promise<void>;
  
  // Atomic operations
  claimNextPendingNode?(jobId: string): Promise<RangeNode<any> | null>;
  findStaleNodes?(jobId: string, staleThresholdMs: number): Promise<RangeNode<any>[]>;
  heartbeat?(nodeId: string): Promise<void>;
  
  // Cleanup
  clear(): Promise<void>;
  disconnect?(): Promise<void>;
}

/**
 * Options for creating a scheduler
 */
export interface SchedulerOptions {
  storage?: StorageAdapter;
  defaultMaxConcurrency?: number;
  redisUrl?: string;
  staleNodeCheckIntervalMs?: number;
  staleNodeThresholdMs?: number;
  enableMetrics?: boolean;
  logger?: Logger;
}

/**
 * Priority queue item
 */
export interface PendingQueueItem {
  nodeId: string;
  jobId: string;
  depth: number;
  priority: number;
  addedAt: number;
  sequence: number;  // For FIFO ordering when addedAt is the same
}

