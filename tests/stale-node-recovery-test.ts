/**
 * Stale Node Recovery Test
 * 
 * This test verifies that the scheduler can detect and recover from stale nodes
 * (nodes that are "running" but their worker has crashed or become unresponsive).
 * 
 * Features tested:
 * - Heartbeat mechanism
 * - Stale node detection
 * - Automatic recovery and retry
 * - Job completion after recovery
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
  staleDetected: 0,
  recovered: 0,
  completed: 0,
  crashed: 0,
};

async function main() {
  log(colors.cyan, '🧪', '='.repeat(70));
  log(colors.cyan, '🧪', 'STALE NODE RECOVERY TEST');
  log(colors.cyan, '🧪', '='.repeat(70));
  
  console.log('\n📋 This test simulates worker crashes and verifies recovery\n');

  log(colors.blue, '🚀', 'Initializing RangeScheduler...');
  
  const scheduler = new RangeScheduler({
    redisUrl: 'redis://localhost:6379',
    defaultMaxConcurrency: 2,
    staleNodeCheckIntervalMs: 2000,      // Check every 2 seconds
    staleNodeThresholdMs: 3000,          // Node is stale after 3 seconds without heartbeat
    heartbeatIntervalMs: 500,            // Heartbeat every 500ms
    enableMetrics: true,
  });

  // Track events
  scheduler.on(SchedulerEvent.NODE_STALE, ({ nodeId, staleDurationMs }) => {
    metrics.staleDetected++;
    log(colors.yellow, '⚠️', `Stale node detected: ${nodeId} (stale for ${(staleDurationMs / 1000).toFixed(1)}s)`);
  });

  scheduler.on(SchedulerEvent.NODE_STARTED, ({ nodeId, attempt }) => {
    if (attempt > 0) {
      metrics.recovered++;
      log(colors.magenta, '🔄', `Recovered node restarted: ${nodeId} (attempt ${attempt + 1})`);
    }
  });

  scheduler.on(SchedulerEvent.NODE_COMPLETED, () => {
    metrics.completed++;
  });

  scheduler.on(SchedulerEvent.JOB_COMPLETED, ({ stats }) => {
    log(colors.green, '🎉', `Job completed! ${stats.doneNodes} nodes completed`);
  });

  // Health check
  const health = await scheduler.healthCheck();
  if (!health.redis) {
    log(colors.red, '❌', 'Redis not available!');
    process.exit(1);
  }
  log(colors.green, '✅', 'Health check passed\n');

  // Create job that simulates crashes
  const config: RangeJobConfig = {
    range: { start: 0, end: 500 },
    maxRangeSize: 100,
    maxConcurrency: 2,
    retry: {
      maxAttempts: 3,
      backoffMs: (attempt) => Math.pow(2, attempt) * 500,
      backoffType: 'exponential',
    },
    work: async (range: Range, ctx) => {
      const rangeId = `[${range.start}-${range.end}]`;
      
      // Simulate crash: First 2 nodes will "crash" (hang indefinitely)
      // This simulates a worker that starts processing but never completes
      if (ctx.attempt === 0 && (range.start === 0 || range.start === 100)) {
        metrics.crashed++;
        log(colors.red, '💥', `Simulating crash: ${rangeId} (will hang and become stale)`);
        
        // Hang indefinitely - simulating a crashed/frozen worker
        await new Promise(() => {}); // Never resolves
        return;
      }
      
      // Check for cancellation
      if (ctx.signal.aborted) {
        log(colors.yellow, '🛑', `Cancelled: ${rangeId}`);
        return;
      }
      
      // Normal processing
      await new Promise(r => setTimeout(r, 100));
      log(colors.green, '✅', `Completed: ${rangeId} (attempt ${ctx.attempt + 1})`);
    },
  };

  // Create and start job
  const startTime = Date.now();
  const jobId = await scheduler.createJob(config);
  await new Promise(r => setTimeout(r, 500));
  
  log(colors.green, '▶️', `Starting job ${jobId}...\n`);
  await scheduler.startJob(jobId);

  // Wait for completion or timeout
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
    
    // Timeout after 30 seconds
    setTimeout(() => {
      if (!resolved) {
        log(colors.yellow, '⏰', 'Test timeout (30s) - checking results...');
        complete();
      }
    }, 30000);
  });

  const elapsed = Date.now() - startTime;
  
  // Results
  console.log('\n' + '='.repeat(70));
  log(colors.cyan, '📊', 'TEST RESULTS');
  console.log('='.repeat(70));
  
  const job = await scheduler.getJob(jobId);
  console.log(`\n📌 Job Status: ${colors.bright}${job?.status}${colors.reset}`);
  
  console.log('\n📈 Recovery Metrics:');
  console.log(`  Crashed Nodes:      ${colors.red}${metrics.crashed}${colors.reset} (simulated)`);
  console.log(`  Stale Detected:     ${colors.yellow}${metrics.staleDetected}${colors.reset}`);
  console.log(`  Recovered:          ${colors.magenta}${metrics.recovered}${colors.reset}`);
  console.log(`  Completed:          ${colors.green}${metrics.completed}${colors.reset}`);
  
  if (job?.stats) {
    console.log('\n📊 Job Stats:');
    console.log(`  Total Nodes:    ${job.stats.totalNodes}`);
    console.log(`  Done:           ${job.stats.doneNodes}`);
    console.log(`  Errors:         ${job.stats.errorNodes}`);
    console.log(`  Range Processed: ${job.stats.rangeProcessed}/${job.stats.rangeTotal}`);
  }

  const perfMetrics = await scheduler.getPerformanceMetrics(jobId);
  if (perfMetrics) {
    console.log('\n⚡ Performance:');
    console.log(`  Success Rate: ${(perfMetrics.successRate * 100).toFixed(1)}%`);
  }
  
  console.log(`\n⏱️  Time: ${(elapsed / 1000).toFixed(2)}s`);
  
  // Verification
  console.log('\n' + '='.repeat(70));
  log(colors.cyan, '✅', 'VERIFICATION');
  console.log('='.repeat(70) + '\n');
  
  const checks = [
    { 
      name: 'Stale Detection', 
      pass: metrics.staleDetected > 0,
      message: `${metrics.staleDetected} stale nodes detected`
    },
    { 
      name: 'Node Recovery', 
      pass: metrics.recovered > 0,
      message: `${metrics.recovered} nodes recovered and retried`
    },
    { 
      name: 'Job Completion', 
      pass: job?.status === 'completed' || (job?.stats.doneNodes === (job?.stats.totalNodes || 0) - (job?.stats.errorNodes || 0)),
      message: `Job completed with ${job?.stats.doneNodes} nodes done`
    },
    { 
      name: 'Crash Handling', 
      pass: metrics.crashed === metrics.staleDetected,
      message: `All ${metrics.crashed} crashed nodes were detected as stale`
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
    log(colors.green, '🎉', 'STALE NODE RECOVERY TEST PASSED! 🚀');
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

