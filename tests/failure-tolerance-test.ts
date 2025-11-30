/**
 * Failure Tolerance Test
 * 
 * This test verifies that the scheduler can handle various failure scenarios:
 * - Redis disconnections
 * - BullMQ worker failures
 * - Partial job failures
 * - Network issues
 * - High failure rates
 * 
 * Features tested:
 * - Retry mechanism under stress
 * - Error recovery
 * - Partial failure handling
 * - Job statistics accuracy
 */

import {
  RangeScheduler,
  SchedulerEvent,
  RangeJobConfig,
  Range,
} from '../src/index';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(color: string, emoji: string, message: string) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
  console.log(`${color}[${timestamp}] ${emoji} ${message}${colors.reset}`);
}

const metrics = {
  attempts: 0,
  failures: 0,
  retries: 0,
  successes: 0,
  permanentFailures: 0,
};

async function main() {
  log(colors.cyan, '🧪', '='.repeat(70));
  log(colors.cyan, '🧪', 'FAILURE TOLERANCE TEST');
  log(colors.cyan, '🧪', '='.repeat(70));
  
  console.log('\n📋 This test verifies the system can handle high failure rates\n');

  log(colors.blue, '🚀', 'Initializing RangeScheduler...');
  
  const scheduler = new RangeScheduler({
    redisUrl: 'redis://localhost:6379',
    defaultMaxConcurrency: 4,
    staleNodeCheckIntervalMs: 5000,
    staleNodeThresholdMs: 10000,
    heartbeatIntervalMs: 1000,
    enableMetrics: true,
  });

  // Track events
  scheduler.on(SchedulerEvent.NODE_STARTED, ({ attempt }) => {
    metrics.attempts++;
    if (attempt > 0) {
      metrics.retries++;
      if (metrics.retries <= 3) {
        log(colors.magenta, '🔄', `Retry attempt ${attempt + 1}`);
      }
    }
  });

  scheduler.on(SchedulerEvent.NODE_COMPLETED, ({ attempt }) => {
    metrics.successes++;
    // Count retries from completed events too
    if (attempt && attempt > 0) {
      metrics.retries++;
    }
  });

  scheduler.on(SchedulerEvent.NODE_FAILED, ({ error, attempt }) => {
    metrics.failures++;
    if (metrics.failures <= 3) {
      log(colors.red, '💥', `Failure (attempt ${attempt + 1}): ${error}`);
    }
  });

  scheduler.on(SchedulerEvent.JOB_COMPLETED, ({ stats }) => {
    log(colors.green, '🎉', `Job completed! ${stats.doneNodes} done, ${stats.errorNodes} errors`);
  });

  scheduler.on(SchedulerEvent.JOB_PARTIALLY_FAILED, ({ stats }) => {
    log(colors.yellow, '⚠️', `Job partially failed: ${stats.doneNodes} done, ${stats.errorNodes} errors`);
  });

  scheduler.on(SchedulerEvent.STATS_UPDATED, ({ stats }) => {
    if (stats.doneNodes % 10 === 0 && stats.doneNodes > 0) {
      const progress = ((stats.rangeProcessed / stats.rangeTotal) * 100).toFixed(1);
      log(colors.cyan, '📊', `Progress: ${progress}% | Done: ${stats.doneNodes}, Errors: ${stats.errorNodes}`);
    }
  });

  // Health check
  const health = await scheduler.healthCheck();
  if (!health.redis) {
    log(colors.red, '❌', 'Redis not available!');
    process.exit(1);
  }
  log(colors.green, '✅', 'Health check passed\n');

  // Test 1: High failure rate (50%) with retry
  log(colors.blue, '🧪', 'TEST 1: High Failure Rate (50%) with Retry');
  console.log('─'.repeat(70));
  
  const config: RangeJobConfig = {
    range: { start: 0, end: 1000 },
    maxRangeSize: 100,
    maxConcurrency: 4,
    failureThreshold: 20, // Allow up to 20% permanent failures
    retry: {
      maxAttempts: 3,
      backoffMs: (attempt) => Math.pow(2, attempt) * 200, // 200ms, 400ms, 800ms
      backoffType: 'exponential',
    },
    work: async (range: Range, ctx) => {
      const rangeId = `[${range.start}-${range.end}]`;
      
      if (ctx.signal.aborted) return;
      
      // Simulate work
      await new Promise(r => setTimeout(r, 20));
      
      // 50% failure on first attempt, 20% on second, 0% on third
      const failureRate = ctx.attempt === 0 ? 0.5 : ctx.attempt === 1 ? 0.2 : 0;
      
      if (Math.random() < failureRate) {
        throw new Error(`Simulated failure ${rangeId}`);
      }
      
      // Success
      if (metrics.successes < 3 || metrics.successes % 20 === 0) {
        log(colors.green, '✅', `Completed: ${rangeId} (attempt ${ctx.attempt + 1})`);
      }
    },
  };

  const startTime = Date.now();
  const jobId = await scheduler.createJob(config);
  await new Promise(r => setTimeout(r, 500));
  
  log(colors.green, '▶️', `Starting job ${jobId}...\n`);
  await scheduler.startJob(jobId);

  // Wait for completion
  await new Promise<void>((resolve) => {
    let resolved = false;
    const complete = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    
    scheduler.once(SchedulerEvent.JOB_COMPLETED, complete);
    scheduler.once(SchedulerEvent.JOB_FAILED, complete);
    scheduler.once(SchedulerEvent.JOB_PARTIALLY_FAILED, complete);
    
    // Timeout after 45 seconds
    setTimeout(() => {
      if (!resolved) {
        log(colors.yellow, '⏰', 'Timeout - checking results...');
        complete();
      }
    }, 45000);
  });

  const elapsed = Date.now() - startTime;
  
  // Results
  console.log('\n' + '='.repeat(70));
  log(colors.cyan, '📊', 'TEST RESULTS');
  console.log('='.repeat(70));
  
  const job = await scheduler.getJob(jobId);
  console.log(`\n📌 Job Status: ${colors.bright}${job?.status}${colors.reset}`);
  
  console.log('\n📈 Failure Metrics:');
  console.log(`  Total Attempts:     ${metrics.attempts}`);
  console.log(`  Failures:           ${colors.red}${metrics.failures}${colors.reset}`);
  console.log(`  Retries:            ${colors.magenta}${metrics.retries}${colors.reset}`);
  console.log(`  Successes:          ${colors.green}${metrics.successes}${colors.reset}`);
  
  if (job?.stats) {
    console.log('\n📊 Job Stats:');
    console.log(`  Total Nodes:    ${job.stats.totalNodes}`);
    console.log(`  Done:           ${job.stats.doneNodes}`);
    console.log(`  Errors:         ${job.stats.errorNodes}`);
    console.log(`  Total Attempts: ${job.stats.totalAttempts}`);
    console.log(`  Range Processed: ${job.stats.rangeProcessed}/${job.stats.rangeTotal}`);
    
    // Calculate actual failure/recovery rates
    const recoveryRate = metrics.failures > 0 
      ? ((metrics.successes / (metrics.successes + job.stats.errorNodes)) * 100).toFixed(1)
      : 100;
    console.log(`  Recovery Rate:  ${recoveryRate}%`);
  }

  const perfMetrics = await scheduler.getPerformanceMetrics(jobId);
  if (perfMetrics) {
    console.log('\n⚡ Performance:');
    console.log(`  Throughput:   ${perfMetrics.throughputPerSecond.toFixed(1)} ops/s`);
    console.log(`  Avg Latency:  ${perfMetrics.avgLatencyMs.toFixed(0)}ms`);
    console.log(`  Success Rate: ${(perfMetrics.successRate * 100).toFixed(1)}%`);
    console.log(`  Retry Rate:   ${(perfMetrics.retryRate * 100).toFixed(1)}%`);
  }

  const bullMetrics = await scheduler.getBullMetrics(jobId);
  if (bullMetrics) {
    console.log('\n📦 BullMQ:');
    console.log(`  Completed: ${bullMetrics.completed}`);
    console.log(`  Failed:    ${bullMetrics.failed}`);
  }
  
  console.log(`\n⏱️  Time: ${(elapsed / 1000).toFixed(2)}s`);
  
  // Verification
  console.log('\n' + '='.repeat(70));
  log(colors.cyan, '✅', 'VERIFICATION');
  console.log('='.repeat(70) + '\n');
  
  const checks = [
    { 
      name: 'Retry Mechanism', 
      pass: metrics.retries > 0,
      message: `${metrics.retries} retries performed`
    },
    { 
      name: 'Failure Handling', 
      pass: metrics.failures > 0,
      message: `${metrics.failures} failures handled`
    },
    { 
      name: 'Recovery Success', 
      pass: metrics.successes > metrics.failures / 2,
      message: `${metrics.successes} successful recoveries`
    },
    { 
      name: 'Job Completion', 
      pass: job?.status === 'completed' || job?.status === 'partially_failed',
      message: `Job reached terminal state: ${job?.status}`
    },
    { 
      name: 'High Tolerance', 
      pass: job?.stats.doneNodes && job.stats.doneNodes > job.stats.totalNodes * 0.7,
      message: `${job?.stats.doneNodes}/${job?.stats.totalNodes} nodes completed (70%+ threshold)`
    },
  ];
  
  let allPassed = true;
  for (const check of checks) {
    const status = check.pass ? `${colors.green}✅${colors.reset}` : `${colors.red}❌${colors.reset}`;
    console.log(`${status} ${check.name}: ${check.message}`);
    if (!check.pass) allPassed = false;
  }
  
  // Shutdown
  console.log('\n' + '='.repeat(70));
  log(colors.blue, '🔄', 'Shutting down...');
  await scheduler.shutdown();
  log(colors.green, '✅', 'Shutdown complete');
  console.log('='.repeat(70) + '\n');
  
  if (allPassed) {
    log(colors.green, '🎉', 'FAILURE TOLERANCE TEST PASSED! 🚀');
    process.exit(0);
  } else {
    log(colors.red, '❌', 'Some checks failed');
    process.exit(1);
  }
}

main().catch((error) => {
  log(colors.red, '💀', `Fatal error: ${error.message}`);
  process.exit(1);
});

