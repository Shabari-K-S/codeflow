import { useMemo, useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../stores/store';

import './FlowChart.css';
import { identifyComponents, generateEdgePath } from '../../core/visualizer/layout';



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
