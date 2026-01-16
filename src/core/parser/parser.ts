import * as parser from '@babel/parser';
import * as t from '@babel/types';
import { parsePythonCode } from './pythonParser.ts';
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

    if (t.isForStatement(node) || t.isWhileStatement(node) || t.isDoWhileStatement(node)) {
        return 'loop';
    }

    if (t.isSwitchStatement(node)) {
        return 'decision'; // The switch(val) part
    }

    if (t.isSwitchCase(node)) {
        return 'decision'; // The case X: part matches or not
    }

    if (t.isBreakStatement(node)) {
        return 'process'; // Visually just a connector usually, but we can make it a node
    }

    if (t.isReturnStatement(node)) {
        return 'return';
    }

    if (t.isThrowStatement(node)) {
        return 'throw';
    }

    if (t.isExpressionStatement(node)) {
        const expr = node.expression;
        if (t.isCallExpression(expr)) {
            if (t.isMemberExpression(expr.callee)) {
                // Check for Python Runtime Ops mapping
                if (t.isMemberExpression(expr.callee.object) &&
                    t.isIdentifier(expr.callee.object.property) &&
                    expr.callee.object.property.name === 'ops') {
                    // This is __pythonRuntime.ops.something(...)
                    const opName = t.isIdentifier(expr.callee.property) ? expr.callee.property.name : '';
                    const args = expr.arguments;

                    if (args.length === 2 && t.isIdentifier(args[0]) && t.isIdentifier(args[1])) {
                        const left = args[0].name;
                        const right = args[1].name;

                        switch (opName) {
                            case 'add': return `${left} + ${right}`;
                            case 'subtract': return `${left} - ${right}`;
                            case 'multiply': return `${left} * ${right}`;
                            case 'divide': return `${left} / ${right}`;
                            case 'floorDivide': return `${left} // ${right}`;
                            case 'mod': return `${left} % ${right}`;
                            case 'pow': return `${left} ** ${right}`;
                            case 'eq': return `${left} == ${right}`;
                            case 'ne': return `${left} != ${right}`;
                            case 'lt': return `${left} < ${right}`;
                            case 'lte': return `${left} <= ${right}`;
                            case 'gt': return `${left} > ${right}`;
                            case 'gte': return `${left} >= ${right}`;
                        }
                    }
                }

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
            return `${left} ${expr.operator} ...`;
        }
        if (t.isUpdateExpression(expr)) {
            const arg = t.isIdentifier(expr.argument) ? expr.argument.name : 'var';
            return expr.prefix ? `${expr.operator}${arg}` : `${arg}${expr.operator}`;
        }
    }

    if (t.isTryStatement(node)) {
        return 'try';
    }

    if (t.isClassDeclaration(node) && node.id) {
        return `class ${node.id.name}`;
    }

    if (t.isClassMethod(node) && t.isIdentifier(node.key)) {
        return node.key.name;
    }

    return node.type;
}

function getNodeType(node: t.Node): FlowNodeType {
    if (t.isFunctionDeclaration(node)) return 'function';
    if (t.isIfStatement(node) || t.isSwitchStatement(node) || t.isSwitchCase(node)) return 'decision';
    if (t.isTryStatement(node)) return 'decision';
    if (t.isForStatement(node) || t.isWhileStatement(node) || t.isDoWhileStatement(node) || t.isForInStatement(node)) return 'loop';
    if (t.isReturnStatement(node)) return 'return';
    if (t.isExpressionStatement(node)) {
        const expr = node.expression;
        if (t.isCallExpression(expr)) return 'call';
    }
    if (t.isClassDeclaration(node)) return 'process';
    if (t.isClassMethod(node)) return 'function';
    return 'process';
}

function getCodeForNode(node: t.Node, code: string): string {
    if (node.loc) {
        const lines = code.split('\n');
        const startLine = node.loc.start.line - 1;
        const endLine = node.loc.end.line - 1;
        const startCol = node.loc.start.column;
        const endCol = node.loc.end.column;

        if (startLine === endLine) {
            return lines[startLine]?.substring(startCol, endCol) || '';
        }

        // Multi-line: First line from startCol, middle lines full, last line to endCol
        const firstLine = lines[startLine]?.substring(startCol) || '';
        const lastLine = lines[endLine]?.substring(0, endCol) || '';
        const middleLines = lines.slice(startLine + 1, endLine).map(l => l.trim()).join(' ');

        return `${firstLine} ${middleLines} ${lastLine}`.replace(/\s+/g, ' ').trim().slice(0, 100);
    }
    return '';
}

export function parseCode(code: string, language: 'javascript' | 'python'): t.File {
    if (language === 'python') {
        return parsePythonCode(code);
    }

    return parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
    });
}

