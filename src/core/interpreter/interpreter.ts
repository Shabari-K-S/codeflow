import * as parser from '@babel/parser';
import * as t from '@babel/types';
import type {
    ExecutionTrace,
    ExecutionStep,
    VariableValue,
    CallFrame
} from '../../types';

const MAX_ITERATIONS = 10000;
const MAX_CALL_DEPTH = 100;

interface Scope {
    variables: Map<string, unknown>;
    parent: Scope | null;
}

interface InterpreterState {
    scope: Scope;
    callStack: CallFrame[];
    steps: ExecutionStep[];
    output: string[];
    stepCount: number;
    breakpoints: number[];
    functions: Map<string, t.FunctionDeclaration>;
    classes: Map<string, t.ClassDeclaration>;
}

function createScope(parent: Scope | null = null): Scope {
    return {
        variables: new Map(),
        parent,
    };
}

function lookupVariable(scope: Scope, name: string): unknown {
    if (scope.variables.has(name)) {
        return scope.variables.get(name);
    }
    if (scope.parent) {
        return lookupVariable(scope.parent, name);
    }
    return undefined;
}

function setVariable(scope: Scope, name: string, value: unknown): void {
    // Check if variable exists in current or parent scope
    let currentScope: Scope | null = scope;
    while (currentScope) {
        if (currentScope.variables.has(name)) {
            currentScope.variables.set(name, value);
            return;
        }
        currentScope = currentScope.parent;
    }
    // If not found, create in current scope
    scope.variables.set(name, value);
}

function declareVariable(scope: Scope, name: string, value: unknown): void {
    scope.variables.set(name, value);
}

function getVariableType(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function collectVariables(scope: Scope): VariableValue[] {
    const variables: VariableValue[] = [];
    let currentScope: Scope | null = scope;
    const seen = new Set<string>();

    while (currentScope) {
        currentScope.variables.forEach((value, name) => {
            if (!seen.has(name)) {
                seen.add(name);
                variables.push({
                    name,
                    value,
                    type: getVariableType(value),
                });
            }
        });
        currentScope = currentScope.parent;
    }

    return variables;
}

function createStep(
    state: InterpreterState,
    node: t.Node,
    nodeId: string
): ExecutionStep {
    return {
        stepIndex: state.steps.length,
        nodeId,
        lineNumber: node.loc?.start.line || 0,
        code: '', // We'll fill this from the source
        variables: collectVariables(state.scope),
        callStack: [...state.callStack],
        isBreakpoint: state.breakpoints.includes(node.loc?.start.line || 0),
    };
}

function addStep(state: InterpreterState, node: t.Node): void {
    if (state.stepCount >= MAX_ITERATIONS) {
        throw new Error('Maximum execution steps exceeded. Possible infinite loop detected.');
    }
    state.stepCount++;

    const step = createStep(state, node, `node_${state.steps.length}`);
    state.steps.push(step);
}

export function executeCode(
    code: string,
    language: 'javascript' | 'python',
    breakpoints: number[] = []
): ExecutionTrace {
    if (language === 'python') {
        throw new Error('Python support coming soon');
    }

    const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
    });

    const state: InterpreterState = {
        scope: createScope(),
        callStack: [],
        steps: [],
        output: [],
        stepCount: 0,
        breakpoints,
        functions: new Map(),
        classes: new Map(),
    };

    // First pass: collect function and class declarations
    ast.program.body.forEach(statement => {
        if (t.isFunctionDeclaration(statement) && statement.id) {
            state.functions.set(statement.id.name, statement);
        }
        if (t.isClassDeclaration(statement) && statement.id) {
            state.classes.set(statement.id.name, statement);
        }
    });

    // Add built-in console.log
    const consoleObj = {
        log: (...args: unknown[]) => {
            state.output.push(args.map(a => String(a)).join(' '));
        },
    };
    declareVariable(state.scope, 'console', consoleObj);

    try {
        // Execute program
        ast.program.body.forEach(statement => {
            if (!t.isFunctionDeclaration(statement)) {
                evaluateStatement(statement, state, code);
            }
        });

        return {
            steps: state.steps,
            totalSteps: state.steps.length,
            hasError: false,
            output: state.output,
        };
    } catch (error) {
        return {
            steps: state.steps,
            totalSteps: state.steps.length,
            hasError: true,
            errorMessage: error instanceof Error ? error.message : 'Execution error',
            output: state.output,
        };
    }
}

