/**
 * Example: Using Date ranges for time-based processing
 * Perfect for: Time-series data, log processing, historical data backfill
 */

import {
  InMemoryScheduler,
  DateRangeAdapter,
  RangeJobConfig,
  SchedulerEvent,
} from '../src/index';

async function main() {
  console.log('📅 Date Range Example');
  console.log('=====================\n');

  const scheduler = new InMemoryScheduler<Date>();

  // Track processed time ranges
  const processedRanges: Array<{ start: Date; end: Date }> = [];

  // Configure the job with Date range
  const config: RangeJobConfig<Date> = {
    // Process logs from the entire year 2024
    range: { 
      start: new Date('2024-01-01T00:00:00Z'), 
      end: new Date('2024-12-31T23:59:59Z')
    },

    // Split into 7-day chunks (1 week in milliseconds)
    maxRangeSize: 7 * 24 * 60 * 60 * 1000,

    // Provide Date adapter
    rangeAdapter: DateRangeAdapter,

    // Optional: Only process weekdays
    shouldProcess: async (range) => {
      const startDay = range.start.getDay();
      // Skip if range starts on weekend (0 = Sunday, 6 = Saturday)
      if (startDay === 0 || startDay === 6) {
        console.log(`  ⏭️  Skipping weekend range: ${range.start.toISOString()}`);
        return false;
      }
      return true;
    },

    // Work callback
    work: async (range) => {
      processedRanges.push(range);
      
      // Simulate processing (e.g., aggregating metrics for the time range)
      await new Promise(resolve => setTimeout(resolve, 20));
      
      const durationDays = (range.end.getTime() - range.start.getTime()) / (24 * 60 * 60 * 1000);
      console.log(`  ✅ Processed ${durationDays.toFixed(1)} days: ${range.start.toISOString()} to ${range.end.toISOString()}`);
    },

    maxConcurrency: 4,
  };

  // Register event listeners
  scheduler.on(SchedulerEvent.JOB_CREATED, ({ jobId }) => {
    console.log(`📋 Job created: ${jobId}\n`);
  });

  scheduler.on(SchedulerEvent.JOB_STARTED, () => {
    console.log('▶️  Job started - Processing 2024 logs\n');
  });

  scheduler.on(SchedulerEvent.NODE_SPLIT, () => {
    console.log(`  🌳 Splitting time range into smaller chunks`);
  });

  scheduler.on(SchedulerEvent.NODE_SKIPPED, () => {
    console.log(`  ⏭️  Skipped range (weekend)`);
  });

  scheduler.on(SchedulerEvent.JOB_COMPLETED, async ({ jobId, stats }) => {
    console.log(`\n✅ Job ${jobId} completed!`);
    console.log(`\nFinal Statistics:`);
    console.log(`  Total nodes: ${stats.totalNodes}`);
    console.log(`  Done nodes: ${stats.doneNodes}`);
    console.log(`  Skipped nodes: ${stats.skippedNodes}`);
    console.log(`  Error nodes: ${stats.errorNodes}`);
    console.log(`  Time range processed: ${(stats.rangeProcessed / (24 * 60 * 60 * 1000)).toFixed(1)} days`);
    console.log(`\nProcessed ${processedRanges.length} time ranges`);
  });

  // Create and start the job
  const jobId = await scheduler.createJob(config);
  await scheduler.startJob(jobId);

  // Wait for completion
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('\n✨ Date range processing complete!');
}

main().catch(console.error);