export function generateFlowGraph(ast: t.File, code: string): FlowGraph {
    nodeIdCounter = 0;
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    const variableTypeMap = new Map<string, string>();

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
    const codeString = code;

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

        if (t.isClassDeclaration(statement) && statement.id) {
            const className = statement.id.name;

            statement.body.body.forEach((member) => {
                if (t.isClassMethod(member) && t.isIdentifier(member.key)) {
                    const methodName = member.key.name;
                    const isConstructor = methodName === 'constructor';

                    const nodeLabel = isConstructor ? `new ${className}()` : `${className}.${methodName}()`;
                    // For constructor, map class name to this node (so 'new ClassName()' links here)
                    // For methods, map method name (so 'obj.method()' links here)
                    // Note: This has collision issues if multiple classes have same method name,
                    // but simple DSA examples usually don't overlap uniquely naming-wise or it's acceptable limitation.
                    const mapKey = isConstructor ? className : `${className}.${methodName}`;

                    const methodNode: FlowNode = {
                        id: generateNodeId(),
                        type: 'function',
                        label: nodeLabel,
                        code: getCodeForNode(member, codeString),
                        lineNumber: member.loc?.start.line || 0,
                        endLineNumber: member.loc?.end.line || 0,
                    };
                    nodes.push(methodNode);
                    functionMap.set(mapKey, methodNode);

                    // Store for later processing
                    if (t.isBlockStatement(member.body)) {
                        functionBodies.push({ funcNode: methodNode, body: member.body.body });
                    }
                }
            });
            return;
        }

        const flowNode = processStatement(statement, codeString, nodes, edges, functionMap, variableTypeMap);
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
            const stmtNode = processStatement(stmt, codeString, nodes, edges, functionMap, variableTypeMap);
            if (stmtNode) {
                if (canContinue(prevId, nodes)) {
                    edges.push({
                        id: `edge_${prevId}_${stmtNode.id}`,
                        source: prevId,
                        target: stmtNode.id,
                        type: index === 0 ? 'true' : 'normal',
                        label: index === 0 ? 'body' : undefined,
                    });
                }
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
    const passthroughNodes = nodes.filter(n => n.label === 'merge');

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
    // Break, continue, return, throw stop flow
    if (!node) return true;
    if (node.type === 'return') return false;
    if (node.label === 'break') return false;
    if (node.label === 'throw') return false;
    // continue?
    return true;
}

// Helper to identify internal Python nodes from filbert
function isInternalPythonNode(statement: t.Statement): boolean {
    if (t.isVariableDeclaration(statement)) {
        return statement.declarations.some(d =>
            t.isIdentifier(d.id) && (
                d.id.name.startsWith('__params') ||
                d.id.name.startsWith('__realArgCount') ||
                d.id.name.startsWith('__hasParams')
            )
        );
    }
    if (t.isIfStatement(statement)) {
        // Check if condition is __hasParams
        if (t.isIdentifier(statement.test) && statement.test.name.startsWith('__hasParams')) {
            return true;
        }
        // Check if condition is checking __realArgCount (e.g. if (__realArgCount < 2))
        if (t.isBinaryExpression(statement.test) &&
            t.isIdentifier(statement.test.left) &&
            statement.test.left.name.startsWith('__realArgCount')) {
            return true;
        }
    }
    if (t.isExpressionStatement(statement) && t.isAssignmentExpression(statement.expression)) {
        const left = statement.expression.left;
        if (t.isMemberExpression(left) && t.isIdentifier(left.object) && left.object.name.startsWith('__params')) {
            return true;
        }
        if (t.isIdentifier(left) && (left.name.startsWith('__params') || left.name.startsWith('__realArgCount'))) {
            return true;
        }
    }
    return false;
}

interface LoopContext {
    continueTargetId: string; // The ID to jump to for 'continue' (loop start/update)
    breakTargetId: string;    // The ID to jump to for 'break' (loop exit)
}

function processStatement(
    statement: t.Statement,
    code: string,
    nodes: FlowNode[],
    edges: FlowEdge[],
    functionMap: Map<string, FlowNode>,
    variableTypeMap: Map<string, string>,
    loopContext?: LoopContext
): FlowNode | null {
    if (t.isEmptyStatement(statement)) return null;

    // Filter out internal Python nodes
    if (isInternalPythonNode(statement)) {
        return null;
    }

    if (t.isSwitchStatement(statement)) {
        return processSwitchStatement(statement, code, nodes, edges, functionMap, variableTypeMap, loopContext);
    }

    if (t.isBlockStatement(statement)) {
        let prevId: string | null = null;
        let firstNode: FlowNode | null = null;

        statement.body.forEach((stmt) => {
            const stmtNode = processStatement(stmt, code, nodes, edges, functionMap, variableTypeMap, loopContext);
            if (stmtNode) {
                if (!firstNode) firstNode = stmtNode;

                if (prevId && canContinue(prevId, nodes)) {
                    edges.push({
                        id: `edge_${prevId}_${stmtNode.id}`,
                        source: prevId,
                        target: stmtNode.id,
                        type: 'normal'
                    });
                }
                prevId = getLastNodeId(stmtNode, nodes, edges);
            }
        });

        // Return the first node to link FROM the previous external node
        // But what about the LAST node? The caller expects a single node returned to link TO the next external node.
        // processStatement returns specific node types. 
        // If we return the first node, the caller links to it.
        // But the caller updates 'previousNodeId' using getLastNodeId(returnValue).
        // So we need getLastNodeId to traverse down the block? 
        // Yes, getLastNodeId implementations usually walk edges.
        return firstNode;
    }

    // Handle For Loops specially (they have init/update nodes that need custom flow)
    if (t.isForStatement(statement)) {
        return processForStatement(statement, code, nodes, edges, functionMap, variableTypeMap);
    }

    // Handle Python For loops (ForInStatement)
    if (t.isForInStatement(statement)) {
        return processForInStatement(statement, code, nodes, edges, functionMap, variableTypeMap);
    }

    // Treat break as a process node for now, will link logic later
    if (t.isBreakStatement(statement)) {
        const node: FlowNode = {
            id: generateNodeId(),
            type: 'process',
            label: 'break',
            code: 'break;',
            lineNumber: statement.loc?.start.line || 0,
            endLineNumber: statement.loc?.end.line || 0,
        };
        nodes.push(node);

        if (loopContext) {
            edges.push({
                id: `edge_${node.id}_break_${loopContext.breakTargetId}`,
                source: node.id,
                target: loopContext.breakTargetId,
                type: 'normal', // or specific style if we want
                label: ''
            });
        }
        return node;
    }

    if (t.isContinueStatement(statement)) {
        const node: FlowNode = {
            id: generateNodeId(),
            type: 'process',
            label: 'continue',
            code: 'continue;',
            lineNumber: statement.loc?.start.line || 0,
            endLineNumber: statement.loc?.end.line || 0,
        };
        nodes.push(node);

        if (loopContext) {
            edges.push({
                id: `edge_${node.id}_continue_${loopContext.continueTargetId}`,
                source: node.id,
                target: loopContext.continueTargetId,
                type: 'loop-back', // Should look like a loop back
                label: 'repeat'
            });
        }
        return node;
    }

    if (t.isDoWhileStatement(statement)) {
        return processDoWhileStatement(statement, code, nodes, edges, functionMap, variableTypeMap);
    }

    if (t.isTryStatement(statement)) {
        return processTryStatement(statement, code, nodes, edges, functionMap, variableTypeMap, loopContext);
    }

    const node: FlowNode = {
        id: generateNodeId(),
        type: getNodeType(statement),
        label: getNodeLabel(statement),
        code: getCodeForNode(statement, code),
        lineNumber: statement.loc?.start.line || 0,
        endLineNumber: statement.loc?.end.line || 0,
    };

    nodes.push(node);

    // Update variable types if this is a declaration
    if (t.isVariableDeclaration(statement)) {
        statement.declarations.forEach(decl => {
            if (t.isIdentifier(decl.id) && decl.init && t.isNewExpression(decl.init) && t.isIdentifier(decl.init.callee)) {
                variableTypeMap.set(decl.id.name, decl.init.callee.name);
            }
        });
    }

    // Check for function calls to add edges (including recursive calls)
    const calledFunctions = findCalledFunctions(statement, variableTypeMap);
    calledFunctions.forEach(targetName => {
        const funcNode = functionMap.get(targetName);
        if (funcNode) {
            // Check if this is a recursive call (calling itself from within)
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

    // Handle if statements
    if (t.isIfStatement(statement)) {
        return processIfStatement(statement, node, code, nodes, edges, functionMap, variableTypeMap, loopContext);
    }

    // Handle loops
    if (t.isWhileStatement(statement)) {
        return processWhileStatement(statement, node, code, nodes, edges, functionMap, variableTypeMap);
    }

    return node;
}

function findCalledFunctions(node: t.Node, variableTypeMap: Map<string, string>): string[] {
    const called: string[] = [];

    // Simple traversal helper
    function traverse(n: t.Node) {
        if (!n) return;

        if (t.isCallExpression(n) || t.isNewExpression(n)) {
            if (t.isIdentifier(n.callee)) {
                // simpleFunc() or new Class()
                called.push(n.callee.name);
            } else if (t.isMemberExpression(n.callee)) {
                // obj.method()
                if (t.isIdentifier(n.callee.object) && t.isIdentifier(n.callee.property)) {
                    const objName = n.callee.object.name;
                    const methodName = n.callee.property.name;
                    const className = variableTypeMap.get(objName);
                    if (className) {
                        called.push(`${className}.${methodName}`);
                    } else {
                        // Fallback: maybe just method name if collisions were allowed?
                        // For now strict class matching as per plan.
                        // But wait, if we call "console.log", we don't want to track it unless mapped.
                    }
                }
            }
        }

        // Recurse into children
        // Babel types don't have a generic 'children' property, need to check keys
        // Being lazy/pragmatic: check common containers
        if (t.isExpressionStatement(n)) traverse(n.expression);
        if (t.isVariableDeclaration(n)) n.declarations.forEach(d => { traverse(d.init as t.Node); });
        // Arguments of calls
        if ((t.isCallExpression(n) || t.isNewExpression(n)) && n.arguments) {
            n.arguments.forEach(arg => traverse(arg as t.Node));
        }
        if (t.isAssignmentExpression(n)) { traverse(n.right); }
        // ... add more if needed
    }

    traverse(node);
    return called;
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

function processIfStatement(
    statement: t.IfStatement,
    parentNode: FlowNode,
    code: string,
    nodes: FlowNode[],
    edges: FlowEdge[],
    functionMap: Map<string, FlowNode>,
    variableTypeMap: Map<string, string>,
    loopContext?: LoopContext
): FlowNode {
    // Check if both branches terminate (return/throw) - if so, no merge needed
    const consequentTerminates = branchTerminates(statement.consequent);
    const alternateTerminates = statement.alternate ? branchTerminates(statement.alternate) : false;
    // If both terminate, we don't strictly need a merge node, but for visual consistency we often keep it 
    // unless we want dead ends. For now, let's keep logic simple: create merge if needed.
    // Actually, if both terminate, the merge node is unreachable.
    const needsMerge = !(consequentTerminates && alternateTerminates);

    const mergeNode: FlowNode | null = needsMerge ? {
        id: generateNodeId(),
        type: 'process',
        label: 'merge',
        code: '',
        lineNumber: statement.loc?.end.line || 0,
    } : null;

    if (mergeNode) nodes.push(mergeNode);

    // Process consequent (true branch)
    if (t.isBlockStatement(statement.consequent)) {
        let prevId = parentNode.id;
        let firstInBranch = true;

        statement.consequent.body.forEach(stmt => {
            const stmtNode = processStatement(stmt, code, nodes, edges, functionMap, variableTypeMap, loopContext);
            if (stmtNode) {
                if (canContinue(prevId, nodes)) {
                    edges.push({
                        id: `edge_${prevId}_${stmtNode.id}`,
                        source: prevId,
                        target: stmtNode.id,
                        type: firstInBranch ? 'true' : 'normal',
                        label: firstInBranch ? 'true' : undefined
                    });
                }
                prevId = getLastNodeId(stmtNode, nodes, edges);
                firstInBranch = false;
            }
        });

        // Loop back / Merge
        if (mergeNode && canContinue(prevId, nodes)) {
            edges.push({
                id: `edge_${prevId}_${mergeNode.id}`,
                source: prevId,
                target: mergeNode.id,
                type: 'normal',
            });
        }
    } else {
        const consequent = processStatement(statement.consequent, code, nodes, edges, functionMap, variableTypeMap, loopContext);
        if (consequent) {
            edges.push({
                id: `edge_${parentNode.id}_${consequent.id}`,
                source: parentNode.id,
                target: consequent.id,
                type: 'true',
                label: 'true',
            });

            const lastId = getLastNodeId(consequent, nodes, edges);
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
            let prevId = parentNode.id;
            let firstInBranch = true;

            statement.alternate.body.forEach(stmt => {
                const stmtNode = processStatement(stmt, code, nodes, edges, functionMap, variableTypeMap, loopContext);
                if (stmtNode) {
                    if (canContinue(prevId, nodes)) {
                        edges.push({
                            id: `edge_${prevId}_${stmtNode.id}`,
                            source: prevId,
                            target: stmtNode.id,
                            type: firstInBranch ? 'false' : 'normal',
                            label: firstInBranch ? 'false' : undefined
                        });
                    }
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
            // Single Statement or Else If
            const alternate = processStatement(statement.alternate, code, nodes, edges, functionMap, variableTypeMap, loopContext);
            if (alternate) {
                // If the alternate is an IfStatement (else if), processStatement(If) returns the If node.
                // We connect Parent -> Alternate with 'false'.
                edges.push({
                    id: `edge_${parentNode.id}_${alternate.id}`,
                    source: parentNode.id,
                    target: alternate.id,
                    type: 'false',
                    label: 'false',
                });

                const lastId = getLastNodeId(alternate, nodes, edges);
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
                id: `edge_${parentNode.id}_${mergeNode.id}_false`,
                source: parentNode.id,
                target: mergeNode.id,
                type: 'false',
                label: 'false',
            });
        }
    }

    if (mergeNode) {
        parentNode.children = [mergeNode.id];
    }
    return parentNode;
}

function processForStatement(
    statement: t.ForStatement,
    code: string,
    nodes: FlowNode[],
    edges: FlowEdge[],
    functionMap: Map<string, FlowNode>,
    variableTypeMap: Map<string, string>,
    loopContext?: LoopContext // Not inherited, For creates a NEW context
): FlowNode {
    // 1. Definition/Init Node (Optional)
    let initNode: FlowNode | null = null;
    if (statement.init) {
        initNode = {
            id: generateNodeId(),
            type: 'process',
            label: getCodeForNode(statement.init, code),
            code: getCodeForNode(statement.init, code),
            lineNumber: statement.loc?.start.line || 0,
        };
        nodes.push(initNode);
    }

    // 2. Loop Condition Node
    const loopNode: FlowNode = {
        id: generateNodeId(),
        type: 'loop',
        label: statement.test ? `for(${getCodeForNode(statement.test, code)})` : 'for(true)',
        code: getCodeForNode(statement, code),
        lineNumber: statement.loc?.start.line || 0,
    };
    nodes.push(loopNode);

    // Connect init to loop
    if (initNode) {
        edges.push({
            id: `edge_${initNode.id}_${loopNode.id}`,
            source: initNode.id,
            target: loopNode.id,
            type: 'normal',
        });
    }

    // 3. Exit Node
    const exitNode: FlowNode = {
        id: generateNodeId(),
        type: 'process',
        label: 'loop exit',
        code: '',
        lineNumber: statement.loc?.end.line || 0,
    };
    nodes.push(exitNode);

    // 4. Update Node (Optional)
    let updateNode: FlowNode | null = null;
    if (statement.update) {
        updateNode = {
            id: generateNodeId(),
            type: 'process',
            label: getCodeForNode(statement.update, code),
            code: getCodeForNode(statement.update, code),
            lineNumber: statement.loc?.start.line || 0,
        };
        nodes.push(updateNode);
        // Update connects back to loop
        edges.push({
            id: `edge_${updateNode.id}_${loopNode.id}_back`,
            source: updateNode.id,
            target: loopNode.id,
            type: 'loop-back',
            label: 'repeat',
        });
    } else {
        // If no update, body connects back to loop directly (handled below)
    }

    // 4. Process Body
    // Create NEW LoopContext
    const currentLoopContext: LoopContext = {
        continueTargetId: updateNode ? updateNode.id : loopNode.id, // Continue goes to update or back to loop
        breakTargetId: exitNode.id // Break goes to exit
    };

    if (t.isBlockStatement(statement.body)) {
        let prevId = loopNode.id;
        let firstInBody = true;

        statement.body.body.forEach((stmt) => {
            const stmtNode = processStatement(stmt, code, nodes, edges, functionMap, variableTypeMap, currentLoopContext);
            if (stmtNode) {
                // If it's the first statement, link from loopNode (true branch)
                if (firstInBody) {
                    edges.push({
                        id: `edge_${loopNode.id}_${stmtNode.id}_true`,
                        source: loopNode.id,
                        target: stmtNode.id,
                        type: 'true',
                        label: 'true'
                    });
                } else if (canContinue(prevId, nodes)) {
                    // Otherwise link from previous statement
                    edges.push({
                        id: `edge_${prevId}_${stmtNode.id}`,
                        source: prevId,
                        target: stmtNode.id,
                        type: 'normal'
                    });
                }
                prevId = getLastNodeId(stmtNode, nodes, edges);
                firstInBody = false;
            }
        });

        // Loop back logic
        if (canContinue(prevId, nodes)) {
            edges.push({
                id: `edge_${prevId}_${updateNode ? updateNode.id : loopNode.id}_loop`,
                source: prevId,
                target: updateNode ? updateNode.id : loopNode.id,
                type: 'loop-back',
            });
        }

    } else {
        // Single statement body
        const stmtNode = processStatement(statement.body, code, nodes, edges, functionMap, variableTypeMap, currentLoopContext);
        if (stmtNode) {
            // Loop -> Body
            edges.push({
                id: `edge_${loopNode.id}_${stmtNode.id}_true`,
                source: loopNode.id,
                target: stmtNode.id,
                type: 'true',
                label: 'true'
            });

            // Body -> Update/Loop
            const lastId = getLastNodeId(stmtNode, nodes, edges);
            if (canContinue(lastId, nodes)) {
                edges.push({
                    id: `edge_${lastId}_${updateNode ? updateNode.id : loopNode.id}_loop`,
                    source: lastId,
                    target: updateNode ? updateNode.id : loopNode.id,
                    type: 'loop-back',
                });
            }
        }
    }

    // 6. False -> Exit
    edges.push({
        id: `edge_${loopNode.id}_${exitNode.id}`,
        source: loopNode.id,
        target: exitNode.id,
        type: 'false',
        label: 'false',
    });

    // Set children for getLastNodeId to work correctly
    // Both initNode (if exists) and loopNode should point to exitNode
    // This ensures that when the caller calls getLastNodeId, it returns exitNode.id
    loopNode.children = [exitNode.id];
    if (initNode) {
        initNode.children = [exitNode.id];
    }

    // Return the entry point (Init if exists, otherwise Loop)
    return initNode || loopNode;
}

function processWhileStatement(
    statement: t.WhileStatement,
    loopNode: FlowNode,
    code: string,
    nodes: FlowNode[],
    edges: FlowEdge[],
    functionMap: Map<string, FlowNode>,
    variableTypeMap: Map<string, string>,
    loopContext?: LoopContext // New context
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

    // Create NEW LoopContext for this loop
    const currentLoopContext: LoopContext = {
        continueTargetId: loopNode.id, // Continue goes back to the loop condition
        breakTargetId: exitNode.id // Break goes to the exit node
    };

    // Process loop body
    if (t.isBlockStatement(statement.body)) {
        let prevId = loopNode.id;
        let firstInBody = true;

        statement.body.body.forEach(stmt => {
            const stmtNode = processStatement(stmt, code, nodes, edges, functionMap, variableTypeMap, currentLoopContext);
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
    } else {
        // Single statement body
        const stmtNode = processStatement(statement.body, code, nodes, edges, functionMap, variableTypeMap, currentLoopContext);
        if (stmtNode) {
            edges.push({
                id: `edge_${loopNode.id}_${stmtNode.id}`,
                source: loopNode.id,
                target: stmtNode.id,
                type: 'true',
                label: 'body',
            });
            const lastId = getLastNodeId(stmtNode, nodes, edges);
            if (canContinue(lastId, nodes)) {
                edges.push({
                    id: `edge_${lastId}_${loopNode.id}_back`,
                    source: lastId,
                    target: loopNode.id,
                    type: 'loop-back',
                    label: 'repeat',
                });
            }
        }
    }

    // Exit condition edge
    edges.push({
        id: `edge_${loopNode.id}_${exitNode.id}`,
        source: loopNode.id,
        target: exitNode.id,
        type: 'false',
        label: 'false',
    });

    loopNode.children = [exitNode.id];
    return loopNode;
}

function processDoWhileStatement(
    statement: t.DoWhileStatement,
    code: string,
    nodes: FlowNode[],
    edges: FlowEdge[],
    functionMap: Map<string, FlowNode>,
    variableTypeMap: Map<string, string>,
    loopContext?: LoopContext
): FlowNode {
    // 1. Create Do Node (Entry/Merge point)
    const doNode: FlowNode = {
        id: generateNodeId(),
        type: 'process',
        label: 'do',
        code: 'do',
        lineNumber: statement.loc?.start.line || 0,
        endLineNumber: statement.loc?.start.line || 0,
    };
    nodes.push(doNode);

    // 2. Create Condition Node (Decision at end)
    const conditionNode: FlowNode = {
        id: generateNodeId(),
        type: 'decision',
        label: `while(${getCodeForNode(statement.test, code)})`,
        code: getCodeForNode(statement.test, code),
        lineNumber: statement.loc?.end.line || 0,
        endLineNumber: statement.loc?.end.line || 0,
    };
    nodes.push(conditionNode);

    // 3. Create Exit Node
    const exitNode: FlowNode = {
        id: generateNodeId(),
        type: 'process',
        label: 'loop exit',
        code: '',
        lineNumber: statement.loc?.end.line || 0,
    };
    nodes.push(exitNode);

    // Create NEW LoopContext for this loop
    const currentLoopContext: LoopContext = {
        continueTargetId: conditionNode.id, // Continue goes to the condition check
        breakTargetId: exitNode.id // Break goes to the exit node
    };

    // 4. Process Body
    if (t.isBlockStatement(statement.body)) {
        let prevId = doNode.id;
        let firstInBody = true;

        statement.body.body.forEach(stmt => {
            const stmtNode = processStatement(stmt, code, nodes, edges, functionMap, variableTypeMap, currentLoopContext);
            if (stmtNode) {
                if (canContinue(prevId, nodes)) {
                    edges.push({
                        id: `edge_${prevId}_${stmtNode.id}`,
                        source: prevId,
                        target: stmtNode.id,
                        type: firstInBody ? 'normal' : 'normal',
                        label: firstInBody ? undefined : undefined
                    });
                }
                prevId = getLastNodeId(stmtNode, nodes, edges);
                firstInBody = false;
            }
        });

        // Link Body End to Condition
        if (canContinue(prevId, nodes)) {
            edges.push({
                id: `edge_${prevId}_${conditionNode.id}`,
                source: prevId,
                target: conditionNode.id,
                type: 'normal'
            });
        }
    } else {
        // Single statement body
        const stmtNode = processStatement(statement.body, code, nodes, edges, functionMap, variableTypeMap, currentLoopContext);
        if (stmtNode) {
            edges.push({
                id: `edge_${doNode.id}_${stmtNode.id}`,
                source: doNode.id,
                target: stmtNode.id,
                type: 'normal'
            });
            const lastId = getLastNodeId(stmtNode, nodes, edges);
            if (canContinue(lastId, nodes)) {
                edges.push({
                    id: `edge_${lastId}_${conditionNode.id}`,
                    source: lastId,
                    target: conditionNode.id,
                    type: 'normal'
                });
            }
        }
    }

    // 5. Condition Edges
    // True -> Back to Do
    edges.push({
        id: `edge_${conditionNode.id}_${doNode.id}_back`,
        source: conditionNode.id,
        target: doNode.id,
        type: 'loop-back',
        label: 'true'
    });

    // False -> Exit
    edges.push({
        id: `edge_${conditionNode.id}_${exitNode.id}_false`,
        source: conditionNode.id,
        target: exitNode.id,
        type: 'false',
        label: 'false'
    });

    doNode.children = [exitNode.id];
    return doNode;
}

function processTryStatement(
    statement: t.TryStatement,
    code: string,
    nodes: FlowNode[],
    edges: FlowEdge[],
    functionMap: Map<string, FlowNode>,
    variableTypeMap: Map<string, string>,
    loopContext?: LoopContext
): FlowNode {
    // 1. Try Node
    const tryNode: FlowNode = {
        id: generateNodeId(),
        type: 'decision',
        label: 'try',
        code: 'try',
        lineNumber: statement.loc?.start.line || 0,
        endLineNumber: statement.loc?.start.line || 0,
    };
    nodes.push(tryNode);

    // 2. Determine merge point (After Try/Catch)
    // If Finally exists, it's the merge point for Try/Catch, and it exits to an AfterFinally node.

    const afterNode: FlowNode = {
        id: generateNodeId(),
        type: 'process',
        label: 'end try',
        code: '',
        lineNumber: statement.loc?.end.line || 0,
    };
    nodes.push(afterNode);

    // 3. Process Try Block
    // Connection: TryNode -> Block Start
    let tryEndId: string | null = null;

    if (t.isBlockStatement(statement.block)) {
        let prevId = tryNode.id;
        let firstInBody = true;

        statement.block.body.forEach(stmt => {
            const stmtNode = processStatement(stmt, code, nodes, edges, functionMap, variableTypeMap, loopContext);
            if (stmtNode) {
                if (canContinue(prevId, nodes)) {
                    edges.push({
                        id: `edge_${prevId}_${stmtNode.id}`,
                        source: prevId,
                        target: stmtNode.id,
                        type: firstInBody ? 'true' : 'normal', // 'true' implies success path
                        label: firstInBody ? 'try' : undefined
                    });
                }
                prevId = getLastNodeId(stmtNode, nodes, edges);
                firstInBody = false;
            }
        });

        // Try Block End -> Finally or After
        tryEndId = prevId;
    }

    // 4. Process Catch Clause
    let catchEndId: string | null = null;

    if (statement.handler) {
        const catchClause = statement.handler;
        const catchNode: FlowNode = {
            id: generateNodeId(),
            type: 'process',
            label: catchClause.param && t.isIdentifier(catchClause.param) ? `catch(${catchClause.param.name})` : 'catch',
            code: 'catch',
            lineNumber: catchClause.loc?.start.line || 0,
        };
        nodes.push(catchNode);

        // Link Try -> Catch (Exception path)
        edges.push({
            id: `edge_${tryNode.id}_${catchNode.id}_error`,
            source: tryNode.id,
            target: catchNode.id,
            type: 'false', // 'false' implies error/exception
            label: 'error'
        });

        // Catch Body
        if (t.isBlockStatement(catchClause.body)) {
            let prevId = catchNode.id;
            // let firstInBody = true; // Not strictly needed if catchNode is the start

            catchClause.body.body.forEach(stmt => {
                const stmtNode = processStatement(stmt, code, nodes, edges, functionMap, variableTypeMap, loopContext);
                if (stmtNode) {
                    if (canContinue(prevId, nodes)) {
                        edges.push({
                            id: `edge_${prevId}_${stmtNode.id}`,
                            source: prevId,
                            target: stmtNode.id,
                            type: 'normal'
                        });
                    }
                    prevId = getLastNodeId(stmtNode, nodes, edges);
                }
            });
            catchEndId = prevId;
        }
    }

    // 5. Process Finally Block
    let finallyStartId: string | null = null;
    let finallyEndId: string | null = null;

    if (statement.finalizer) {
        const finallyBlock = statement.finalizer;
        const finallyNode: FlowNode = {
            id: generateNodeId(),
            type: 'process',
            label: 'finally',
            code: 'finally',
            lineNumber: finallyBlock.loc?.start.line || 0,
        };
        nodes.push(finallyNode);
        finallyStartId = finallyNode.id;

        let prevId = finallyNode.id;
        if (t.isBlockStatement(finallyBlock)) {
            finallyBlock.body.forEach(stmt => {
                const stmtNode = processStatement(stmt, code, nodes, edges, functionMap, variableTypeMap, loopContext);
                if (stmtNode) {
                    if (canContinue(prevId, nodes)) {
                        edges.push({
                            id: `edge_${prevId}_${stmtNode.id}`,
                            source: prevId,
                            target: stmtNode.id,
                            type: 'normal'
                        });
                    }
                    prevId = getLastNodeId(stmtNode, nodes, edges);
                }
            });
        }
        finallyEndId = prevId;
    }

    // 6. Connect Ends
    const nextStepId = finallyStartId || afterNode.id;

    // Connect Try Body End -> Next
    if (tryEndId && canContinue(tryEndId, nodes)) {
        edges.push({
            id: `edge_${tryEndId}_${nextStepId}_tryend`,
            source: tryEndId,
            target: nextStepId,
            type: 'normal'
        });
    }

    // Connect Catch Body End -> Next
    if (catchEndId && canContinue(catchEndId, nodes)) {
        edges.push({
            id: `edge_${catchEndId}_${nextStepId}_catchend`,
            source: catchEndId,
            target: nextStepId,
            type: 'normal'
        });
    }

    // Connect Finally End -> After
    if (finallyEndId && finallyStartId && canContinue(finallyEndId, nodes)) {
        // If finally exists, it flows to 'afterNode'.
        edges.push({
            id: `edge_${finallyEndId}_${afterNode.id}`,
            source: finallyEndId,
            target: afterNode.id,
            type: 'normal'
        });
    }

    // If no finally, try/catch already linked to afterNode (as nextStepId).

    tryNode.children = [afterNode.id];
    return tryNode;
}

function processSwitchStatement(
    statement: t.SwitchStatement,
    code: string,
    nodes: FlowNode[],
    edges: FlowEdge[],
    functionMap: Map<string, FlowNode>,
    variableTypeMap: Map<string, string>,
    loopContext?: LoopContext
): FlowNode {
    // 1. Create Switch Node
    const switchNode: FlowNode = {
        id: generateNodeId(),
        type: 'decision',
        label: `switch(${statement.discriminant.type === 'Identifier' ? statement.discriminant.name : '...'})`,
        code: getCodeForNode(statement, code),
        lineNumber: statement.loc?.start.line || 0,
        endLineNumber: statement.loc?.end.line || 0,
    };
    nodes.push(switchNode);

    // 2. Create Merge Node (Exit point)
    const mergeNode: FlowNode = {
        id: generateNodeId(),
        type: 'process',
        label: 'merge',
        code: '',
        lineNumber: statement.loc?.end.line || 0,
    };
    nodes.push(mergeNode);

    let prevCaseCheckId = switchNode.id;
    // let prevCaseBodyLastId: string | null = null; // Detect fallthrough later

    // 3. Process Cases
    statement.cases.forEach((caseClause, index) => {
        // Create Case Check Node
        const caseLabel = caseClause.test ?
            `case ${getCodeForNode(caseClause.test, code)}` :
            'default';

        const caseCheckNode: FlowNode = {
            id: generateNodeId(),
            type: 'decision',
            label: caseLabel,
            code: getCodeForNode(caseClause, code),
            lineNumber: caseClause.loc?.start.line || 0,
        };
        nodes.push(caseCheckNode);

        // Connect previous check to this case (false/next)
        edges.push({
            id: `edge_${prevCaseCheckId}_${caseCheckNode.id}`,
            source: prevCaseCheckId,
            target: caseCheckNode.id,
            type: index === 0 ? 'normal' : 'false',
            label: index === 0 ? undefined : 'next'
        });

        // 4. Process Case Body
        let bodyPrevId = caseCheckNode.id;
        let isFirstStmt = true;

        if (caseClause.consequent.length > 0) {
            caseClause.consequent.forEach(stmt => {
                const stmtNode = processStatement(stmt, code, nodes, edges, functionMap, variableTypeMap, loopContext);
                if (stmtNode) {
                    // Match found -> Enter body
                    if (canContinue(bodyPrevId, nodes)) {
                        if (isFirstStmt) {
                            edges.push({
                                id: `edge_${caseCheckNode.id}_${stmtNode.id}_match`,
                                source: caseCheckNode.id,
                                target: stmtNode.id,
                                type: 'true',
                                label: 'match'
                            });
                        } else {
                            edges.push({
                                id: `edge_${bodyPrevId}_${stmtNode.id}`,
                                source: bodyPrevId,
                                target: stmtNode.id,
                                type: 'normal'
                            });
                        }
                    }
                    bodyPrevId = getLastNodeId(stmtNode, nodes, edges);
                    isFirstStmt = false;
                }
            });

            // Handle break/fallthrough
            if (canContinue(bodyPrevId, nodes)) {
                // Fallthrough to next case? Or just end here if no more fallthrough logic
                // If the last statement was NOT a break, we technically fall through
                // but for visualization, linking to next case body is complex without knowing it ahead.
                // Simple version: Link to merge node if valid
                // Actually, correct flow is fallthrough to next case's body start.
                // prevCaseBodyLastId = bodyPrevId;
            } else {
                // It was a break or return
                if (getLastNodeLabel(bodyPrevId, nodes) === 'break') {
                    edges.push({
                        id: `edge_${bodyPrevId}_${mergeNode.id}`,
                        source: bodyPrevId,
                        target: mergeNode.id,
                        type: 'normal',
                    });
                }
                // prevCaseBodyLastId = null;
            }
        } else {
            // Empty case (e.g. case 1: case 2: ...)
            // Fallthrough intention
            // prevCaseBodyLastId = caseCheckNode.id;
        }

        prevCaseCheckId = caseCheckNode.id;

        // Handle Fallthrough from previous case
        // (Wait, logic above tracks current body exit. How to link NEXT case?
        // We need to link prevCaseBodyLastId to the START of this case's body... or this case's match?
        // Typically code flows into the body.
        // Simplified: Flow into the start of this block or Merge if empty?)
    });

    // Final default/no-match path connects where?
    // If last case logic didn't match, we exit switch.
    edges.push({
        id: `edge_${prevCaseCheckId}_${mergeNode.id}_nomatch`,
        source: prevCaseCheckId,
        target: mergeNode.id,
        type: 'false',
        label: 'exit'
    });

    switchNode.children = [mergeNode.id];
    return switchNode;
}

function getLastNodeLabel(nodeId: string, nodes: FlowNode[]): string {
    const n = nodes.find(n => n.id === nodeId);
    return n ? n.label : '';
}

function getLastNodeId(node: FlowNode, _nodes: FlowNode[], _edges: FlowEdge[]): string {
    // If this node has children (like if/loop), return the merge/exit node
    if (node.children && node.children.length > 0) {
        return node.children[node.children.length - 1];
    }
    return node.id;
}

function processForInStatement(
    statement: t.ForInStatement,
    code: string,
    nodes: FlowNode[],
    edges: FlowEdge[],
    functionMap: Map<string, FlowNode>,
    variableTypeMap: Map<string, string>,
    loopContext?: LoopContext
): FlowNode {
    // 1. Loop Node
    const loopNode: FlowNode = {
        id: generateNodeId(),
        type: 'loop',
        label: `for ${t.isIdentifier(statement.left) ? statement.left.name : 'var'} in ...`, // Simplified label
        code: getCodeForNode(statement, code),
        lineNumber: statement.loc?.start.line || 0,
    };

    // Attempt to get better label: "for i in range(5)"
    // Since 'right' might be complex, we just try to grab code snippet if possible
    if (statement.loc) {
        // getCodeForNode returns specific lines.
        // We might want to construct label manually if we want "for i in iter"
        const leftCode = t.isIdentifier(statement.left) ? statement.left.name : 'var';
        const rightCode = getCodeForNode(statement.right as t.Node, code);
        loopNode.label = `for ${leftCode} in ${rightCode}`;
    }

    nodes.push(loopNode);

    // 2. Exit Node
    const exitNode: FlowNode = {
        id: generateNodeId(),
        type: 'process',
        label: 'loop exit',
        code: '',
        lineNumber: statement.loc?.end.line || 0,
    };
    nodes.push(exitNode);

    // 3. Process Body

    // Create NEW LoopContext for this loop
    const currentLoopContext: LoopContext = {
        continueTargetId: loopNode.id, // Continue goes to back to loop
        breakTargetId: exitNode.id // Break goes to exit
    };

    if (t.isBlockStatement(statement.body)) {
        let prevId = loopNode.id;
        let firstInBody = true;

        statement.body.body.forEach(stmt => {
            const stmtNode = processStatement(stmt, code, nodes, edges, functionMap, variableTypeMap, currentLoopContext);
            if (stmtNode) {
                if (canContinue(prevId, nodes)) {
                    edges.push({
                        id: `edge_${prevId}_${stmtNode.id}`,
                        source: prevId,
                        target: stmtNode.id,
                        type: firstInBody ? 'true' : 'normal',
                        label: firstInBody ? 'body' : undefined,
                    });
                }
                prevId = getLastNodeId(stmtNode, nodes, edges);
                firstInBody = false;
            }
        });

        // Loop back logic
        if (canContinue(prevId, nodes)) {
            edges.push({
                id: `edge_${prevId}_${loopNode.id}_back`,
                source: prevId,
                target: loopNode.id,
                type: 'loop-back',
                label: 'repeat',
            });
        }
    } else {
        const stmtNode = processStatement(statement.body, code, nodes, edges, functionMap, variableTypeMap, currentLoopContext);
        if (stmtNode) {
            edges.push({
                id: `edge_${loopNode.id}_${stmtNode.id}`,
                source: loopNode.id,
                target: stmtNode.id,
                type: 'true',
                label: 'body',
            });

            const lastId = getLastNodeId(stmtNode, nodes, edges);
            if (canContinue(lastId, nodes)) {
                edges.push({
                    id: `edge_${lastId}_${loopNode.id}_back`,
                    source: lastId,
                    target: loopNode.id,
                    type: 'loop-back',
                    label: 'repeat',
                });
            }
        }
    }

    // Connect Loop False -> Exit
    edges.push({
        id: `edge_${loopNode.id}_${exitNode.id}_exit`,
        source: loopNode.id,
        target: exitNode.id,
        type: 'false',
        label: 'exit',
    });

    loopNode.children = [exitNode.id];
    return loopNode;
}
