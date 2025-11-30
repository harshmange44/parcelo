/**
 * Example: Using custom types with a custom adapter
 * Perfect for: Sharded databases, multi-dimensional ranges, complex domain objects
 */

import {
  InMemoryScheduler,
  RangeJobConfig,
  SchedulerEvent,
  Range,
} from '../src/index';
import { RangeAdapter } from '../src/adapters/rangeAdapter';

/**
 * Custom type: Represents a user ID in a sharded database
 */
interface ShardedUserId {
  shard: number;  // Which database shard (0-99)
  id: number;     // User ID within that shard (0-999999)
}

/**
 * Custom adapter for ShardedUserId
 */
const ShardedUserIdAdapter: RangeAdapter<ShardedUserId> = {
  compare: (a, b) => {
    // Compare by shard first, then by ID
    const shardDiff = a.shard - b.shard;
    return shardDiff !== 0 ? shardDiff : a.id - b.id;
  },

  size: (range) => {
    // Calculate total number of users in range
    const startTotal = range.start.shard * 1_000_000 + range.start.id;
    const endTotal = range.end.shard * 1_000_000 + range.end.id;
    return endTotal - startTotal;
  },

  midpoint: (start, end) => {
    // Find midpoint across shards
    const startTotal = start.shard * 1_000_000 + start.id;
    const endTotal = end.shard * 1_000_000 + end.id;
    const mid = Math.floor((startTotal + endTotal) / 2);

    return {
      shard: Math.floor(mid / 1_000_000),
      id: mid % 1_000_000,
    };
  },

  isValid: (range) => {
    const cmp = ShardedUserIdAdapter.compare(range.start, range.end);
    return cmp < 0;
  },

  toString: (value) => `shard${value.shard}:${value.id}`,

  serialize: (value) => JSON.stringify(value),

  deserialize: (value) => JSON.parse(value),
};

async function main() {
  console.log('🔧 Custom Type Range Example (Sharded User IDs)');
  console.log('================================================\n');

  const scheduler = new InMemoryScheduler<ShardedUserId>();

  // Track processed ranges
  const processedRanges: Array<{ start: ShardedUserId; end: ShardedUserId }> = [];

  // Configure the job with custom ShardedUserId range
  const config: RangeJobConfig<ShardedUserId> = {
    // Process users across 10 shards, each with up to 1 million users
    range: { 
      start: { shard: 0, id: 0 }, 
      end: { shard: 9, id: 999_999 }
    },

    // Split ranges larger than 50,000 users
    maxRangeSize: 50_000,

    // Provide custom adapter
    rangeAdapter: ShardedUserIdAdapter,

    // Optional: Only process even-numbered shards
    shouldProcess: async (range, flags) => {
      // For non-leaf nodes, check if range contains any even shards
      if (!flags.isLeaf && range.start.shard % 2 !== 0 && range.end.shard === range.start.shard) {
        console.log(`  ⏭️  Pruning odd shard ${range.start.shard}`);
        return false;
      }
      return true;
    },

    // Work callback
    work: async (range) => {
      processedRanges.push(range);
      
      // Simulate processing (e.g., migrating users in this range)
      await new Promise(resolve => setTimeout(resolve, 15));
      
      const size = ShardedUserIdAdapter.size(range);
      console.log(`  ✅ Processed ${size.toLocaleString()} users from ${ShardedUserIdAdapter.toString(range.start)} to ${ShardedUserIdAdapter.toString(range.end)}`);
    },

    maxConcurrency: 5,
  };

  // Register event listeners
  scheduler.on(SchedulerEvent.JOB_CREATED, ({ jobId }) => {
    console.log(`📋 Job created: ${jobId}\n`);
  });

  scheduler.on(SchedulerEvent.JOB_STARTED, () => {
    console.log('▶️  Job started - Processing sharded users\n');
  });

  scheduler.on(SchedulerEvent.NODE_SPLIT, ({ nodeId, leftId, rightId }) => {
    console.log(`  🌳 Node split into smaller ranges`);
  });

  scheduler.on(SchedulerEvent.NODE_SKIPPED, ({ nodeId }) => {
    console.log(`  ⏭️  Skipped range (odd shard)`);
  });

  scheduler.on(SchedulerEvent.JOB_COMPLETED, async ({ jobId, stats }) => {
    console.log(`\n✅ Job ${jobId} completed!`);
    console.log(`\nFinal Statistics:`);
    console.log(`  Total nodes: ${stats.totalNodes}`);
    console.log(`  Done nodes: ${stats.doneNodes}`);
    console.log(`  Skipped nodes: ${stats.skippedNodes}`);
    console.log(`  Error nodes: ${stats.errorNodes}`);
    console.log(`  Users processed: ${stats.rangeProcessed.toLocaleString()}`);
    console.log(`  Users skipped: ${stats.rangeSkipped.toLocaleString()}`);
    console.log(`\nProcessed ${processedRanges.length} sharded ranges`);
  });

  // Create and start the job
  const jobId = await scheduler.createJob(config);
  await scheduler.startJob(jobId);

  // Wait for completion
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('\n✨ Custom type range processing complete!');
}

main().catch(console.error);