function evaluateStatement(
    statement: t.Statement,
    state: InterpreterState,
    code: string
): unknown {
    addStep(state, statement);

    if (t.isVariableDeclaration(statement)) {
        statement.declarations.forEach(decl => {
            if (t.isIdentifier(decl.id)) {
                const value = decl.init ? evaluateExpression(decl.init, state, code) : undefined;
                declareVariable(state.scope, decl.id.name, value);
            }
        });
        return undefined;
    }

    if (t.isExpressionStatement(statement)) {
        return evaluateExpression(statement.expression, state, code);
    }

    if (t.isIfStatement(statement)) {
        const condition = evaluateExpression(statement.test, state, code);
        if (condition) {
            if (t.isBlockStatement(statement.consequent)) {
                for (const stmt of statement.consequent.body) {
                    const result = evaluateStatement(stmt, state, code);
                    if (result && typeof result === 'object' && 'isReturn' in result) {
                        return result;
                    }
                }
            } else {
                return evaluateStatement(statement.consequent, state, code);
            }
        } else if (statement.alternate) {
            if (t.isBlockStatement(statement.alternate)) {
                for (const stmt of statement.alternate.body) {
                    const result = evaluateStatement(stmt, state, code);
                    if (result && typeof result === 'object' && 'isReturn' in result) {
                        return result;
                    }
                }
            } else {
                return evaluateStatement(statement.alternate, state, code);
            }
        }
        return undefined;
    }

    if (t.isForStatement(statement)) {
        // Initialize
        if (statement.init) {
            if (t.isVariableDeclaration(statement.init)) {
                evaluateStatement(statement.init, state, code);
            } else {
                evaluateExpression(statement.init, state, code);
            }
        }

        let iterations = 0;
        while (true) {
            if (iterations++ > MAX_ITERATIONS) {
                throw new Error('Maximum loop iterations exceeded. Possible infinite loop.');
            }

            // Test condition
            if (statement.test) {
                addStep(state, statement);
                const condition = evaluateExpression(statement.test, state, code);
                if (!condition) break;
            }

            // Execute body
            if (t.isBlockStatement(statement.body)) {
                for (const stmt of statement.body.body) {
                    const result = evaluateStatement(stmt, state, code);
                    if (result && typeof result === 'object' && 'isReturn' in result) {
                        return result;
                    }
                }
            } else {
                evaluateStatement(statement.body, state, code);
            }

            // Update
            if (statement.update) {
                evaluateExpression(statement.update, state, code);
            }
        }
        return undefined;
    }

    if (t.isWhileStatement(statement)) {
        let iterations = 0;
        while (true) {
            if (iterations++ > MAX_ITERATIONS) {
                throw new Error('Maximum loop iterations exceeded. Possible infinite loop.');
            }

            addStep(state, statement);
            const condition = evaluateExpression(statement.test, state, code);
            if (!condition) break;

            if (t.isBlockStatement(statement.body)) {
                for (const stmt of statement.body.body) {
                    const result = evaluateStatement(stmt, state, code);
                    if (result && typeof result === 'object' && 'isReturn' in result) {
                        return result;
                    }
                }
            } else {
                evaluateStatement(statement.body, state, code);
            }
        }
        return undefined;
    }

    if (t.isReturnStatement(statement)) {
        const value = statement.argument
            ? evaluateExpression(statement.argument, state, code)
            : undefined;
        return { isReturn: true, value };
    }

    if (t.isClassDeclaration(statement)) {
        // Already collected in first pass, but we might want to step on it?
        // Or just return undefined.
        // Let's add a step for the class declaration itself so it shows up
        // (Step was added at top of evaluateStatement function)
        return undefined;
    }

    if (t.isBlockStatement(statement)) {
        for (const stmt of statement.body) {
            const result = evaluateStatement(stmt, state, code);
            if (result && typeof result === 'object' && 'isReturn' in result) {
                return result;
            }
        }
        return undefined;
    }

    return undefined;
}

