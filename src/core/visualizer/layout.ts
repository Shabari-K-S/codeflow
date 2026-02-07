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

// (Duplicate dagre layout removed)


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


// Robust Layout: Internal Component Layout (Dagre)
import dagre from 'dagre';

export function layoutComponent(nodes: FlowNode[], edges: FlowEdge[]): LayoutNode[] {
    if (nodes.length === 0) return [];

    const g = new dagre.graphlib.Graph();
    g.setGraph({
        rankdir: 'TB',
        nodesep: 50,    // Reduced from 120
        ranksep: 50,    // Reduced from 100
        edgesep: 10,    // Reduced from 40
        marginx: 20,
        marginy: 20,
        ranker: 'network-simplex'
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add nodes
    nodes.forEach(node => {
        g.setNode(node.id, {
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            label: node.label
        });
    });

    // Add edges
    edges.forEach(edge => {
        let weight = 1;
        let minlen = 1;

        if (edge.type === 'true') weight = 5;
        if (edge.type === 'loop-back' || edge.type === 'recursive') {
            weight = 0;
            minlen = 2;
        }

        g.setEdge(edge.source, edge.target, {
            weight,
            minlen,
            label: edge.type,
            // Custom data to pass through Dagre
            edgeObj: edge
        });
    });

    dagre.layout(g);

    // Update nodes with positions
    // AND capture edge control points

    // Edges with points need to be updated in the original array reference if possible, 
    // or we return them? 
    // The current signature returns LayoutNode[].
    // Ideally we should return { nodes: LayoutNode[], edges: FlowEdge[] } or update edges in place.
    // Since we pass `edges` object references, we can attach points to them.

    edges.forEach(edge => {
        const dagreEdge = g.edge(edge.source, edge.target);
        if (dagreEdge && dagreEdge.points) {
            // Attach points to the edge object (requires updating FlowEdge type or adding dynamic prop)
            (edge as any).points = dagreEdge.points;
        }
    });

    return nodes.map(n => {
        const node = g.node(n.id);
        return {
            ...n,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            column: 0,
            row: 0
        };
    });
}

// Global Layout: Vertical Stacking of Components
export function identifyComponents(inputNodes: FlowNode[], inputEdges: FlowEdge[]): FlowComponent[] {
    if (inputNodes.length === 0) return [];

    // Remove merge nodes
    const { nodes, edges } = removeMergeNodes(inputNodes, inputEdges);

    // 1. Group nodes into "Scopes" (ignoring calls)
    const neighbors = new Map<string, string[]>();
    nodes.forEach(n => neighbors.set(n.id, []));
    edges.forEach(e => {
        if (e.type !== 'call' && e.type !== 'recursive') {
            neighbors.get(e.source)?.push(e.target);
            neighbors.get(e.target)?.push(e.source);
        }
    });

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

    // 2. Layout each component independently
    const flowComponents: FlowComponent[] = [];

    // Sort: Start Node containing component FIRST, then functions
    components.sort((a, b) => {
        const aStart = a.some(id => nodes.find(n => n.id === id)?.type === 'start');
        const bStart = b.some(id => nodes.find(n => n.id === id)?.type === 'start');
        if (aStart) return -1;
        if (bStart) return 1;
        return 0;
    });

    let currentOffsetX = 0;
    // Dynamic padding: Reduced significanty
    const padding = 100;

    components.forEach(componentIds => {
        const componentNodes = nodes.filter(n => componentIds.includes(n.id));
        const componentEdges = edges.filter(e => componentIds.includes(e.source) && componentIds.includes(e.target));

        const layout = layoutComponent(componentNodes, componentEdges);
        if (layout.length === 0) return;

        // Calculate bounding box centered at 0,0 locally
        const minX = Math.min(...layout.map(n => n.x - n.width / 2));
        const maxX = Math.max(...layout.map(n => n.x + n.width / 2));
        const minY = Math.min(...layout.map(n => n.y - n.height / 2));
        const maxY = Math.max(...layout.map(n => n.y + n.height / 2));

        const width = maxX - minX;
        const height = maxY - minY;

        // Center locally
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        layout.forEach(n => {
            n.x -= centerX;
            n.y -= centerY;
        });

        // Adjust edge points to match the center offset!
        componentEdges.forEach(edge => {
            if ((edge as any).points) {
                (edge as any).points.forEach((p: any) => {
                    p.x -= centerX;
                    p.y -= centerY;
                });
            }
        });

        const title = determineTitle(componentNodes);

        // Position Horizontally (Side-by-Side)
        // All components positioned with top at Y=0
        // Dynamic routing handles any relative position when dragged
        const yOffset = height / 2;

        flowComponents.push({
            id: componentNodes[0].id,
            nodes: layout,
            edges: componentEdges,
            x: currentOffsetX + width / 2,
            y: yOffset,
            width,
            height,
            title
        });

        currentOffsetX += width + padding;
    });

    return flowComponents;
}

function determineTitle(nodes: FlowNode[]): string {
    const startNode = nodes.find(n => n.type === 'start');
    if (startNode) return 'Main Execution';

    const funcNode = nodes.find(n => n.type === 'function');
    if (funcNode) {
        let name = funcNode.label.replace('function ', '').replace('()', '');
        if (name.includes('.')) return `Method: ${name}`;
        return `Function: ${name}`;
    }
    return 'Sub-process';
}


// Generate Edge Path
export function generateEdgePath(
    source: LayoutNode,
    target: LayoutNode,
    edgeType: string = 'normal',
    edgePoints?: { x: number, y: number }[] // NEW: Optional points from Dagre
): string {

    // --- CASE 0: Internal Edges using Dagre Points ---
    // If points are provided, use them directly for a smooth, natural flow
    if (edgePoints && edgePoints.length > 0) {
        // Dagre points include start, bends, and end.
        // We can use a Basis Curve or Monotone X/Y to make it smooth.
        // Or simple linear segments with L.

        // Construct path: M start L p1 L p2 ... L end
        // Or better: M start C ...
        // Let's us basic linear for now, or simple curve interpolation if needed.
        // Dagre's points are usually the "bends".

        let path = `M ${edgePoints[0].x} ${edgePoints[0].y}`;

        if (edgePoints.length === 2) {
            // Straight line
            path += ` L ${edgePoints[1].x} ${edgePoints[1].y}`;
        } else {
            // Multi-segment: use Curve Basis for smoothness?
            // Or just lines. Dagre's ortho routing gives "Taxicab" like points.
            for (let i = 1; i < edgePoints.length; i++) {
                path += ` L ${edgePoints[i].x} ${edgePoints[i].y}`;
            }
        }
        return path;
    }


    // --- CASE 1: CALL EDGES (Smooth Bezier) ---
    // User requested "professional" curve for long jumps
    const isCall = edgeType === 'call';
    if (isCall) {
        const sourceBottom = { x: source.x, y: source.y + source.height / 2 };
        const targetTop = { x: target.x, y: target.y - target.height / 2 };

        const dy = targetTop.y - sourceBottom.y;


        // Control Points for Cubic Bezier
        // Curve out downwards, then curve in downwards
        // Handles both forward and backward calls gracefully

        const controlYOffset = Math.max(Math.abs(dy) * 0.5, 100);

        const cp1 = { x: sourceBottom.x, y: sourceBottom.y + controlYOffset };
        const cp2 = { x: targetTop.x, y: targetTop.y - controlYOffset };

        // If backward call (target above), push controls further out to loop around?
        // Or just S-curve.

        return `M ${sourceBottom.x} ${sourceBottom.y} 
                C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${targetTop.x} ${targetTop.y}`;
    }

    // --- FALLBACK: Standard / Manual Routing ---
    // (Used if no points provided, e.g. cross-component edges without points)

    return generateEdgePathLegacy(source, target);
}

// Rename the old function to keep as fallback
function generateEdgePathLegacy(
    source: LayoutNode,
    target: LayoutNode
): string {
    const dx = target.x - source.x;

    const sourceBottom = { x: source.x, y: source.y + source.height / 2 };
    const targetTop = { x: target.x, y: target.y - target.height / 2 };

    // Quick straight line for simple cases
    if (Math.abs(dx) < 2) {
        return `M ${sourceBottom.x} ${sourceBottom.y} L ${targetTop.x} ${targetTop.y}`;
    }

    // Standard Z-Shape
    const r = 12;
    const midY = (source.y + source.height / 2 + target.y - target.height / 2) / 2;
    const signX = target.x > source.x ? 1 : -1;

    return `M ${sourceBottom.x} ${sourceBottom.y}
            L ${sourceBottom.x} ${midY - r}
            Q ${sourceBottom.x} ${midY}, ${sourceBottom.x + r * signX} ${midY}
            L ${targetTop.x - r * signX} ${midY}
            Q ${targetTop.x} ${midY}, ${targetTop.x} ${midY + r}
            L ${targetTop.x} ${targetTop.y}`;
}
