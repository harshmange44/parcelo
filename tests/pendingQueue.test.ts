/**
 * Tests for PendingQueue
 */

import { PendingQueue } from '../src/core/pendingQueue';

describe('PendingQueue', () => {
  let queue: PendingQueue;

  beforeEach(() => {
    queue = new PendingQueue();
  });

  describe('enqueue and dequeue', () => {
    it('should enqueue and dequeue items', () => {
      queue.enqueue('node1', 'job1', 0);
      
      expect(queue.size()).toBe(1);
      
      const item = queue.dequeue();
      expect(item).not.toBeNull();
      expect(item!.nodeId).toBe('node1');
      expect(queue.size()).toBe(0);
    });

    it('should maintain FIFO order for same depth', () => {
      queue.enqueue('node1', 'job1', 0);
      queue.enqueue('node2', 'job1', 0);
      queue.enqueue('node3', 'job1', 0);

      expect(queue.dequeue()!.nodeId).toBe('node1');
      expect(queue.dequeue()!.nodeId).toBe('node2');
      expect(queue.dequeue()!.nodeId).toBe('node3');
    });

    it('should prioritize deeper nodes', () => {
      queue.enqueue('node1', 'job1', 0);
      queue.enqueue('node2', 'job1', 2);
      queue.enqueue('node3', 'job1', 1);

      expect(queue.dequeue()!.nodeId).toBe('node2'); // depth 2
      expect(queue.dequeue()!.nodeId).toBe('node3'); // depth 1
      expect(queue.dequeue()!.nodeId).toBe('node1'); // depth 0
    });

    it('should return null when empty', () => {
      expect(queue.dequeue()).toBeNull();
    });
  });

  describe('peek', () => {
    it('should peek without removing', () => {
      queue.enqueue('node1', 'job1', 0);
      
      const item = queue.peek();
      expect(item).not.toBeNull();
      expect(item!.nodeId).toBe('node1');
      expect(queue.size()).toBe(1);
    });

    it('should return null when empty', () => {
      expect(queue.peek()).toBeNull();
    });
  });

  describe('remove', () => {
    it('should remove a specific item', () => {
      queue.enqueue('node1', 'job1', 0);
      queue.enqueue('node2', 'job1', 0);
      queue.enqueue('node3', 'job1', 0);

      const result = queue.remove('node2');
      expect(result).toBe(true);
      expect(queue.size()).toBe(2);
      
      expect(queue.dequeue()!.nodeId).toBe('node1');
      expect(queue.dequeue()!.nodeId).toBe('node3');
    });

    it('should return false for non-existent item', () => {
      queue.enqueue('node1', 'job1', 0);
      
      const result = queue.remove('node2');
      expect(result).toBe(false);
      expect(queue.size()).toBe(1);
    });

    it('should maintain heap property after removal', () => {
      queue.enqueue('node1', 'job1', 0);
      queue.enqueue('node2', 'job1', 2);
      queue.enqueue('node3', 'job1', 1);
      queue.enqueue('node4', 'job1', 3);

      queue.remove('node2'); // Remove depth 2

      expect(queue.dequeue()!.nodeId).toBe('node4'); // depth 3
      expect(queue.dequeue()!.nodeId).toBe('node3'); // depth 1
      expect(queue.dequeue()!.nodeId).toBe('node1'); // depth 0
    });
  });

  describe('has', () => {
    it('should check if item exists', () => {
      queue.enqueue('node1', 'job1', 0);
      
      expect(queue.has('node1')).toBe(true);
      expect(queue.has('node2')).toBe(false);
    });
  });

  describe('isEmpty', () => {
    it('should check if queue is empty', () => {
      expect(queue.isEmpty()).toBe(true);
      
      queue.enqueue('node1', 'job1', 0);
      expect(queue.isEmpty()).toBe(false);
      
      queue.dequeue();
      expect(queue.isEmpty()).toBe(true);
    });
  });

  describe('getByJob', () => {
    it('should get items for a specific job', () => {
      queue.enqueue('node1', 'job1', 0);
      queue.enqueue('node2', 'job2', 0);
      queue.enqueue('node3', 'job1', 0);

      const job1Items = queue.getByJob('job1');
      expect(job1Items).toHaveLength(2);
      expect(job1Items.map(i => i.nodeId)).toContain('node1');
      expect(job1Items.map(i => i.nodeId)).toContain('node3');
    });
  });

  describe('removeByJob', () => {
    it('should remove all items for a job', () => {
      queue.enqueue('node1', 'job1', 0);
      queue.enqueue('node2', 'job2', 0);
      queue.enqueue('node3', 'job1', 0);

      const removed = queue.removeByJob('job1');
      expect(removed).toBe(2);
      expect(queue.size()).toBe(1);
      expect(queue.dequeue()!.nodeId).toBe('node2');
    });
  });

  describe('clear', () => {
    it('should clear all items', () => {
      queue.enqueue('node1', 'job1', 0);
      queue.enqueue('node2', 'job1', 0);
      queue.enqueue('node3', 'job1', 0);

      queue.clear();
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
    });
  });

  describe('priority ordering', () => {
    it('should handle complex priority scenarios', () => {
      // Add items with various depths
      queue.enqueue('node1', 'job1', 0);
      queue.enqueue('node2', 'job1', 1);
      queue.enqueue('node3', 'job1', 1);
      queue.enqueue('node4', 'job1', 2);
      queue.enqueue('node5', 'job1', 0);

      // Should dequeue in order: depth 2, depth 1 (FIFO), depth 0 (FIFO)
      expect(queue.dequeue()!.nodeId).toBe('node4'); // depth 2
      expect(queue.dequeue()!.nodeId).toBe('node2'); // depth 1, first
      expect(queue.dequeue()!.nodeId).toBe('node3'); // depth 1, second
      expect(queue.dequeue()!.nodeId).toBe('node1'); // depth 0, first
      expect(queue.dequeue()!.nodeId).toBe('node5'); // depth 0, second
    });
  });

  describe('duplicate prevention', () => {
    it('should not enqueue duplicate nodes', () => {
      queue.enqueue('node1', 'job1', 0);
      queue.enqueue('node1', 'job1', 0);

      expect(queue.size()).toBe(1);
    });
  });
});

