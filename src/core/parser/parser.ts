import * as parser from '@babel/parser';
import * as t from '@babel/types';
import type { FlowNode, FlowEdge, FlowGraph, FlowNodeType } from '../../types';

let nodeIdCounter = 0;

function generateNodeId(): string {
    return `node_${++nodeIdCounter}`;
}

function getNodeLabel(node: t.Node): string {
    if (t.isVariableDeclaration(node)) {
        const declarations = node.declarations
            .map(d => {
                const name = t.isIdentifier(d.id) ? d.id.name : 'var';
                return name;
            })
            .join(', ');
        return `${node.kind} ${declarations}`;
    }

    if (t.isFunctionDeclaration(node) && node.id) {
        return `function ${node.id.name}()`;
    }

    if (t.isIfStatement(node)) {
        return 'if (condition)';
    }

    if (t.isForStatement(node)) {
        return 'for loop';
    }

    if (t.isWhileStatement(node)) {
        return 'while loop';
    }

    if (t.isReturnStatement(node)) {
        return 'return';
    }

    if (t.isExpressionStatement(node)) {
        const expr = node.expression;
        if (t.isCallExpression(expr)) {
            if (t.isMemberExpression(expr.callee)) {
                const obj = t.isIdentifier(expr.callee.object) ? expr.callee.object.name : '';
                const prop = t.isIdentifier(expr.callee.property) ? expr.callee.property.name : '';
                return `${obj}.${prop}()`;
            }
            if (t.isIdentifier(expr.callee)) {
                return `${expr.callee.name}()`;
            }
        }
        if (t.isAssignmentExpression(expr)) {
            const left = t.isIdentifier(expr.left) ? expr.left.name : 'var';
            return `${left} = ...`;
        }
    }

    return node.type;
}

function getNodeType(node: t.Node): FlowNodeType {
    if (t.isFunctionDeclaration(node)) return 'function';
    if (t.isIfStatement(node)) return 'decision';
    if (t.isForStatement(node) || t.isWhileStatement(node) || t.isDoWhileStatement(node)) return 'loop';
    if (t.isReturnStatement(node)) return 'return';
    if (t.isExpressionStatement(node)) {
        const expr = node.expression;
        if (t.isCallExpression(expr)) return 'call';
    }
    return 'process';
}

function getCodeForNode(node: t.Node, code: string): string {
    if (node.loc) {
        const lines = code.split('\n');
        const startLine = node.loc.start.line - 1;
        const endLine = node.loc.end.line - 1;
        if (startLine === endLine) {
            return lines[startLine]?.trim() || '';
        }
        return lines.slice(startLine, endLine + 1).map(l => l.trim()).join(' ').slice(0, 100);
    }
    return '';
}

export function parseCode(code: string, language: 'javascript' | 'python'): t.File {
    if (language === 'python') {
        throw new Error('Python support coming soon');
    }

    return parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
    });
}

