import { useMemo, useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../stores/store';
import type { FlowNode, FlowEdge } from '../../types';
import './FlowChart.css';

const NODE_WIDTH = 180;
const NODE_HEIGHT = 56;
const HORIZONTAL_SPACING = 140;
const VERTICAL_SPACING = 100;

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

    while (queue.length > 0) {
        const { id, row } = queue.shift()!;

        outgoing.get(id)?.forEach(targetId => {
            if (!visited.has(targetId) || (rows.get(targetId)! < row + 1)) {
                visited.add(targetId);
                rows.set(targetId, row + 1);
                queue.push({ id: targetId, row: row + 1 });
            }
        });
    }

    nodes.forEach(n => {
        if (!rows.has(n.id)) rows.set(n.id, 0);
    });

    const rowGroups = new Map<number, FlowNode[]>();
    nodes.forEach(node => {
        const row = rows.get(node.id) || 0;
        if (!rowGroups.has(row)) rowGroups.set(row, []);
        rowGroups.get(row)!.push(node);
    });

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

// Improved layout algorithm with component separation
function identifyComponents(nodes: FlowNode[], edges: FlowEdge[]): FlowComponent[] {
    if (nodes.length === 0) return [];

    // 1. Build adjacency for component detection
    const neighbors = new Map<string, string[]>();
    nodes.forEach(n => neighbors.set(n.id, []));
    edges.forEach(e => {
        // We include call edges here if we want them in the same component?
        // Usually, separate functions should be separate components.
        // So we IGNORE call edges for connectivity.
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

    // 3. Layout each component independently and pack them
    const flowComponents: FlowComponent[] = [];

    // Sort components: 'Start' first
    components.sort((a, b) => {
        const aHasStart = a.some(id => nodes.find(n => n.id === id)?.type === 'start');
        const bHasStart = b.some(id => nodes.find(n => n.id === id)?.type === 'start');
        if (aHasStart) return -1;
        if (bHasStart) return 1;
        return b.length - a.length;
    });

    let currentOffsetY = 0;
    const padding = 100;

    components.forEach(componentIds => {
        const componentNodes = nodes.filter(n => componentIds.includes(n.id));
        const componentEdges = edges.filter(e => componentIds.includes(e.source) && componentIds.includes(e.target));

        const layout = layoutComponent(componentNodes, componentEdges);

        const minX = Math.min(...layout.map(n => n.x - n.width / 2));
        const maxX = Math.max(...layout.map(n => n.x + n.width / 2));
        const minY = Math.min(...layout.map(n => n.y - n.height / 2));
        const maxY = Math.max(...layout.map(n => n.y + n.height / 2));

        const width = maxX - minX;
        const height = maxY - minY;

        // Center the component internally around (0,0) or keep it relative? 
        // We will assign an initial global position for the COMPONENT.
        // And the nodes will be relative to that component's position.

        // Let's say the component position is the center of the component.
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        // Adjust node positions to be relative to the component center
        layout.forEach(n => {
            n.x -= centerX;
            n.y -= centerY;
        });

        // Current Offset Strategy: Stack them vertically for initial layout
        // The component's initial position will be (0, currentOffsetY + height/2)
        const compX = 0;
        const compY = currentOffsetY + height / 2;

        flowComponents.push({
            id: componentNodes[0].id, // stable id for the component
            nodes: layout,
            edges: componentEdges,
            x: compX,
            y: compY,
            width,
            height
        });

        currentOffsetY += height + padding;
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

    if (Math.abs(sourceX - targetX) < 5) {
        return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
    }

    const midY = (sourceY + targetY) / 2;
    return `M ${sourceX} ${sourceY}
          C ${sourceX} ${midY},
            ${targetX} ${midY},
            ${targetX} ${targetY}`;
}

function getNodeGradient(type: string): [string, string] {
    switch (type) {
        case 'start': return ['#22c55e', '#16a34a'];
        case 'end': return ['#ef4444', '#dc2626'];
        case 'decision': return ['#f59e0b', '#d97706'];
        case 'loop': return ['#3b82f6', '#2563eb'];
        case 'function': return ['#a855f7', '#9333ea'];
        case 'call': return ['#ec4899', '#db2777'];
        case 'return': return ['#f97316', '#ea580c'];
        default: return ['#475569', '#334155'];
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

    // State for component positions: { [componentId]: {x, y} }
    const [positions, setPositions] = useState<Record<string, { x: number, y: number }>>({});
    const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);

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
            const group = d3.select(`#component-${comp.id}`);
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

                    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="4" stdDeviation="6" floodOpacity="0.3" result="shadow" />
                    </filter>
                    <filter id="glow-active" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="8" result="blur" />
                        <feFlood floodColor="#3b82f6" floodOpacity="0.6" result="color" />
                        <feComposite in="color" in2="blur" operator="in" result="shadow" />
                        <feMerge>
                            <feMergeNode in="shadow" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                    <filter id="selected-glow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#60a5fa" floodOpacity="0.5" />
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
                                {/* Selection Highlight Box */}
                                {isSelected && (
                                    <rect
                                        x={-comp.width / 2 - 20}
                                        y={-comp.height / 2 - 20}
                                        width={comp.width + 40}
                                        height={comp.height + 40}
                                        fill="none"
                                        stroke="#3b82f6"
                                        strokeWidth="2"
                                        strokeDasharray="5,5"
                                        rx="10"
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
                                            const isActive = node.lineNumber === currentLine && node.lineNumber > 0;
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
