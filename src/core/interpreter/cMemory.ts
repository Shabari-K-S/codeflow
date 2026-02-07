/**
 * C Memory Simulation for CodeFlow
 * 
 * Provides realistic pointer and memory simulation for educational purposes.
 * Tracks heap allocations, supports pointer arithmetic, and detects memory leaks.
 */

// ============================================================================
// Memory Constants
// ============================================================================

const HEAP_START = 0x1000;      // Starting address for heap allocations
const STACK_START = 0x7FFF0000; // Starting address for stack (grows down)
const NULL_PTR = 0x0;           // Null pointer value

// ============================================================================
// Memory Block Types
// ============================================================================

interface MemoryBlock {
    address: number;
    size: number;
    data: any[];
    freed: boolean;
    allocLine: number;      // Line number where allocated
    freeLine?: number;      // Line number where freed (if freed)
    type: string;           // Type of data stored
    stack?: boolean;        // Is this stack memory?
}

interface StackFrame {
    name: string;           // Function name
    baseAddress: number;    // Base address of this frame
    variables: Map<string, { address: number; size: number; type: string }>;
}

// ============================================================================
// CPointer Class
// ============================================================================

/**
 * Simulates a C pointer with address tracking and arithmetic
 */
export class CPointer {
    private _address: number;
    private _type: string;
    private _elementSize: number;

    constructor(type: string, address: number = NULL_PTR) {
        this._type = type.replace('*', '').trim();
        this._address = address;
        this._elementSize = this.getTypeSize(this._type);
    }

    private getTypeSize(type: string): number {
        switch (type.toLowerCase()) {
            case 'char': return 1;
            case 'short': return 2;
            case 'int': case 'float': return 4;
            case 'double': case 'long': return 8;
            default: return 4; // Default to int size
        }
    }

    get address(): number { return this._address; }
    set address(addr: number) { this._address = addr; }

    get type(): string { return this._type; }
    get elementSize(): number { return this._elementSize; }

    get isNull(): boolean { return this._address === NULL_PTR; }

    /**
     * Dereference the pointer (get value at address)
     */
    dereference(memory: CMemory): any {
        if (this.isNull) {
            throw new Error('Null pointer dereference');
        }
        return memory.read(this._address);
    }

    /**
     * Write value through pointer
     */
    write(memory: CMemory, value: any): void {
        if (this.isNull) {
            throw new Error('Null pointer write');
        }
        memory.write(this._address, value);
    }

    /**
     * Pointer arithmetic: p + n
     */
    add(n: number): CPointer {
        return new CPointer(this._type + '*', this._address + (n * this._elementSize));
    }

    /**
     * Pointer arithmetic: p - n
     */
    subtract(n: number): CPointer {
        return new CPointer(this._type + '*', this._address - (n * this._elementSize));
    }

    /**
     * Pointer difference: p1 - p2 (returns number of elements)
     */
    diff(other: CPointer): number {
        return Math.floor((this._address - other._address) / this._elementSize);
    }

    /**
     * Pre-increment: ++p
     */
    preIncrement(): CPointer {
        this._address += this._elementSize;
        return this;
    }

    /**
     * Post-increment: p++
     */
    postIncrement(): CPointer {
        const old = new CPointer(this._type + '*', this._address);
        this._address += this._elementSize;
        return old;
    }

    /**
     * Pre-decrement: --p
     */
    preDecrement(): CPointer {
        this._address -= this._elementSize;
        return this;
    }

    /**
     * Post-decrement: p--
     */
    postDecrement(): CPointer {
        const old = new CPointer(this._type + '*', this._address);
        this._address -= this._elementSize;
        return old;
    }

    /**
     * Array subscript: p[i]
     */
    subscript(memory: CMemory, index: number): any {
        const addr = this._address + (index * this._elementSize);
        return memory.read(addr);
    }

    /**
     * Set value at index: p[i] = value
     */
    setSubscript(memory: CMemory, index: number, value: any): void {
        const addr = this._address + (index * this._elementSize);
        memory.write(addr, value);
    }

