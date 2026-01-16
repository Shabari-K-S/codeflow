import { useMemo, useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../stores/store';
import type { FlowNode, FlowEdge } from '../../types';
import './FlowChart.css';

const NODE_WIDTH = 140;
const NODE_HEIGHT = 44;
const HORIZONTAL_SPACING = 160;
const VERTICAL_SPACING = 70;

interface LayoutNode extends FlowNode {
    x: number;
    y: number;
    width: number;
    height: number;
    column: number;
    row: number;
}

interface FlowComponent {
    id: string; // ID of the first node or similar stable ID
    nodes: LayoutNode[];
    edges: FlowEdge[]; // internal edges
    x: number;
    y: number;
    width: number;
    height: number;
    title: string;
}

// Simple BFS-based layout that assigns rows and spreads nodes horizontally
function layoutComponent(nodes: FlowNode[], edges: FlowEdge[]): LayoutNode[] {
    if (nodes.length === 0) return [];


    // Build outgoing edges map (excluding loop-back and recursive)
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    nodes.forEach(n => {
        outgoing.set(n.id, []);
        incoming.set(n.id, []);
    });

    edges.forEach(e => {
        if (e.type !== 'loop-back' && e.type !== 'recursive' && e.type !== 'call') {
            outgoing.get(e.source)?.push(e.target);
            incoming.get(e.target)?.push(e.source);
        }
    });

    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // Robust Layout: Assign rows using Topological Sort (Kahn's Algorithm)
    // This naturally handles cycles by breaking them when necessary
    const nodeRows = new Map<string, number>();

    // Copy incoming degrees for processing
    const inDegrees = new Map<string, number>();
    nodes.forEach(n => inDegrees.set(n.id, incoming.get(n.id)?.length || 0));

    let queue = nodes.filter(n => (inDegrees.get(n.id) || 0) === 0);
    let currentRow = 0;

    // Safety limit to prevent infinite loops (should strictly not happen with this algo, but safe guard)
    let processedCount = 0;
    const totalNodes = nodes.length;

    while (processedCount < totalNodes) {
        if (queue.length === 0) {
            // Cycle detected! 
            // We have nodes left but no roots (all have incoming edges).
            // Break a cycle: pick a node with lowest in-degree (heuristic) and force it processable
            const remaining = nodes.filter(n => !nodeRows.has(n.id));
            if (remaining.length === 0) break; // Should not happen if count logic is right

            // Sort by lowest rank/degree heuristic
            remaining.sort((a, b) => (inDegrees.get(a.id) || 0) - (inDegrees.get(b.id) || 0));

            // Force process the first one (treat incoming edges as back-edges)
            queue.push(remaining[0]);
            // (We don't need to manually decrement parent degrees for the 'broken' edges because
            // we are just forcing this node to be placed at the current level)
        }

        const nextQueue: FlowNode[] = [];

        // Process current level
        for (const node of queue) {
            if (nodeRows.has(node.id)) continue; // Already processed

            nodeRows.set(node.id, currentRow);
            processedCount++;

            const children = outgoing.get(node.id) || [];
            children.forEach(childId => {
                const currentDegree = inDegrees.get(childId) || 0;
                inDegrees.set(childId, currentDegree - 1);

                if (currentDegree - 1 === 0) {
                    // Find node object
                    const childNode = nodeMap.get(childId);
                    if (childNode) nextQueue.push(childNode);
                }
            });
        }

        // Move to next row
        queue = nextQueue;
        currentRow++;
    }

    // --- X-Positioning using "Parent-Guided" heuristic ---

    // Initial State: X=0 for everyone
    const nodeX = new Map<string, number>();
    nodes.forEach(n => nodeX.set(n.id, 0));

    // Get max row index
    let maxRow = 0;
    nodeRows.forEach(r => maxRow = Math.max(maxRow, r));

    // Process row by row
    for (let r = 1; r <= maxRow; r++) {
        const rowNodes = nodes.filter(n => nodeRows.get(n.id) === r);

        // 1. Calculate Ideal X based on parents
        const idealX = new Map<string, number>();

        rowNodes.forEach(node => {
            const parents = incoming.get(node.id) || [];
            if (parents.length === 0) {
                idealX.set(node.id, 0);
                return;
            }

            let weightedSum = 0;
            let weightTotal = 0;

            parents.forEach(pid => {
                const parentX = nodeX.get(pid) || 0;
                // Find edge type
                const edge = edges.find(e => e.source === pid && e.target === node.id);

                if (edge?.type === 'false') {
                    // False branches: Try to push right
                    weightedSum += (parentX + NODE_WIDTH + HORIZONTAL_SPACING);
                    weightTotal += 1;
                } else if (edge?.type === 'true') {
                    // True branches: Try to keep straight
                    weightedSum += parentX;
                    weightTotal += 2; // Stronger pull
                } else {
                    // Normal/other
                    weightedSum += parentX;
                    weightTotal += 1;
                }
            });

            idealX.set(node.id, weightTotal > 0 ? weightedSum / weightTotal : 0);
        });

        // 2. Sort by Ideal X to determine relative order
        rowNodes.sort((a, b) => (idealX.get(a.id) || 0) - (idealX.get(b.id) || 0));

        // 3. Place nodes avoiding overlap
        // We'll place them as close to Ideal X as possible while maintaining Min Distance
        const minDistance = NODE_WIDTH + HORIZONTAL_SPACING;

        // Simple sweep: Start from left-most ideal, ensure gap from previous
        // This can be improved by a center-out sweep, but let's try strict left-to-right first
        // actually, left-to-right from sort order is safest

        for (let i = 0; i < rowNodes.length; i++) {
            const node = rowNodes[i];
            let x = idealX.get(node.id) || 0;

            if (i > 0) {
                const prevNode = rowNodes[i - 1];
                const prevX = nodeX.get(prevNode.id)!;
                const minX = prevX + minDistance;
                if (x < minX) x = minX;
            }
            nodeX.set(node.id, x);
        }

        // 4. Center the entire row relative to 0?
        // Or Center relative to parent group?
        // If we just pushed everything right, the graph drifts right.
        // Let's re-center the row based on the average X of the *parents* of this row?
        // No, simpler: Center the row around 0 to keep the graph balanced.
        if (rowNodes.length > 0) {
            const currentMin = nodeX.get(rowNodes[0].id)!;
            const currentMax = nodeX.get(rowNodes[rowNodes.length - 1].id)!;
            const rowCenter = (currentMin + currentMax) / 2;
            const shift = -rowCenter; // Shift so center becomes 0

            rowNodes.forEach(n => {
                nodeX.set(n.id, nodeX.get(n.id)! + shift);
            });
        }
    }

    // Convert to LayoutNode
    return nodes.map(n => {
        return {
            ...n,
            x: nodeX.get(n.id) || 0,
            y: (nodeRows.get(n.id) || 0) * (NODE_HEIGHT + VERTICAL_SPACING),
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            column: 0,
            row: nodeRows.get(n.id) || 0
        };
    });
}


// Remove passthrough nodes by redirecting edges around them
function removeMergeNodes(nodes: FlowNode[], edges: FlowEdge[]): { nodes: FlowNode[], edges: FlowEdge[] } {
    // Identify passthrough nodes to remove
    const isPassthrough = (n: FlowNode) => {
        const l = n.label.toLowerCase().trim();
        return l === 'merge' || l === 'loop exit' || l === '.' || l === '';
    };

    const passthroughIds = new Set(nodes.filter(isPassthrough).map(n => n.id));

    if (passthroughIds.size === 0) {
        return { nodes, edges };
    }

    // Build edge maps - include ALL edge types except call/recursive
    const outEdgeMap = new Map<string, FlowEdge>();
    edges.forEach(e => {
        if (e.type !== 'call' && e.type !== 'recursive') {
            // Only store first outgoing edge per node (for bypass)
            if (!outEdgeMap.has(e.source)) {
                outEdgeMap.set(e.source, e);
            }
        }
    });

    // Find final target for a passthrough node (follow chains)
    // Returns target ID and whether any edge in the chain was a loop-back
    function getFinalTarget(nodeId: string, visited: Set<string>): { target: string, isLoopBack: boolean } | null {
        if (visited.has(nodeId)) return null; // Cycle
        visited.add(nodeId);

        const outEdge = outEdgeMap.get(nodeId);
        if (!outEdge) return null;

        // Check if this hop is a loop-back
        const isCurrentLoopBack = outEdge.type === 'loop-back';

        if (passthroughIds.has(outEdge.target)) {
            const result = getFinalTarget(outEdge.target, visited);
            if (result) {
                return {
                    target: result.target,
                    isLoopBack: isCurrentLoopBack || result.isLoopBack
                };
            }
            return null;
        }
        return { target: outEdge.target, isLoopBack: isCurrentLoopBack };
    }

    // Determine which nodes can be removed (have valid final targets)
    const removableIds = new Set<string>();
    const resolvedTargets = new Map<string, { target: string, isLoopBack: boolean }>();

    for (const nodeId of passthroughIds) {
        const result = getFinalTarget(nodeId, new Set());
        if (result) {
            removableIds.add(nodeId);
            resolvedTargets.set(nodeId, result);
        }
    }

    if (removableIds.size === 0) {
        return { nodes, edges };
    }

    // Create bypass edges
    const newEdges: FlowEdge[] = [];
    const edgesToRemove = new Set<string>();
    const createdBypasses = new Set<string>(); // Prevent duplicates

    for (const nodeId of removableIds) {
        const resolved = resolvedTargets.get(nodeId)!;

        // Find all edges coming INTO this node
        const incoming = edges.filter(e => e.target === nodeId && e.type !== 'call' && e.type !== 'recursive');

        for (const inEdge of incoming) {
            // Skip if source is also being removed
            if (removableIds.has(inEdge.source)) {
                edgesToRemove.add(inEdge.id);
                continue;
            }

            // Include type and label in key to preserve distinct edges (e.g. True AND False paths)
            const bypassKey = `${inEdge.source}:${resolved.target}:${inEdge.type}:${inEdge.label}`;

            if (!createdBypasses.has(bypassKey)) {
                createdBypasses.add(bypassKey);

                // Preserve loop-back type!
                // If the incoming, outgoing, or chain was a loop-back, the new edge must be a loop-back
                // to avoid creating cycles in the DAG layout.
                let newType = inEdge.type;
                if ((!newType || newType === 'normal') && resolved.isLoopBack) {
                    newType = 'loop-back';
                }

                newEdges.push({
                    id: `bypass_${inEdge.source}_${resolved.target}_${inEdge.type}`,
                    source: inEdge.source,
                    target: resolved.target,
                    type: newType,
                    label: inEdge.label,
                });
            }
            edgesToRemove.add(inEdge.id);
        }

        // Remove outgoing edges from this node (using our map is safer/faster)
        const outEdge = outEdgeMap.get(nodeId);
        if (outEdge) edgesToRemove.add(outEdge.id);
    }

    return {
        nodes: nodes.filter(n => !removableIds.has(n.id)),
        edges: [...edges.filter(e => !edgesToRemove.has(e.id)), ...newEdges],
    };
}


// Improved layout algorithm with component separation
function identifyComponents(inputNodes: FlowNode[], inputEdges: FlowEdge[]): FlowComponent[] {
    if (inputNodes.length === 0) return [];

    // Remove merge nodes by redirecting edges around them
    const { nodes, edges } = removeMergeNodes(inputNodes, inputEdges);

    // 1. Build adjacency for component detection
    const neighbors = new Map<string, string[]>();
    nodes.forEach(n => neighbors.set(n.id, []));
    edges.forEach(e => {
        // We include call edges here if we want them in the same component?
        // Usually, separate functions should be separate components.
        // So we IGNORE call edges for connectivity.
        // Also ignore recursive edges to avoid grouping recursive functions with themselves if logic is weird
        // AND importantly, ignore edges that point TO a function node, as that's likely a call or metadata connection
        // We want function definitions to be ISOLATED roots.

        // Find the target node type
        const targetNode = nodes.find(n => n.id === e.target);
        const isTargetFunction = targetNode?.type === 'function';

        if (e.type !== 'call' && e.type !== 'recursive' && !isTargetFunction) {
            neighbors.get(e.source)?.push(e.target);
            neighbors.get(e.target)?.push(e.source);
        }
    });

    // 2. Find connected components
    const components: string[][] = [];
    const visited = new Set<string>();

    nodes.forEach(node => {
        if (!visited.has(node.id)) {
            const component: string[] = [];
            const queue = [node.id];
            visited.add(node.id);

            while (queue.length > 0) {
                const current = queue.shift()!;
                component.push(current);

                neighbors.get(current)?.forEach(neighbor => {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        queue.push(neighbor);
                    }
                });
            }
            components.push(component);
        }
    });

    // 3. Layout each component independently and pack them HORIZONTALLY
    const flowComponents: FlowComponent[] = [];

    // Sort components: 'Start' first, then by size
    components.sort((a, b) => {
        const aHasStart = a.some(id => nodes.find(n => n.id === id)?.type === 'start');
        const bHasStart = b.some(id => nodes.find(n => n.id === id)?.type === 'start');
        if (aHasStart) return -1;
        if (bHasStart) return 1;
        return b.length - a.length;
    });

    let currentOffsetX = 0;
    const padding = 120; // Increased spacing between components

    components.forEach(componentIds => {
        const componentNodes = nodes.filter(n => componentIds.includes(n.id));
        const componentEdges = edges.filter(e => componentIds.includes(e.source) && componentIds.includes(e.target));

        const layout = layoutComponent(componentNodes, componentEdges);
        if (layout.length === 0) return;

        const minX = Math.min(...layout.map(n => n.x - n.width / 2));
        const maxX = Math.max(...layout.map(n => n.x + n.width / 2));
        const minY = Math.min(...layout.map(n => n.y - n.height / 2));
        const maxY = Math.max(...layout.map(n => n.y + n.height / 2));

        const width = maxX - minX;
        const height = maxY - minY;

        // Determine Title
        let title = 'Sub-process';
        const startNode = componentNodes.find(n => n.type === 'start');
        if (startNode) {
            title = 'Main Execution';
        } else {
            // Find root-ish node (0 in-degree roughly, or 'function' type)
            const funcNode = componentNodes.find(n => n.type === 'function');
            if (funcNode) {
                // Formatting "function foo()" -> "Function: foo"
                let name = funcNode.label.replace('function ', '').replace('()', '');
                // Handle "class.method"
                if (name.includes('.')) title = `Method: ${name}`;
                else title = `Function: ${name}`;
            }
        }

        // Center the component internally
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        // Adjust node positions to be relative to the component center
        layout.forEach(n => {
            n.x -= centerX;
            n.y -= centerY;
        });

        // HORIZONTAL placement: Place components side-by-side
        const compX = currentOffsetX + width / 2;
        const compY = 0; // All components aligned at top

        flowComponents.push({
            id: componentNodes[0].id,
            nodes: layout,
            edges: componentEdges,
            x: compX,
            y: compY,
            width,
            height,
            title
        });

        currentOffsetX += width + padding;
    });

    return flowComponents;
}

