import * as parser from '@babel/parser';
import * as t from '@babel/types';
import { parsePythonCode } from '../parser/pythonParser.ts';
import type {
    ExecutionTrace,
    ExecutionStep,
    VariableValue,
    CallFrame
} from '../../types';

const MAX_ITERATIONS = 10000;
const MAX_CALL_DEPTH = 100;

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

interface Scope {
    variables: Map<string, unknown>;
    parent: Scope | null;
}

// Helper classes for Python Runtime
class PythonList {
    items: any[];

    constructor(...args: any[]) {
        this.items = [];
        // Handle both new PythonList([1, 2]) and new PythonList(1, 2)
        if (args.length === 1 && Array.isArray(args[0])) {
            this.items.push(...args[0]);
        } else {
            this.items.push(...args);
        }
    }

    append(item: any) {
        this.items.push(item);
    }

    push(...items: any[]) {
        this.items.push(...items);
        return this.items.length;
    }

    forEach(callback: (value: any, index: number, array: any[]) => void) {
        this.items.forEach(callback);
    }

    map(callback: (value: any, index: number, array: any[]) => any) {
        return this.items.map(callback);
    }

    toJSON() {
        return this.items;
    }

    [Symbol.iterator]() {
        return this.items[Symbol.iterator]();
    }

    get length() {
        return this.items.length;
    }

    toString() {
        return this.items.toString();
    }
}

class PythonDict {
    [key: string]: any;
    constructor(...pairs: any[][]) {
        pairs.forEach(pair => {
            if (Array.isArray(pair) && pair.length >= 2) {
                this[String(pair[0])] = pair[1];
            }
        });
    }
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
    if (value instanceof PythonList) return 'list';
    return typeof value;
}

function cloneValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;

    if (seen.has(value as object)) return seen.get(value as object);

    if (value instanceof PythonList) {
        // Unwrap PythonList to native array for visualization snapshot
        return cloneValue(value.items, seen);
    }

    if (Array.isArray(value)) {
        const arr: unknown[] = [];
        seen.set(value, arr);
        value.forEach(v => arr.push(cloneValue(v, seen)));
        return arr;
    }

    const obj: Record<string, unknown> = {};
    seen.set(value as object, obj);

    for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            obj[key] = cloneValue((value as Record<string, unknown>)[key], seen);
        }
    }
    return obj;
}

const BUILTIN_VARIABLES = new Set([
    'console',
    'Array',
    'Object',
    'Math',
    'Number',
    'String',
    'Boolean',
    'Date',
    'parseInt',
    'parseFloat',
    'isNaN',
    'isFinite',
    'JSON',
    // Python built-ins
    'print',
    'range',
    'len',
    'str',
    'int',
    'float',
    'abs',
    'min',
    'max',
    'type',
    'bool',
    'sum',
    '__pythonRuntime'
]);

