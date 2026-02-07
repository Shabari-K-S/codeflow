import { useMemo, useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../stores/store';

import './FlowChart.css';
import { identifyComponents, generateEdgePath } from '../../core/visualizer/layout';



const NODE_COLORS: Record<string, string> = {
    start: '#4ade80',  // Neon Green
    end: '#f87171',    // Neon Red
    decision: '#fbbf24', // Neon Amber
    loop: '#fbbf24',   // Neon Amber
    function: '#c084fc', // Neon Purple
    call: '#60a5fa',   // Neon Blue
    return: '#f472b6', // Neon Pink
    process: '#94a3b8', // Slate/White
    default: '#94a3b8'
};

function getNodeColor(type: string): string {
    return NODE_COLORS[type] || NODE_COLORS.default;
}

function getNodeIcon(type: string): string {
    switch (type) {
        case 'start': return '▶';
        case 'end': return '■';
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

    // Initialize and Update positions when components change
    // We intentionally overwrite positions on component update to reflect layout algorithm changes.
    // Dragging state is preserved via `positions` only while components remain same reference,
    // but here we want new layout to take precedence if the graph structure/layout changes.
    useEffect(() => {
        setPositions(prev => {
            const newPositions = { ...prev };
            components.forEach(comp => {
                // Always update position to match the layout engine's latest calculation
                // This ensures that when we switch layouts (e.g. to vertical stack), the UI updates.
                newPositions[comp.id] = { x: comp.x, y: comp.y };
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
                    {/* Standard Markers */}
                    <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="#475569" />
                    </marker>
                    <marker id="arrow-active" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="#38bdf8" />
                    </marker>

                    {/* Condition Markers */}
                    <marker id="arrow-true" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="#4ade80" />
                    </marker>
                    <marker id="arrow-false" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="#f87171" />
                    </marker>
                    <marker id="arrow-recursive" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="#fb923c" />
                    </marker>
                    <marker id="arrow-call" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="#c084fc" />
                    </marker>

                    <filter id="neon-glow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="3.5" result="coloredBlur" />
                        <feMerge>
                            <feMergeNode in="coloredBlur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>

                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <circle cx="2" cy="2" r="1" fill="rgba(56, 189, 248, 0.15)" />
                    </pattern>
                </defs>

                <rect x="-50000" y="-50000" width="100000" height="100000" fill="url(#grid)" />

                <g ref={zoomGroupRef}>

                    {/* GLOBAL EDGES (Cross-component connections) */}
                    {flowGraph && (() => {
                        // 1. Identify Global Edges
                        const localEdgeIds = new Set<string>();
                        components.forEach(c => c.edges.forEach(e => localEdgeIds.add(e.id)));
                        const globalEdges = flowGraph.edges.filter(e => !localEdgeIds.has(e.id));

                        // 2. Helper to find node absolute position
                        const getNodeAbsPos = (nodeId: string) => {
                            for (const comp of components) {
                                const node = comp.nodes.find(n => n.id === nodeId);
                                if (node) {
                                    const compPos = positions[comp.id] || { x: comp.x, y: comp.y };
                                    return {
                                        x: compPos.x + node.x,
                                        y: compPos.y + node.y,
                                        width: node.width,
                                        height: node.height,
                                        node,
                                        comp
                                    };
                                }
                            }
                            return null;
                        };

                        // 3. Helper to find function ENTRY node for call edges
                        // This ensures call arrows connect to the top function node, not arbitrary internal node
                        const getFunctionEntryNode = (nodeId: string) => {
                            for (const comp of components) {
                                const hasNode = comp.nodes.find(n => n.id === nodeId);
                                if (hasNode) {
                                    // Find function entry: type='function' or topmost node
                                    const funcEntry = comp.nodes.find(n => n.type === 'function');
                                    if (funcEntry) {
                                        const compPos = positions[comp.id] || { x: comp.x, y: comp.y };
                                        return {
                                            x: compPos.x + funcEntry.x,
                                            y: compPos.y + funcEntry.y,
                                            width: funcEntry.width,
                                            height: funcEntry.height,
                                            node: funcEntry,
                                            comp
                                        };
                                    }
                                    // Fallback: topmost node in component
                                    const topmostNode = comp.nodes.reduce((top, n) =>
                                        n.y < top.y ? n : top, comp.nodes[0]);
                                    const compPos = positions[comp.id] || { x: comp.x, y: comp.y };
                                    return {
                                        x: compPos.x + topmostNode.x,
                                        y: compPos.y + topmostNode.y,
                                        width: topmostNode.width,
                                        height: topmostNode.height,
                                        node: topmostNode,
                                        comp
                                    };
                                }
                            }
                            return null;
                        };

                        return globalEdges.map((edge, index) => {
                            const sourceInfo = getNodeAbsPos(edge.source);
                            // For call edges, target the function entry node for cleaner connection
                            const targetInfo = edge.type === 'call'
                                ? getFunctionEntryNode(edge.target)
                                : getNodeAbsPos(edge.target);

                            if (!sourceInfo || !targetInfo) return null;

                            // Create wrapper objects that mimic Node layout for generateEdgePath
                            // ensuring we pass the absolute coordinates
                            const sourceLayout = { ...sourceInfo.node, x: sourceInfo.x, y: sourceInfo.y };
                            const targetLayout = { ...targetInfo.node, x: targetInfo.x, y: targetInfo.y };

                            const path = generateEdgePath(sourceLayout, targetLayout, edge.type, undefined, index);

                            // Style for Global Edges (usually Calls)
                            const isCall = edge.type === 'call';
                            const strokeColor = isCall ? '#c084fc' : '#94a3b8';
                            const markerEnd = isCall ? 'url(#arrow-call)' : 'url(#arrow)';
                            const strokeDash = isCall ? '6 4' : '4 4';

                            // Label Position - Place on the ACTUAL path, not geometric center
                            // For calls, path goes: source.bottom -> down -> horizontal -> down -> target.top
                            // Put label on the horizontal segment
                            let labelX: number;
                            let labelY: number;

                            if (isCall) {
                                // Horizontal segment is between source and target X
                                // Y is at the level where the path goes horizontal (just below source exit)
                                const sourceBottom = sourceLayout.y + sourceLayout.height / 2;
                                labelX = sourceLayout.x + 40; // Slightly right of source for better visibility
                                labelY = sourceBottom + 30; // Just below source exit point
                            } else {
                                // Default: midpoint
                                labelX = (sourceLayout.x + targetLayout.x) / 2;
                                labelY = (sourceLayout.y + targetLayout.y) / 2;
                            }

                            return (
                                <g key={edge.id} className="global-edge">
                                    <path
                                        d={path}
                                        fill="none"
                                        stroke="#0f172a"
                                        strokeWidth={6}
                                        opacity={0.8}
                                    />
                                    <motion.path
                                        d={path}
                                        fill="none"
                                        stroke={strokeColor}
                                        strokeWidth={2}
                                        strokeDasharray={strokeDash}
                                        strokeLinecap="round"
                                        markerEnd={markerEnd}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: 0.5 }}
                                    />
                                    {edge.label && (
                                        <g transform={`translate(${labelX}, ${labelY})`}>
                                            <rect
                                                x="-24"
                                                y="-10"
                                                width="48"
                                                height="20"
                                                rx="6"
                                                fill="#1e293b"
                                                stroke={strokeColor}
                                                strokeWidth="1"
                                                filter="url(#neon-glow)"
                                            />
                                            <text
                                                textAnchor="middle"
                                                dominantBaseline="middle"
                                                fill={strokeColor}
                                                fontSize="10"
                                                fontWeight="600"
                                                fontFamily="'JetBrains Mono', monospace"
                                            >
                                                {edge.label}
                                            </text>
                                        </g>
                                    )}
                                </g>
                            );
                        });
                    })()}

                    {components.map(comp => {
                        const pos = positions[comp.id] || { x: comp.x, y: comp.y };
                        const isSelected = selectedComponentId === comp.id;

                        // Calculate bounding box for dashed border
                        const padding = 40;
                        const boxWidth = comp.width + padding * 2;
                        const boxHeight = comp.height + padding * 2;

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
                                {/* Component Boundary (Dashed Neon Box) */}
                                <rect
                                    x={-boxWidth / 2}
                                    y={-boxHeight / 2}
                                    width={boxWidth}
                                    height={boxHeight}
                                    fill="rgba(15, 23, 42, 0.4)"
                                    stroke={isSelected ? '#38bdf8' : '#334155'}
                                    strokeWidth={isSelected ? 2 : 1}
                                    strokeDasharray="8 6"
                                    rx="12"
                                    opacity="0.8"
                                />
                                {isSelected && (
                                    <rect
                                        x={-boxWidth / 2}
                                        y={-boxHeight / 2}
                                        width={boxWidth}
                                        height={boxHeight}
                                        fill="none"
                                        stroke="#38bdf8"
                                        strokeWidth="1"
                                        strokeOpacity="0.3"
                                        rx="12"
                                        filter="url(#neon-glow)"
                                    />
                                )}

                                {/* Edges */}
                                <g className="edges">
                                    {comp.edges.map((edge, index) => {
                                        const source = comp.nodes.find(n => n.id === edge.source);
                                        const target = comp.nodes.find(n => n.id === edge.target);

                                        if (!source || !target) return null;

                                        const isLoopBack = edge.type === 'loop-back';
                                        const isRecursive = edge.type === 'recursive';

                                        // Pass index for dynamic call routing offset
                                        // Pass edge points from Dagre layout (if available) for natural routing
                                        const edgePoints = (edge as any).points; // Layout engine attached points

                                        const path = generateEdgePath(
                                            source,
                                            target,
                                            edge.type,
                                            comp.width / 2,
                                            index,
                                            edgePoints // NEW: Pass points
                                        );
                                        const isActive = source.lineNumber === currentLine || target.lineNumber === currentLine;

                                        // Default styles
                                        let strokeColor = '#475569';
                                        let markerEnd = 'url(#arrow)';
                                        let strokeDash = '4 4';

                                        // Conditional styles based on edge type
                                        if (isActive) {
                                            strokeColor = '#38bdf8'; // Active Neon Blue
                                            markerEnd = 'url(#arrow-active)';
                                        } else if (edge.type === 'true') {
                                            strokeColor = '#4ade80'; // Neon Green
                                            markerEnd = 'url(#arrow-true)';
                                        } else if (edge.type === 'false') {
                                            strokeColor = '#f87171'; // Neon Red
                                            markerEnd = 'url(#arrow-false)';
                                        } else if (edge.type === 'recursive') {
                                            strokeColor = '#fb923c'; // Neon Orange
                                            markerEnd = 'url(#arrow-recursive)';
                                        } else if (edge.type === 'call') {
                                            strokeColor = '#c084fc'; // Neon Purple
                                            markerEnd = 'url(#arrow-call)';
                                            strokeDash = '6 4';
                                        }

                                        // Refined Label Positioning (Geometry-Aware)
                                        let labelX = (source.x + target.x) / 2;
                                        let labelY = (source.y + target.y) / 2;

                                        const isVertical = Math.abs(source.x - target.x) < 20;

                                        if (edge.type === 'true') {
                                            // True Branch
                                            if (isVertical) {
                                                // Vertical Flow (e.g. Function Body or straight through)
                                                // Place label slightly below source to signify start of block
                                                labelX = source.x + 20;
                                                labelY = source.y + source.height / 2 + 30;
                                            } else {
                                                // Branching Left
                                                // Path goes Left then Down.
                                                // Push further left to avoid overlap
                                                labelX = source.x - source.width / 2 - 40;
                                                labelY = source.y - 5;
                                            }
                                        } else if (edge.type === 'false') {
                                            // False Branch
                                            if (isVertical) {
                                                // Vertical Flow (unlikely for False, but possible)
                                                labelX = source.x + 20;
                                                labelY = source.y + source.height / 2 + 30;
                                            } else {
                                                // Branching Right
                                                // Push further right to avoid overlap
                                                labelX = source.x + source.width / 2 + 40;
                                                labelY = source.y - 5;
                                            }
                                        } else if (isLoopBack || isRecursive) {
                                            // On the vertical return segment (far right)
                                            labelX = (comp.width / 2) + 50;
                                            // Y is midpoint of loop height
                                            labelY = (source.y + target.y) / 2;
                                        } else {
                                            // Normal
                                            labelX = (source.x + target.x) / 2 + 10;
                                        }

                                        return (
                                            <g key={edge.id}>
                                                {/* Background path for hit detection/visibility */}
                                                <path
                                                    d={path}
                                                    fill="none"
                                                    stroke="#0f172a"
                                                    strokeWidth={6}
                                                    opacity={0.8}
                                                />
                                                <motion.path
                                                    d={path}
                                                    fill="none"
                                                    stroke={strokeColor}
                                                    strokeWidth={isActive ? 2.5 : 2}
                                                    strokeDasharray={strokeDash}
                                                    strokeLinecap="round"
                                                    markerEnd={markerEnd}
                                                    initial={{ strokeDashoffset: 0 }}
                                                    animate={isActive ? { strokeDashoffset: -20 } : { strokeDashoffset: 0 }}
                                                    transition={isActive ? { duration: 1, repeat: Infinity, ease: 'linear' } : {}}
                                                />
                                                {edge.label && (
                                                    <g transform={`translate(${labelX}, ${labelY})`}>
                                                        <rect
                                                            x="-24"
                                                            y="-10"
                                                            width="48"
                                                            height="20"
                                                            rx="6"
                                                            fill="#1e293b"
                                                            stroke={strokeColor}
                                                            strokeWidth="1"
                                                            filter="url(#neon-glow)"
                                                        />
                                                        <text
                                                            textAnchor="middle"
                                                            dominantBaseline="middle"
                                                            fill={strokeColor}
                                                            fontSize="10"
                                                            fontWeight="600"
                                                            fontFamily="'JetBrains Mono', monospace"
                                                        >
                                                            {edge.label}
                                                        </text>
                                                    </g>
                                                )}
                                            </g>
                                        );
                                    })}
                                </g>

                                {/* Nodes (Metoro Cards) */}
                                <g className="nodes">
                                    <AnimatePresence>
                                        {comp.nodes.map((node) => {
                                            const isEndNodeActive = isFinished && node.type === 'end';
                                            const isLineActive = node.lineNumber === currentLine && node.lineNumber > 0;
                                            const isActive = isEndNodeActive || isLineActive;
                                            const color = getNodeColor(node.type);
                                            const icon = getNodeIcon(node.type);

                                            return (
                                                <motion.g
                                                    key={node.id}
                                                    initial={{ opacity: 0, scale: 0.9 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.9 }}
                                                    transition={{ duration: 0.3 }}
                                                >
                                                    {/* Card Body */}
                                                    <rect
                                                        x={node.x - node.width / 2}
                                                        y={node.y - node.height / 2}
                                                        width={node.width}
                                                        height={node.height}
                                                        rx="6"
                                                        fill="#1e293b" // Dark Slate
                                                        stroke={isActive ? color : '#334155'}
                                                        strokeWidth={isActive ? 2 : 1}
                                                        filter={isActive ? 'url(#neon-glow)' : undefined}
                                                    />

                                                    {/* Accent Bar (Left side) */}
                                                    <path
                                                        d={`M ${node.x - node.width / 2} ${node.y - node.height / 2 + 6} 
                                                           L ${node.x - node.width / 2} ${node.y + node.height / 2 - 6}`}
                                                        stroke={color}
                                                        strokeWidth="3"
                                                        strokeLinecap="round"
                                                        transform="translate(4, 0)"
                                                    />

                                                    {/* Icon */}
                                                    <text
                                                        x={node.x - node.width / 2 + 20}
                                                        y={node.y + 1}
                                                        textAnchor="middle"
                                                        dominantBaseline="middle"
                                                        fill={color}
                                                        fontSize="12"
                                                        fontWeight="bold"
                                                    >
                                                        {icon}
                                                    </text>

                                                    {/* Label */}
                                                    <text
                                                        x={node.x + 10}
                                                        y={node.y}
                                                        textAnchor="middle"
                                                        dominantBaseline="middle"
                                                        fill="#f1f5f9"
                                                        fontSize="11"
                                                        fontFamily="'JetBrains Mono', monospace"
                                                        fontWeight="500"
                                                    >
                                                        {node.label.length > 18 ? node.label.slice(0, 16) + '..' : node.label}
                                                    </text>

                                                    {/* Line Number Badge (Right corner) */}
                                                    {node.lineNumber > 0 && (
                                                        <g>
                                                            <circle
                                                                cx={node.x + node.width / 2 - 10}
                                                                cy={node.y - node.height / 2 + 10}
                                                                r="8"
                                                                fill="#0f172a"
                                                                stroke="#334155"
                                                                strokeWidth="1"
                                                            />
                                                            <text
                                                                x={node.x + node.width / 2 - 10}
                                                                y={node.y - node.height / 2 + 11}
                                                                textAnchor="middle"
                                                                dominantBaseline="middle"
                                                                fill="#94a3b8"
                                                                fontSize="9"
                                                            >
                                                                {node.lineNumber}
                                                            </text>
                                                        </g>
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