// Generate smooth curved path - updated to accept offsets
function generateEdgePath(
    source: LayoutNode,
    target: LayoutNode,
    isLoopBack: boolean,
    isRecursive: boolean = false
): string {
    const sourceX = source.x;
    const sourceY = source.y + source.height / 2;
    const targetX = target.x;
    const targetY = target.y - target.height / 2;

    if (isLoopBack) {
        const offset = 60;
        const controlX = Math.min(source.x, target.x) - offset;
        return `M ${source.x - source.width / 2} ${source.y}
            Q ${controlX} ${source.y},
              ${controlX} ${(source.y + target.y) / 2}
            Q ${controlX} ${target.y},
              ${target.x - target.width / 2} ${target.y}`;
    }

    // Recursive call - curve to the right side and loop back up
    if (isRecursive) {
        const offset = 80;
        const controlX = Math.max(source.x, target.x) + source.width / 2 + offset;
        return `M ${source.x + source.width / 2} ${source.y}
            Q ${controlX} ${source.y},
              ${controlX} ${(source.y + target.y) / 2}
            Q ${controlX} ${target.y},
              ${target.x + target.width / 2} ${target.y}`;
    }

    // Smoother Bezier Curves
    if (Math.abs(sourceX - targetX) < 5) {
        return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
    }

    const midY = (sourceY + targetY) / 2;

    // Add logic to avoid overlapping vertical lines
    // If it's a straight drop, use a slight curve? No, straight is fine.

    // For non-straight, use Cubic Bezier with better control points
    return `M ${sourceX} ${sourceY}
          C ${sourceX} ${midY},
            ${targetX} ${midY},
            ${targetX} ${targetY}`;
}

