# parcelo 📦

> Parcel out massive jobs with recursive binary splitting. Process at scale with automatic retry, distributed coordination, and fault tolerance.

A production-ready TypeScript library for splitting large workloads into manageable chunks and processing them at scale.

## Features

- 🌳 **Recursive Binary Splitting**: Automatically splits large ranges into manageable chunks
- ✂️ **Prunable Trees**: Skip entire subtrees based on custom logic
- 🔄 **Concurrent Execution**: Worker pool with configurable concurrency
- 📊 **Real-time Statistics**: Track progress and performance
- 🎯 **Type-safe**: Built with TypeScript, no `any` types
- 💾 **Storage Agnostic**: In-memory by default, extensible with adapters
- 📡 **Event-driven**: Rich event system for monitoring
- ⚡ **Efficient**: O(log N) operations with priority queue

## Installation

```bash
npm install @harshmange44/parcelo
```

## Quick Start

### Development / Testing (Simple)

```typescript
import { InMemoryScheduler } from '@harshmange44/parcelo';

const scheduler = new InMemoryScheduler();

const jobId = await scheduler.createJob({
  range: { start: 0, end: 1000 },
  maxRangeSize: 100,
  work: async (range) => {
    console.log(`Processing ${range.start} to ${range.end}`);
  }
});

await scheduler.startJob(jobId);
```

### Production (Recommended)

```typescript
import { RangeScheduler } from '@harshmange44/parcelo';

const scheduler = new RangeScheduler({
  redisUrl: 'redis://localhost:6379',
  defaultMaxConcurrency: 10,
  staleNodeCheckIntervalMs: 30_000,
  heartbeatIntervalMs: 15_000,
  enableMetrics: true,
});

const jobId = await scheduler.createJob({
  range: { start: 0, end: 1_000_000 },
  maxRangeSize: 10_000,
  retry: {
    maxAttempts: 3,
    backoffMs: (attempt) => Math.pow(2, attempt) * 1000,
  },
  work: async (range, ctx) => {
    // Your work here
  }
});

await scheduler.startJob(jobId);
```

## Which Scheduler to Use?

### InMemoryScheduler (Development/Testing)

**Use for:**
- ✅ Local development
- ✅ Unit tests
- ✅ Quick prototyping
- ✅ Simple single-process applications

**Features:**
- ⚡ Zero setup (no external dependencies)
- ⚡ Fast startup
- ⚡ Perfect for learning

**Limitations:**
- ❌ No persistence (state lost on crash)
- ❌ No automatic retry
- ❌ Single process only

### RangeScheduler (Production - RECOMMENDED)

**Use for:**
- ✅ Production deployments
- ✅ Critical jobs requiring reliability
- ✅ Distributed processing across multiple workers
- ✅ Jobs that need retry logic

**Features:**
- ✅ Redis persistence (crash-safe)
- ✅ BullMQ reliable job processing
- ✅ Automatic retry with exponential backoff
- ✅ Stale node detection & recovery
- ✅ Performance metrics (throughput, latency)
- ✅ Distributed coordination
- ✅ Heartbeat mechanism

**Requirements:**
- Redis server
- BullMQ setup
```

## Core Concepts

### Range Jobs

A `RangeJob` operates on a numeric range `{ start: number; end: number }`. The scheduler automatically splits large ranges into smaller chunks using recursive binary splitting.

### Range Tree

Internally, the scheduler maintains a binary tree where:
- Each node represents a subrange
- Nodes have a status: `pending`, `running`, `done`, `skipped`, or `error`
- Leaf nodes represent executable units
- Non-leaf nodes are split into left and right children

### Pruning

The `shouldProcess` callback allows you to skip entire subtrees:

```typescript
shouldProcess: async (range, flags) => {
  // Skip ranges that don't meet criteria
  if (range.start % 10000 !== 0) {
    return false; // Entire subtree will be skipped
  }
  return true;
}
```

### Worker Pool

Work is executed concurrently using a worker pool. Configure concurrency per job or globally:

```typescript
const scheduler = new RangeScheduler({
  defaultMaxConcurrency: 10
});