export function generateFlowGraph(ast: t.File): FlowGraph {
    nodeIdCounter = 0;
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];

    // Create start node
    const startNode: FlowNode = {
        id: generateNodeId(),
        type: 'start',
        label: 'Start',
        code: '',
        lineNumber: 0,
    };
    nodes.push(startNode);

    // Create end node
    const endNode: FlowNode = {
        id: generateNodeId(),
        type: 'end',
        label: 'End',
        code: '',
        lineNumber: 0,
    };

    let previousNodeId = startNode.id;
    const codeString = '';

    // Track function declarations to process their bodies
    const functionBodies: { funcNode: FlowNode; body: t.Statement[] }[] = [];
    const functionMap = new Map<string, FlowNode>();

    // Process program body
    ast.program.body.forEach((statement) => {
        if (t.isFunctionDeclaration(statement) && statement.id) {
            // Create function entry node
            const funcNode: FlowNode = {
                id: generateNodeId(),
                type: 'function',
                label: `function ${statement.id.name}()`,
                code: getCodeForNode(statement, codeString),
                lineNumber: statement.loc?.start.line || 0,
                endLineNumber: statement.loc?.end.line || 0,
            };
            nodes.push(funcNode);
            functionMap.set(statement.id.name, funcNode);

            // Store for later processing
            if (t.isBlockStatement(statement.body)) {
                functionBodies.push({ funcNode, body: statement.body.body });
            }
            return;
        }

        const flowNode = processStatement(statement, codeString, nodes, edges, functionMap);
        if (flowNode) {
            edges.push({
                id: `edge_${previousNodeId}_${flowNode.id}`,
                source: previousNodeId,
                target: flowNode.id,
                type: 'normal',
            });

            // Get the last node in any sub-structure
            previousNodeId = getLastNodeId(flowNode, nodes, edges);
        }
    });

    // Add end node
    nodes.push(endNode);
    edges.push({
        id: `edge_${previousNodeId}_${endNode.id}`,
        source: previousNodeId,
        target: endNode.id,
        type: 'normal',
    });

    // Now process function bodies
    functionBodies.forEach(({ funcNode, body }) => {
        const startNodeIdx = nodes.length;
        let prevId = funcNode.id;

        body.forEach((stmt, index) => {
            const stmtNode = processStatement(stmt, codeString, nodes, edges, functionMap);
            if (stmtNode) {
                edges.push({
                    id: `edge_${prevId}_${stmtNode.id}`,
                    source: prevId,
                    target: stmtNode.id,
                    type: index === 0 ? 'true' : 'normal',
                    label: index === 0 ? 'body' : undefined,
                });
                prevId = getLastNodeId(stmtNode, nodes, edges);
            }
        });

        // Create function end node
        const funcEndNode: FlowNode = {
            id: generateNodeId(),
            type: 'end',
            label: 'End',
            code: '',
            lineNumber: funcNode.endLineNumber || 0,
        };
        nodes.push(funcEndNode);

        // Connect last statement to function end (if it flows through)
        if (canContinue(prevId, nodes)) {
            edges.push({
                id: `edge_${prevId}_${funcEndNode.id}`,
                source: prevId,
                target: funcEndNode.id,
                type: 'normal',
            });
        }

        // Connect ALL return nodes within this function to the end node
        const endNodeIdx = nodes.length;
        for (let i = startNodeIdx; i < endNodeIdx; i++) {
            if (nodes[i].type === 'return') {
                edges.push({
                    id: `edge_return_${nodes[i].id}_${funcEndNode.id}`,
                    source: nodes[i].id,
                    target: funcEndNode.id,
                    type: 'normal',
                });
            }
        }

        funcNode.children = [funcEndNode.id];
    });

    // Post-process: remove useless merge nodes (only 1 incoming, 1 outgoing non-recursive edge)
    const cleanedGraph = removeUselessMergeNodes(nodes, edges);

    return {
        nodes: cleanedGraph.nodes,
        edges: cleanedGraph.edges,
        entryNodeId: startNode.id,
        exitNodeId: endNode.id,
    };
}

