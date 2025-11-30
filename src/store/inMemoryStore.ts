/**
 * In-memory storage implementation
 */

import { RangeJob, RangeNode, NodeStatus, StorageAdapter } from '../types';

/**
 * In-memory storage adapter (no external DB)
 */
export class InMemoryStore implements StorageAdapter {
  private jobs: Map<string, RangeJob>;
  private nodes: Map<string, RangeNode>;
  private jobNodes: Map<string, Set<string>>; // jobId -> Set<nodeId>
  private jobNodesByStatus: Map<string, Map<NodeStatus, Set<string>>>; // jobId -> status -> Set<nodeId>

  constructor() {
    this.jobs = new Map();
    this.nodes = new Map();
    this.jobNodes = new Map();
    this.jobNodesByStatus = new Map();
  }

  // Job operations
  async saveJob(job: RangeJob): Promise<void> {
    this.jobs.set(job.id, { ...job });
  }

  async getJob(jobId: string): Promise<RangeJob | null> {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  async updateJob(jobId: string, updates: Partial<RangeJob>): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    Object.assign(job, updates);
  }

  async deleteJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
    
    // Clean up associated nodes
    const nodeIds = this.jobNodes.get(jobId);
    if (nodeIds) {
      for (const nodeId of nodeIds) {
        this.nodes.delete(nodeId);
      }
      this.jobNodes.delete(jobId);
    }
    
    this.jobNodesByStatus.delete(jobId);
  }

  async getAllJobs(): Promise<RangeJob<any>[]> {
    return Array.from(this.jobs.values());
  }

  // Node operations
  async saveNode(node: RangeNode): Promise<void> {
    this.nodes.set(node.id, { ...node });
    
    // Update job nodes index
    if (!this.jobNodes.has(node.jobId)) {
      this.jobNodes.set(node.jobId, new Set());
    }
    this.jobNodes.get(node.jobId)!.add(node.id);
    
    // Update status index
    this.updateStatusIndex(node.jobId, node.id, node.status);
  }

  async getNode(nodeId: string): Promise<RangeNode | null> {
    const node = this.nodes.get(nodeId);
    return node ? { ...node } : null;
  }

  async updateNode(nodeId: string, updates: Partial<RangeNode>): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }
    
    const oldStatus = node.status;
    Object.assign(node, updates);
    
    // Update status index if status changed
    if (updates.status && updates.status !== oldStatus) {
      this.removeFromStatusIndex(node.jobId, nodeId, oldStatus);
      this.updateStatusIndex(node.jobId, nodeId, updates.status);
    }
  }

  async deleteNode(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (node) {
      this.nodes.delete(nodeId);
      
      // Update indices
      const jobNodeSet = this.jobNodes.get(node.jobId);
      if (jobNodeSet) {
        jobNodeSet.delete(nodeId);
      }
      
      this.removeFromStatusIndex(node.jobId, nodeId, node.status);
    }
  }

  async getNodesByJob(jobId: string): Promise<RangeNode[]> {
    const nodeIds = this.jobNodes.get(jobId);
    if (!nodeIds) {
      return [];
    }
    
    const nodes: RangeNode[] = [];
    for (const nodeId of nodeIds) {
      const node = this.nodes.get(nodeId);
      if (node) {
        nodes.push({ ...node });
      }
    }
    
    return nodes;
  }

  async getNodesByStatus(jobId: string, status: NodeStatus): Promise<RangeNode[]> {
    const statusMap = this.jobNodesByStatus.get(jobId);
    if (!statusMap) {
      return [];
    }
    
    const nodeIds = statusMap.get(status);
    if (!nodeIds) {
      return [];
    }
    
    const nodes: RangeNode[] = [];
    for (const nodeId of nodeIds) {
      const node = this.nodes.get(nodeId);
      if (node) {
        nodes.push({ ...node });
      }
    }
    
    return nodes;
  }

  // Batch operations
  async saveNodes(nodes: RangeNode[]): Promise<void> {
    for (const node of nodes) {
      await this.saveNode(node);
    }
  }

  async updateNodes(updates: Array<{ nodeId: string; updates: Partial<RangeNode> }>): Promise<void> {
    for (const { nodeId, updates: nodeUpdates } of updates) {
      await this.updateNode(nodeId, nodeUpdates);
    }
  }

  // Cleanup
  async clear(): Promise<void> {
    this.jobs.clear();
    this.nodes.clear();
    this.jobNodes.clear();
    this.jobNodesByStatus.clear();
  }

  // Private helper methods
  private updateStatusIndex(jobId: string, nodeId: string, status: NodeStatus): void {
    if (!this.jobNodesByStatus.has(jobId)) {
      this.jobNodesByStatus.set(jobId, new Map());
    }
    
    const statusMap = this.jobNodesByStatus.get(jobId)!;
    if (!statusMap.has(status)) {
      statusMap.set(status, new Set());
    }
    
    statusMap.get(status)!.add(nodeId);
  }

  private removeFromStatusIndex(jobId: string, nodeId: string, status: NodeStatus): void {
    const statusMap = this.jobNodesByStatus.get(jobId);
    if (statusMap) {
      const statusSet = statusMap.get(status);
      if (statusSet) {
        statusSet.delete(nodeId);
        if (statusSet.size === 0) {
          statusMap.delete(status);
        }
      }
    }
  }
}

