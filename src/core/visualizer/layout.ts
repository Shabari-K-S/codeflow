import type { FlowNode, FlowEdge } from '../../types';

export const NODE_WIDTH = 140;
export const NODE_HEIGHT = 44;
export const HORIZONTAL_SPACING = 160;
export const VERTICAL_SPACING = 70;

export interface LayoutNode extends FlowNode {
    x: number;
    y: number;
    width: number;
    height: number;
    column: number;
    row: number;
}

export interface FlowComponent {
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
export function layoutComponent(nodes: FlowNode[], edges: FlowEdge[]): LayoutNode[] {
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
export function removeMergeNodes(nodes: FlowNode[], edges: FlowEdge[]): { nodes: FlowNode[], edges: FlowEdge[] } {
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
export function identifyComponents(inputNodes: FlowNode[], inputEdges: FlowEdge[]): FlowComponent[] {
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
export function generateEdgePath(
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
