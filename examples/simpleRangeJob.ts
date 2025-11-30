/**
 * Example: Process a large numeric range with recursive splitting
 * 
 * This example demonstrates:
 * - Creating a job with a large range (0 to 1,000,000)
 * - Splitting ranges recursively until they're manageable
 * - Using shouldProcess to prune certain ranges
 * - Tracking progress with events
 * - Concurrent execution with worker pool
 */

import {
  InMemoryScheduler,
  SchedulerEvent,
  RangeJobConfig,
  Range,
  ProcessFlags,
} from '../src/index';

async function main() {
  console.log('🚀 Starting Recursive Range Scheduler Example\n');

  // Create scheduler (in-memory, no external dependencies)
  const scheduler = new InMemoryScheduler({
    defaultMaxConcurrency: 5,
  });

  // Track processed ranges
  const processedRanges: Range[] = [];

  // Configure the job
  const config: RangeJobConfig = {
    // Process numbers from 0 to 1,000,000
    range: { start: 0, end: 1_000_000 },

    // Split ranges larger than 1000
    maxRangeSize: 1000,

    // Only process ranges where start is divisible by 10000
    // This will skip ~90% of the work, demonstrating pruning
    shouldProcess: async (range: Range, flags: ProcessFlags) => {
      // Skip if the range doesn't align with our filtering
      if (range.start % 10000 !== 0 && !flags.isLeaf) {
        // For non-leaf nodes, check if any descendant could be valid
        const rangeStart = Math.floor(range.start / 10000) * 10000;
        
        // If range doesn't contain a valid starting point, skip it
        if (rangeStart >= range.end) {
          console.log(`  ⏭️  Pruning range [${range.start}, ${range.end}) at depth ${flags.depth}`);
          return false;
        }
      }
      
      return true;
    },

    // Simulate work on each leaf range
    work: async (range: Range) => {
      // Only actually process if it starts at a multiple of 10000
      if (range.start % 10000 === 0) {
        processedRanges.push(range);
        
        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 10));
        
        console.log(`  ✅ Processed range [${range.start.toLocaleString()}, ${range.end.toLocaleString()})`);
      } else {
        // This shouldn't happen with our shouldProcess logic
        console.log(`  ⚠️  Unexpected range [${range.start}, ${range.end})`);
      }
    },

    maxConcurrency: 5,
  };

  // Register event listeners
  scheduler.on(SchedulerEvent.JOB_CREATED, ({ jobId }) => {
    console.log(`📋 Job created: ${jobId}\n`);
  });

  scheduler.on(SchedulerEvent.JOB_STARTED, () => {
    console.log('▶️  Job started\n');
  });

  scheduler.on(SchedulerEvent.NODE_SPLIT, () => {
    // Uncomment to see all splits (can be verbose)
    // console.log(`  🌳 Range split`);
  });

  scheduler.on(SchedulerEvent.NODE_SKIPPED, () => {
    // Track skipped nodes
    // console.log(`  ⏭️  Node skipped`);
  });

  scheduler.on(SchedulerEvent.STATS_UPDATED, ({ stats }) => {
    // Print progress periodically
    const progress = (stats.rangeProcessed / stats.rangeTotal) * 100;
    if (stats.doneNodes % 10 === 0 || stats.doneNodes === 1) {
      console.log(`  📊 Progress: ${progress.toFixed(2)}% | ` +
                  `Nodes: ${stats.totalNodes} total, ${stats.doneNodes} done, ` +
                  `${stats.skippedNodes} skipped, ${stats.runningNodes} running, ` +
                  `${stats.pendingNodes} pending`);
    }
  });

  scheduler.on(SchedulerEvent.JOB_COMPLETED, ({ stats }) => {
    console.log('\n✨ Job completed!');
    console.log(`\nFinal Statistics:`);
    console.log(`  Total Nodes: ${stats.totalNodes}`);
    console.log(`  Done: ${stats.doneNodes}`);
    console.log(`  Skipped: ${stats.skippedNodes}`);
    console.log(`  Errors: ${stats.errorNodes}`);
    console.log(`  Range Processed: ${stats.rangeProcessed.toLocaleString()} / ${stats.rangeTotal.toLocaleString()}`);
    console.log(`  Range Skipped: ${stats.rangeSkipped.toLocaleString()}`);
    console.log(`\n  Processed ${processedRanges.length} leaf ranges`);
  });

  scheduler.on(SchedulerEvent.JOB_FAILED, ({ error }) => {
    console.error(`\n❌ Job failed: ${error}`);
  });

  // Create and start the job
  const jobId = await scheduler.createJob(config);
  
  const startTime = Date.now();
  await scheduler.startJob(jobId);

  // Wait for completion
  await new Promise<void>((resolve) => {
    scheduler.once(SchedulerEvent.JOB_COMPLETED, () => resolve());
    scheduler.once(SchedulerEvent.JOB_FAILED, () => resolve());
  });

  const elapsed = Date.now() - startTime;
  console.log(`\n⏱️  Total time: ${(elapsed / 1000).toFixed(2)}s`);

  // Get final snapshot
  console.log('\n📸 Tree Snapshot (first few levels):');
  const snapshot = await scheduler.getJobTreeSnapshot(jobId);
  if (snapshot) {
    printTreeSnapshot(snapshot.rootNode, 0, 3);
  }

  console.log('\n✅ Example completed!');
}

/**
 * Helper to print tree structure
 */
function printTreeSnapshot(node: any, depth: number, maxDepth: number): void {
  if (depth > maxDepth) return;

  const indent = '  '.repeat(depth);
  const rangeStr = `[${node.range.start.toLocaleString()}, ${node.range.end.toLocaleString()})`;
  const statusIcon = getStatusIcon(node.status);
  
  console.log(`${indent}${statusIcon} ${rangeStr} - ${node.status}${node.isLeaf ? ' (leaf)' : ''}`);

  if (node.leftChild) {
    printTreeSnapshot(node.leftChild, depth + 1, maxDepth);
  }
  if (node.rightChild) {
    printTreeSnapshot(node.rightChild, depth + 1, maxDepth);
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'done': return '✅';
    case 'running': return '🔄';
    case 'pending': return '⏳';
    case 'skipped': return '⏭️';
    case 'error': return '❌';
    default: return '❓';
  }
}

// Run the example
main().catch(console.error);

