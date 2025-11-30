/**
 * Node store - high-level operations on range nodes
 */

import { RangeNode, NodeStatus, StorageAdapter } from '../types';

/**
 * Manages node storage and operations
 */
export class NodeStore {
  constructor(private storage: StorageAdapter) {}

  /**
   * Create and save a new node
   */
  async create(node: RangeNode<any>): Promise<void> {
    await this.storage.saveNode(node);
  }

  /**
   * Get a node by ID
   */
  async get(nodeId: string): Promise<RangeNode<any> | null> {
    return this.storage.getNode(nodeId);
  }

  /**
   * Update a node
   */
  async update(nodeId: string, updates: Partial<RangeNode<any>>): Promise<void> {
    await this.storage.updateNode(nodeId, updates);
  }

  /**
   * Update node status
   */
  async updateStatus(nodeId: string, status: NodeStatus, error?: string): Promise<void> {
    const updates: Partial<RangeNode> = { status };
    
    if (status === NodeStatus.RUNNING) {
      updates.startedAt = Date.now();
    } else if (status === NodeStatus.DONE || status === NodeStatus.ERROR || status === NodeStatus.SKIPPED) {
      updates.completedAt = Date.now();
    }
    
    if (error) {
      updates.error = error;
    }
    
    await this.storage.updateNode(nodeId, updates);
  }

  /**
   * Set node children
   */
  async setChildren(nodeId: string, leftChildId: string, rightChildId: string): Promise<void> {
    await this.storage.updateNode(nodeId, {
      leftChildId,
      rightChildId,
      isLeaf: false,
    });
  }

  /**
   * Get all nodes for a job
   */
  async getByJob(jobId: string): Promise<RangeNode[]> {
    return this.storage.getNodesByJob(jobId);
  }

  /**
   * Get nodes by status for a job
   */
  async getByStatus(jobId: string, status: NodeStatus): Promise<RangeNode[]> {
    return this.storage.getNodesByStatus(jobId, status);
  }

  /**
   * Get pending nodes for a job
   */
  async getPending(jobId: string): Promise<RangeNode[]> {
    return this.getByStatus(jobId, NodeStatus.PENDING);
  }

  /**
   * Get running nodes for a job
   */
  async getRunning(jobId: string): Promise<RangeNode[]> {
    return this.getByStatus(jobId, NodeStatus.RUNNING);
  }

  /**
   * Save multiple nodes
   */
  async createMany(nodes: RangeNode<any>[]): Promise<void> {
    await this.storage.saveNodes(nodes);
  }

  /**
   * Delete a node
   */
  async delete(nodeId: string): Promise<void> {
    await this.storage.deleteNode(nodeId);
  }
}

