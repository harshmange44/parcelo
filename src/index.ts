/**
 * parcelo
 * 
 * Parcel out massive jobs with recursive binary splitting.
 * Process at scale with automatic retry, distributed coordination, and fault tolerance.
 */

// Main schedulers
export { RangeScheduler } from './core/rangeScheduler';              // Production-ready (RECOMMENDED)
export { InMemoryScheduler } from './core/inMemoryScheduler';        // Development/testing

// Aliases for clarity
export { RangeScheduler as DistributedScheduler } from './core/rangeScheduler';
export { InMemoryScheduler as LocalScheduler } from './core/inMemoryScheduler';

// Backward compatibility (deprecated)
/** @deprecated Use RangeScheduler instead */
export { RangeScheduler as ProductionScheduler } from './core/rangeScheduler';

// Core classes
export { RangeTree } from './core/rangeTree';
export { PendingQueue } from './core/pendingQueue';
export { EventEmitter } from './core/events';

// Range Adapters (NEW!)
export type { RangeAdapter } from './adapters/rangeAdapter';
export { 
  NumberRangeAdapter,
  BigIntRangeAdapter,
  DateRangeAdapter,
  StringRangeAdapter,
  DefaultRangeAdapter,
  getDefaultAdapter,
} from './adapters/rangeAdapter';

// Storage
export { InMemoryStore } from './store/inMemoryStore';
export { RedisStore } from './store/redisStore';
export { JobStore } from './store/jobStore';
export { NodeStore } from './store/nodeStore';

// Worker
export { WorkerPool } from './worker/workerPool';
export { BullMQWorker } from './worker/bullmqWorker';

// Metrics
export { MetricsCollector, JobMetrics, ConsoleLogger } from './core/metrics';

// Utilities
export { generateId, generateJobId, generateNodeId } from './utils/id';
export { now, formatDuration, elapsed } from './utils/time';

// Types
export type {
  Range,
  ProcessFlags,
  ShouldProcessCallback,
  WorkCallback,
  WorkContext,
  RangeJobConfig,
  RangeNode,
  RangeJob,
  JobStats,
  RangeTreeSnapshot,
  RangeNodeSnapshot,
  EventListener,
  EventData,
  StorageAdapter,
  SchedulerOptions,
  PendingQueueItem,
  Logger,
  RetryConfig,
  RetryAttempt,
  PerformanceMetrics,
} from './types';

export { NodeStatus, JobStatus, SchedulerEvent } from './types';



