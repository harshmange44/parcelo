/**
 * Job store - high-level operations on jobs
 */

import { RangeJob, JobStatus, JobStats, StorageAdapter } from '../types';

/**
 * Manages job storage and operations
 */
export class JobStore {
  constructor(private storage: StorageAdapter) {}

  /**
   * Create and save a new job
   */
  async create(job: RangeJob<any>): Promise<void> {
    await this.storage.saveJob(job);
  }

  /**
   * Get a job by ID
   */
  async get(jobId: string): Promise<RangeJob<any> | null> {
    return this.storage.getJob(jobId);
  }

  /**
   * Update job status
   */
  async updateStatus(jobId: string, status: JobStatus): Promise<void> {
    const updates: Partial<RangeJob> = { status };
    
    if (status === JobStatus.RUNNING) {
      updates.startedAt = Date.now();
    } else if (status === JobStatus.COMPLETED || status === JobStatus.FAILED || status === JobStatus.CANCELLED) {
      updates.completedAt = Date.now();
    } else if (status === JobStatus.PAUSED) {
      updates.pausedAt = Date.now();
    }
    
    await this.storage.updateJob(jobId, updates);
  }

  /**
   * Update job statistics
   */
  async updateStats(jobId: string, stats: JobStats): Promise<void> {
    await this.storage.updateJob(jobId, { stats });
  }

  /**
   * Delete a job
   */
  async delete(jobId: string): Promise<void> {
    await this.storage.deleteJob(jobId);
  }

  /**
   * Check if a job exists
   */
  async exists(jobId: string): Promise<boolean> {
    const job = await this.storage.getJob(jobId);
    return job !== null;
  }
}

