import { describe, it, expect } from 'vitest';
import { PythonList, PythonDict } from './interpreter';

describe('PythonList', () => {
    it('should initialize correctly', () => {
        const list1 = new PythonList([1, 2, 3]);
        expect(list1.items).toEqual([1, 2, 3]);

        const list2 = new PythonList(1, 2, 3);
        expect(list2.items).toEqual([1, 2, 3]);
    });

    it('pop() should remove and return item', () => {
        const list = new PythonList([1, 2, 3]);
        expect(list.pop()).toBe(3);
        expect(list.items).toEqual([1, 2]);
        expect(list.pop(0)).toBe(1);
        expect(list.items).toEqual([2]);
    });

    it('pop() should throw on empty list', () => {
        const list = new PythonList();
        expect(() => list.pop()).toThrow('pop from empty list');
    });

    it('extend() should append items from iterable', () => {
        const list = new PythonList([1, 2]);
        list.extend([3, 4]);
        expect(list.items).toEqual([1, 2, 3, 4]);

        const list2 = new PythonList([5, 6]);
        list.extend(list2);
        expect(list.items).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('insert() should insert item at index', () => {
        const list = new PythonList([1, 3]);
        list.insert(1, 2);
        expect(list.items).toEqual([1, 2, 3]);

        list.insert(0, 0);
        expect(list.items).toEqual([0, 1, 2, 3]);

        list.insert(100, 4);
        expect(list.items).toEqual([0, 1, 2, 3, 4]);
    });

    it('remove() should remove first occurrence', () => {
        const list = new PythonList([1, 2, 3, 2]);
        list.remove(2);
        expect(list.items).toEqual([1, 3, 2]);
    });

    it('remove() should throw if item not found', () => {
        const list = new PythonList([1, 2]);
        expect(() => list.remove(3)).toThrow('ValueError: list.remove(x): x not in list');
    });

    it('clear() should empty the list', () => {
        const list = new PythonList([1, 2]);
        list.clear();
        expect(list.items).toEqual([]);
    });

    it('index() should return index of item', () => {
        const list = new PythonList([1, 2, 3, 2]);
        expect(list.index(2)).toBe(1);
        expect(list.index(2, 2)).toBe(3);
    });

    it('index() should throw if item not found', () => {
        const list = new PythonList([1, 2]);
        expect(() => list.index(3)).toThrow();
    });

    it('count() should return number of occurrences', () => {
        const list = new PythonList([1, 2, 3, 2, 2]);
        expect(list.count(2)).toBe(3);
        expect(list.count(5)).toBe(0);
    });

    it('sort() should sort the list', () => {
        const list = new PythonList([3, 1, 2]);
        list.sort();
        expect(list.items).toEqual([1, 2, 3]);

        list.sort(undefined, true);
        expect(list.items).toEqual([3, 2, 1]);
    });

    it('reverse() should reverse the list', () => {
        const list = new PythonList([1, 2, 3]);
        list.reverse();
        expect(list.items).toEqual([3, 2, 1]);
    });

    it('copy() should return a shallow copy', () => {
        const list = new PythonList([1, 2]);
        const copy = list.copy();
        expect(copy.items).toEqual([1, 2]);
        expect(copy).not.toBe(list);
    });
});

describe('PythonDict', () => {
    it('pop() should remove and return value', () => {
        const dict = new PythonDict(['a', 1], ['b', 2]);
        expect(dict.pop('a')).toBe(1);
        expect(dict.a).toBeUndefined();
    });

    it('pop() should return default if key missing', () => {
        const dict = new PythonDict(['a', 1]);
        expect(dict.pop('b', 10)).toBe(10);
    });

    it('pop() should throw if key missing and no default', () => {
        const dict = new PythonDict(['a', 1]);
        expect(() => dict.pop('b')).toThrow();
    });

    it('popitem() should remove and return last item', () => {
        const dict = new PythonDict(['a', 1], ['b', 2]);
        const item = dict.popitem();
        expect(item).toEqual(['b', 2]);
        expect(dict.b).toBeUndefined();
    });

    it('clear() should remove all items', () => {
        const dict = new PythonDict(['a', 1]);
        dict.clear();
        expect(dict.keys().length).toBe(0);
    });

    it('setdefault() should return existing value or set new one', () => {
        const dict = new PythonDict(['a', 1]);
        expect(dict.setdefault('a', 2)).toBe(1);
        expect(dict.a).toBe(1);

        expect(dict.setdefault('b', 2)).toBe(2);
        expect(dict.b).toBe(2);
    });

    it('fromkeys() should create new dict', () => {
        const dict = PythonDict.fromkeys(['a', 'b'], 1);
        expect(dict.a).toBe(1);
        expect(dict.b).toBe(1);
    });

    it('keys(), values(), items() should return correct arrays', () => {
        const dict = new PythonDict(['a', 1], ['b', 2]);
        expect(dict.keys().sort()).toEqual(['a', 'b']);
        expect(dict.values().sort()).toEqual([1, 2]);
        // items returns array of arrays, simplified check
        const items = dict.items().sort((a, b) => a[0].localeCompare(b[0]));
        expect(items).toEqual([['a', 1], ['b', 2]]);
    });

    it('get() should return value or default', () => {
        const dict = new PythonDict(['a', 1]);
        expect(dict.get('a')).toBe(1);
        expect(dict.get('b')).toBeUndefined();
        expect(dict.get('b', 'default')).toBe('default');
    });

    it('update() should merge dictionaries', () => {
        const dict = new PythonDict(['a', 1]);
        const other = new PythonDict(['b', 2]);
        dict.update(other);
        expect(dict.a).toBe(1);
        expect(dict.b).toBe(2);

        dict.update({ c: 3 });
        expect(dict.c).toBe(3);
    });
});

import { PythonSet, PythonTuple } from './interpreter';

describe('PythonSet', () => {
    it('should initialize correctly', () => {
        const set1 = new PythonSet([1, 2, 3]);
        expect(set1.items.has(1)).toBe(true);
        expect(set1.items.size).toBe(3);

        const set2 = new PythonSet("hello");
        expect(set2.items.has('h')).toBe(true);
        expect(set2.items.size).toBe(4); // h, e, l, o
    });

    it('add() should add item', () => {
        const set = new PythonSet();
        set.add(1);
        expect(set.items.has(1)).toBe(true);
    });

    it('remove() should remove item', () => {
        const set = new PythonSet([1]);
        set.remove(1);
        expect(set.items.has(1)).toBe(false);
    });

    it('remove() should throw if item missing', () => {
        const set = new PythonSet();
        expect(() => set.remove(1)).toThrow();
    });

    it('discard() should remove item without error', () => {
        const set = new PythonSet([1]);
        set.discard(1);
        expect(set.items.has(1)).toBe(false);
        set.discard(2); // No error
    });

    it('pop() should remove and return item', () => {
        const set = new PythonSet([1]);
        expect(set.pop()).toBe(1);
        expect(set.items.size).toBe(0);
    });

    it('operations should work correctly', () => {
        const s1 = new PythonSet([1, 2]);
        const s2 = new PythonSet([2, 3]);

        const union = s1.union(s2);
        expect(union.items.size).toBe(3);
        expect(union.items.has(1)).toBe(true);
        expect(union.items.has(2)).toBe(true);
        expect(union.items.has(3)).toBe(true);

        const intersection = s1.intersection(s2);
        expect(intersection.items.size).toBe(1);
        expect(intersection.items.has(2)).toBe(true);

        const diff = s1.difference(s2);
        expect(diff.items.size).toBe(1);
        expect(diff.items.has(1)).toBe(true);

        const symDiff = s1.symmetric_difference(s2);
        expect(symDiff.items.size).toBe(2);
        expect(symDiff.items.has(1)).toBe(true);
        expect(symDiff.items.has(3)).toBe(true);
    });

    it('subset/superset', () => {
        const s1 = new PythonSet([1, 2]);
        const s2 = new PythonSet([1, 2, 3]);

        expect(s1.issubset(s2)).toBe(true);
        expect(s2.issuperset(s1)).toBe(true);
        expect(s2.issubset(s1)).toBe(false);
    });

    it('clear() should remove all items', () => {
        const s = new PythonSet([1, 2]);
        s.clear();
        expect(s.items.size).toBe(0);
    });

    it('copy() should create a shallow copy', () => {
        const s1 = new PythonSet([1, 2]);
        const s2 = s1.copy();
        expect(s2).not.toBe(s1); // Different reference
        expect(s2.items.size).toBe(2);
        expect(s2.items.has(1)).toBe(true);
        expect(s2.items.has(2)).toBe(true);

        s1.add(3);
        expect(s2.items.has(3)).toBe(false); // Should not affect copy
    });
});

describe('PythonTuple', () => {
    it('should initialize correctly', () => {
        const t1 = new PythonTuple([1, 2]);
        expect(t1.items).toEqual([1, 2]);

        const t2 = new PythonTuple("hi");
        expect(t2.items).toEqual(['h', 'i']);
    });

    it('index() should return index', () => {
        const t = new PythonTuple([1, 2, 2]);
        expect(t.index(2)).toBe(1);
    });

    it('count() should return count', () => {
        const t = new PythonTuple([1, 2, 2]);
        expect(t.count(2)).toBe(2);
    });

    it('should be immutable (no push/pop)', () => {
        const t = new PythonTuple([1]);
        expect((t as any).push).toBeUndefined();
        expect((t as any).pop).toBeUndefined();
    });
});

import { executeCode } from './interpreter';

describe('Python String Methods', () => {
    // Helper to execute code and check last output
    const run = (code: string) => {
        const result = executeCode(code, 'python');
        if (result.hasError) throw new Error(result.errorMessage);
        return result.output[result.output.length - 1];
    };

    it('upper/lower should transform string', () => {
        expect(run('print("HeLLo".lower())')).toBe("hello");
        expect(run('print("hello".upper())')).toBe("HELLO");
    });

    it('strip/lstrip/rstrip should remove chars', () => {
        expect(run('print("  hello  ".strip())')).toBe("hello");
        expect(run('print("--hello--".strip("-"))')).toBe("hello");
        expect(run('print("  hello  ".lstrip())')).toBe("hello  ");
        expect(run('print("  hello  ".rstrip())')).toBe("  hello");
    });

    it('split should split string', () => {
        expect(run('print("a b c".split())')).toBe("['a', 'b', 'c']");
        expect(run('print("a,b,c".split(","))')).toBe("['a', 'b', 'c']");
        expect(run('print("a,b,c".split(",", 1))')).toBe("['a', 'b,c']");
    });

    it('join should join iterable', () => {
        expect(run('print("-".join(["a", "b"]))')).toBe("a-b");
    });

    it('replace should replace substring', () => {
        expect(run('print("hello".replace("l", "L"))')).toBe("heLLo");
        expect(run('print("hello".replace("l", "L", 1))')).toBe("heLlo");
    });

    it('find/count should work', () => {
        expect(run('print("hello".find("l"))')).toBe("2");
        expect(run('print("hello".count("l"))')).toBe("2");
        expect(run('print("hello".find("z"))')).toBe("-1");
    });

    it('startswith/endswith should work', () => {
        expect(run('print("hello".startswith("he"))')).toBe("true");
        expect(run('print("hello".endswith("lo"))')).toBe("true");
    });

    it('format should replace placeholders', () => {
        expect(run('print("Hello {}!".format("World"))')).toBe("Hello World!");
        expect(run('print("{} + {} = {}".format(1, 2, 3))')).toBe("1 + 2 = 3");
    });
});

describe('JavaScript Execution', () => {
    // Helper to execute code and check outputs
    const runJS = (code: string) => {
        const result = executeCode(code, 'javascript');
        if (result.hasError) throw new Error(result.errorMessage);
        return result.output;
    };

    it('should support Map and Classes (LRU Cache)', () => {
        const code = `
class Node {
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this.next = null;
    this.prev = null;
  }
}

class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.map = new Map(); // Stores key -> Node
    
    // Dummy nodes to make list manipulation easier
    this.head = new Node(0, 0);
    this.tail = new Node(0, 0);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  // Remove a node from its current position in the linked list
  _remove(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  // Add a node right after the head (Most Recently Used position)
  _add(node) {
    node.next = this.head.next;
    node.prev = this.head;
    this.head.next.prev = node;
    this.head.next = node;
  }

  get(key) {
    if (this.map.has(key)) {
      const node = this.map.get(key);
      this._remove(node); // Move to front
      this._add(node);
      return node.value;
    }
    return -1;
  }

  put(key, value) {
    if (this.map.has(key)) {
      this._remove(this.map.get(key));
    }
    
    const newNode = new Node(key, value);
    this.map.set(key, newNode);
    this._add(newNode);

    if (this.map.size > this.capacity) {
      // Remove the Least Recently Used (node before tail)
      const lru = this.tail.prev;
      this._remove(lru);
      this.map.delete(lru.key);
    }
  }
}

// --- Example Usage ---
const cache = new LRUCache(2);
cache.put(1, 1);
cache.put(2, 2);
console.log(cache.get(1)); // returns 1 (1 is now MRU)
cache.put(3, 3);           // evicts key 2 (LRU)
console.log(cache.get(2)); // returns -1 (not found)
`;
        const output = runJS(code);
        expect(output).toEqual(['1', '-1']);
    });
});