// Remove passthrough nodes (merge/loop exit) that only have one incoming and one outgoing edge
function removeUselessMergeNodes(nodes: FlowNode[], edges: FlowEdge[]): { nodes: FlowNode[], edges: FlowEdge[] } {
    // Find all passthrough-type nodes
    const passthroughNodes = nodes.filter(n => n.label === 'merge' || n.label === 'loop exit');

    for (const passNode of passthroughNodes) {
        // Count incoming and outgoing edges (exclude recursive/call edges which are informational)
        const incoming = edges.filter(e => e.target === passNode.id && e.type !== 'recursive' && e.type !== 'call');
        const outgoing = edges.filter(e => e.source === passNode.id && e.type !== 'recursive' && e.type !== 'call');

        // If passthrough node is just a passthrough (1 in, 1 out) or (1 in, 0 out), remove it
        if (incoming.length === 1 && outgoing.length <= 1) {
            const inEdge = incoming[0];
            const outEdge = outgoing[0];

            if (outEdge) {
                // Create a new edge bypassing the node
                const bypassEdge: FlowEdge = {
                    id: `edge_bypass_${inEdge.source}_${outEdge.target}`,
                    source: inEdge.source,
                    target: outEdge.target,
                    type: inEdge.type, // Keep the original edge type (e.g., 'false')
                    label: inEdge.label,
                };

                // Remove old outgoing edge
                const outEdgeIndex = edges.findIndex(e => e.id === outEdge.id);
                if (outEdgeIndex !== -1) edges.splice(outEdgeIndex, 1);

                // Add bypass edge
                edges.push(bypassEdge);

                // Update any node that had this node as a child
                for (const node of nodes) {
                    if (node.children) {
                        const idx = node.children.indexOf(passNode.id);
                        if (idx !== -1) {
                            node.children[idx] = outEdge.target;
                        }
                    }
                }
            }

            // Remove the passthrough node
            const nodeIndex = nodes.findIndex(n => n.id === passNode.id);
            if (nodeIndex !== -1) {
                nodes.splice(nodeIndex, 1);
            }

            // Remove incoming edge
            const inEdgeIndex = edges.findIndex(e => e.id === inEdge.id);
            if (inEdgeIndex !== -1) edges.splice(inEdgeIndex, 1);
        }
    }

    return { nodes, edges };
}

function canContinue(nodeId: string, nodes: FlowNode[]): boolean {
    const node = nodes.find(n => n.id === nodeId);
    return node ? node.type !== 'return' : true;
}

function processStatement(
    statement: t.Statement,
    code: string,
    nodes: FlowNode[],
    edges: FlowEdge[],
    functionMap: Map<string, FlowNode>
): FlowNode | null {
    if (t.isEmptyStatement(statement)) return null;

    const node: FlowNode = {
        id: generateNodeId(),
        type: getNodeType(statement),
        label: getNodeLabel(statement),
        code: getCodeForNode(statement, code),
        lineNumber: statement.loc?.start.line || 0,
        endLineNumber: statement.loc?.end.line || 0,
    };

    nodes.push(node);

    // Check for function calls to add edges (including recursive calls)
    if (t.isExpressionStatement(statement) || t.isVariableDeclaration(statement) || t.isReturnStatement(statement)) {
        functionMap.forEach((funcNode, name) => {
            const callPattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
            const codeSnippet = getCodeForNode(statement, code);

            if (callPattern.test(codeSnippet)) {
                // Check if this is a recursive call (calling itself from within)
                // We detect this by checking if the current node's line is within the function's body
                const isRecursive = node.lineNumber >= (funcNode.lineNumber || 0) &&
                    node.lineNumber <= (funcNode.endLineNumber || 0);

                edges.push({
                    id: `edge_call_${node.id}_${funcNode.id}`,
                    source: node.id,
                    target: funcNode.id,
                    type: isRecursive ? 'recursive' : 'call',
                    label: isRecursive ? 'recurse' : 'calls'
                });
            }
        });
    }

    // Handle if statements
    if (t.isIfStatement(statement)) {
        return processIfStatement(statement, node, code, nodes, edges, functionMap);
    }

    // Handle loops
    if (t.isForStatement(statement) || t.isWhileStatement(statement)) {
        return processLoopStatement(statement, node, code, nodes, edges, functionMap);
    }

    return node;
}