    clone(): CPointer {
        return new CPointer(this._type + '*', this._address);
    }

    toString(): string {
        if (this.isNull) return 'NULL';
        return `0x${this._address.toString(16).toUpperCase()}`;
    }

    toJSON() {
        return {
            address: this._address,
            type: this._type + '*',
            isNull: this.isNull,
            display: this.toString()
        };
    }
}

// ============================================================================
// CMemory Class
// ============================================================================

/**
 * Simulates C memory with heap and stack management
 */
export class CMemory {
    private heap: Map<number, MemoryBlock>;
    private addressToBlock: Map<number, number>; // Maps any address to its block start
    private nextHeapAddress: number;
    private stackFrames: StackFrame[];
    private currentStackAddress: number;
    private allocationHistory: Array<{ action: 'alloc' | 'free'; address: number; size: number; line: number }>;

    constructor() {
        this.heap = new Map();
        this.addressToBlock = new Map();
        this.nextHeapAddress = HEAP_START;
        this.stackFrames = [];
        this.currentStackAddress = STACK_START;
        this.allocationHistory = [];
    }

    // ========================================================================
    // Heap Management
    // ========================================================================

    /**
     * Allocate memory on the heap (malloc)
     */
    malloc(size: number, line: number = 0, type: string = 'void'): number {
        if (size <= 0) {
            return NULL_PTR;
        }

        const address = this.nextHeapAddress;
        const block: MemoryBlock = {
            address,
            size,
            data: new Array(size).fill(0),
            freed: false,
            allocLine: line,
            type
        };

        this.heap.set(address, block);

        // Map all addresses in this block to the block start
        for (let i = 0; i < size; i++) {
            this.addressToBlock.set(address + i, address);
        }

        this.nextHeapAddress += size + 8; // Add padding between allocations
        this.allocationHistory.push({ action: 'alloc', address, size, line });

        return address;
    }

    /**
     * Allocate and zero-initialize memory (calloc)
     */
    calloc(count: number, size: number, line: number = 0, type: string = 'void'): number {
        const totalSize = count * size;
        const address = this.malloc(totalSize, line, type);
        // malloc already initializes to 0, so we're done
        return address;
    }

    /**
     * Reallocate memory (realloc)
     */
    realloc(ptr: number, newSize: number, line: number = 0): number {
        if (ptr === NULL_PTR) {
            return this.malloc(newSize, line);
        }

        if (newSize === 0) {
            this.free(ptr, line);
            return NULL_PTR;
        }

        const block = this.heap.get(ptr);
        if (!block || block.freed) {
            throw new Error(`realloc: invalid pointer 0x${ptr.toString(16)}`);
        }

        // Allocate new block
        const newAddress = this.malloc(newSize, line, block.type);
        const newBlock = this.heap.get(newAddress)!;

        // Copy old data
        const copySize = Math.min(block.size, newSize);
        for (let i = 0; i < copySize; i++) {
            newBlock.data[i] = block.data[i];
        }

        // Free old block
        this.free(ptr, line);

        return newAddress;
    }

    /**
     * Free allocated memory
     */
    free(ptr: number, line: number = 0): boolean {
        if (ptr === NULL_PTR) {
            return true; // free(NULL) is valid in C
        }

        const block = this.heap.get(ptr);
        if (!block) {
            throw new Error(`free: invalid pointer 0x${ptr.toString(16)}`);
        }

        if (block.stack) {
            throw new Error(`Invalid free: cannot free stack memory at 0x${ptr.toString(16)}`);
        }

        if (block.freed) {
            throw new Error(`double free detected at address 0x${ptr.toString(16)}`);
        }

        block.freed = true;
        block.freeLine = line;
        this.allocationHistory.push({ action: 'free', address: ptr, size: block.size, line });

        return true;
    }

    // ========================================================================
    // Memory Access
    // ========================================================================

