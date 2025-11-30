/**
 * Production Benchmark for RangeScheduler
 * 
 * Tests RangeScheduler (Redis + BullMQ) with realistic workloads:
 * - Database queries (10-100ms)
 * - API calls (50-500ms)
 * - File processing (100-1000ms)
 * - Mixed workloads
 * 
 * Requirements:
 * - Redis running (docker run -d -p 6379:6379 redis)
 * - Node.js 16+
 * 
 * Usage:
 *   npm run benchmark:production
 */

import { RangeScheduler, SchedulerEvent, JobStatus } from '../src/index';
import * as os from 'os';

interface WorkloadConfig {
  name: string;
  workDurationMs: number;
  description: string;
  realisticScenario: string;
}

interface BenchmarkResult {
  config: WorkloadConfig;
  workloadSize: number;
  concurrency: number;
  totalTimeMs: number;
  itemsPerSecond: number;
  itemsProcessed: number;
  sequentialBaseline: number; // Single-threaded sequential throughput
  speedup: number; // Speedup vs sequential (e.g., 4.2x means 4.2x faster)
  parallelEfficiency: number; // Actual throughput / (sequential * concurrency) - shows how well we parallelize
  nodesProcessed: number;
  errors: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

// Realistic workload configurations
const WORKLOADS: WorkloadConfig[] = [
  {
    name: 'Fast DB Query',
    workDurationMs: 10,
    description: 'Cache hit or simple indexed query',
    realisticScenario: 'Redis cache lookup, indexed DB query',
  },
  {
    name: 'Normal DB Query',
    workDurationMs: 50,
    description: 'Typical database operation',
    realisticScenario: 'PostgreSQL/MySQL query with index',
  },
  {
    name: 'Complex DB Query',
    workDurationMs: 100,
    description: 'Join or aggregation query',
    realisticScenario: 'Multi-table join, GROUP BY, aggregation',
  },
  {
    name: 'Fast API Call',
    workDurationMs: 50,
    description: 'Internal microservice call',
    realisticScenario: 'Internal API, same datacenter',
  },
  {
    name: 'External API Call',
    workDurationMs: 200,
    description: 'Third-party API call',
    realisticScenario: 'Stripe, Twilio, external service',
  },
  {
    name: 'Slow API Call',
    workDurationMs: 500,
    description: 'Heavy external API',
    realisticScenario: 'AI/ML API, image processing service',
  },
  {
    name: 'File Processing',
    workDurationMs: 100,
    description: 'Read/process small file',
    realisticScenario: 'CSV parsing, JSON processing',
  },
  {
    name: 'Heavy File Processing',
    workDurationMs: 500,
    description: 'Large file or complex processing',
    realisticScenario: 'Image resize, video encoding, large CSV',
  },
];

async function simulateWork(workDurationMs: number, workType: string): Promise<void> {
  // Simulate actual work with realistic patterns
  
  if (workType.includes('DB')) {
    // Database: network latency + query time
    const networkLatency = workDurationMs * 0.1; // 10% network
    const queryTime = workDurationMs * 0.9; // 90% query
    
    await new Promise(r => setTimeout(r, networkLatency));
    // Simulate query processing (CPU-bound)
    const start = Date.now();
    while (Date.now() - start < queryTime) {
      // Busy wait to simulate CPU work
      Math.sqrt(Math.random());
    }
  } else if (workType.includes('API')) {
    // API: mostly network latency
    await new Promise(r => setTimeout(r, workDurationMs * 0.95));
    // Small processing overhead
    await new Promise(r => setTimeout(r, workDurationMs * 0.05));
  } else {
    // File processing: I/O + CPU
    const ioTime = workDurationMs * 0.4;
    const cpuTime = workDurationMs * 0.6;
    
    await new Promise(r => setTimeout(r, ioTime));
    const start = Date.now();
    while (Date.now() - start < cpuTime) {
      Math.sqrt(Math.random());
    }
  }
}

async function runBenchmark(
  config: WorkloadConfig,
  workloadSize: number,
  maxRangeSize: number,
  concurrency: number
): Promise<BenchmarkResult> {
  const scheduler = new RangeScheduler({
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    defaultMaxConcurrency: concurrency,
    staleNodeCheckIntervalMs: 30_000,
    heartbeatIntervalMs: 15_000,
    enableMetrics: true,
  });

  const latencies: number[] = [];
  let nodesProcessed = 0;
  let errors = 0;
  const nodeStartTimes = new Map<string, number>();

  scheduler.on(SchedulerEvent.NODE_STARTED, ({ nodeId }) => {
    nodeStartTimes.set(nodeId, Date.now());
  });

  scheduler.on(SchedulerEvent.NODE_COMPLETED, ({ nodeId, durationMs }) => {
    nodesProcessed++;
    latencies.push(durationMs);
    nodeStartTimes.delete(nodeId);
  });

  scheduler.on(SchedulerEvent.NODE_FAILED, ({ nodeId }) => {
    errors++;
    nodeStartTimes.delete(nodeId);
  });

  const startTime = Date.now();

  const jobId = await scheduler.createJob({
    range: { start: 0, end: workloadSize },
    maxRangeSize,
    maxConcurrency: concurrency,
    retry: {
      maxAttempts: 2,
      backoffMs: 100,
    },
    work: async () => {
      await simulateWork(config.workDurationMs, config.name);
    },
  });

  const completionPromise = new Promise<void>((resolve) => {
    scheduler.on(SchedulerEvent.JOB_COMPLETED, () => resolve());
    scheduler.on(SchedulerEvent.JOB_FAILED, () => resolve());
  });

  await scheduler.startJob(jobId);
  await completionPromise;

  // Wait a bit for final events and ensure all processing is done
  await new Promise(r => setTimeout(r, 1000));

  const totalTimeMs = Date.now() - startTime;
  const itemsPerSecond = (workloadSize / totalTimeMs) * 1000;
  const itemsProcessed = workloadSize;
  
  // Calculate sequential baseline (single-threaded, no overhead)
  // Sequential would take: workloadSize * workDurationMs
  const sequentialTimeMs = workloadSize * config.workDurationMs;
  const sequentialBaseline = (workloadSize / sequentialTimeMs) * 1000;
  
  // Speedup: how much faster than sequential
  const speedup = sequentialBaseline > 0 ? itemsPerSecond / sequentialBaseline : 0;
  
  // Parallel efficiency: actual / (sequential * concurrency)
  // 100% means perfect parallelization, <100% means overhead/contention
  const parallelEfficiency = sequentialBaseline > 0 
    ? (itemsPerSecond / (sequentialBaseline * concurrency)) * 100 
    : 0;

  // Calculate percentiles
  latencies.sort((a, b) => a - b);
  const avgLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

  // Shutdown gracefully
  // Cancel the job first to stop the processing loop immediately
  try {
    const job = await scheduler.getJob(jobId);
    if (job && (job.status === JobStatus.RUNNING || job.status === JobStatus.PAUSED)) {
      await scheduler.cancelJob(jobId);
      // Give loop time to stop
      await new Promise(r => setTimeout(r, 300));
    }
  } catch (error) {
    // Ignore errors if job already completed or connection issues
    if (!(error instanceof Error && error.message.includes('Connection is closed'))) {
      // Only log non-connection errors
    }
  }

  // Now shutdown
  try {
    await scheduler.shutdown();
  } catch (error) {
    // Ignore connection closed errors during shutdown (race condition)
    if (!(error instanceof Error && error.message.includes('Connection is closed'))) {
      throw error;
    }
  }

  return {
    config,
    workloadSize,
    concurrency,
    totalTimeMs,
    itemsPerSecond,
    itemsProcessed,
    sequentialBaseline,
    speedup,
    parallelEfficiency,
    nodesProcessed,
    errors,
    avgLatencyMs: avgLatency,
    p95LatencyMs: p95,
    p99LatencyMs: p99,
  };
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🏭 PRODUCTION BENCHMARK - RangeScheduler (Redis + BullMQ)');
  console.log('='.repeat(80) + '\n');

  // System info
  const sysInfo = {
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || 'Unknown',
    totalMemory: (os.totalmem() / (1024 ** 3)).toFixed(1) + ' GB',
    nodeVersion: process.version,
  };

  console.log('💻 System Information:');
  console.log(`   Platform:     ${sysInfo.platform} ${sysInfo.arch}`);
  console.log(`   CPU:          ${sysInfo.cpuModel}`);
  console.log(`   Cores:        ${sysInfo.cpus}`);
  console.log(`   Memory:       ${sysInfo.totalMemory}`);
  console.log(`   Node.js:      ${sysInfo.nodeVersion}`);
  console.log(`   Redis:        ${process.env.REDIS_URL || 'redis://localhost:6379'}\n`);

  // Test configuration
  const TEST_SIZE = 1000; // Smaller for realistic workloads
  const MAX_RANGE_SIZE = 50;
  const CONCURRENCY = 10;

  console.log('📋 Test Configuration:');
  console.log(`   Workload Size: ${TEST_SIZE.toLocaleString()} items`);
  console.log(`   Max Range Size: ${MAX_RANGE_SIZE}`);
  console.log(`   Concurrency: ${CONCURRENCY} workers\n`);

  console.log('Running benchmarks...\n');

  const results: BenchmarkResult[] = [];

  for (const workload of WORKLOADS) {
    process.stdout.write(`Testing ${workload.name.padEnd(25)} (${workload.workDurationMs}ms)... `);
    
    try {
      const result = await runBenchmark(
        workload,
        TEST_SIZE,
        MAX_RANGE_SIZE,
        CONCURRENCY
      );
      
      results.push(result);
      console.log(`✓ ${result.itemsPerSecond.toFixed(1)} items/sec (${result.speedup.toFixed(2)}x speedup, ${result.parallelEfficiency.toFixed(1)}% efficiency)`);
      
      // Small delay between tests
      await new Promise(r => setTimeout(r, 1000));
    } catch (error) {
      console.log(`✗ Error: ${error instanceof Error ? error.message : String(error)}`);
      console.log('   Make sure Redis is running: docker run -d -p 6379:6379 redis');
    }
  }

  // Results table
  console.log('\n' + '='.repeat(80));
  console.log('📊 BENCHMARK RESULTS');
  console.log('='.repeat(80) + '\n');

  console.log('┌──────────────────────────┬──────────┬──────────────┬──────────────┬────────────┬────────────┬────────────┐');
  console.log('│ Workload                  │ Time (s) │ Items/sec    │ Items        │ Speedup    │ Efficiency │ p99 (ms)   │');
  console.log('├──────────────────────────┼──────────┼──────────────┼──────────────┼────────────┼────────────┼────────────┤');

  for (const result of results) {
    const name = result.config.name.padEnd(24);
    const time = (result.totalTimeMs / 1000).toFixed(1).padStart(8);
    const throughput = result.itemsPerSecond.toFixed(1).padStart(12);
    const items = result.itemsProcessed.toLocaleString().padStart(12);
    const speedup = `${result.speedup.toFixed(2)}x`.padStart(10);
    const efficiency = `${result.parallelEfficiency.toFixed(1)}%`.padStart(10);
    const p99 = result.p99LatencyMs.toFixed(0).padStart(10);

    console.log(`│ ${name} │ ${time} │ ${throughput} │ ${items} │ ${speedup} │ ${efficiency} │ ${p99} │`);
  }

  console.log('└──────────────────────────┴──────────┴──────────────┴──────────────┴────────────┴────────────┴────────────┘');
  
  // Detailed workload descriptions
  console.log('\n📋 Workload Definitions:\n');
  for (const result of results) {
    console.log(`${result.config.name}:`);
    console.log(`  • Handler: ${result.config.description}`);
    console.log(`  • Simulation: await sleep(${result.config.workDurationMs}ms) + CPU work`);
    console.log(`  • Items Processed: ${result.itemsProcessed.toLocaleString()}`);
    console.log(`  • Concurrency: ${result.concurrency} workers`);
    console.log(`  • Sequential Baseline: ${result.sequentialBaseline.toFixed(1)} items/sec (1 worker)`);
    console.log(`  • Actual Throughput: ${result.itemsPerSecond.toFixed(1)} items/sec (${result.concurrency} workers)`);
    console.log(`  • Speedup: ${result.speedup.toFixed(2)}x faster than sequential`);
    console.log(`  • Parallel Efficiency: ${result.parallelEfficiency.toFixed(1)}% (of ideal parallel)`);
    console.log(`  • Real-World: ${result.config.realisticScenario}\n`);
  }

  // Summary
  console.log('\n📈 Summary Statistics:\n');
  
  const avgSpeedup = results.reduce((sum, r) => sum + r.speedup, 0) / results.length;
  const avgParallelEfficiency = results.reduce((sum, r) => sum + r.parallelEfficiency, 0) / results.length;
  const avgThroughput = results.reduce((sum, r) => sum + r.itemsPerSecond, 0) / results.length;
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
  const totalItems = results.reduce((sum, r) => sum + r.itemsProcessed, 0);

  console.log(`   Total Items Processed: ${totalItems.toLocaleString()}`);
  console.log(`   Average Throughput: ${avgThroughput.toFixed(1)} items/sec`);
  console.log(`   Average Speedup: ${avgSpeedup.toFixed(2)}x vs sequential`);
  console.log(`   Average Parallel Efficiency: ${avgParallelEfficiency.toFixed(1)}%`);
  console.log(`   Total Errors: ${totalErrors}`);
  
  console.log('\n💡 Understanding the Metrics:\n');
  console.log('   • Speedup: How many times faster than single-threaded sequential processing');
  console.log('     - 4.2x means 4.2x faster than processing one item at a time');
  console.log('     - Ideal: close to concurrency level (e.g., 8-10x for 10 workers)');
  console.log('   • Parallel Efficiency: Actual throughput / (sequential × workers)');
  console.log('     - 100% = perfect parallelization (no overhead)');
  console.log('     - 80-95% = good (some overhead from coordination)');
  console.log('     - <80% = may indicate bottlenecks (Redis, network, contention)');

  // Real-world scenarios
  console.log('\n🎯 Production Use Cases:\n');
  console.log('Based on these benchmarks, here\'s what to expect in production:\n');

  const scenarios = [
    { name: 'E-commerce order processing', work: 'Normal DB Query' },
    { name: 'Payment processing', work: 'External API Call' },
    { name: 'Data import/ETL', work: 'File Processing' },
    { name: 'Image processing pipeline', work: 'Heavy File Processing' },
  ];

  for (const scenario of scenarios) {
    const workload = results.find(r => r.config.name === scenario.work);
    if (workload) {
      console.log(`   ${scenario.name}:`);
      console.log(`     Throughput: ${workload.itemsPerSecond.toFixed(0)} items/sec`);
      console.log(`     Workers: ${workload.concurrency}`);
      console.log(`     Speedup: ${workload.speedup.toFixed(2)}x vs sequential`);
      console.log(`     Work: ${workload.config.realisticScenario}`);
      console.log(`     Handler: ${workload.config.description} (${workload.config.workDurationMs}ms per item)`);
      console.log('');
    }
  }

  console.log('\n✅ Benchmark complete!\n');
  console.log('💡 Tips for Production:');
  console.log('   - Use appropriate concurrency (CPU cores × 2-4)');
  console.log('   - Monitor Redis memory usage');
  console.log('   - Scale horizontally with multiple workers');
  console.log('   - Use connection pooling for DB/API calls\n');
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  console.error('\nMake sure Redis is running:');
  console.error('  docker run -d -p 6379:6379 redis\n');
  process.exit(1);
});

