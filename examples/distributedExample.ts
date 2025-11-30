/**
 * Distributed Example: Range Processing with Full Reliability
 * 
 * This example demonstrates:
 * - Redis-backed persistence (crash-safe)
 * - BullMQ for reliable distributed processing
 * - Automatic retry with exponential backoff
 * - Stale node detection and recovery
 * - Real-time performance metrics
 * - Heartbeat mechanism
 * - Graceful shutdown
 */

import {
  RangeScheduler,
  SchedulerEvent,
  RangeJobConfig,
  Range,
} from '../src/index';

async function main() {
  console.log('🚀 Distributed Range Scheduler Example\n');
  console.log('Prerequisites:');
  console.log('  - Redis running on localhost:6379');
  console.log('  - Run: docker run -d -p 6379:6379 redis\n');

  // Create distributed scheduler with full reliability
  const scheduler = new RangeScheduler({
    redisUrl: 'redis://localhost:6379',
    defaultMaxConcurrency: 10,
    
    // Stale detection (detect crashed workers)
    staleNodeCheckIntervalMs: 30_000,    // Check every 30 seconds
    staleNodeThresholdMs: 2 * 60 * 1000, // 2 minutes timeout
    
    // Heartbeat (keep-alive for running nodes)
    heartbeatIntervalMs: 15_000,          // Heartbeat every 15 seconds
    
    // Enable performance metrics
    enableMetrics: true,
  });

  // Track processed ranges
  let processedCount = 0;
  let failedCount = 0;

  // Setup event listeners for monitoring
  scheduler.on(SchedulerEvent.JOB_CREATED, ({ jobId }) => {
    console.log(`📋 Job created: ${jobId}\n`);
  });

  scheduler.on(SchedulerEvent.JOB_STARTED, () => {
    console.log('▶️  Job started\n');
  });

  scheduler.on(SchedulerEvent.NODE_SPLIT, () => {
    // Uncomment to see all splits
    // console.log(`  🌳 Node split`);
  });

  scheduler.on(SchedulerEvent.NODE_RETRYING, ({ nodeId, attempt }) => {
    console.log(`  🔄 Retrying node ${nodeId} (attempt ${attempt})`);
  });

  scheduler.on(SchedulerEvent.NODE_STALE, ({ nodeId, staleDurationMs }) => {
    console.log(`  ⚠️  Stale node detected: ${nodeId} (stale for ${(staleDurationMs / 1000).toFixed(0)}s)`);
  });

  scheduler.on(SchedulerEvent.NODE_COMPLETED, ({ durationMs }) => {
    processedCount++;
    if (processedCount % 10 === 0) {
      console.log(`  ✅ Processed ${processedCount} ranges (last: ${durationMs}ms)`);
    }
  });

  scheduler.on(SchedulerEvent.NODE_FAILED, ({ nodeId, error, attempt }) => {
    failedCount++;
    console.log(`  ❌ Node failed: ${nodeId} (attempt ${attempt}): ${error}`);
  });

  scheduler.on(SchedulerEvent.STATS_UPDATED, ({ stats }) => {
    // Print progress every 20 nodes
    if (stats.doneNodes % 20 === 0 && stats.doneNodes > 0) {
      const progress = (stats.rangeProcessed / stats.rangeTotal) * 100;
      console.log(`  📊 Progress: ${progress.toFixed(1)}% | ` +
                  `Nodes: ${stats.doneNodes}/${stats.totalNodes} | ` +
                  `Errors: ${stats.errorNodes} | ` +
                  `Skipped: ${stats.skippedNodes} | ` +
                  `Throughput: ${stats.throughputPerMinute.toFixed(0)}/min`);
    }
  });

  scheduler.on(SchedulerEvent.METRICS_UPDATED, ({ metrics }) => {
    console.log(`\n📈 Performance Metrics:`);
    console.log(`  Throughput: ${metrics.throughputPerSecond.toFixed(2)} ops/sec`);
    console.log(`  Latency (avg): ${metrics.avgLatencyMs.toFixed(0)}ms`);
    console.log(`  Latency (p95): ${metrics.p95LatencyMs.toFixed(0)}ms`);
    console.log(`  Latency (p99): ${metrics.p99LatencyMs.toFixed(0)}ms`);
    console.log(`  Success rate: ${(metrics.successRate * 100).toFixed(1)}%`);
    console.log(`  Retry rate: ${(metrics.retryRate * 100).toFixed(1)}%`);
  });

  scheduler.on(SchedulerEvent.JOB_COMPLETED, ({ stats }) => {
    console.log('\n✨ Job completed successfully!');
    console.log(`\nFinal Statistics:`);
    console.log(`  Total Nodes: ${stats.totalNodes}`);
    console.log(`  Done: ${stats.doneNodes}`);
    console.log(`  Skipped: ${stats.skippedNodes}`);
    console.log(`  Errors: ${stats.errorNodes}`);
    console.log(`  Range Processed: ${stats.rangeProcessed.toLocaleString()} / ${stats.rangeTotal.toLocaleString()}`);
    console.log(`  Total Attempts: ${stats.totalAttempts}`);
    console.log(`  Avg Latency: ${stats.avgNodeLatencyMs.toFixed(0)}ms`);
    console.log(`  P95 Latency: ${stats.p95NodeLatencyMs?.toFixed(0)}ms`);
    console.log(`  Throughput: ${stats.throughputPerMinute.toFixed(0)} ranges/min`);
  });

  scheduler.on(SchedulerEvent.JOB_PARTIALLY_FAILED, ({ stats }) => {
    console.log('\n⚠️  Job partially failed');
    console.log(`  Success: ${stats.doneNodes}/${stats.totalNodes}`);
    console.log(`  Failures: ${stats.errorNodes}`);
  });

  scheduler.on(SchedulerEvent.JOB_FAILED, ({ error }) => {
    console.error(`\n❌ Job failed: ${error}`);
  });

  // Health check
  const health = await scheduler.healthCheck();
  console.log('Health Check:', health);
  
  if (!health.redis) {
    console.error('\n❌ Redis is not available. Please start Redis:');
    console.error('   docker run -d -p 6379:6379 redis\n');
    process.exit(1);
  }

  console.log('\n✅ Redis connected\n');

  // Configure the job
  const config: RangeJobConfig = {
    // Process range from 0 to 100,000
    range: { start: 0, end: 100_000 },

    // Split into chunks of max 1000
    maxRangeSize: 1000,

    // Max tree depth
    maxDepth: 20,

    // Allow up to 5% failures
    failureThreshold: 5,

    // Retry configuration
    retry: {
      maxAttempts: 3,
      backoffMs: (attempt) => Math.pow(2, attempt) * 1000, // Exponential: 2s, 4s, 8s
      backoffType: 'exponential',
    },

    // Pruning: only process ranges where start is divisible by 10000
    shouldProcess: async (range: Range) => {
      // For demonstration: skip some ranges
      if (range.start >= 50000 && range.start < 60000) {
        return false; // Skip this entire subtree
      }
      return true;
    },

    // The actual work
    work: async (range: Range, ctx) => {
      // Check for cancellation
      if (ctx.signal.aborted) {
        ctx.logger?.info('Work cancelled', { nodeId: ctx.nodeId });
        return;
      }

      // Simulate work with variable latency
      const workDuration = 50 + Math.random() * 100; // 50-150ms
      await new Promise(r => setTimeout(r, workDuration));

      // Simulate occasional transient failures (10% chance)
      if (Math.random() < 0.1 && ctx.attempt === 0) {
        throw new Error('Simulated transient failure (will retry)');
      }

      // Simulate rare permanent failures (1% chance after retries)
      if (Math.random() < 0.01 && ctx.attempt >= 2) {
        throw new Error('Simulated permanent failure');
      }

      // Log occasionally
      if (range.start % 10000 === 0) {
        ctx.logger?.info('Processing milestone', {
          range,
          attempt: ctx.attempt,
        });
      }
    },

    maxConcurrency: 10,
  };

  // Create and start the job
  const startTime = Date.now();
  const jobId = await scheduler.createJob(config);

  // Wait a bit for BullMQ to initialize
  await new Promise(r => setTimeout(r, 1000));

  await scheduler.startJob(jobId);

  // Wait for completion
  await new Promise<void>((resolve) => {
    scheduler.once(SchedulerEvent.JOB_COMPLETED, () => resolve());
    scheduler.once(SchedulerEvent.JOB_FAILED, () => resolve());
    scheduler.once(SchedulerEvent.JOB_PARTIALLY_FAILED, () => resolve());
  });

  const elapsed = Date.now() - startTime;
  console.log(`\n⏱️  Total time: ${(elapsed / 1000).toFixed(2)}s`);

  // Get final job state
  const job = await scheduler.getJob(jobId);
  console.log(`\n🏁 Final job status: ${job?.status}`);

  // Get BullMQ metrics
  const bullMetrics = await scheduler.getBullMetrics(jobId);
  if (bullMetrics) {
    console.log(`\n📦 BullMQ Queue Metrics:`);
    console.log(`  Waiting: ${bullMetrics.waiting}`);
    console.log(`  Active: ${bullMetrics.active}`);
    console.log(`  Completed: ${bullMetrics.completed}`);
    console.log(`  Failed: ${bullMetrics.failed}`);
    console.log(`  Delayed: ${bullMetrics.delayed}`);
  }

  // Graceful shutdown
  console.log('\n🔄 Shutting down gracefully...');
  await scheduler.shutdown();

  console.log('\n✅ Example completed!');
  console.log('\n💡 Key Features Demonstrated:');
  console.log('  ✓ Redis persistence (crash-safe)');
  console.log('  ✓ BullMQ reliable processing');
  console.log('  ✓ Automatic retry with backoff');
  console.log('  ✓ Stale detection (crashed workers)');
  console.log('  ✓ Performance metrics');
  console.log('  ✓ Heartbeat mechanism');
  console.log('  ✓ Partial failure handling');
  console.log('  ✓ Graceful shutdown');

  process.exit(0);
}

// Handle shutdown signals
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n⚠️  Received SIGTERM, shutting down...');
  process.exit(0);
});

// Run the example
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

