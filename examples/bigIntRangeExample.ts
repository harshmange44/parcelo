/**
 * Example: Using BigInt ranges for very large number ranges
 * Perfect for: Twitter Snowflake IDs, large database IDs, blockchain data
 */

import {
  InMemoryScheduler,
  BigIntRangeAdapter,
  RangeJobConfig,
  SchedulerEvent,
} from '../src/index';

async function main() {
  console.log('🔢 BigInt Range Example');
  console.log('========================\n');

  const scheduler = new InMemoryScheduler<bigint>();

  // Track processed ranges
  const processedRanges: Array<{ start: bigint; end: bigint }> = [];

  // Configure the job with BigInt range
  const config: RangeJobConfig<bigint> = {
    // Process a very large range (e.g., Twitter Snowflake IDs)
    // Range: 1 trillion to 2 trillion
    range: { 
      start: 1_000_000_000_000n, 
      end: 2_000_000_000_000n 
    },

    // Split ranges larger than 1 million
    maxRangeSize: 1_000_000,

    // Provide BigInt adapter
    rangeAdapter: BigIntRangeAdapter,

    // Work callback
    work: async (range) => {
      processedRanges.push(range);
      
      // Simulate processing (e.g., fetching tweets by ID range)
      await new Promise(resolve => setTimeout(resolve, 10));
      
      console.log(`  ✅ Processed range [${range.start.toLocaleString()}, ${range.end.toLocaleString()})`);
    },

    maxConcurrency: 3,
  };

  // Register event listeners
  scheduler.on(SchedulerEvent.JOB_CREATED, ({ jobId }) => {
    console.log(`📋 Job created: ${jobId}\n`);
  });

  scheduler.on(SchedulerEvent.JOB_STARTED, () => {
    console.log('▶️  Job started\n');
  });

  scheduler.on(SchedulerEvent.NODE_SPLIT, ({ leftId, rightId }) => {
    console.log(`  🌳 Node split into [${leftId}] and [${rightId}]`);
  });

  scheduler.on(SchedulerEvent.JOB_COMPLETED, async ({ jobId, stats }) => {
    console.log(`\n✅ Job ${jobId} completed!`);
    console.log(`\nFinal Statistics:`);
    console.log(`  Total nodes: ${stats.totalNodes}`);
    console.log(`  Done nodes: ${stats.doneNodes}`);
    console.log(`  Skipped nodes: ${stats.skippedNodes}`);
    console.log(`  Error nodes: ${stats.errorNodes}`);
    console.log(`  Range processed: ${stats.rangeProcessed.toLocaleString()}`);
    console.log(`\nProcessed ${processedRanges.length} ranges`);
  });

  // Create and start the job
  const jobId = await scheduler.createJob(config);
  await scheduler.startJob(jobId);

  // Wait for completion
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('\n✨ BigInt range processing complete!');
}

main().catch(console.error);