function processIfStatement(
    statement: t.IfStatement,
    decisionNode: FlowNode,
    code: string,
    nodes: FlowNode[],
    edges: FlowEdge[],
    functionMap: Map<string, FlowNode>
): FlowNode {
    // Check if both branches terminate (return/throw) - if so, no merge needed
    const consequentTerminates = branchTerminates(statement.consequent);
    const alternateTerminates = statement.alternate ? branchTerminates(statement.alternate) : false;
    const bothTerminate = consequentTerminates && alternateTerminates;

    // Create merge node only if at least one branch doesn't terminate
    let mergeNode: FlowNode | null = null;
    if (!bothTerminate) {
        mergeNode = {
            id: generateNodeId(),
            type: 'process',
            label: 'merge',
            code: '',
            lineNumber: statement.loc?.end.line || 0,
        };
        nodes.push(mergeNode);
    }

    // Process consequent (true branch)
    if (t.isBlockStatement(statement.consequent)) {
        let prevId = decisionNode.id;
        let firstInBranch = true;

        statement.consequent.body.forEach(stmt => {
            const stmtNode = processStatement(stmt, code, nodes, edges, functionMap);
            if (stmtNode) {
                edges.push({
                    id: `edge_${prevId}_${stmtNode.id}`,
                    source: prevId,
                    target: stmtNode.id,
                    type: firstInBranch ? 'true' : 'normal',
                    label: firstInBranch ? 'true' : undefined,
                });
                prevId = getLastNodeId(stmtNode, nodes, edges);
                firstInBranch = false;
            }
        });

        if (mergeNode && canContinue(prevId, nodes)) {
            edges.push({
                id: `edge_${prevId}_${mergeNode.id}`,
                source: prevId,
                target: mergeNode.id,
                type: 'normal',
            });
        }
    } else {
        const stmtNode = processStatement(statement.consequent, code, nodes, edges, functionMap);
        if (stmtNode) {
            edges.push({
                id: `edge_${decisionNode.id}_${stmtNode.id}`,
                source: decisionNode.id,
                target: stmtNode.id,
                type: 'true',
                label: 'true',
            });

            const lastId = getLastNodeId(stmtNode, nodes, edges);
            if (mergeNode && canContinue(lastId, nodes)) {
                edges.push({
                    id: `edge_${lastId}_${mergeNode.id}`,
                    source: lastId,
                    target: mergeNode.id,
                    type: 'normal',
                });
            }
        }
    }

    // Process alternate (false branch)
    if (statement.alternate) {
        if (t.isBlockStatement(statement.alternate)) {
            let prevId = decisionNode.id;
            let firstInBranch = true;

            statement.alternate.body.forEach(stmt => {
                const stmtNode = processStatement(stmt, code, nodes, edges, functionMap);
                if (stmtNode) {
                    edges.push({
                        id: `edge_${prevId}_${stmtNode.id}`,
                        source: prevId,
                        target: stmtNode.id,
                        type: firstInBranch ? 'false' : 'normal',
                        label: firstInBranch ? 'false' : undefined,
                    });
                    prevId = getLastNodeId(stmtNode, nodes, edges);
                    firstInBranch = false;
                }
            });

            if (mergeNode && canContinue(prevId, nodes)) {
                edges.push({
                    id: `edge_${prevId}_${mergeNode.id}`,
                    source: prevId,
                    target: mergeNode.id,
                    type: 'normal',
                });
            }
        } else if (t.isIfStatement(statement.alternate)) {
            // else if
            const elseIfNode = processStatement(statement.alternate, code, nodes, edges, functionMap);
            if (elseIfNode) {
                edges.push({
                    id: `edge_${decisionNode.id}_${elseIfNode.id}`,
                    source: decisionNode.id,
                    target: elseIfNode.id,
                    type: 'false',
                    label: 'false',
                });

                // Nested If terminates where it terminates. We don't connect elseIfNode directly to merge.
                // But wait, elseIfNode returns a decisionNode which HAS a merge node.
                // We need to connect that merge node to OUR merge node?
                // Nested if structure:
                // If1 -> ElseIf -> (True/False) -> MergeIf2.
                // MergeIf2 -> MergeIf1.
                // getLastNodeId(elseIfNode) returns MergeIf2.
                const lastId = getLastNodeId(elseIfNode, nodes, edges);
                if (mergeNode && canContinue(lastId, nodes)) {
                    edges.push({
                        id: `edge_${lastId}_${mergeNode.id}`,
                        source: lastId,
                        target: mergeNode.id,
                        type: 'normal',
                    });
                }
            }
        } else {
            const stmtNode = processStatement(statement.alternate, code, nodes, edges, functionMap);
            if (stmtNode) {
                edges.push({
                    id: `edge_${decisionNode.id}_${stmtNode.id}`,
                    source: decisionNode.id,
                    target: stmtNode.id,
                    type: 'false',
                    label: 'false',
                });

                const lastId = getLastNodeId(stmtNode, nodes, edges);
                if (mergeNode && canContinue(lastId, nodes)) {
                    edges.push({
                        id: `edge_${lastId}_${mergeNode.id}`,
                        source: lastId,
                        target: mergeNode.id,
                        type: 'normal',
                    });
                }
            }
        }
    } else {
        // No else branch - connect directly to merge if it exists
        if (mergeNode) {
            edges.push({
                id: `edge_${decisionNode.id}_${mergeNode.id}_false`,
                source: decisionNode.id,
                target: mergeNode.id,
                type: 'false',
                label: 'false',
            });
        }
    }

    if (mergeNode) {
        decisionNode.children = [mergeNode.id];
    }
    return decisionNode;
}