    /**
     * Read value from memory
     */
    read(address: number, offset: number = 0): any {
        const targetAddr = address + offset;
        const blockStart = this.addressToBlock.get(targetAddr);

        if (blockStart === undefined) {
            throw new Error(`Segmentation fault: read from invalid address 0x${targetAddr.toString(16)}`);
        }

        const block = this.heap.get(blockStart)!;

        if (block.freed) {
            throw new Error(`Use after free: reading from freed memory at 0x${targetAddr.toString(16)}`);
        }

        const index = targetAddr - blockStart;
        if (index < 0 || index >= block.size) {
            throw new Error(`Buffer overflow: read at index ${index} of block size ${block.size}`);
        }

        return block.data[index];
    }

    /**
     * Write value to memory
     */
    write(address: number, value: any, offset: number = 0): void {
        const targetAddr = address + offset;
        const blockStart = this.addressToBlock.get(targetAddr);

        if (blockStart === undefined) {
            throw new Error(`Segmentation fault: write to invalid address 0x${targetAddr.toString(16)}`);
        }

        const block = this.heap.get(blockStart)!;

        if (block.freed) {
            throw new Error(`Use after free: writing to freed memory at 0x${targetAddr.toString(16)}`);
        }

        const index = targetAddr - blockStart;
        if (index < 0 || index >= block.size) {
            throw new Error(`Buffer overflow: write at index ${index} of block size ${block.size}`);
        }

        block.data[index] = value;
    }

    /**
     * Get type of memory block at address
     */
    getType(address: number): string {
        const blockStart = this.addressToBlock.get(address);
        if (blockStart === undefined) return 'void';
        const block = this.heap.get(blockStart);
        return block ? block.type : 'void';
    }

    /**
     * Read multiple values (for arrays)
     */
    readArray(address: number, count: number): any[] {
        const result: any[] = [];
        for (let i = 0; i < count; i++) {
            result.push(this.read(address, i));
        }
        return result;
    }

    /**
     * Write multiple values (for arrays)
     */
    writeArray(address: number, values: any[]): void {
        for (let i = 0; i < values.length; i++) {
            this.write(address, values[i], i);
        }
    }

    // ========================================================================
    // Stack Management
    // ========================================================================

    /**
     * Push a new stack frame (function call)
     */
    pushFrame(functionName: string): StackFrame {
        const frame: StackFrame = {
            name: functionName,
            baseAddress: this.currentStackAddress,
            variables: new Map()
        };
        this.stackFrames.push(frame);
        return frame;
    }

    /**
     * Pop the current stack frame (function return)
     */
    popFrame(): StackFrame | undefined {
        const frame = this.stackFrames.pop();
        if (frame) {
            // Cleanup stack memory blocks
            frame.variables.forEach(v => {
                this.heap.delete(v.address);
                for (let i = 0; i < v.size; i++) {
                    this.addressToBlock.delete(v.address + i);
                }
            });

            this.currentStackAddress = frame.baseAddress;
        }
        return frame;
    }

    /**
     * Allocate a stack variable
     */
    allocStackVariable(name: string, type: string, size: number): number {
        if (this.stackFrames.length === 0) {
            this.pushFrame('global');
        }

        const frame = this.stackFrames[this.stackFrames.length - 1];
        this.currentStackAddress -= size;

        const address = this.currentStackAddress;

        frame.variables.set(name, {
            address,
            size,
            type
        });

        // Create Memory Block for Stack Variable
        const block: MemoryBlock = {
            address,
            size,
            data: new Array(size).fill(0),
            freed: false,
            allocLine: 0,
            type,
            stack: true
        };
        this.heap.set(address, block);
        for (let i = 0; i < size; i++) {
            this.addressToBlock.set(address + i, address);
        }

        return address;
    }

    // ========================================================================
    // Memory Analysis
    // ========================================================================

