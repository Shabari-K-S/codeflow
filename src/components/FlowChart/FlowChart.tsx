import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../stores/store';
import type { FlowNode, FlowEdge } from '../../types';
import './FlowChart.css';

const NODE_WIDTH = 180;
const NODE_HEIGHT = 56;
const HORIZONTAL_SPACING = 80;
const VERTICAL_SPACING = 70;

interface LayoutNode extends FlowNode {
    x: number;
    y: number;
    width: number;
    height: number;
    column: number;
    row: number;
}

// Improved layout algorithm
function layoutNodes(nodes: FlowNode[], edges: FlowEdge[]): LayoutNode[] {
    if (nodes.length === 0) return [];

    // Build adjacency lists
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();

    nodes.forEach(n => {
        outgoing.set(n.id, []);
        incoming.set(n.id, []);
    });

    edges.forEach(e => {
        if (e.type !== 'loop-back') {
            outgoing.get(e.source)?.push(e.target);
            incoming.get(e.target)?.push(e.source);
        }
    });

    // Assign rows using BFS from start node
    const rows = new Map<string, number>();
    const visited = new Set<string>();

    // Find start node
    const startNode = nodes.find(n => n.type === 'start');
    if (!startNode) {
        // Fallback: use first node
        const queue: { id: string; row: number }[] = [{ id: nodes[0].id, row: 0 }];
        while (queue.length > 0) {
            const { id, row } = queue.shift()!;
            if (visited.has(id)) continue;
            visited.add(id);
            rows.set(id, Math.max(rows.get(id) || 0, row));

            outgoing.get(id)?.forEach(targetId => {
                if (!visited.has(targetId)) {
                    queue.push({ id: targetId, row: row + 1 });
                }
            });
        }
    } else {
        const queue: { id: string; row: number }[] = [{ id: startNode.id, row: 0 }];
        while (queue.length > 0) {
            const { id, row } = queue.shift()!;
            if (visited.has(id)) {
                // Update row if new path is longer
                if (row > (rows.get(id) || 0)) {
                    rows.set(id, row);
                }
                continue;
            }
            visited.add(id);
            rows.set(id, row);

            outgoing.get(id)?.forEach(targetId => {
                queue.push({ id: targetId, row: row + 1 });
            });
        }
    }

    // Handle unvisited nodes (like separate function declarations)
    nodes.forEach(n => {
        if (!rows.has(n.id)) {
            rows.set(n.id, 0);
        }
    });

    // Group nodes by row
    const rowGroups = new Map<number, FlowNode[]>();
    nodes.forEach(node => {
        const row = rows.get(node.id) || 0;
        if (!rowGroups.has(row)) {
            rowGroups.set(row, []);
        }
        rowGroups.get(row)!.push(node);
    });

    // Position nodes - center each row
    const layoutNodes: LayoutNode[] = [];
    const maxRow = Math.max(...Array.from(rows.values()));

    for (let row = 0; row <= maxRow; row++) {
        const group = rowGroups.get(row) || [];
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

    const viewBox = useMemo(() => {
        if (layoutedNodes.length === 0) {
            return '-300 -50 600 400';
        }

        const padding = 80;
        const minX = Math.min(...layoutedNodes.map(n => n.x - n.width / 2)) - padding;
        const maxX = Math.max(...layoutedNodes.map(n => n.x + n.width / 2)) + padding;
        const minY = Math.min(...layoutedNodes.map(n => n.y - n.height / 2)) - padding;
        const maxY = Math.max(...layoutedNodes.map(n => n.y + n.height / 2)) + padding;

        return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
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

            <svg viewBox={viewBox} className="flowchart__svg">
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
                <rect x="-2000" y="-2000" width="4000" height="4000" fill="url(#grid)" />

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
            </svg>
        </div>
    );
}
