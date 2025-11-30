/**
 * Worker pool for executing range jobs
 */

import { WorkCallback, WorkContext, Range } from '../types';

/**
 * Represents an active worker
 */
interface Worker<T> {
  id: string;
  nodeId: string;
  jobId: string;
  range: Range<T>;
  controller: AbortController;
  promise: Promise<void>;
  startedAt: number;
}

/**
 * Manages a pool of concurrent workers
 * @template T The type of values in the range
 */
export class WorkerPool<T = number> {
  private workers: Map<string, Worker<T>>;
  private maxConcurrency: number;

  constructor(maxConcurrency: number = 10) {
    this.workers = new Map();
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  /**
   * Check if the pool has capacity for more workers
   */
  hasCapacity(): boolean {
    return this.workers.size < this.maxConcurrency;
  }

  /**
   * Get the number of active workers
   */
  activeCount(): number {
    return this.workers.size;
  }

  /**
   * Get the number of available slots
   */
  availableSlots(): number {
    return Math.max(0, this.maxConcurrency - this.workers.size);
  }

  /**
   * Execute work for a node
   */
  async execute(
    nodeId: string,
    jobId: string,
    range: Range<T>,
    work: WorkCallback<T>
  ): Promise<void> {
    if (!this.hasCapacity()) {
      throw new Error('Worker pool at capacity');
    }

    const controller = new AbortController();
    const context: WorkContext = {
      jobId,
      nodeId,
      signal: controller.signal,
      attempt: 1, // Default attempt number
    };

    const workerId = `worker_${nodeId}`;
    
    // Execute the work
    const promise = (async () => {
      try {
        await work(range, context);
      } finally {
        // Clean up worker
        this.workers.delete(workerId);
      }
    })();

    // Track the worker
    const worker: Worker<T> = {
      id: workerId,
      nodeId,
      jobId,
      range,
      controller,
      promise,
      startedAt: Date.now(),
    };

    this.workers.set(workerId, worker);

    return promise;
  }

  /**
   * Cancel a specific worker
   */
  cancel(nodeId: string): boolean {
    for (const [workerId, worker] of this.workers.entries()) {
      if (worker.nodeId === nodeId) {
        worker.controller.abort();
        this.workers.delete(workerId);
        return true;
      }
    }
    return false;
  }

  /**
   * Cancel all workers for a job
   */
  cancelJob(jobId: string): number {
    let cancelled = 0;
    const workersToCancel: string[] = [];

    for (const [workerId, worker] of this.workers.entries()) {
      if (worker.jobId === jobId) {
        worker.controller.abort();
        workersToCancel.push(workerId);
        cancelled++;
      }
    }

    // Remove cancelled workers
    for (const workerId of workersToCancel) {
      this.workers.delete(workerId);
    }

    return cancelled;
  }

  /**
   * Cancel all workers
   */
  cancelAll(): number {
    const count = this.workers.size;
    
    for (const worker of this.workers.values()) {
      worker.controller.abort();
    }
    
    this.workers.clear();
    return count;
  }

  /**
   * Wait for all active workers to complete
   */
  async drain(): Promise<void> {
    const promises = Array.from(this.workers.values()).map(w => w.promise);
    await Promise.allSettled(promises);
  }

  /**
   * Wait for all workers of a specific job to complete
   */
  async drainJob(jobId: string): Promise<void> {
    const promises = Array.from(this.workers.values())
      .filter(w => w.jobId === jobId)
      .map(w => w.promise);
    await Promise.allSettled(promises);
  }

  /**
   * Get active worker info for a job
   */
  getActiveWorkers(jobId: string): Array<{ nodeId: string; range: Range<T>; startedAt: number }> {
    const result: Array<{ nodeId: string; range: Range<T>; startedAt: number }> = [];
    
    for (const worker of this.workers.values()) {
      if (worker.jobId === jobId) {
        result.push({
          nodeId: worker.nodeId,
          range: worker.range,
          startedAt: worker.startedAt,
        });
      }
    }
    
    return result;
  }

  /**
   * Check if a node is currently being processed
   */
  isProcessing(nodeId: string): boolean {
    for (const worker of this.workers.values()) {
      if (worker.nodeId === nodeId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Update max concurrency
   */
  setMaxConcurrency(maxConcurrency: number): void {
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  /**
   * Get max concurrency
   */
  getMaxConcurrency(): number {
    return this.maxConcurrency;
  }

  /**
   * Get pool statistics
   */
  getStats(): { active: number; capacity: number; available: number } {
    return {
      active: this.activeCount(),
      capacity: this.maxConcurrency,
      available: this.availableSlots(),
    };
  }
}

