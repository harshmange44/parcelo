/**
 * Tests for RangeTree
 */

import { RangeTree } from '../src/core/rangeTree';
import { NodeStore } from '../src/store/nodeStore';
import { InMemoryStore } from '../src/store/inMemoryStore';
import { NodeStatus } from '../src/types';
import { NumberRangeAdapter } from '../src/adapters/rangeAdapter';

describe('RangeTree', () => {
  let store: InMemoryStore;
  let nodeStore: NodeStore;
  let rangeTree: RangeTree<number>;
  let adapter: NumberRangeAdapter;

  beforeEach(() => {
    store = new InMemoryStore();
    nodeStore = new NodeStore(store);
    adapter = new NumberRangeAdapter();
    rangeTree = new RangeTree(nodeStore, 10, adapter);
  });

  describe('createRoot', () => {
    it('should create a root node', async () => {
      const root = await rangeTree.createRoot('job1', { start: 0, end: 100 });

      expect(root).toBeDefined();
      expect(root.range).toEqual({ start: 0, end: 100 });
      expect(root.depth).toBe(0);
      expect(root.path).toEqual([]);
      expect(root.parentId).toBeNull();
      expect(root.status).toBe(NodeStatus.PENDING);
    });

    it('should mark small ranges as leaf', async () => {
      const root = await rangeTree.createRoot('job1', { start: 0, end: 5 });
      expect(root.isLeaf).toBe(true);
    });

    it('should mark large ranges as non-leaf', async () => {
      const root = await rangeTree.createRoot('job1', { start: 0, end: 100 });
      expect(root.isLeaf).toBe(false);
    });
  });

  describe('split', () => {
    it('should split a node into two children', async () => {
      const root = await rangeTree.createRoot('job1', { start: 0, end: 100 });
      const result = await rangeTree.split(root.id);

      expect(result).not.toBeNull();
      expect(result!.left.range.start).toBe(0);
      expect(result!.left.range.end).toBe(50);
      expect(result!.right.range.start).toBe(50);
      expect(result!.right.range.end).toBe(100);
    });

    it('should set correct depth and path for children', async () => {
      const root = await rangeTree.createRoot('job1', { start: 0, end: 100 });
      const result = await rangeTree.split(root.id);

      expect(result!.left.depth).toBe(1);
      expect(result!.left.path).toEqual([0]);
      expect(result!.right.depth).toBe(1);
      expect(result!.right.path).toEqual([1]);
    });

    it('should not split a leaf node', async () => {
      const root = await rangeTree.createRoot('job1', { start: 0, end: 5 });
      const result = await rangeTree.split(root.id);

      expect(result).toBeNull();
    });

    it('should not split an already-split node', async () => {
      const root = await rangeTree.createRoot('job1', { start: 0, end: 100 });
      await rangeTree.split(root.id);
      const result = await rangeTree.split(root.id);

      expect(result).toBeNull();
    });
  });

  describe('shouldProcessNode', () => {
    it('should return true when no callback provided', async () => {
      const root = await rangeTree.createRoot('job1', { start: 0, end: 100 });
      const result = await rangeTree.shouldProcessNode(root);

      expect(result).toBe(true);
    });

    it('should use callback when provided', async () => {
      const shouldProcess = jest.fn(() => false);
      const tree = new RangeTree(nodeStore, 10, adapter, shouldProcess);
      const root = await tree.createRoot('job1', { start: 0, end: 100 });
      const result = await tree.shouldProcessNode(root);

      expect(shouldProcess).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('should pass correct flags to callback', async () => {
      const shouldProcess = jest.fn(() => true);
      const tree = new RangeTree(nodeStore, 10, adapter, shouldProcess);
      const root = await tree.createRoot('job1', { start: 0, end: 100 });
      await tree.shouldProcessNode(root);

      expect(shouldProcess).toHaveBeenCalledWith(
        { start: 0, end: 100 },
        expect.objectContaining({
          depth: 0,
          path: [],
          isLeaf: false,
        })
      );
    });
  });

  describe('skipSubtree', () => {
    it('should mark node and children as skipped', async () => {
      const root = await rangeTree.createRoot('job1', { start: 0, end: 100 });
      const result = await rangeTree.split(root.id);

      await rangeTree.skipSubtree(root.id);

      const rootNode = await nodeStore.get(root.id);
      const leftNode = await nodeStore.get(result!.left.id);
      const rightNode = await nodeStore.get(result!.right.id);

      expect(rootNode!.status).toBe(NodeStatus.SKIPPED);
      expect(leftNode!.status).toBe(NodeStatus.SKIPPED);
      expect(rightNode!.status).toBe(NodeStatus.SKIPPED);
    });
  });

  describe('getSnapshot', () => {
    it('should return a snapshot of the tree', async () => {
      const root = await rangeTree.createRoot('job1', { start: 0, end: 100 });
      const snapshot = await rangeTree.getSnapshot(root.id);

      expect(snapshot).toBeDefined();
      expect(snapshot.id).toBe(root.id);
      expect(snapshot.range).toEqual({ start: 0, end: 100 });
    });

    it('should include children in snapshot', async () => {
      const root = await rangeTree.createRoot('job1', { start: 0, end: 100 });
      await rangeTree.split(root.id);
      const snapshot = await rangeTree.getSnapshot(root.id);

      expect(snapshot.leftChild).toBeDefined();
      expect(snapshot.rightChild).toBeDefined();
      expect(snapshot.leftChild!.range).toEqual({ start: 0, end: 50 });
      expect(snapshot.rightChild!.range).toEqual({ start: 50, end: 100 });
    });
  });

  describe('static methods', () => {
    it('should calculate range size', () => {
      expect(RangeTree.rangeSize({ start: 0, end: 100 }, adapter)).toBe(100);
      expect(RangeTree.rangeSize({ start: 50, end: 75 }, adapter)).toBe(25);
    });

    it('should validate ranges', () => {
      expect(RangeTree.isValidRange({ start: 0, end: 100 }, adapter)).toBe(true);
      expect(RangeTree.isValidRange({ start: 100, end: 0 }, adapter)).toBe(false);
      expect(RangeTree.isValidRange({ start: 0, end: 0 }, adapter)).toBe(false);
      expect(RangeTree.isValidRange({ start: NaN, end: 100 }, adapter)).toBe(false);
      expect(RangeTree.isValidRange({ start: 0, end: Infinity }, adapter)).toBe(false);
    });
  });
});

