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

    // Track function declarations to process separately
    const functionNodes: Map<string, FlowNode> = new Map();

    // Process program body
    ast.program.body.forEach((statement) => {
        if (t.isFunctionDeclaration(statement) && statement.id) {
            // Store function declarations but don't add to main flow
            const funcNode: FlowNode = {
                id: generateNodeId(),
                type: 'function',
                label: `function ${statement.id.name}()`,
                code: getCodeForNode(statement, codeString),
                lineNumber: statement.loc?.start.line || 0,
                endLineNumber: statement.loc?.end.line || 0,
            };
            functionNodes.set(statement.id.name, funcNode);
            return;
        }

        const flowNode = processStatement(statement, codeString, nodes, edges);
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

    // Add function nodes (they'll be displayed separately)
    functionNodes.forEach(node => nodes.push(node));

    return {
        nodes,
        edges,
        entryNodeId: startNode.id,
        exitNodeId: endNode.id,
    };
}

function processStatement(
    statement: t.Statement,
    code: string,
    nodes: FlowNode[],
    edges: FlowEdge[]
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

    // Handle if statements
    if (t.isIfStatement(statement)) {
        return processIfStatement(statement, node, code, nodes, edges);
    }

    // Handle loops
    if (t.isForStatement(statement) || t.isWhileStatement(statement)) {
        return processLoopStatement(statement, node, code, nodes, edges);
    }

    return node;
}

function processIfStatement(
    statement: t.IfStatement,
    decisionNode: FlowNode,
    code: string,
    nodes: FlowNode[],
    edges: FlowEdge[]
): FlowNode {
    // Create merge node for after the if
    const mergeNode: FlowNode = {
        id: generateNodeId(),
        type: 'process',
        label: 'merge',
        code: '',
        lineNumber: statement.loc?.end.line || 0,
    };
    nodes.push(mergeNode);

    // Process consequent (true branch)
    if (t.isBlockStatement(statement.consequent)) {
        let prevId = decisionNode.id;
        let firstInBranch = true;

        statement.consequent.body.forEach(stmt => {
            const stmtNode = processStatement(stmt, code, nodes, edges);
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

        // Connect to merge
        edges.push({
            id: `edge_${prevId}_${mergeNode.id}`,
            source: prevId,
            target: mergeNode.id,
            type: 'normal',
        });
    } else {
        const stmtNode = processStatement(statement.consequent, code, nodes, edges);
        if (stmtNode) {
            edges.push({
                id: `edge_${decisionNode.id}_${stmtNode.id}`,
                source: decisionNode.id,
                target: stmtNode.id,
                type: 'true',
                label: 'true',
            });
            edges.push({
                id: `edge_${stmtNode.id}_${mergeNode.id}`,
                source: stmtNode.id,
                target: mergeNode.id,
                type: 'normal',
            });
        }
    }

    // Process alternate (false branch)
    if (statement.alternate) {
        if (t.isBlockStatement(statement.alternate)) {
            let prevId = decisionNode.id;
            let firstInBranch = true;

            statement.alternate.body.forEach(stmt => {
                const stmtNode = processStatement(stmt, code, nodes, edges);
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

            // Connect to merge
            edges.push({
                id: `edge_${prevId}_${mergeNode.id}`,
                source: prevId,
                target: mergeNode.id,
                type: 'normal',
            });
        } else if (t.isIfStatement(statement.alternate)) {
            // else if
            const elseIfNode = processStatement(statement.alternate, code, nodes, edges);
            if (elseIfNode) {
                edges.push({
                    id: `edge_${decisionNode.id}_${elseIfNode.id}`,
                    source: decisionNode.id,
                    target: elseIfNode.id,
                    type: 'false',
                    label: 'false',
                });
            }
        } else {
            const stmtNode = processStatement(statement.alternate, code, nodes, edges);
            if (stmtNode) {
                edges.push({
                    id: `edge_${decisionNode.id}_${stmtNode.id}`,
                    source: decisionNode.id,
                    target: stmtNode.id,
                    type: 'false',
                    label: 'false',
                });
                edges.push({
                    id: `edge_${stmtNode.id}_${mergeNode.id}`,
                    source: stmtNode.id,
                    target: mergeNode.id,
                    type: 'normal',
                });
            }
        }
    } else {
        // No else branch - connect directly to merge
        edges.push({
            id: `edge_${decisionNode.id}_${mergeNode.id}_false`,
            source: decisionNode.id,
            target: mergeNode.id,
            type: 'false',
            label: 'false',
        });
    }

    decisionNode.children = [mergeNode.id];
    return decisionNode;
}

function processLoopStatement(
    statement: t.ForStatement | t.WhileStatement,
    loopNode: FlowNode,
    code: string,
    nodes: FlowNode[],
    edges: FlowEdge[]
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
            const stmtNode = processStatement(stmt, code, nodes, edges);
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
        edges.push({
            id: `edge_${prevId}_${loopNode.id}_back`,
            source: prevId,
            target: loopNode.id,
            type: 'loop-back',
            label: 'repeat',
        });
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
