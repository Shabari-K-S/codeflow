import { describe, it, expect } from 'vitest';
import { identifyComponents, removeMergeNodes, generateEdgePath } from './layout';
import type { LayoutNode } from './layout';
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

    describe('generateEdgePath', () => {
        // Mock LayoutNodes
        const nodeA: LayoutNode = {
            id: 'A', x: 100, y: 100, width: 100, height: 40,
            type: 'process', label: 'A', column: 0, row: 0,
            code: '', lineNumber: 0
        };
        const nodeB: LayoutNode = {
            id: 'B', x: 300, y: 300, width: 100, height: 40,
            type: 'process', label: 'B', column: 0, row: 0,
            code: '', lineNumber: 0
        };

        // const nodeC: LayoutNode = {
        //     id: 'C', x: 100, y: 50, width: 100, height: 40,
        //     type: 'process', label: 'C', column: 0, row: 0,
        //     code: '', lineNumber: 0
        // };

        it('should use provided edge points (Dagre) if available', () => {
            // Mock points from Dagre
            const points = [{ x: 100, y: 100 }, { x: 200, y: 200 }, { x: 300, y: 300 }];
            const path = generateEdgePath(nodeA, nodeB, 'normal', points);

            // Should construct path from points
            expect(path).toBe('M 100 100 L 200 200 L 300 300');
        });

        it('should generate Cubic Bezier curve for CALL edges', () => {
            // A(100,100) -> B(300,300)
            const path = generateEdgePath(nodeA, nodeB, 'call');

            // Should contain Bezier command 'C'
            expect(path).toContain('C');
            // Starts at source bottom (100, 120)
            expect(path).toContain('M 100 120');
            // Ends at target top (300, 280)
            // The format is C cp1x cp1y, cp2x cp2y, endx endy
            expect(path).toContain(', 300 280');
        });

        it('should fallback to Z-shape if no points and not call', () => {
            // Standard behavior
            const path = generateEdgePath(nodeA, nodeB, 'normal');
            expect(path).toContain('Q'); // Quadratic curves for rounded corners
            expect(path).not.toContain('C'); // No Cubic Bezier
        });
    });
});