// Or per job
await scheduler.createJob({
  // ...
  maxConcurrency: 5
});
```

## API Reference

### RangeScheduler

#### Constructor

```typescript
new RangeScheduler(options?: SchedulerOptions)
```

Options:
- `storage?: StorageAdapter` - Custom storage adapter (defaults to in-memory)
- `defaultMaxConcurrency?: number` - Default max concurrent workers (default: 10)

#### Methods

##### `createJob(config: RangeJobConfig): Promise<string>`

Creates a new range job and returns its ID.

```typescript
interface RangeJobConfig {
  range: Range;
  maxRangeSize: number;
  shouldProcess?: ShouldProcessCallback;
  work: WorkCallback;
  maxConcurrency?: number;
  metadata?: Record<string, unknown>;
}
```

##### `startJob(jobId: string): Promise<void>`

Starts processing a job.

##### `pauseJob(jobId: string): Promise<void>`

Pauses a running job.

##### `cancelJob(jobId: string): Promise<void>`

Cancels a job and cleans up resources.

##### `getJob(jobId: string): Promise<RangeJob | null>`

Retrieves job details.

##### `getStats(jobId: string): Promise<JobStats | null>`

Gets current job statistics:

```typescript
interface JobStats {
  totalNodes: number;
  pendingNodes: number;
  runningNodes: number;
  doneNodes: number;
  skippedNodes: number;
  errorNodes: number;
  rangeProcessed: number;
  rangeSkipped: number;
  rangeTotal: number;
}
```

##### `getJobTreeSnapshot(jobId: string): Promise<RangeTreeSnapshot | null>`

Gets a recursive snapshot of the job's range tree for inspection.

##### `on(event: SchedulerEvent, listener: EventListener): void`

Registers an event listener.

### Events

The scheduler emits the following events:

- `JOB_CREATED` - Job was created
- `JOB_STARTED` - Job started processing
- `JOB_PAUSED` - Job was paused
- `JOB_RESUMED` - Job resumed from pause
- `JOB_CANCELLED` - Job was cancelled
- `JOB_COMPLETED` - Job completed successfully
- `JOB_FAILED` - Job failed with errors
- `NODE_CREATED` - New tree node created
- `NODE_SPLIT` - Node split into children
- `NODE_SKIPPED` - Node was skipped
- `NODE_STARTED` - Leaf node started executing
- `NODE_COMPLETED` - Leaf node completed
- `NODE_FAILED` - Leaf node failed
- `STATS_UPDATED` - Job statistics updated

Example:

```typescript
scheduler.on(SchedulerEvent.STATS_UPDATED, ({ jobId, stats }) => {
  const progress = (stats.rangeProcessed / stats.rangeTotal) * 100;
  console.log(`Progress: ${progress.toFixed(2)}%`);
});
```

## Examples

### Basic Range Processing

```typescript
const jobId = await scheduler.createJob({
  range: { start: 0, end: 1000 },
  maxRangeSize: 100,
  work: async (range) => {
    // Process range
    for (let i = range.start; i < range.end; i++) {
      // Do something with i
    }
  }
});

await scheduler.startJob(jobId);
```

### With Pruning

```typescript
const jobId = await scheduler.createJob({
  range: { start: 0, end: 1000000 },
  maxRangeSize: 1000,
  
  // Only process every 10,000th range
  shouldProcess: async (range, flags) => {
    if (flags.isLeaf) {
      return range.start % 10000 === 0;
    }
    // For non-leaf nodes, check if any descendant could be valid
    return Math.floor(range.end / 10000) > Math.floor(range.start / 10000);
  },
  
  work: async (range) => {
    console.log(`Processing ${range.start} - ${range.end}`);
  }
});

await scheduler.startJob(jobId);
```

### Progress Tracking

```typescript
scheduler.on(SchedulerEvent.STATS_UPDATED, ({ stats }) => {
  const progress = (stats.rangeProcessed / stats.rangeTotal) * 100;
  console.log(`Progress: ${progress.toFixed(2)}%`);
  console.log(`Nodes: ${stats.doneNodes}/${stats.totalNodes}`);
});

scheduler.on(SchedulerEvent.JOB_COMPLETED, ({ stats }) => {
  console.log('Completed!', {
    processed: stats.rangeProcessed,
    skipped: stats.rangeSkipped,
    errors: stats.errorNodes
  });
});
```

### Error Handling

```typescript
const jobId = await scheduler.createJob({
  range: { start: 0, end: 1000 },
  maxRangeSize: 100,
  work: async (range, context) => {
    try {
      // Your work here
      if (context.signal.aborted) {
        return; // Job was cancelled
      }
    } catch (error) {
      // Error will be caught and node marked as error
      throw error;
    }
  }
});

scheduler.on(SchedulerEvent.NODE_FAILED, ({ nodeId, error }) => {
  console.error(`Node ${nodeId} failed:`, error);
});

scheduler.on(SchedulerEvent.JOB_FAILED, ({ error }) => {
  console.error('Job failed:', error);
});
```

## Architecture

### Storage Layer

The library uses a storage adapter pattern for flexibility:

```typescript
interface StorageAdapter {
  saveJob(job: RangeJob): Promise<void>;
  getJob(jobId: string): Promise<RangeJob | null>;
  // ... other methods
}
```

Default: `InMemoryStore` (no persistence)

Custom adapters can be implemented for databases, Redis, etc.

### Processing Pipeline

1. Job created with root node covering entire range
2. Root node added to pending queue
3. Processing loop:
   - Dequeue highest priority node (deeper = higher priority)
   - Check `shouldProcess` callback
   - If leaf: execute work
   - If non-leaf: split into two children
4. Children added back to queue
5. Repeat until no pending nodes

### Performance

- **Splitting**: O(log N) tree depth for N total range size
- **Queue operations**: O(log M) for M pending nodes
- **Node lookup**: O(1) with in-memory store
- **Concurrency**: Configurable worker pool

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run example
npm run example
```

## License

MIT

## Author

Harsh Mange

