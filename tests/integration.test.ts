/**
 * Integration tests - test the complete system
 */

import { InMemoryScheduler } from '../src/core/inMemoryScheduler';
import { SchedulerEvent, JobStatus } from '../src/types';

describe('Integration Tests', () => {
  describe('Complete workflow', () => {
    it('should process a large range with splitting and pruning', async () => {
      const scheduler = new InMemoryScheduler({ defaultMaxConcurrency: 3 });
      const processedRanges: Array<{ start: number; end: number }> = [];
      
      // Track events
      const events: string[] = [];
      scheduler.on(SchedulerEvent.JOB_CREATED, () => { events.push('created'); return undefined; });
      scheduler.on(SchedulerEvent.JOB_STARTED, () => { events.push('started'); return undefined; });
      scheduler.on(SchedulerEvent.JOB_COMPLETED, () => { events.push('completed'); return undefined; });

      const jobId = await scheduler.createJob({
        range: { start: 0, end: 1000 },
        maxRangeSize: 50,
        shouldProcess: async (range) => {
          // Only process ranges where start is even
          return range.start % 100 < 50;
        },
        work: async (range) => {
          processedRanges.push(range);
        },
      });

      // Wait for completion
      await new Promise<void>((resolve) => {
        scheduler.on(SchedulerEvent.JOB_COMPLETED, () => resolve());
        scheduler.on(SchedulerEvent.JOB_FAILED, () => resolve());
      });

      await scheduler.startJob(jobId);

      // Wait a bit for processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      const job = await scheduler.getJob(jobId);
      const stats = await scheduler.getStats(jobId);

      // Verify job completed or is in progress
      expect(job).not.toBeNull();
      expect(stats).not.toBeNull();
      expect(stats!.totalNodes).toBeGreaterThan(1);
      
      // Verify events were emitted
      expect(events).toContain('created');
      expect(events).toContain('started');
    }, 10000);

    it('should handle concurrent jobs', async () => {
      const scheduler = new InMemoryScheduler({ defaultMaxConcurrency: 5 });
      
      const job1Id = await scheduler.createJob({
        range: { start: 0, end: 100 },
        maxRangeSize: 10,
        work: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
        },
      });

      const job2Id = await scheduler.createJob({
        range: { start: 0, end: 100 },
        maxRangeSize: 10,
        work: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
        },
      });

      // Start both jobs
      await scheduler.startJob(job1Id);
      await scheduler.startJob(job2Id);

      // Both should be running
      const job1 = await scheduler.getJob(job1Id);
      const job2 = await scheduler.getJob(job2Id);

      expect(job1?.status).toBe(JobStatus.RUNNING);
      expect(job2?.status).toBe(JobStatus.RUNNING);
    });

    it('should handle pause and resume', async () => {
      const scheduler = new InMemoryScheduler({ defaultMaxConcurrency: 2 });
      
      const jobId = await scheduler.createJob({
        range: { start: 0, end: 100 },
        maxRangeSize: 10,
        work: async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
        },
      });

      await scheduler.startJob(jobId);
      
      // Let it run a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Pause
      await scheduler.pauseJob(jobId);
      const pausedJob = await scheduler.getJob(jobId);
      expect(pausedJob?.status).toBe(JobStatus.PAUSED);

      // Resume
      await scheduler.startJob(jobId);
      const resumedJob = await scheduler.getJob(jobId);
      expect(resumedJob?.status).toBe(JobStatus.RUNNING);
    });

    it('should track accurate statistics throughout execution', async () => {
      const scheduler = new InMemoryScheduler({ defaultMaxConcurrency: 2 });
      const statsHistory: any[] = [];

      scheduler.on(SchedulerEvent.STATS_UPDATED, ({ stats }) => {
        statsHistory.push({ ...stats });
      });

      const jobId = await scheduler.createJob({
        range: { start: 0, end: 100 },
        maxRangeSize: 10,
        work: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
        },
      });

      const completionPromise = new Promise<void>((resolve) => {
        scheduler.on(SchedulerEvent.JOB_COMPLETED, () => resolve());
      });

      await scheduler.startJob(jobId);
      await completionPromise;

      // Verify stats progression
      expect(statsHistory.length).toBeGreaterThan(0);
      
      const finalStats = statsHistory[statsHistory.length - 1];
      expect(finalStats.rangeProcessed).toBe(100);
      expect(finalStats.pendingNodes).toBe(0);
      expect(finalStats.runningNodes).toBe(0);
    }, 10000);

    it('should properly clean up on cancellation', async () => {
      const scheduler = new InMemoryScheduler({ defaultMaxConcurrency: 2 });
      
      const jobId = await scheduler.createJob({
        range: { start: 0, end: 1000 },
        maxRangeSize: 10,
        work: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
        },
      });

      await scheduler.startJob(jobId);
      
      // Let it run briefly
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Cancel
      await scheduler.cancelJob(jobId);
      
      const job = await scheduler.getJob(jobId);
      expect(job?.status).toBe(JobStatus.CANCELLED);
    });

    it('should handle errors gracefully', async () => {
      const scheduler = new InMemoryScheduler({ defaultMaxConcurrency: 2 });
      
      const jobId = await scheduler.createJob({
        range: { start: 0, end: 50 },
        maxRangeSize: 10,
        work: async (range) => {
          if (range.start === 20) {
            throw new Error('Simulated error');
          }
        },
      });

      const failedPromise = new Promise<void>((resolve) => {
        scheduler.on(SchedulerEvent.JOB_FAILED, () => resolve());
        scheduler.on(SchedulerEvent.JOB_COMPLETED, () => resolve());
      });

      await scheduler.startJob(jobId);
      await failedPromise;

      const stats = await scheduler.getStats(jobId);
      expect(stats?.errorNodes).toBeGreaterThan(0);
    }, 10000);
  });

  describe('Tree structure', () => {
    it('should create a proper binary tree structure', async () => {
      const scheduler = new InMemoryScheduler();
      
      const jobId = await scheduler.createJob({
        range: { start: 0, end: 100 },
        maxRangeSize: 10,
        work: async () => {},
      });

      await scheduler.startJob(jobId);
      
      // Wait for some processing
      await new Promise(resolve => setTimeout(resolve, 100));

      const snapshot = await scheduler.getJobTreeSnapshot(jobId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.rootNode).toBeDefined();
      expect(snapshot!.rootNode.range).toEqual({ start: 0, end: 100 });

      // Verify tree structure
      const countNodes = (node: any): number => {
        let count = 1;
        if (node.leftChild) count += countNodes(node.leftChild);
        if (node.rightChild) count += countNodes(node.rightChild);
        return count;
      };

      const nodeCount = countNodes(snapshot!.rootNode);
      expect(nodeCount).toBeGreaterThan(1);
    });
  });

  describe('Edge cases', () => {
    it('should handle single-element ranges', async () => {
      const scheduler = new InMemoryScheduler();
      let workCalled = false;

      const jobId = await scheduler.createJob({
        range: { start: 0, end: 1 },
        maxRangeSize: 1,
        work: async () => {
          workCalled = true;
        },
      });

      const completedPromise = new Promise<void>((resolve) => {
        scheduler.on(SchedulerEvent.JOB_COMPLETED, () => resolve());
      });

      await scheduler.startJob(jobId);
      await completedPromise;

      expect(workCalled).toBe(true);
      const stats = await scheduler.getStats(jobId);
      expect(stats?.rangeProcessed).toBe(1);
    });

    it('should handle ranges that require deep splitting', async () => {
      const scheduler = new InMemoryScheduler();
      
      const jobId = await scheduler.createJob({
        range: { start: 0, end: 10000 },
        maxRangeSize: 10,
        work: async () => {},
      });

      const completedPromise = new Promise<void>((resolve) => {
        scheduler.on(SchedulerEvent.JOB_COMPLETED, () => resolve());
      });

      await scheduler.startJob(jobId);
      await completedPromise;

      const snapshot = await scheduler.getJobTreeSnapshot(jobId);
      expect(snapshot).not.toBeNull();

      // Calculate max depth
      const getMaxDepth = (node: any): number => {
        if (!node.leftChild && !node.rightChild) return node.depth;
        const leftDepth = node.leftChild ? getMaxDepth(node.leftChild) : 0;
        const rightDepth = node.rightChild ? getMaxDepth(node.rightChild) : 0;
        return Math.max(leftDepth, rightDepth);
      };

      const maxDepth = getMaxDepth(snapshot!.rootNode);
      expect(maxDepth).toBeGreaterThan(5); // Should be deep tree
    }, 15000);

    it('should handle all ranges being skipped', async () => {
      const scheduler = new InMemoryScheduler();
      
      const jobId = await scheduler.createJob({
        range: { start: 0, end: 100 },
        maxRangeSize: 10,
        shouldProcess: async () => false, // Skip everything
        work: async () => {
          throw new Error('Should not be called');
        },
      });

      const completedPromise = new Promise<void>((resolve) => {
        scheduler.on(SchedulerEvent.JOB_COMPLETED, () => resolve());
      });

      await scheduler.startJob(jobId);
      await completedPromise;

      const stats = await scheduler.getStats(jobId);
      expect(stats?.rangeProcessed).toBe(0);
      expect(stats?.skippedNodes).toBeGreaterThan(0);
    });
  });
});

