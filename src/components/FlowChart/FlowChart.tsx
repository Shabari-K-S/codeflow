import { useMemo, useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../stores/store';
import type { FlowNode, FlowEdge } from '../../types';
import './FlowChart.css';

const NODE_WIDTH = 180;
const NODE_HEIGHT = 56;
const HORIZONTAL_SPACING = 140; // Increased from 80
const VERTICAL_SPACING = 100;   // Increased from 70

interface LayoutNode extends FlowNode {
    x: number;
    y: number;
    width: number;
    height: number;
    column: number;
    row: number;
}

// Improved layout algorithm with component separation
function layoutNodes(nodes: FlowNode[], edges: FlowEdge[]): LayoutNode[] {
    if (nodes.length === 0) return [];

    // 1. Build adjacency graph for component detection (ignoring call edges)
    const neighbors = new Map<string, string[]>();
    nodes.forEach(n => neighbors.set(n.id, []));
    edges.forEach(e => {
        if (e.type !== 'call') {
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

    // 3. Layout each component independently
    const allLayoutNodes: LayoutNode[] = [];
    let currentOffsetY = 0;

    // Sort components: 'Start' component first, then by size
    components.sort((a, b) => {
        const aHasStart = a.some(id => nodes.find(n => n.id === id)?.type === 'start');
        const bHasStart = b.some(id => nodes.find(n => n.id === id)?.type === 'start');
        if (aHasStart) return -1;
        if (bHasStart) return 1;
        return b.length - a.length;
    });

    components.forEach(componentIds => {
        const componentNodes = nodes.filter(n => componentIds.includes(n.id));
        const componentEdges = edges.filter(e => componentIds.includes(e.source) && componentIds.includes(e.target));

        // Internal layout for component
        const layout = layoutComponent(componentNodes, componentEdges);

        // Calculate component bounds
        const minY = Math.min(...layout.map(n => n.y));
        const maxY = Math.max(...layout.map(n => n.y));
        const height = maxY - minY + NODE_HEIGHT + VERTICAL_SPACING;

        // Shift component to correct vertical position
        layout.forEach(n => {
            n.y += currentOffsetY;
        });

        allLayoutNodes.push(...layout);
        currentOffsetY += height;
    });

    return allLayoutNodes;
}

// Layout a single connected component
function layoutComponent(nodes: FlowNode[], edges: FlowEdge[]): LayoutNode[] {
    // Build adjacency lists (ignoring call edges)
    const outgoing = new Map<string, string[]>();
    nodes.forEach(n => outgoing.set(n.id, []));
    edges.forEach(e => {
        if (e.type !== 'loop-back' && e.type !== 'call') {
            outgoing.get(e.source)?.push(e.target);
        }
    });

    // Assign rows using BFS
    const rows = new Map<string, number>();

    // Find root(s) - nodes with no incoming edges or Start/Function types
    const incomingCounts = new Map<string, number>();
    nodes.forEach(n => incomingCounts.set(n.id, 0));
    edges.forEach(e => {
        if (e.type !== 'loop-back' && e.type !== 'call') {
            incomingCounts.set(e.target, (incomingCounts.get(e.target) || 0) + 1);
        }
    });

    const roots = nodes.filter(n =>
        (incomingCounts.get(n.id) === 0) ||
        n.type === 'start' ||
        n.type === 'function'
    );

    const queue: { id: string; row: number }[] = roots.map(r => ({ id: r.id, row: 0 }));
    const visited = new Set<string>(roots.map(r => r.id));
    roots.forEach(r => rows.set(r.id, 0));

    // Also handle cycles by including unvisited nodes if needed, but BFS usually covers reachable
    // We iterate until queue empty
    while (queue.length > 0) {
        const { id, row } = queue.shift()!;

        outgoing.get(id)?.forEach(targetId => {
            // Only update if not strictly visited or if we found a longer path (longest path layering)
            if (!visited.has(targetId) || (rows.get(targetId)! < row + 1)) {
                visited.add(targetId);
                rows.set(targetId, row + 1);
                queue.push({ id: targetId, row: row + 1 });
            }
        });
    }

    // Handle any unreachable nodes (should be rare in connected component but safe to handle)
    nodes.forEach(n => {
        if (!rows.has(n.id)) rows.set(n.id, 0);
    });

    // Group by row
    const rowGroups = new Map<number, FlowNode[]>();
    nodes.forEach(node => {
        const row = rows.get(node.id) || 0;
        if (!rowGroups.has(row)) rowGroups.set(row, []);
        rowGroups.get(row)!.push(node);
    });

    // Basic Barycenter heuristic-ish: sort nodes in row based on parent positions
    // ... For now, plain center layout per row is decent if components are separated

    const layoutNodes: LayoutNode[] = [];
    const maxRow = Math.max(...Array.from(rows.values()));

    for (let row = 0; row <= maxRow; row++) {
        const group = rowGroups.get(row) || [];
        // Center the row
        const totalWidth = group.length * NODE_WIDTH + (group.length - 1) * HORIZONTAL_SPACING;
        const startX = -totalWidth / 2 + NODE_WIDTH / 2;

        group.forEach((node, index) => {
            layoutNodes.push({
                ...node,
                x: startX + index * (NODE_WIDTH + HORIZONTAL_SPACING),
                y: row * (NODE_HEIGHT + VERTICAL_SPACING),
                width: NODE_WIDTH,
                height: NODE_HEIGHT,
                column: index,
                row,
            });
        });
    }

    return layoutNodes;
}

// Generate smooth curved path between nodes
function generateEdgePath(
    source: LayoutNode,
    target: LayoutNode,
    isLoopBack: boolean
): string {
    const sourceX = source.x;
    const sourceY = source.y + source.height / 2;
    const targetX = target.x;
    const targetY = target.y - target.height / 2;

    if (isLoopBack) {
        // Loop back curve on the left side
        const offset = 60;
        const controlX = Math.min(source.x, target.x) - offset;
        return `M ${source.x - source.width / 2} ${source.y}
            Q ${controlX} ${source.y},
              ${controlX} ${(source.y + target.y) / 2}
            Q ${controlX} ${target.y},
              ${target.x - target.width / 2} ${target.y}`;
    }

    // Straight down
    if (Math.abs(sourceX - targetX) < 5) {
        return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
    }

    // Curved connection for branching
    const midY = (sourceY + targetY) / 2;
    return `M ${sourceX} ${sourceY}
          C ${sourceX} ${midY},
            ${targetX} ${midY},
            ${targetX} ${targetY}`;
}

function getNodeGradient(type: string): [string, string] {
    switch (type) {
        case 'start':
            return ['#22c55e', '#16a34a'];
        case 'end':
            return ['#ef4444', '#dc2626'];
        case 'decision':
            return ['#f59e0b', '#d97706'];
        case 'loop':
            return ['#3b82f6', '#2563eb'];
        case 'function':
            return ['#a855f7', '#9333ea'];
        case 'call':
            return ['#ec4899', '#db2777'];
        case 'return':
            return ['#f97316', '#ea580c'];
        default:
            return ['#475569', '#334155'];
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
    const { flowGraph, trace, currentStepIndex } = useStore();

    const currentLine = useMemo(() => {
        if (trace && currentStepIndex >= 0 && currentStepIndex < trace.steps.length) {
            return trace.steps[currentStepIndex].lineNumber;
        }
        return -1;
    }, [trace, currentStepIndex]);

    const layoutedNodes = useMemo(() => {
        if (!flowGraph) return [];
        return layoutNodes(flowGraph.nodes, flowGraph.edges);
    }, [flowGraph]);

    const svgRef = useRef<SVGSVGElement>(null);
    const gRef = useRef<SVGGElement>(null);

    // Initial Zoom / Center logic
    useEffect(() => {
        if (!svgRef.current || !gRef.current || layoutedNodes.length === 0) return;

        const svg = d3.select(svgRef.current);
        const g = d3.select(gRef.current);

        const zoom = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                g.attr('transform', event.transform);
            });

        svg.call(zoom);

        // Calculate bounding box of the graph
        const padding = 80;
        const minX = Math.min(...layoutedNodes.map(n => n.x - n.width / 2)) - padding;
        const maxX = Math.max(...layoutedNodes.map(n => n.x + n.width / 2)) + padding;
        const minY = Math.min(...layoutedNodes.map(n => n.y - n.height / 2)) - padding;
        const maxY = Math.max(...layoutedNodes.map(n => n.y + n.height / 2)) + padding;

        const graphWidth = maxX - minX;
        const graphHeight = maxY - minY;
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;

        // Get SVG dimensions
        const { width: svgWidth, height: svgHeight } = svgRef.current.getBoundingClientRect();

        // Calculate initial scale to fit
        const scale = Math.min(
            1,
            Math.min(svgWidth / graphWidth, svgHeight / graphHeight) * 0.9
        );

        // Center the graph
        const initialTransform = d3.zoomIdentity
            .translate(svgWidth / 2, svgHeight / 2)
            .scale(scale)
            .translate(-midX, -midY);

        svg.call(zoom.transform, initialTransform);

    }, [layoutedNodes]);

    if (!flowGraph) {
        return (
            <div className="flowchart flowchart--empty">
                <div className="flowchart__placeholder">
                    <div className="flowchart__placeholder-icon">
                        <svg viewBox="0 0 100 100" width="80" height="80">
                            <rect x="10" y="10" width="30" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                            <line x1="25" y1="30" x2="25" y2="45" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                            <polygon points="25,50 15,70 35,70" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                            <line x1="15" y1="70" x2="15" y2="85" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                            <line x1="35" y1="70" x2="35" y2="85" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                            <rect x="60" y="40" width="30" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                            <line x1="75" y1="60" x2="75" y2="80" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                            <ellipse cx="75" cy="90" rx="15" ry="8" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
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
            </div>

            <svg
                ref={svgRef}
                className="flowchart__svg"
                style={{ cursor: 'grab', width: '100%', height: '100%' }}
            >
                <defs>
                    {/* Gradients for each node type */}
                    {['start', 'end', 'decision', 'loop', 'function', 'call', 'return', 'process'].map(type => {
                        const [color1, color2] = getNodeGradient(type);
                        return (
                            <linearGradient key={type} id={`gradient-${type}`} x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor={color1} />
                                <stop offset="100%" stopColor={color2} />
                            </linearGradient>
                        );
                    })}

                    {/* Active gradient */}
                    <linearGradient id="gradient-active" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#60a5fa" />
                        <stop offset="100%" stopColor="#3b82f6" />
                    </linearGradient>

                    {/* Arrow markers */}
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

                    {/* Shadow filter */}
                    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="4" stdDeviation="6" floodOpacity="0.3" />
                    </filter>

                    {/* Glow filter for active node */}
                    <filter id="glow-active" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="8" result="blur" />
                        <feFlood floodColor="#3b82f6" floodOpacity="0.6" result="color" />
                        <feComposite in="color" in2="blur" operator="in" result="shadow" />
                        <feMerge>
                            <feMergeNode in="shadow" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                {/* Background grid */}
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                    <circle cx="20" cy="20" r="1" fill="#334155" opacity="0.3" />
                </pattern>
                <rect x="-50000" y="-50000" width="100000" height="100000" fill="url(#grid)" />

                <g ref={gRef}>
                    {/* Edges */}
                    <g className="edges">
                        {flowGraph.edges.map(edge => {
                            const source = layoutedNodes.find(n => n.id === edge.source);
                            const target = layoutedNodes.find(n => n.id === edge.target);

                            if (!source || !target) return null;

                            const isLoopBack = edge.type === 'loop-back';
                            const path = generateEdgePath(source, target, isLoopBack);
                            const isActive = source.lineNumber === currentLine || target.lineNumber === currentLine;

                            let strokeColor = '#64748b';
                            let markerEnd = 'url(#arrow)';

                            if (edge.type === 'true') {
                                strokeColor = '#22c55e';
                                markerEnd = 'url(#arrow-true)';
                            } else if (edge.type === 'false') {
                                strokeColor = '#ef4444';
                                markerEnd = 'url(#arrow-false)';
                            } else if (edge.type === 'call') {
                                strokeColor = '#a855f7'; // Purple for function calls
                            } else if (isActive) {
                                strokeColor = '#3b82f6';
                                markerEnd = 'url(#arrow-active)';
                            }

                            // Calculate label position
                            const labelX = (source.x + target.x) / 2 + (isLoopBack ? -40 : 15);
                            const labelY = (source.y + target.y) / 2 + 5;

                            return (
                                <g key={edge.id}>
                                    {/* Edge shadow */}
                                    <path
                                        d={path}
                                        fill="none"
                                        stroke="black"
                                        strokeWidth={3}
                                        opacity={0.1}
                                        transform="translate(1, 2)"
                                    />
                                    {/* Edge line */}
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
                                    {/* Edge label */}
                                    {edge.label && (
                                        <g transform={`translate(${labelX}, ${labelY})`}>
                                            <rect
                                                x="-20"
                                                y="-10"
                                                width="40"
                                                height="18"
                                                rx="9"
                                                fill={edge.type === 'true' ? '#166534' : edge.type === 'false' ? '#991b1b' : '#1e293b'}
                                            />
                                            <text
                                                textAnchor="middle"
                                                dominantBaseline="middle"
                                                fill="white"
                                                fontSize="10"
                                                fontWeight="600"
                                            >
                                                {edge.label}
                                            </text>
                                        </g>
                                    )}
                                </g>
                            );
                        })}
                    </g>

                    {/* Nodes */}
                    <g className="nodes">
                        <AnimatePresence>
                            {layoutedNodes.map((node, index) => {
                                const isActive = node.lineNumber === currentLine && node.lineNumber > 0;
                                const gradientId = isActive ? 'gradient-active' : `gradient-${node.type}`;
                                const icon = getNodeIcon(node.type);

                                // Determine shape based on type
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
                                        {/* Node shape */}
                                        {isOval ? (
                                            <ellipse
                                                cx={node.x}
                                                cy={node.y}
                                                rx={node.width / 2}
                                                ry={node.height / 2}
                                                fill={`url(#${gradientId})`}
                                                stroke={isActive ? '#93c5fd' : 'rgba(255,255,255,0.1)'}
                                                strokeWidth={isActive ? 3 : 1}
                                            />
                                        ) : isDiamond ? (
                                            <polygon
                                                points={`
                            ${node.x} ${node.y - node.height / 2 - 5},
                            ${node.x + node.width / 2 + 10} ${node.y},
                            ${node.x} ${node.y + node.height / 2 + 5},
                            ${node.x - node.width / 2 - 10} ${node.y}
                        `}
                                                fill={`url(#${gradientId})`}
                                                stroke={isActive ? '#93c5fd' : 'rgba(255,255,255,0.1)'}
                                                strokeWidth={isActive ? 3 : 1}
                                            />
                                        ) : (
                                            <rect
                                                x={node.x - node.width / 2}
                                                y={node.y - node.height / 2}
                                                width={node.width}
                                                height={node.height}
                                                rx={12}
                                                fill={`url(#${gradientId})`}
                                                stroke={isActive ? '#93c5fd' : 'rgba(255,255,255,0.1)'}
                                                strokeWidth={isActive ? 3 : 1}
                                            />
                                        )}

                                        {/* Icon */}
                                        <text
                                            x={node.x - node.width / 2 + 18}
                                            y={node.y + 1}
                                            textAnchor="middle"
                                            dominantBaseline="middle"
                                            fill="rgba(255,255,255,0.8)"
                                            fontSize="14"
                                        >
                                            {icon}
                                        </text>

                                        {/* Label */}
                                        <text
                                            x={node.x + 8}
                                            y={node.y}
                                            textAnchor="middle"
                                            dominantBaseline="middle"
                                            fill="white"
                                            fontSize="12"
                                            fontFamily="'JetBrains Mono', monospace"
                                            fontWeight="500"
                                        >
                                            {node.label.length > 16 ? node.label.slice(0, 14) + '…' : node.label}
                                        </text>

                                        {/* Line number badge */}
                                        {node.lineNumber > 0 && (
                                            <g>
                                                <circle
                                                    cx={node.x + node.width / 2 - 8}
                                                    cy={node.y - node.height / 2 + 8}
                                                    r={12}
                                                    fill="#0f172a"
                                                    stroke={isActive ? '#3b82f6' : '#334155'}
                                                    strokeWidth={2}
                                                />
                                                <text
                                                    x={node.x + node.width / 2 - 8}
                                                    y={node.y - node.height / 2 + 9}
                                                    textAnchor="middle"
                                                    dominantBaseline="middle"
                                                    fill={isActive ? '#60a5fa' : '#94a3b8'}
                                                    fontSize="10"
                                                    fontWeight="600"
                                                >
                                                    {node.lineNumber}
                                                </text>
                                            </g>
                                        )}

                                        {/* Active pulse animation */}
                                        {isActive && (
                                            <motion.ellipse
                                                cx={node.x}
                                                cy={node.y}
                                                rx={isOval ? node.width / 2 + 5 : node.width / 2 + 10}
                                                ry={isOval ? node.height / 2 + 5 : node.height / 2 + 10}
                                                fill="none"
                                                stroke="#3b82f6"
                                                strokeWidth={2}
                                                initial={{ opacity: 0.8, scale: 1 }}
                                                animate={{ opacity: 0, scale: 1.2 }}
                                                transition={{ duration: 1, repeat: Infinity }}
                                            />
                                        )}
                                    </motion.g>
                                );
                            })}
                        </AnimatePresence>
                    </g>
                </g>
            </svg>
        </div>
    );
}