function collectVariables(scope: Scope): VariableValue[] {
    const variables: VariableValue[] = [];
    let currentScope: Scope | null = scope;
    const seen = new Set<string>();

    while (currentScope) {
        currentScope.variables.forEach((value, name) => {
            // Filter out internal Python runtime variables and private vars
            if (!seen.has(name) && !name.startsWith('__')) {
                if (BUILTIN_VARIABLES.has(name)) return;

                seen.add(name);

                // Create a deep snapshot of the value to prevent future mutations 
                // from affecting historical steps
                const snapshotValue = cloneValue(value);

                variables.push({
                    name,
                    value: snapshotValue,
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

function isExpressionOrLiteral(node: t.Node | null | undefined): boolean {
    if (!node) return false;
    if (!node) return false;
    return t.isExpression(node) || t.isLiteral(node) || (node as any).type === 'Literal';
}

function shouldIgnoreStep(statement: t.Statement): boolean {
    // Ignore internal variable declarations (filbert generated)
    if (t.isVariableDeclaration(statement)) {
        return statement.declarations.some(decl =>
            t.isIdentifier(decl.id) && decl.id.name.startsWith('__')
        );
    }

    // Ignore internal if checks (parameter validation)
    if (t.isIfStatement(statement)) {
        // Check if test condition involves internal variables
        if (t.isBinaryExpression(statement.test)) {
            if (t.isIdentifier(statement.test.left) && statement.test.left.name.startsWith('__')) {
                return true;
            }
        }
    }

    return false;
}

export function executeCode(
    code: string,
    language: 'javascript' | 'python',
    breakpoints: number[] = []
): ExecutionTrace {

    let ast: t.File;

    try {
        if (language === 'python') {
            ast = parsePythonCode(code);
        } else {
            ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
                errorRecovery: true,
            });
        }
    } catch (error) {
        return {
            steps: [],
            totalSteps: 0,
            hasError: true,
            errorMessage: error instanceof Error ? error.message : 'Parse error',
            output: [],
        };
    }

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
    declareVariable(state.scope, 'Array', Array);
    declareVariable(state.scope, 'Object', Object);
    declareVariable(state.scope, 'Math', Math);
    declareVariable(state.scope, 'Number', Number);
    declareVariable(state.scope, 'String', String);
    declareVariable(state.scope, 'Boolean', Boolean);
    declareVariable(state.scope, 'Date', Date);
    declareVariable(state.scope, 'parseInt', parseInt);
    declareVariable(state.scope, 'parseFloat', parseFloat);
    declareVariable(state.scope, 'isNaN', isNaN);
    declareVariable(state.scope, 'isFinite', isFinite);
    declareVariable(state.scope, 'JSON', JSON);

    // Python Runtime Support
    if (language === 'python') {
        const pythonRuntime = {
            objects: {
                list: PythonList,
                dict: PythonDict,
            },
            ops: {
                add: (a: any, b: any) => a + b,
                subtract: (a: any, b: any) => a - b,
                multiply: (a: any, b: any) => a * b,
                divide: (a: any, b: any) => a / b,
                floorDivide: (a: any, b: any) => Math.floor(a / b),
                mod: (a: any, b: any) => a % b,
                pow: (a: any, b: any) => Math.pow(a, b),
                eq: (a: any, b: any) => a == b,
                ne: (a: any, b: any) => a != b,
                lt: (a: any, b: any) => a < b,
                lte: (a: any, b: any) => a <= b,
                gt: (a: any, b: any) => a > b,
                gte: (a: any, b: any) => a >= b,
                in: (a: any, b: any) => {
                    if (Array.isArray(b)) return b.includes(a);
                    if (b instanceof PythonList) return b.items.includes(a);
                    if (typeof b === 'object' && b !== null) return a in b; // Check keys
                    return false;
                },
                notIn: (a: any, b: any) => {
                    if (Array.isArray(b)) return !b.includes(a);
                    if (b instanceof PythonList) return !b.items.includes(a);
                    if (typeof b === 'object' && b !== null) return !(a in b);
                    return true;
                },
                is: (a: any, b: any) => Object.is(a, b),
                isNot: (a: any, b: any) => !Object.is(a, b),
                and: (a: any, b: any) => a && b,
                or: (a: any, b: any) => a || b,
                not: (a: any) => !a,
                usub: (a: any) => -a,
                uadd: (a: any) => +a,
                subscriptIndex: (obj: any, key: any) => {
                    return obj[key];
                },
            },
            functions: {
                print: (...args: any[]) => {
                    const output = args.map(arg => {
                        if (Array.isArray(arg)) {
                            return JSON.stringify(arg);
                        }
                        if (typeof arg === 'object' && arg !== null) {
                            if (arg instanceof PythonList || (arg.constructor && arg.constructor.name === 'PythonDict')) {
                                return JSON.stringify(arg);
                            }
                            // Plain object (dict)
                            return JSON.stringify(arg);
                        }
                        return String(arg);
                    }).join(' ');
                    state.output.push(output);
                },
                range: (start: number, stop?: number, step: number = 1) => {
                    if (stop === undefined) {
                        stop = start;
                        start = 0;
                    }
                    const result = new PythonList();
                    for (let i = start; minCheck(i, stop, step); i += step) {
                        result.push(i);
                    }
                    return result;

                    function minCheck(curr: number, end: number, s: number) {
                        return s > 0 ? curr < end : curr > end;
                    }
                },
                len: (obj: any) => {
                    if (Array.isArray(obj) || typeof obj === 'string') return obj.length;
                    if (obj instanceof PythonList) return obj.length;
                    if (obj instanceof Set || obj instanceof Map) return obj.size;
                    if (typeof obj === 'object' && obj !== null) return Object.keys(obj).length;
                    return 0;
                },
                str: (obj: any) => {
                    if (obj instanceof PythonList) return JSON.stringify(obj.items);
                    if (typeof obj === 'object' && obj !== null) return JSON.stringify(obj);
                    return String(obj);
                },
                int: (obj: any) => {
                    return parseInt(obj, 10);
                },
                float: (obj: any) => {
                    return parseFloat(obj);
                },
                abs: (obj: any) => Math.abs(obj),
                min: (...args: any[]) => {
                    if (args.length === 1 && (Array.isArray(args[0]) || args[0] instanceof PythonList)) {
                        const arr = args[0] instanceof PythonList ? args[0].items : args[0];
                        return Math.min(...arr);
                    }
                    return Math.min(...args);
                },
                max: (...args: any[]) => {
                    if (args.length === 1 && (Array.isArray(args[0]) || args[0] instanceof PythonList)) {
                        const arr = args[0] instanceof PythonList ? args[0].items : args[0];
                        return Math.max(...arr);
                    }
                    return Math.max(...args);
                },
                type: (obj: any) => {
                    if (obj === null) return 'NoneType';
                    if (obj instanceof PythonList) return 'list';
                    if (Array.isArray(obj)) return 'list';
                    if (typeof obj === 'object') return 'dict';
                    return typeof obj;
                },
                bool: (obj: any) => Boolean(obj),
                sum: (arr: any) => {
                    const items = arr instanceof PythonList ? arr.items : arr;
                    return items.reduce((a: number, b: number) => a + b, 0);
                }
            }
        };
        declareVariable(state.scope, '__pythonRuntime', pythonRuntime);

        // Expose Python built-ins to global scope
        Object.entries(pythonRuntime.functions).forEach(([name, func]) => {
            declareVariable(state.scope, name, func);
        });
    }

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
    if (!shouldIgnoreStep(statement)) {
        addStep(state, statement);
    }

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
                if (Boolean(statement.test) && !condition) break;
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

    // Support ForOfStatement in case filbert generates it
    // Handle ForInStatement as well (treating it as value iteration for Python compatibility)
    if (t.isForOfStatement(statement) || t.isForInStatement(statement)) {
        const right = evaluateExpression(statement.right, state, code);

        // Ensure right is iterable
        if (right == null || typeof (right as any)[Symbol.iterator] !== 'function') {
            throw new Error('Right side of for-of/in is not iterable');
        }

        let iterations = 0;
        // Iterate
        for (const value of (right as Iterable<unknown>)) {
            if (iterations++ > MAX_ITERATIONS) {
                throw new Error('Maximum loop iterations exceeded. Possible infinite loop.');
            }

            // Assign to left
            if (t.isVariableDeclaration(statement.left)) {
                // let x of ...
                const decl = statement.left.declarations[0];
                if (t.isIdentifier(decl.id)) {
                    declareVariable(state.scope, decl.id.name, value);
                }
            } else if (t.isIdentifier(statement.left)) {
                setVariable(state.scope, statement.left.name, value);
            } else if (t.isMemberExpression(statement.left)) {
                const obj = evaluateExpression(statement.left.object, state, code) as Record<string, unknown>;
                const prop = t.isIdentifier(statement.left.property) ? statement.left.property.name : evaluateExpression(statement.left.property as t.Expression, state, code);
                if (obj) obj[prop as string] = value;
            }

            addStep(state, statement);

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
    if ((expression as any).type === 'Literal') {
        return (expression as any).value;
    }

    if (t.isNumericLiteral(expression)) {
        return expression.value;
    }

    if (t.isStringLiteral(expression)) {
        return expression.value;
    }

    if (t.isTemplateLiteral(expression)) {
        let result = '';
        expression.quasis.forEach((element, i) => {
            result += element.value.cooked || element.value.raw;
            if (i < expression.expressions.length) {
                const expr = expression.expressions[i];
                if (t.isExpression(expr) || t.isLiteral(expr)) { // Expressions are TSType | Expression in Babel, narrowing needed
                    const val = evaluateExpression(expr as t.Expression, state, code);
                    result += String(val);
                }
            }
        });
        return result;
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
        const elements = expression.elements.map(el => {
            if (el === null) return undefined;
            if (t.isSpreadElement(el)) {
                return evaluateExpression(el.argument, state, code);
            }
            return evaluateExpression(el, state, code);
        });

        // If Python Runtime is active, return PythonList instead of native Array
        if (lookupVariable(state.scope, '__pythonRuntime')) {
            return new PythonList(elements);
        }

        return elements;
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
                obj[key] = isExpressionOrLiteral(prop.value as t.Node)
                    ? evaluateExpression(prop.value as t.Expression, state, code)
                    : undefined;
            }
        });
        return obj;
    }

    if (t.isSequenceExpression(expression)) {
        let result: unknown;
        expression.expressions.forEach(expr => {
            result = evaluateExpression(expr, state, code);
        });
        return result;
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
            let prop;
            if (expression.left.computed) {
                prop = evaluateExpression(expression.left.property as t.Expression, state, code);
            } else {
                prop = t.isIdentifier(expression.left.property)
                    ? expression.left.property.name
                    : evaluateExpression(expression.left.property as t.Expression, state, code);
            }
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
                const bound = value.bind(obj);
                // Also copy properties if needed? Not for now.
                return bound;
            }
            return value;
        }
        return undefined;
    }

    if (t.isThisExpression(expression)) {
        return lookupVariable(state.scope, 'this');
    }

    if (t.isArrowFunctionExpression(expression) || t.isFunctionExpression(expression)) {
        return (...args: unknown[]) => {
            const funcScope = createScope(state.scope);

            expression.params.forEach((param, i) => {
                if (t.isIdentifier(param)) {
                    declareVariable(funcScope, param.name, args[i]);
                }
            });

            const frame: CallFrame = {
                id: `frame_${state.callStack.length}`,
                functionName: '(anonymous)',
                lineNumber: expression.loc?.start.line || 0,
                variables: new Map(),
            };
            // Initial variables
            funcScope.variables.forEach((val, name) => {
                frame.variables.set(name, { name, value: val, type: getVariableType(val) });
            });
            state.callStack.push(frame);

            const previousScope = state.scope;
            state.scope = funcScope;

            let returnValue: unknown = undefined;

            if (t.isBlockStatement(expression.body)) {
                for (const stmt of expression.body.body) {
                    const res = evaluateStatement(stmt, state, code);
                    if (res && typeof res === 'object' && 'isReturn' in res) {
                        returnValue = (res as { isReturn: boolean; value: unknown }).value;
                        break;
                    }
                }
            } else {
                returnValue = evaluateExpression(expression.body as t.Expression, state, code);
            }

            state.scope = previousScope;
            state.callStack.pop();

            return returnValue;
        };
    }

    if (t.isNewExpression(expression)) {
        let constructor: unknown;
        let isUserClass = false;
        let className = '';

        if (t.isIdentifier(expression.callee)) {
            className = expression.callee.name;
            if (state.classes.has(className)) {
                isUserClass = true;
            } else {
                constructor = lookupVariable(state.scope, className);
            }
        } else {
            constructor = evaluateExpression(expression.callee as t.Expression, state, code);
        }

        const args = expression.arguments.map(arg => {
            if (isExpressionOrLiteral(arg)) {
                return evaluateExpression(arg as t.Expression, state, code);
            }
            return undefined;
        });

        if (isUserClass) {
            const classDecl = state.classes.get(className);
            if (!classDecl) throw new Error(`Class ${className} not found`);

            // Create instance
            const instance: Record<string, unknown> = {
                __className: className
            };

            // Find constructor
            let ctorMethod: t.ClassMethod | undefined;
            classDecl.body.body.forEach(member => {
                if (t.isClassMethod(member) && t.isIdentifier(member.key) && member.key.name === 'constructor') {
                    ctorMethod = member;
                }
            });

            if (ctorMethod) {
                if (state.callStack.length >= MAX_CALL_DEPTH) {
                    throw new Error('Maximum call stack depth exceeded.');
                }

                const funcScope = createScope(state.scope);

                // Bind 'this'
                declareVariable(funcScope, 'this', instance);

                // Bind params
                ctorMethod.params.forEach((param, i) => {
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
                if (ctorMethod.body) {
                    for (const stmt of ctorMethod.body.body) {
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

        if (typeof constructor === 'function') {
            return new (constructor as any)(...args);
        }

        throw new Error('Expression is not a constructor');
    }

    if (t.isCallExpression(expression)) {
        const calleeNode = expression.callee;

        // Handle method call (obj.method())
        if (t.isMemberExpression(calleeNode)) {
            const obj = evaluateExpression(calleeNode.object, state, code) as Record<string, unknown>;

            // Check for Python Runtime Ops mapping
            // Note: AST transform for Python maps a + b -> __pythonRuntime.ops.add(a, b)
            // This is a MemberExpression call: __pythonRuntime.ops...

            const prop = calleeNode.computed
                ? evaluateExpression(calleeNode.property as t.Expression, state, code) as string
                : t.isIdentifier(calleeNode.property)
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
                            if (isExpressionOrLiteral(arg)) {
                                return evaluateExpression(arg as t.Expression, state, code);
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

            // If it's a native function (like from pythonRuntime), execute it
            // We retrieved 'property' above, but we need the function itself
            if (obj && typeof obj[prop] === 'function') {
                const args = expression.arguments.map(arg => {
                    if (isExpressionOrLiteral(arg)) {
                        return evaluateExpression(arg as t.Expression, state, code);
                    }
                    return undefined;
                });
                return (obj[prop] as Function).call(obj, ...args);
            }
        }

        let callee: unknown;
        if (t.isExpression(calleeNode)) {
            callee = evaluateExpression(calleeNode, state, code);
        }
        const args = expression.arguments.map(arg => {
            if (isExpressionOrLiteral(arg)) {
                return evaluateExpression(arg as t.Expression, state, code);
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

            // Visual Step: Highlight the function declaration line (Entry)
            addStep(state, funcDecl);

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