function getNodeGradient(type: string): [string, string] {
    switch (type) {
        case 'start': return ['#4ade80', '#22c55e']; // Bright Green
        case 'end': return ['#f87171', '#ef4444']; // Red
        case 'decision': return ['#fbbf24', '#d97706']; // Amber
        case 'loop': return ['#60a5fa', '#2563eb']; // Blue
        case 'function': return ['#c084fc', '#9333ea']; // Purple
        case 'call': return ['#f472b6', '#db2777']; // Pink
        case 'return': return ['#fb923c', '#ea580c']; // Orange
        default: return ['#94a3b8', '#475569']; // Slate
    }
}

function getNodeIcon(type: string): string {
    switch (type) {
        case 'start': return '▶';
        case 'end': return '⬛';
        case 'decision': return '◇';
        case 'loop': return '↻';
        case 'function': return 'ƒ';
        case 'call': return '→';
        case 'return': return '←';
        default: return '•';
    }
}

export function FlowChart() {
    const { flowGraph, trace, currentStepIndex, playbackState } = useStore();

    // State for component positions: { [componentId]: {x, y} }
    const [positions, setPositions] = useState<Record<string, { x: number, y: number }>>({});
    const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);

    // Check if execution is complete (at last step OR finished state)
    const isAtLastStep = trace && currentStepIndex >= trace.totalSteps - 1;
    const isFinished = playbackState === 'finished' || isAtLastStep;

    const currentLine = useMemo(() => {
        if (trace && currentStepIndex >= 0 && currentStepIndex < trace.steps.length) {
            return trace.steps[currentStepIndex].lineNumber;
        }
        return -1;
    }, [trace, currentStepIndex]);

    // Initial identification of components
    const components = useMemo(() => {
        if (!flowGraph) return [];
        return identifyComponents(flowGraph.nodes, flowGraph.edges);
    }, [flowGraph]);

    // Initialize positions when components change
    useEffect(() => {
        setPositions(prev => {
            const newPositions = { ...prev };
            components.forEach(comp => {
                if (!newPositions[comp.id]) {
                    newPositions[comp.id] = { x: comp.x, y: comp.y };
                }
            });
            return newPositions;
        });
    }, [components]);

    const svgRef = useRef<SVGSVGElement>(null);
    const zoomGroupRef = useRef<SVGGElement>(null);

    // Zoom Logic
    useEffect(() => {
        if (!svgRef.current || !zoomGroupRef.current) return;

        const svg = d3.select(svgRef.current);
        const g = d3.select(zoomGroupRef.current);

        const zoom = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                g.attr('transform', event.transform);
            })
            .filter((event) => {
                if (event.type === 'wheel') return true;
                return !event.target.closest('.draggable-component');
            });

        svg.call(zoom);

        // Initial centering logic
        if (components.length > 0) {
            // Calculate total bounding box
            const padding = 80;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

            components.forEach(comp => {
                // Use current stored position or initial position
                const pos = positions[comp.id] || { x: comp.x, y: comp.y };
                minX = Math.min(minX, pos.x - comp.width / 2);
                maxX = Math.max(maxX, pos.x + comp.width / 2);
                minY = Math.min(minY, pos.y - comp.height / 2);
                maxY = Math.max(maxY, pos.y + comp.height / 2);
            });

            minX -= padding;
            maxX += padding;
            minY -= padding;
            maxY += padding;

            const graphWidth = maxX - minX;
            const graphHeight = maxY - minY;
            const midX = (minX + maxX) / 2;
            const midY = (minY + maxY) / 2;

            const { width: svgWidth, height: svgHeight } = svgRef.current.getBoundingClientRect();

            if (graphWidth > 0 && graphHeight > 0 && svgWidth > 0 && svgHeight > 0) {
                const scale = Math.min(
                    1,
                    Math.min(svgWidth / graphWidth, svgHeight / graphHeight) * 0.9
                );

                const initialTransform = d3.zoomIdentity
                    .translate(svgWidth / 2, svgHeight / 2)
                    .scale(scale)
                    .translate(-midX, -midY);

                svg.call(zoom.transform, initialTransform);
            }
        }

    }, [components, positions]);

    // Drag Logic
    useEffect(() => {
        if (!components.length) return;

        components.forEach(comp => {
            const group = d3.select<SVGGElement, unknown>(`#component-${comp.id}`);
            if (group.empty()) return;

            const drag = d3.drag<SVGGElement, unknown>()
                .on('start', (event) => {
                    setSelectedComponentId(comp.id);
                    d3.select(event.sourceEvent.target).style('cursor', 'grabbing');
                })
                .on('drag', (event) => {
                    setPositions(prev => ({
                        ...prev,
                        [comp.id]: {
                            x: (prev[comp.id]?.x || 0) + event.dx,
                            y: (prev[comp.id]?.y || 0) + event.dy
                        }
                    }));
                })
                .on('end', (event) => {
                    d3.select(event.sourceEvent.target).style('cursor', 'grab');
                });

            group.call(drag);
        });

    }, [components, positions]);

    if (!flowGraph) {
        return (
            <div className="flowchart flowchart--empty">
                <div className="flowchart__placeholder">
                    <div className="flowchart__placeholder-icon">
                        <svg viewBox="0 0 100 100" width="80" height="80">
                            <rect x="10" y="10" width="30" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                            <line x1="25" y1="30" x2="25" y2="45" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                            <polygon points="25,50 15,70 35,70" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                        </svg>
                    </div>
                    <h3>Ready to Visualize</h3>
                    <p>Write code in the editor and click <span className="highlight">Visualize</span> to see the flow</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flowchart">
            <div className="flowchart__toolbar">
                <span className="flowchart__stats">
                    {flowGraph.nodes.length} nodes • {flowGraph.edges.length} edges
                </span>
                <span className="flowchart__hint">
                    Drag components to rearrange
                </span>
            </div>

            <svg
                ref={svgRef}
                className="flowchart__svg"
                style={{ width: '100%', height: '100%' }}
            >
                <defs>
                    {['start', 'end', 'decision', 'loop', 'function', 'call', 'return', 'process'].map(type => {
                        const [color1, color2] = getNodeGradient(type);
                        return (
                            <linearGradient key={type} id={`gradient-${type}`} x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor={color1} />
                                <stop offset="100%" stopColor={color2} />
                            </linearGradient>
                        );
                    })}

                    <linearGradient id="gradient-active" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#60a5fa" />
                        <stop offset="100%" stopColor="#3b82f6" />
                    </linearGradient>

                    <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
                        <path d="M0,0 L12,6 L0,12 L3,6 Z" fill="#64748b" />
                    </marker>
                    <marker id="arrow-active" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
                        <path d="M0,0 L12,6 L0,12 L3,6 Z" fill="#3b82f6" />
                    </marker>
                    <marker id="arrow-true" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
                        <path d="M0,0 L12,6 L0,12 L3,6 Z" fill="#22c55e" />
                    </marker>
                    <marker id="arrow-false" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
                        <path d="M0,0 L12,6 L0,12 L3,6 Z" fill="#ef4444" />
                    </marker>
                    <marker id="arrow-recursive" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
                        <path d="M0,0 L12,6 L0,12 L3,6 Z" fill="#f97316" />
                    </marker>

                    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="4" stdDeviation="6" floodOpacity="0.5" floodColor="#000" result="shadow" />
                    </filter>
                    <filter id="glow-active" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="6" result="blur" />
                        <feFlood floodColor="#60a5fa" floodOpacity="0.8" result="color" />
                        <feComposite in="color" in2="blur" operator="in" result="shadow" />
                        <feMerge>
                            <feMergeNode in="shadow" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                    <filter id="selected-glow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#c084fc" floodOpacity="0.6" />
                    </filter>
                </defs>

                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                    <circle cx="20" cy="20" r="1" fill="#334155" opacity="0.3" />
                </pattern>
                <rect x="-50000" y="-50000" width="100000" height="100000" fill="url(#grid)" />

                <g ref={zoomGroupRef}>

                    {components.map(comp => {
                        const pos = positions[comp.id] || { x: comp.x, y: comp.y };
                        const isSelected = selectedComponentId === comp.id;

                        // Calculate bounding box for dashed border
                        const padding = 40;
                        const boxWidth = comp.width + padding * 2;
                        const boxHeight = comp.height + padding * 2;
                        const boxX = -boxWidth / 2;
                        const boxY = -boxHeight / 2;

                        return (
                            <g
                                key={comp.id}
                                id={`component-${comp.id}`}
                                className="draggable-component"
                                transform={`translate(${pos.x}, ${pos.y})`}
                                style={{ cursor: 'grab' }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedComponentId(comp.id);
                                }}
                            >
                                {/* Component Container Label */}
                                <text
                                    x={boxX}
                                    y={boxY - 15}
                                    fill="#94a3b8"
                                    fontSize="14"
                                    fontWeight="600"
                                    fontFamily="monospace"
                                    letterSpacing="1px"
                                >
                                    {comp.title.toUpperCase()}
                                </text>

                                {/* Component Container Box */}
                                <rect
                                    x={boxX}
                                    y={boxY}
                                    width={boxWidth}
                                    height={boxHeight}
                                    fill="none"
                                    stroke="#334155"
                                    strokeWidth="1"
                                    strokeDasharray="4,4"
                                    rx="16"
                                    pointerEvents="all" // Allow clicking on empty space to drag
                                    opacity="0.5"
                                />

                                {/* Selection Highlight Box (Overlays the container) */}
                                {isSelected && (
                                    <rect
                                        x={boxX - 5}
                                        y={boxY - 5}
                                        width={boxWidth + 10}
                                        height={boxHeight + 10}
                                        fill="none"
                                        stroke="#3b82f6"
                                        strokeWidth="2"
                                        rx="20"
                                        pointerEvents="none"
                                    />
                                )}

                                {/* Edges */}
                                <g className="edges">
                                    {comp.edges.map(edge => {
                                        const source = comp.nodes.find(n => n.id === edge.source);
                                        const target = comp.nodes.find(n => n.id === edge.target);

                                        if (!source || !target) return null;

                                        const isLoopBack = edge.type === 'loop-back';
                                        const isRecursive = edge.type === 'recursive';
                                        const path = generateEdgePath(source, target, isLoopBack, isRecursive);
                                        const isActive = source.lineNumber === currentLine || target.lineNumber === currentLine;

                                        let strokeColor = '#64748b';
                                        let markerEnd = 'url(#arrow)';

                                        if (edge.type === 'true') {
                                            strokeColor = '#22c55e';
                                            markerEnd = 'url(#arrow-true)';
                                        } else if (edge.type === 'false') {
                                            strokeColor = '#ef4444';
                                            markerEnd = 'url(#arrow-false)';
                                        } else if (edge.type === 'recursive') {
                                            strokeColor = '#f97316'; // Orange for recursive calls
                                            markerEnd = 'url(#arrow-recursive)';
                                        } else if (edge.type === 'call') {
                                            strokeColor = '#a855f7'; // Purple for regular calls
                                        } else if (isActive) {
                                            strokeColor = '#3b82f6';
                                            markerEnd = 'url(#arrow-active)';
                                        }

                                        const labelX = (source.x + target.x) / 2 + (isLoopBack ? -40 : isRecursive ? 100 : 15);
                                        const labelY = (source.y + target.y) / 2 + 5;

                                        return (
                                            <g key={edge.id}>
                                                <path
                                                    d={path}
                                                    fill="none"
                                                    stroke="black"
                                                    strokeWidth={3}
                                                    opacity={0.1}
                                                    transform="translate(1, 2)"
                                                />
                                                <motion.path
                                                    d={path}
                                                    fill="none"
                                                    stroke={strokeColor}
                                                    strokeWidth={isActive ? 3 : 2}
                                                    strokeDasharray={edge.type === 'call' ? '5,5' : 'none'}
                                                    strokeLinecap="round"
                                                    markerEnd={markerEnd}
                                                    initial={{ pathLength: 0, opacity: 0 }}
                                                    animate={{ pathLength: 1, opacity: 1 }}
                                                    transition={{ duration: 0.5, delay: 0.1 }}
                                                />
                                                {edge.label && (
                                                    <g transform={`translate(${labelX}, ${labelY})`}>
                                                        <rect x="-20" y="-10" width="40" height="18" rx="9" fill={edge.type === 'true' ? '#166534' : edge.type === 'false' ? '#991b1b' : '#1e293b'} />
                                                        <text textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="10" fontWeight="600">{edge.label}</text>
                                                    </g>
                                                )}
                                            </g>
                                        );
                                    })}
                                </g>

                                {/* Nodes */}
                                <g className="nodes">
                                    <AnimatePresence>
                                        {comp.nodes.map((node, index) => {
                                            // Highlight End node when playback is finished, otherwise highlight by current line
                                            const isEndNodeActive = isFinished && node.type === 'end';
                                            const isLineActive = node.lineNumber === currentLine && node.lineNumber > 0;
                                            const isActive = isEndNodeActive || isLineActive;
                                            const gradientId = isActive ? 'gradient-active' : `gradient-${node.type}`;
                                            const icon = getNodeIcon(node.type);
                                            const isOval = node.type === 'start' || node.type === 'end';
                                            const isDiamond = node.type === 'decision' || node.type === 'loop';

                                            return (
                                                <motion.g
                                                    key={node.id}
                                                    initial={{ opacity: 0, scale: 0.8 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.8 }}
                                                    transition={{ duration: 0.3, delay: index * 0.03 }}
                                                    filter={isActive ? 'url(#glow-active)' : 'url(#shadow)'}
                                                >
                                                    {isOval ? (
                                                        <ellipse cx={node.x} cy={node.y} rx={node.width / 2} ry={node.height / 2} fill={`url(#${gradientId})`} stroke={isActive ? '#93c5fd' : 'rgba(255,255,255,0.1)'} strokeWidth={isActive ? 3 : 1} />
                                                    ) : isDiamond ? (
                                                        <polygon points={`${node.x} ${node.y - node.height / 2 - 5}, ${node.x + node.width / 2 + 10} ${node.y}, ${node.x} ${node.y + node.height / 2 + 5}, ${node.x - node.width / 2 - 10} ${node.y}`} fill={`url(#${gradientId})`} stroke={isActive ? '#93c5fd' : 'rgba(255,255,255,0.1)'} strokeWidth={isActive ? 3 : 1} />
                                                    ) : (
                                                        <rect x={node.x - node.width / 2} y={node.y - node.height / 2} width={node.width} height={node.height} rx={12} fill={`url(#${gradientId})`} stroke={isActive ? '#93c5fd' : 'rgba(255,255,255,0.1)'} strokeWidth={isActive ? 3 : 1} />
                                                    )}
                                                    <text x={node.x - node.width / 2 + 18} y={node.y + 1} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.8)" fontSize="14">{icon}</text>
                                                    <text x={node.x + 8} y={node.y} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="12" fontFamily="'JetBrains Mono', monospace" fontWeight="500">{node.label.length > 16 ? node.label.slice(0, 14) + '…' : node.label}</text>
                                                    {node.lineNumber > 0 && (
                                                        <g>
                                                            <circle cx={node.x + node.width / 2 - 8} cy={node.y - node.height / 2 + 8} r={12} fill="#0f172a" stroke={isActive ? '#3b82f6' : '#334155'} strokeWidth={2} />
                                                            <text x={node.x + node.width / 2 - 8} y={node.y - node.height / 2 + 9} textAnchor="middle" dominantBaseline="middle" fill={isActive ? '#60a5fa' : '#94a3b8'} fontSize="10" fontWeight="600">{node.lineNumber}</text>
                                                        </g>
                                                    )}
                                                    {isActive && (
                                                        <motion.ellipse cx={node.x} cy={node.y} rx={isOval ? node.width / 2 + 5 : node.width / 2 + 10} ry={isOval ? node.height / 2 + 5 : node.height / 2 + 10} fill="none" stroke="#3b82f6" strokeWidth={2} initial={{ opacity: 0.8, scale: 1 }} animate={{ opacity: 0, scale: 1.2 }} transition={{ duration: 1, repeat: Infinity }} />
                                                    )}
                                                </motion.g>
                                            );
                                        })}
                                    </AnimatePresence>
                                </g>
                            </g>
                        );
                    })}
                </g>
            </svg>
        </div>
    );
}