// Helper function to check if a branch terminates (returns, throws, etc.)
function branchTerminates(node: t.Statement): boolean {
    if (t.isReturnStatement(node) || t.isThrowStatement(node)) {
        return true;
    }
    if (t.isBlockStatement(node)) {
        // Check if the last statement terminates
        const lastStmt = node.body[node.body.length - 1];
        if (lastStmt) {
            return branchTerminates(lastStmt);
        }
    }
    if (t.isIfStatement(node)) {
        // Both branches must terminate
        const consequentTerminates = branchTerminates(node.consequent);
        const alternateTerminates = node.alternate ? branchTerminates(node.alternate) : false;
        return consequentTerminates && alternateTerminates;
    }
    return false;
}

function processLoopStatement(
    statement: t.ForStatement | t.WhileStatement,
    loopNode: FlowNode,
    code: string,
    nodes: FlowNode[],
    edges: FlowEdge[],
    functionMap: Map<string, FlowNode>
): FlowNode {
    // Create exit node for after the loop
    const exitNode: FlowNode = {
        id: generateNodeId(),
        type: 'process',
        label: 'loop exit',
        code: '',
        lineNumber: statement.loc?.end.line || 0,
    };
    nodes.push(exitNode);

    // Process loop body
    if (t.isBlockStatement(statement.body)) {
        let prevId = loopNode.id;
        let firstInBody = true;

        statement.body.body.forEach(stmt => {
            const stmtNode = processStatement(stmt, code, nodes, edges, functionMap);
            if (stmtNode) {
                edges.push({
                    id: `edge_${prevId}_${stmtNode.id}`,
                    source: prevId,
                    target: stmtNode.id,
                    type: firstInBody ? 'true' : 'normal',
                    label: firstInBody ? 'body' : undefined,
                });
                prevId = getLastNodeId(stmtNode, nodes, edges);
                firstInBody = false;
            }
        });

        // Loop back edge
        if (canContinue(prevId, nodes)) {
            edges.push({
                id: `edge_${prevId}_${loopNode.id}_back`,
                source: prevId,
                target: loopNode.id,
                type: 'loop-back',
                label: 'repeat',
            });
        }
    }

    // Exit condition edge
    edges.push({
        id: `edge_${loopNode.id}_${exitNode.id}`,
        source: loopNode.id,
        target: exitNode.id,
        type: 'false',
        label: 'exit',
    });

    loopNode.children = [exitNode.id];
    return loopNode;
}

function getLastNodeId(node: FlowNode, _nodes: FlowNode[], _edges: FlowEdge[]): string {
    // If this node has children (like if/loop), return the merge/exit node
    if (node.children && node.children.length > 0) {
        return node.children[node.children.length - 1];
    }
    return node.id;
}
