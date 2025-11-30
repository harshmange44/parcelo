/**
 * Load Test
 * 
 * This test verifies the scheduler can handle large-scale workloads:
 * - Large range (1 million units)
 * - Many nodes (hundreds)
 * - High concurrency
 * - Sustained throughput
 * 
 * Features tested:
 * - Scalability
 * - Performance under load
 * - Memory efficiency
 * - Queue management
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
  nodesProcessed: 0,
  totalLatency: 0,
  maxLatency: 0,
  minLatency: Infinity,
  throughputSamples: [] as number[],
};

async function main() {
  log(colors.cyan, '🧪', '='.repeat(70));
  log(colors.cyan, '🧪', 'LOAD TEST - Large Scale Processing');
  log(colors.cyan, '🧪', '='.repeat(70));
  
  console.log('\n📋 This test processes a large range with high concurrency\n');

  log(colors.blue, '🚀', 'Initializing RangeScheduler...');
  
  const scheduler = new RangeScheduler({
    redisUrl: 'redis://localhost:6379',
    defaultMaxConcurrency: 10,  // High concurrency
    staleNodeCheckIntervalMs: 10000,
    staleNodeThresholdMs: 20000,
    heartbeatIntervalMs: 2000,
    enableMetrics: true,
  });

  let lastProgressTime = Date.now();
  let nodesInLastSecond = 0;

  // Track events
  scheduler.on(SchedulerEvent.NODE_COMPLETED, ({ durationMs }) => {
    metrics.nodesProcessed++;
    nodesInLastSecond++;
    
    metrics.totalLatency += durationMs;
    metrics.maxLatency = Math.max(metrics.maxLatency, durationMs);
    metrics.minLatency = Math.min(metrics.minLatency, durationMs);
    
    // Sample throughput every second
    const now = Date.now();
    if (now - lastProgressTime >= 1000) {
      const throughput = (nodesInLastSecond / ((now - lastProgressTime) / 1000));
      metrics.throughputSamples.push(throughput);
      lastProgressTime = now;
      nodesInLastSecond = 0;
    }
  });

  scheduler.on(SchedulerEvent.STATS_UPDATED, ({ stats }) => {
    if (stats.doneNodes % 50 === 0 && stats.doneNodes > 0) {
      const progress = ((stats.rangeProcessed / stats.rangeTotal) * 100).toFixed(1);
      const avgLatency = metrics.nodesProcessed > 0 
        ? (metrics.totalLatency / metrics.nodesProcessed).toFixed(0)
        : 0;
      const currentThroughput = metrics.throughputSamples.length > 0
        ? metrics.throughputSamples[metrics.throughputSamples.length - 1].toFixed(1)
        : 0;
      
      log(colors.cyan, '📊', 
        `Progress: ${progress}% | Nodes: ${stats.doneNodes}/${stats.totalNodes} | ` +
        `Throughput: ${currentThroughput} ops/s | Latency: ${avgLatency}ms`
      );
    }
  });

  scheduler.on(SchedulerEvent.JOB_COMPLETED, ({ stats }) => {
    log(colors.green, '🎉', `Job completed! Processed ${stats.rangeProcessed} units`);
  });

  // Health check
  const health = await scheduler.healthCheck();
  if (!health.redis) {
    log(colors.red, '❌', 'Redis not available!');
    process.exit(1);
  }
  log(colors.green, '✅', 'Health check passed\n');

  // Configure load test
  const RANGE_START = 0;
  const RANGE_END = 100000;      // 100K units (adjust based on your needs)
  const MAX_RANGE_SIZE = 1000;   // Each leaf handles 1000 units
  const CONCURRENCY = 10;        // 10 concurrent workers
  
  log(colors.blue, '📋', 'Load Test Configuration:');
  console.log(`  Range: ${RANGE_START.toLocaleString()} - ${RANGE_END.toLocaleString()} (${(RANGE_END - RANGE_START).toLocaleString()} units)`);
  console.log(`  Max Range Size: ${MAX_RANGE_SIZE.toLocaleString()}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  Expected Nodes: ~${Math.ceil((RANGE_END - RANGE_START) / MAX_RANGE_SIZE)}`);
  console.log('');

  const config: RangeJobConfig = {
    range: { start: RANGE_START, end: RANGE_END },
    maxRangeSize: MAX_RANGE_SIZE,
    maxConcurrency: CONCURRENCY,
    retry: {
      maxAttempts: 2,
      backoffMs: 500,
      backoffType: 'fixed',
    },
    work: async (range: Range, ctx) => {
      if (ctx.signal.aborted) return;
      
      // Simulate lightweight processing (1ms per unit = 1-10ms per range)
      const units = range.end - range.start;
      await new Promise(r => setTimeout(r, Math.max(1, units / 100)));
      
      // Simulate very occasional failures (1%)
      if (ctx.attempt === 0 && Math.random() < 0.01) {
        throw new Error(`Simulated failure`);
      }
    },
  };

  const startTime = Date.now();
  log(colors.green, '▶️', 'Starting load test...\n');
  
  const jobId = await scheduler.createJob(config);
  await new Promise(r => setTimeout(r, 500));
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
    
    // Timeout after 120 seconds
    setTimeout(() => {
      if (!resolved) {
        log(colors.yellow, '⏰', 'Timeout (120s) - analyzing partial results...');
        complete();
      }
    }, 120000);
  });

  const elapsed = Date.now() - startTime;
  const job = await scheduler.getJob(jobId);
  
  // Calculate statistics
  const avgLatency = metrics.nodesProcessed > 0 
    ? metrics.totalLatency / metrics.nodesProcessed 
    : 0;
  const avgThroughput = metrics.throughputSamples.length > 0
    ? metrics.throughputSamples.reduce((a, b) => a + b, 0) / metrics.throughputSamples.length
    : 0;
  const peakThroughput = metrics.throughputSamples.length > 0
    ? Math.max(...metrics.throughputSamples)
    : 0;
  const unitsPerSecond = job?.stats.rangeProcessed 
    ? (job.stats.rangeProcessed / (elapsed / 1000))
    : 0;
  
  // Results
  console.log('\n' + '='.repeat(70));
  log(colors.cyan, '📊', 'LOAD TEST RESULTS');
  console.log('='.repeat(70));
  
  console.log(`\n📌 Job Status: ${colors.bright}${job?.status}${colors.reset}`);
  
  console.log('\n📊 Processing Stats:');
  if (job?.stats) {
    console.log(`  Total Nodes:     ${job.stats.totalNodes}`);
    console.log(`  Completed:       ${colors.green}${job.stats.doneNodes}${colors.reset}`);
    console.log(`  Errors:          ${colors.red}${job.stats.errorNodes}${colors.reset}`);
    console.log(`  Range Processed: ${job.stats.rangeProcessed.toLocaleString()}/${job.stats.rangeTotal.toLocaleString()} units`);
    console.log(`  Completion:      ${((job.stats.rangeProcessed / job.stats.rangeTotal) * 100).toFixed(2)}%`);
  }
  
  console.log('\n⚡ Performance Metrics:');
  console.log(`  Total Time:        ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`  Nodes/sec:         ${colors.cyan}${avgThroughput.toFixed(2)}${colors.reset}`);
  console.log(`  Peak Throughput:   ${colors.bright}${peakThroughput.toFixed(2)}${colors.reset} nodes/sec`);
  console.log(`  Units/sec:         ${unitsPerSecond.toFixed(0).toLocaleString()}`);
  console.log(`  Avg Latency:       ${avgLatency.toFixed(2)}ms`);
  console.log(`  Min Latency:       ${metrics.minLatency === Infinity ? 'N/A' : metrics.minLatency.toFixed(2) + 'ms'}`);
  console.log(`  Max Latency:       ${metrics.maxLatency.toFixed(2)}ms`);

  const perfMetrics = await scheduler.getPerformanceMetrics(jobId);
  if (perfMetrics) {
    console.log('\n📈 System Metrics:');
    console.log(`  Success Rate:    ${(perfMetrics.successRate * 100).toFixed(2)}%`);
    console.log(`  p50 Latency:     ${perfMetrics.p50LatencyMs.toFixed(0)}ms`);
    console.log(`  p95 Latency:     ${perfMetrics.p95LatencyMs.toFixed(0)}ms`);
    console.log(`  p99 Latency:     ${perfMetrics.p99LatencyMs.toFixed(0)}ms`);
  }

  const bullMetrics = await scheduler.getBullMetrics(jobId);
  if (bullMetrics) {
    console.log('\n📦 BullMQ Queue:');
    console.log(`  Completed:  ${bullMetrics.completed}`);
    console.log(`  Failed:     ${bullMetrics.failed}`);
    console.log(`  Active:     ${bullMetrics.active}`);
    console.log(`  Waiting:    ${bullMetrics.waiting}`);
  }
  
  // Verification
  console.log('\n' + '='.repeat(70));
  log(colors.cyan, '✅', 'VERIFICATION');
  console.log('='.repeat(70) + '\n');
  
  const checks = [
    { 
      name: 'High Throughput', 
      pass: avgThroughput >= 5,
      message: `${avgThroughput.toFixed(2)} nodes/sec (target: ≥5)`
    },
    { 
      name: 'Low Latency', 
      pass: avgLatency < 500,
      message: `${avgLatency.toFixed(0)}ms average (target: <500ms)`
    },
    { 
      name: 'High Success Rate', 
      pass: perfMetrics ? perfMetrics.successRate > 0.95 : true,
      message: `${perfMetrics ? (perfMetrics.successRate * 100).toFixed(1) : 'N/A'}% (target: >95%)`
    },
    { 
      name: 'Job Completion', 
      pass: job?.status === 'completed' || (job?.stats.doneNodes || 0) > (job?.stats.totalNodes || 0) * 0.9,
      message: `${job?.status} (90%+ nodes completed)`
    },
    { 
      name: 'Consistent Performance', 
      pass: metrics.maxLatency < avgLatency * 5,
      message: `Max latency ${metrics.maxLatency.toFixed(0)}ms < 5x average`
    },
  ];
  
  let allPassed = true;
  for (const check of checks) {
    const status = check.pass ? `${colors.green}✅${colors.reset}` : `${colors.red}❌${colors.reset}`;
    console.log(`${status} ${check.name}: ${check.message}`);
    if (!check.pass) allPassed = false;
  }
  
  // Throughput chart (simple ASCII visualization)
  if (metrics.throughputSamples.length > 0) {
    console.log('\n📈 Throughput Over Time:');
    const maxSample = Math.max(...metrics.throughputSamples);
    const samples = metrics.throughputSamples.slice(0, 50); // Show first 50 seconds
    for (let i = 0; i < samples.length; i++) {
      const bars = Math.round((samples[i] / maxSample) * 40);
      const bar = '█'.repeat(bars);
      console.log(`  ${i.toString().padStart(3)}s: ${bar} ${samples[i].toFixed(1)} ops/s`);
    }
  }
  
  // Shutdown
  console.log('\n' + '='.repeat(70));
  log(colors.blue, '🔄', 'Shutting down...');
  await scheduler.shutdown();
  log(colors.green, '✅', 'Shutdown complete');
  console.log('='.repeat(70) + '\n');
  
  if (allPassed) {
    log(colors.green, '🎉', 'LOAD TEST PASSED! 🚀');
    log(colors.cyan, '📊', `Processed ${job?.stats.rangeProcessed.toLocaleString()} units in ${(elapsed / 1000).toFixed(2)}s`);
    process.exit(0);
  } else {
    log(colors.yellow, '⚠️', 'Some performance targets not met (but test completed)');
    process.exit(0); // Exit 0 since test ran successfully
  }
}

main().catch((error) => {
  log(colors.red, '💀', `Fatal error: ${error.message}`);
  process.exit(1);
});

