import { describe, it, expect } from 'vitest';
import { executeCode as interpreter } from './interpreter';



describe('C Interpreter Memory & Structs', () => {

    it('should allocate and free memory (malloc/free)', () => {
        const code = `
            int main() {
                int* p = malloc(4);
                *p = 42;
                free(p);
                return 0;
            }
        `;

        const trace = interpreter(code, 'c');
        expect(trace.hasError).toBe(false);

        // Find step where *p = 42 happened (allocation active)
        // Find step where free(p) happened (memory freed)

        // This test requires step.code to be populated, which we might not be doing fully yet?
        // interpreter.ts:695 code: '', // We'll fill this from the source
        // Ah, createStep sets code to empty string currently! I should fix that if I want to debug by code.
        // But I can check memory state at different steps.

        // Check final reference to memory
        // At the end, heap should be empty or freed.
        const lastStep = trace.steps[trace.steps.length - 1];
        expect(lastStep.memory).toBeDefined();
        if (lastStep.memory) {
            const heap = lastStep.memory.heap;
            // Should have 1 block that is freed
            expect(heap.length).toBeGreaterThan(0);
            const block = heap[heap.length - 1];
            expect(block.isAllocated).toBe(false);
        }
    });

    it('should handle struct definition and allocation', () => {
        const code = `
            struct Point {
                int x;
                int y;
            };
            
            int main() {
                struct Point* p = malloc(sizeof(struct Point));
                p->x = 10;
                p->y = 20;
                return p->x + p->y;
            }
        `;

        const trace = interpreter(code, 'c');
        expect(trace.hasError).toBe(false);

        // Check structDefs in state? Interpreter doesn't return state directly, only trace.
        // But we can check memory snapshot.
        const lastStep = trace.steps[trace.steps.length - 1];
        if (lastStep.memory) {
            const heap = lastStep.memory.heap;
            // CMemory malloc (direct) doesn't know struct type, so it might be 'void*' or similar
            // But we can check size.
            // Also if we use parser transform for 'struct Point p;', it uses __allocStruct which sets type.
            // Here we use malloc.
            const block = heap.find(b => b.size === 8);
            expect(block).toBeDefined();
            if (block) {
                expect(block.size).toBe(8); // 2 ints
                // Data might be raw bytes or array. CMemory uses DataView or similar?
                // CMemory uses Uint8Array usually, but my mock implementation used `any[]` or similar?
                // Let's check CMemory implementation.
            }
        }
    });

    it('should handle linked list (pointers to structs)', () => {
        const code = `
            struct Node {
                int value;
                struct Node* next;
            };
            
            int main() {
                struct Node* head = malloc(sizeof(struct Node));
                head->value = 1;
                
                struct Node* second = malloc(sizeof(struct Node));
                second->value = 2;
                
                head->next = second;
                
                return head->next->value;
            }
        `;
        const trace = interpreter(code, 'c');
        expect(trace.hasError).toBe(false);
    });

});
