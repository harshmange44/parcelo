/**
 * Tests for InMemoryScheduler
 */

import { InMemoryScheduler } from '../src/core/inMemoryScheduler';
import { JobStatus, SchedulerEvent } from '../src/types';

describe('InMemoryScheduler', () => {
  let scheduler: InMemoryScheduler;

  beforeEach(() => {
    scheduler = new InMemoryScheduler();
  });

  describe('createJob', () => {
    it('should create a job with valid range', async () => {
      const jobId = await scheduler.createJob({
        range: { start: 0, end: 100 },
        maxRangeSize: 10,
        work: async () => {},
      });

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');

      const job = await scheduler.getJob(jobId);
      expect(job).not.toBeNull();
      expect(job!.status).toBe(JobStatus.CREATED);
      expect(job!.config.range).toEqual({ start: 0, end: 100 });
    });

    it('should reject invalid range', async () => {
      await expect(
        scheduler.createJob({
          range: { start: 100, end: 0 },
          maxRangeSize: 10,
          work: async () => {},
        })
      ).rejects.toThrow('Invalid range');
    });

    it('should emit JOB_CREATED event', async () => {
      const listener = jest.fn();
      scheduler.on(SchedulerEvent.JOB_CREATED, listener);

      const jobId = await scheduler.createJob({
        range: { start: 0, end: 100 },
        maxRangeSize: 10,
        work: async () => {},
      });

      expect(listener).toHaveBeenCalledWith({
        jobId,
        job: expect.objectContaining({ id: jobId }),
      });
    });
  });

  describe('startJob', () => {
    it('should start a created job', async () => {
      const jobId = await scheduler.createJob({
        range: { start: 0, end: 10 },
        maxRangeSize: 5,
        work: async () => {},
      });

      await scheduler.startJob(jobId);

      const job = await scheduler.getJob(jobId);
      expect(job!.status).toBe(JobStatus.RUNNING);
    });

    it('should emit JOB_STARTED event', async () => {
      const listener = jest.fn();
      scheduler.on(SchedulerEvent.JOB_STARTED, listener);

      const jobId = await scheduler.createJob({
        range: { start: 0, end: 10 },
        maxRangeSize: 5,
        work: async () => {},
      });

      await scheduler.startJob(jobId);

      expect(listener).toHaveBeenCalledWith({ jobId });
    });
  });

  describe('pauseJob', () => {
    it('should pause a running job', async () => {
      const jobId = await scheduler.createJob({
        range: { start: 0, end: 10 },
        maxRangeSize: 5,
        work: async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
        },
      });

      await scheduler.startJob(jobId);
      await new Promise(resolve => setTimeout(resolve, 50));
      await scheduler.pauseJob(jobId);

      const job = await scheduler.getJob(jobId);
      expect(job!.status).toBe(JobStatus.PAUSED);
    });

    it('should emit JOB_PAUSED event', async () => {
      const listener = jest.fn();
      scheduler.on(SchedulerEvent.JOB_PAUSED, listener);

      const jobId = await scheduler.createJob({
        range: { start: 0, end: 10 },
        maxRangeSize: 5,
        work: async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
        },
      });

      await scheduler.startJob(jobId);
      await new Promise(resolve => setTimeout(resolve, 50));
      await scheduler.pauseJob(jobId);

      expect(listener).toHaveBeenCalledWith({ jobId });
    });
  });

  describe('cancelJob', () => {
    it('should cancel a job', async () => {
      const jobId = await scheduler.createJob({
        range: { start: 0, end: 10 },
        maxRangeSize: 5,
        work: async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
        },
      });

      await scheduler.startJob(jobId);
      await new Promise(resolve => setTimeout(resolve, 50));
      await scheduler.cancelJob(jobId);

      const job = await scheduler.getJob(jobId);
      expect(job!.status).toBe(JobStatus.CANCELLED);
    });

    it('should emit JOB_CANCELLED event', async () => {
      const listener = jest.fn();
      scheduler.on(SchedulerEvent.JOB_CANCELLED, listener);

      const jobId = await scheduler.createJob({
        range: { start: 0, end: 10 },
        maxRangeSize: 5,
        work: async () => {},
      });

      await scheduler.cancelJob(jobId);

      expect(listener).toHaveBeenCalledWith({ jobId });
    });
  });

  describe('job execution', () => {
    it('should complete a simple job', async () => {
      const workFn = jest.fn();
      const jobId = await scheduler.createJob({
        range: { start: 0, end: 10 },
        maxRangeSize: 5,
        work: workFn,
      });

      const completedPromise = new Promise(resolve => {
        scheduler.on(SchedulerEvent.JOB_COMPLETED, resolve);
      });

      await scheduler.startJob(jobId);
      await completedPromise;

      const job = await scheduler.getJob(jobId);
      expect(job!.status).toBe(JobStatus.COMPLETED);
      expect(workFn).toHaveBeenCalled();
    });

    it('should split ranges larger than maxRangeSize', async () => {
      const ranges: Array<{ start: number; end: number }> = [];
      
      const jobId = await scheduler.createJob({
        range: { start: 0, end: 100 },
        maxRangeSize: 10,
        work: async (range) => {
          ranges.push(range);
        },
      });

      const completedPromise = new Promise(resolve => {
        scheduler.on(SchedulerEvent.JOB_COMPLETED, resolve);
      });

      await scheduler.startJob(jobId);
      await completedPromise;

      // Should have split into multiple ranges
      expect(ranges.length).toBeGreaterThan(1);
      
      // All ranges should be <= maxRangeSize
      for (const range of ranges) {
        expect(range.end - range.start).toBeLessThanOrEqual(10);
      }

      // Total coverage should be 100
      const totalCoverage = ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
      expect(totalCoverage).toBe(100);
    });

    it('should respect shouldProcess callback', async () => {
      const workFn = jest.fn();
      const shouldProcess = jest.fn((range) => {
        // Only process ranges starting at even numbers
        return range.start % 2 === 0;
      });

      const jobId = await scheduler.createJob({
        range: { start: 0, end: 20 },
        maxRangeSize: 5,
        shouldProcess,
        work: workFn,
      });

      const completedPromise = new Promise(resolve => {
        scheduler.on(SchedulerEvent.JOB_COMPLETED, resolve);
      });

      await scheduler.startJob(jobId);
      await completedPromise;

      expect(shouldProcess).toHaveBeenCalled();
      
      const stats = await scheduler.getStats(jobId);
      expect(stats!.skippedNodes).toBeGreaterThan(0);
    });

    it('should handle work errors', async () => {
      const jobId = await scheduler.createJob({
        range: { start: 0, end: 10 },
        maxRangeSize: 5,
        work: async () => {
          throw new Error('Work failed');
        },
      });

      const failedPromise = new Promise(resolve => {
        scheduler.on(SchedulerEvent.JOB_FAILED, resolve);
      });

      await scheduler.startJob(jobId);
      await failedPromise;

      const job = await scheduler.getJob(jobId);
      expect(job!.status).toBe(JobStatus.FAILED);
      
      const stats = await scheduler.getStats(jobId);
      expect(stats!.errorNodes).toBeGreaterThan(0);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', async () => {
      const jobId = await scheduler.createJob({
        range: { start: 0, end: 100 },
        maxRangeSize: 10,
        work: async () => {},
      });

      const stats = await scheduler.getStats(jobId);
      expect(stats).not.toBeNull();
      expect(stats!.rangeTotal).toBe(100);
      expect(stats!.totalNodes).toBeGreaterThan(0);
    });
  });

  describe('getJobTreeSnapshot', () => {
    it('should return tree snapshot', async () => {
      const jobId = await scheduler.createJob({
        range: { start: 0, end: 100 },
        maxRangeSize: 10,
        work: async () => {},
      });

      await scheduler.startJob(jobId);
      await new Promise(resolve => setTimeout(resolve, 100));

      const snapshot = await scheduler.getJobTreeSnapshot(jobId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.jobId).toBe(jobId);
      expect(snapshot!.rootNode).toBeDefined();
      expect(snapshot!.rootNode.range).toEqual({ start: 0, end: 100 });
    });
  });

  describe('events', () => {
    it('should emit NODE_CREATED events', async () => {
      const listener = jest.fn();
      scheduler.on(SchedulerEvent.NODE_CREATED, listener);

      const jobId = await scheduler.createJob({
        range: { start: 0, end: 100 },
        maxRangeSize: 10,
        work: async () => {},
      });
      
      // Use jobId to avoid unused variable warning
      expect(jobId).toBeDefined();
      expect(listener).toHaveBeenCalled();
    });

    it('should emit STATS_UPDATED events', async () => {
      const listener = jest.fn();
      scheduler.on(SchedulerEvent.STATS_UPDATED, listener);

      const jobId = await scheduler.createJob({
        range: { start: 0, end: 20 },
        maxRangeSize: 5,
        work: async () => {},
      });

      await scheduler.startJob(jobId);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(listener).toHaveBeenCalled();
    });
  });
});