function evaluateExpression(
    expression: t.Expression | t.PrivateName,
    state: InterpreterState,
    code: string
): unknown {
    if (t.isNumericLiteral(expression)) {
        return expression.value;
    }

    if (t.isStringLiteral(expression)) {
        return expression.value;
    }

    if (t.isBooleanLiteral(expression)) {
        return expression.value;
    }

    if (t.isNullLiteral(expression)) {
        return null;
    }

    if (t.isIdentifier(expression)) {
        return lookupVariable(state.scope, expression.name);
    }

    if (t.isArrayExpression(expression)) {
        return expression.elements.map(el => {
            if (el === null) return undefined;
            if (t.isSpreadElement(el)) {
                return evaluateExpression(el.argument, state, code);
            }
            return evaluateExpression(el, state, code);
        });
    }

    if (t.isObjectExpression(expression)) {
        const obj: Record<string, unknown> = {};
        expression.properties.forEach(prop => {
            if (t.isObjectProperty(prop)) {
                const key = t.isIdentifier(prop.key)
                    ? prop.key.name
                    : t.isStringLiteral(prop.key)
                        ? prop.key.value
                        : String(prop.key);
                obj[key] = t.isExpression(prop.value)
                    ? evaluateExpression(prop.value, state, code)
                    : undefined;
            }
        });
        return obj;
    }

    if (t.isBinaryExpression(expression)) {
        const left = evaluateExpression(expression.left, state, code);
        const right = evaluateExpression(expression.right, state, code);

        switch (expression.operator) {
            case '+': return (left as number) + (right as number);
            case '-': return (left as number) - (right as number);
            case '*': return (left as number) * (right as number);
            case '/': return (left as number) / (right as number);
            case '%': return (left as number) % (right as number);
            case '**': return Math.pow(left as number, right as number);
            case '<': return (left as number) < (right as number);
            case '>': return (left as number) > (right as number);
            case '<=': return (left as number) <= (right as number);
            case '>=': return (left as number) >= (right as number);
            case '==': return left == right;
            case '===': return left === right;
            case '!=': return left != right;
            case '!==': return left !== right;
            default:
                return undefined;
        }
    }

    if (t.isUnaryExpression(expression)) {
        const arg = evaluateExpression(expression.argument, state, code);
        switch (expression.operator) {
            case '!': return !arg;
            case '-': return -(arg as number);
            case '+': return +(arg as number);
            case 'typeof': return typeof arg;
            default:
                return undefined;
        }
    }

    if (t.isUpdateExpression(expression)) {
        if (t.isIdentifier(expression.argument)) {
            const current = lookupVariable(state.scope, expression.argument.name) as number;
            const newValue = expression.operator === '++' ? current + 1 : current - 1;
            setVariable(state.scope, expression.argument.name, newValue);
            return expression.prefix ? newValue : current;
        }
        return undefined;
    }

    if (t.isAssignmentExpression(expression)) {
        const value = evaluateExpression(expression.right, state, code);

        if (t.isIdentifier(expression.left)) {
            let finalValue = value;
            if (expression.operator !== '=') {
                const current = lookupVariable(state.scope, expression.left.name);
                switch (expression.operator) {
                    case '+=': finalValue = (current as number) + (value as number); break;
                    case '-=': finalValue = (current as number) - (value as number); break;
                    case '*=': finalValue = (current as number) * (value as number); break;
                    case '/=': finalValue = (current as number) / (value as number); break;
                }
            }
            setVariable(state.scope, expression.left.name, finalValue);
            return finalValue;
        }

        if (t.isMemberExpression(expression.left)) {
            const obj = evaluateExpression(expression.left.object, state, code) as Record<string, unknown>;
            const prop = t.isIdentifier(expression.left.property)
                ? expression.left.property.name
                : evaluateExpression(expression.left.property as t.Expression, state, code);
            if (obj && typeof obj === 'object') {
                obj[prop as string] = value;
            }
            return value;
        }

        return value;
    }

    if (t.isMemberExpression(expression)) {
        const obj = evaluateExpression(expression.object, state, code) as Record<string, unknown>;
        const prop = expression.computed
            ? evaluateExpression(expression.property as t.Expression, state, code)
            : t.isIdentifier(expression.property)
                ? expression.property.name
                : undefined;

        if (obj && prop !== undefined) {
            const value = obj[prop as string];
            // Handle console.log as special case
            if (typeof value === 'function') {
                return value.bind(obj);
            }
            return value;
        }
        return undefined;
    }

    if (t.isThisExpression(expression)) {
        return lookupVariable(state.scope, 'this');
    }

    if (t.isNewExpression(expression)) {
        if (!t.isIdentifier(expression.callee)) {
            throw new Error('Only identifier-based class instantiation is supported');
        }

        const className = expression.callee.name;
        const classDecl = state.classes.get(className);

        if (!classDecl) {
            throw new Error(`Class ${className} not found`);
        }

        const args = expression.arguments.map(arg => {
            if (t.isExpression(arg)) {
                return evaluateExpression(arg, state, code);
            }
            return undefined;
        });

        // Create instance
        const instance: Record<string, unknown> = {
            __className: className
        };

        // Find constructor
        let constructor: t.ClassMethod | undefined;
        classDecl.body.body.forEach(member => {
            if (t.isClassMethod(member) && t.isIdentifier(member.key) && member.key.name === 'constructor') {
                constructor = member;
            }
        });

        if (constructor) {
            if (state.callStack.length >= MAX_CALL_DEPTH) {
                throw new Error('Maximum call stack depth exceeded.');
            }

            const funcScope = createScope(state.scope);

            // Bind 'this'
            declareVariable(funcScope, 'this', instance);

            // Bind params
            constructor.params.forEach((param, i) => {
                if (t.isIdentifier(param)) {
                    declareVariable(funcScope, param.name, args[i]);
                }
            });

            const frame: CallFrame = {
                id: `frame_${state.callStack.length}`,
                functionName: `${className}.constructor`,
                lineNumber: expression.loc?.start.line || 0,
                variables: new Map(),
            };
            funcScope.variables.forEach((value, name) => {
                frame.variables.set(name, { name, value, type: getVariableType(value) });
            });
            state.callStack.push(frame);

            const previousScope = state.scope;
            state.scope = funcScope;

            // Execute constructor body
            if (constructor.body) {
                for (const stmt of constructor.body.body) {
                    const result = evaluateStatement(stmt, state, code);
                    if (result && typeof result === 'object' && 'isReturn' in result) {
                        break;
                    }
                }
            }

            state.scope = previousScope;
            state.callStack.pop();
        }

        return instance;
    }

    if (t.isCallExpression(expression)) {
        const calleeNode = expression.callee;

        // Handle method call (obj.method())
        if (t.isMemberExpression(calleeNode)) {
            const obj = evaluateExpression(calleeNode.object, state, code) as Record<string, unknown>;
            const prop = t.isIdentifier(calleeNode.property)
                ? calleeNode.property.name
                : evaluateExpression(calleeNode.property as t.Expression, state, code) as string;

            if (obj && obj.__className) {
                const className = obj.__className as string;
                const classDecl = state.classes.get(className);

                if (classDecl) {
                    // Find method
                    let method: t.ClassMethod | undefined;
                    classDecl.body.body.forEach(member => {
                        if (t.isClassMethod(member) && t.isIdentifier(member.key) && member.key.name === prop) {
                            method = member;
                        }
                    });

                    if (method) {
                        const args = expression.arguments.map(arg => {
                            if (t.isExpression(arg)) {
                                return evaluateExpression(arg, state, code);
                            }
                            return undefined;
                        });

                        if (state.callStack.length >= MAX_CALL_DEPTH) {
                            throw new Error('Maximum call stack depth exceeded.');
                        }

                        const funcScope = createScope(state.scope);

                        // Bind 'this'
                        declareVariable(funcScope, 'this', obj);

                        // Bind params
                        method.params.forEach((param, i) => {
                            if (t.isIdentifier(param)) {
                                declareVariable(funcScope, param.name, args[i]);
                            }
                        });

                        const frame: CallFrame = {
                            id: `frame_${state.callStack.length}`,
                            functionName: `${className}.${prop}`,
                            lineNumber: expression.loc?.start.line || 0,
                            variables: new Map(),
                        };
                        funcScope.variables.forEach((value, name) => {
                            frame.variables.set(name, { name, value, type: getVariableType(value) });
                        });
                        state.callStack.push(frame);

                        const previousScope = state.scope;
                        state.scope = funcScope;

                        let returnValue: unknown = undefined;
                        if (method.body) {
                            for (const stmt of method.body.body) {
                                const result = evaluateStatement(stmt, state, code);
                                if (result && typeof result === 'object' && 'isReturn' in result) {
                                    returnValue = (result as { isReturn: boolean; value: unknown }).value;
                                    break;
                                }
                            }
                        }

                        state.scope = previousScope;
                        state.callStack.pop();
                        return returnValue;
                    }
                }
            }
        }

        let callee: unknown;
        if (t.isExpression(calleeNode)) {
            callee = evaluateExpression(calleeNode, state, code);
        }
        const args = expression.arguments.map(arg => {
            if (t.isExpression(arg)) {
                return evaluateExpression(arg, state, code);
            }
            return undefined;
        });

        if (typeof callee === 'function') {
            return callee(...args);
        }

        // User-defined function
        let funcName = '';
        if (t.isIdentifier(expression.callee)) {
            funcName = expression.callee.name;
        } else if (t.isMemberExpression(expression.callee)) {
            funcName = t.isIdentifier(expression.callee.property)
                ? expression.callee.property.name
                : '';
        }

        const funcDecl = state.functions.get(funcName);
        if (funcDecl) {
            if (state.callStack.length >= MAX_CALL_DEPTH) {
                throw new Error('Maximum call stack depth exceeded. Possible infinite recursion.');
            }

            // Create new scope for function
            const funcScope = createScope(state.scope);

            // Bind parameters
            funcDecl.params.forEach((param, i) => {
                if (t.isIdentifier(param)) {
                    declareVariable(funcScope, param.name, args[i]);
                }
            });

            // Push call frame
            const frame: CallFrame = {
                id: `frame_${state.callStack.length}`,
                functionName: funcName,
                lineNumber: expression.loc?.start.line || 0,
                variables: new Map(),
            };
            // Copy variables for display
            funcScope.variables.forEach((value, name) => {
                frame.variables.set(name, {
                    name,
                    value,
                    type: getVariableType(value),
                });
            });
            state.callStack.push(frame);

            // Save current scope and switch to function scope
            const previousScope = state.scope;
            state.scope = funcScope;

            // Execute function body
            let returnValue: unknown = undefined;
            if (funcDecl.body) {
                for (const stmt of funcDecl.body.body) {
                    const result = evaluateStatement(stmt, state, code);
                    if (result && typeof result === 'object' && 'isReturn' in result) {
                        returnValue = (result as { isReturn: boolean; value: unknown }).value;
                        break;
                    }
                }
            }

            // Restore scope and pop call frame
            state.scope = previousScope;
            state.callStack.pop();

            return returnValue;
        }

        return undefined;
    }

    if (t.isConditionalExpression(expression)) {
        const test = evaluateExpression(expression.test, state, code);
        return test
            ? evaluateExpression(expression.consequent, state, code)
            : evaluateExpression(expression.alternate, state, code);
    }

    if (t.isLogicalExpression(expression)) {
        const left = evaluateExpression(expression.left, state, code);
        if (expression.operator === '&&') {
            return left ? evaluateExpression(expression.right, state, code) : left;
        }
        if (expression.operator === '||') {
            return left ? left : evaluateExpression(expression.right, state, code);
        }
        if (expression.operator === '??') {
            return left !== null && left !== undefined
                ? left
                : evaluateExpression(expression.right, state, code);
        }
    }

    return undefined;
}
