import { describe, it, expect } from 'vitest';
import { identifyComponents, removeMergeNodes } from './layout';
import type { FlowNode, FlowEdge } from '../../types';

describe('Visualizer Layout', () => {

    // Helper to create nodes
    const createNode = (id: string, type: string = 'process', label: string = 'node'): FlowNode => ({
        id, type: type as any, label: label,
        // add dummy props if FlowNode requires them (FlowChart usually expects x,y but FlowNode might not have them initially?)
        // Let's check type definition if needed. Usually FlowNode in types.ts
    } as any);

    // Helper to create edges
    const createEdge = (source: string, target: string, type: string = 'normal'): FlowEdge => ({
        id: `e_${source}_${target}`,
        source,
        target,
        type: type as any,
        label: ''
    });

    describe('removeMergeNodes', () => {
        it('should return original graph if no merge nodes', () => {
            const nodes = [createNode('1'), createNode('2')];
            const edges = [createEdge('1', '2')];
            const result = removeMergeNodes(nodes, edges);
            expect(result.nodes).toHaveLength(2);
            expect(result.edges).toHaveLength(1);
        });

        it('should remove merge nodes and bypass edges', () => {
            // 1 -> Merge -> 2
            const nodes = [
                createNode('1', 'process'),
                createNode('m', 'process', 'merge'),
                createNode('2', 'process')
            ];
            const edges = [
                createEdge('1', 'm'),
                createEdge('m', '2')
            ];

            const result = removeMergeNodes(nodes, edges);

            expect(result.nodes.map(n => n.id)).toEqual(['1', '2']);
            expect(result.edges).toHaveLength(1);
            expect(result.edges[0].source).toBe('1');
            expect(result.edges[0].target).toBe('2');
        });

        it('should handle chained merge nodes', () => {
            // 1 -> M1 -> M2 -> 2
            const nodes = [
                createNode('1'),
                createNode('m1', 'process', 'merge'),
                createNode('m2', 'process', 'merge'),
                createNode('2')
            ];
            const edges = [
                createEdge('1', 'm1'),
                createEdge('m1', 'm2'),
                createEdge('m2', '2')
            ];

            const result = removeMergeNodes(nodes, edges);
            expect(result.nodes.map(n => n.id)).toEqual(['1', '2']);
            expect(result.edges).toHaveLength(1);
            expect(result.edges[0].source).toBe('1');
            expect(result.edges[0].target).toBe('2');
        });
    });

    describe('identifyComponents', () => {
        it('should return empty list for empty graph', () => {
            const result = identifyComponents([], []);
            expect(result).toEqual([]);
        });

        it('should identify a single connected component', () => {
            const nodes = [createNode('1'), createNode('2')];
            const edges = [createEdge('1', '2')];
            const result = identifyComponents(nodes, edges);

            expect(result).toHaveLength(1);
            expect(result[0].nodes).toHaveLength(2);
        });

        it('should identify disconnected components', () => {
            // 1->2   3->4
            const nodes = [createNode('1'), createNode('2'), createNode('3'), createNode('4')];
            const edges = [createEdge('1', '2'), createEdge('3', '4')];

            const result = identifyComponents(nodes, edges);
            expect(result).toHaveLength(2);
        });
    });
});