    /**
     * Get all memory leaks (allocated but not freed)
     */
    getLeaks(): Array<{ address: number; size: number; line: number }> {
        const leaks: Array<{ address: number; size: number; line: number }> = [];

        this.heap.forEach((block) => {
            if (block.stack) return;
            if (!block.freed) {
                leaks.push({
                    address: block.address,
                    size: block.size,
                    line: block.allocLine
                });
            }
        });

        return leaks;
    }

    /**
     * Get heap state for visualization
     */
    getHeapState(): Array<{
        address: number;
        size: number;
        freed: boolean;
        type: string;
        data: any[];
        allocLine: number;
        freeLine?: number;
    }> {
        const blocks: Array<{
            address: number;
            size: number;
            freed: boolean;
            type: string;
            data: any[];
            allocLine: number;
            freeLine?: number;
        }> = [];

        this.heap.forEach((block) => {
            if (block.stack) return;
            blocks.push({
                address: block.address,
                size: block.size,
                freed: block.freed,
                type: block.type,
                data: [...block.data],
                allocLine: block.allocLine,
                freeLine: block.freeLine
            });
        });

        // Sort by address
        return blocks.sort((a, b) => a.address - b.address);
    }

    /**
     * Get stack state for visualization
     */
    getStackState(): Array<{
        functionName: string;
        variables: Array<{ name: string; address: number; type: string }>;
    }> {
        return this.stackFrames.map(frame => ({
            functionName: frame.name,
            variables: Array.from(frame.variables.entries()).map(([name, info]) => ({
                name,
                address: info.address,
                type: info.type
            }))
        }));
    }

    /**
     * Get allocation history
     */
    getAllocationHistory() {
        return [...this.allocationHistory];
    }

    /**
     * Get total allocated bytes (not freed)
     */
    getTotalAllocated(): number {
        let total = 0;
        this.heap.forEach((block) => {
            if (block.stack) return;
            if (!block.freed) {
                total += block.size;
            }
        });
        return total;
    }

    /**
     * Get total freed bytes
     */
    getTotalFreed(): number {
        let total = 0;
        this.heap.forEach((block) => {
            if (block.stack) return;
            if (block.freed) {
                total += block.size;
            }
        });
        return total;
    }

    /**
     * Check if an address is valid and accessible
     */
    isValidAddress(address: number): boolean {
        if (address === NULL_PTR) return false;
        const blockStart = this.addressToBlock.get(address);
        if (blockStart === undefined) return false;
        const block = this.heap.get(blockStart);
        return block !== undefined && !block.freed;
    }

    /**
     * Reset memory state
     */
    reset(): void {
        this.heap.clear();
        this.addressToBlock.clear();
        this.nextHeapAddress = HEAP_START;
        this.stackFrames = [];
        this.currentStackAddress = STACK_START;
        this.allocationHistory = [];
    }

    /**
     * Get memory summary for display
     */
    getSummary(): {
        heapBlocks: number;
        activeBlocks: number;
        freedBlocks: number;
        totalAllocated: number;
        leakCount: number;
        leakBytes: number;
    } {
        let activeBlocks = 0;
        let freedBlocks = 0;
        let leakBytes = 0;

        this.heap.forEach((block) => {
            if (block.freed) {
                freedBlocks++;
            } else {
                activeBlocks++;
                leakBytes += block.size;
            }
        });

        return {
            heapBlocks: this.heap.size,
            activeBlocks,
            freedBlocks,
            totalAllocated: this.getTotalAllocated() + this.getTotalFreed(),
            leakCount: activeBlocks,
            leakBytes
        };
    }
}

// ============================================================================
// Address-of Operator Helpers
// ============================================================================

/**
 * Create a pointer from a variable address
 * Note: This is called by the interpreter when processing &variable
 * The actual address comes from the stack frame
 */
export function addressOf(type: string, address: number): CPointer {
    return new CPointer(type, address);
}

// ============================================================================
// Exports
// ============================================================================

export const NULL = NULL_PTR;
export const HEAP_BASE = HEAP_START;
export const STACK_BASE = STACK_START;
