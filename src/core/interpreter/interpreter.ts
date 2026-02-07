import * as parser from '@babel/parser';
import * as t from '@babel/types';
import { parsePythonCode } from '../parser/pythonParser.ts';
import { parseCCode } from '../parser/cParser.ts';
import { printf, CInt, CFloat, CDouble, CChar, CArray, CStructDef, createCType, getDefaultValue } from './cRuntime.ts';
import { CMemory, CPointer } from './cMemory.ts';
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
    memory?: CMemory;
    structDefs?: Map<string, CStructDef>;
}

interface Scope {
    variables: Map<string, unknown>;
    parent: Scope | null;
}

export class CVariable {
    public address: number;
    public type: string;
    constructor(address: number, type: string) {
        this.address = address;
        this.type = type;
    }
    toString() { return `<CVar ${this.type} @ 0x${this.address.toString(16)}>`; }
}

export class CStructRef {
    public address: number;
    public def: CStructDef;
    public memory: CMemory;

    constructor(address: number, def: CStructDef, memory: CMemory) {
        this.address = address;
        this.def = def;
        this.memory = memory;
    }

    toString() {
        return `<struct ${this.def.name} @ 0x${this.address.toString(16)}>`;
    }
}

// Helper classes for Python Runtime
export class PythonList {
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

    toString(): string {
        return `[${this.items.map(item => {
            if (typeof item === 'string') return `'${item}'`;
            if (item === null) return 'None';
            if (item === true) return 'True';
            if (item === false) return 'False';
            if (item && typeof item === 'object' && item.toString && (item instanceof PythonList || item instanceof PythonTuple || item instanceof PythonSet)) {
                return item.toString();
            }
            if (Array.isArray(item)) return JSON.stringify(item);
            return String(item);
        }).join(', ')}]`;
    }

    pop(index: number = -1) {
        if (this.items.length === 0) {
            throw new Error('pop from empty list');
        }
        if (index < 0) {
            index = this.items.length + index;
        }
        if (index < 0 || index >= this.items.length) {
            throw new Error('pop index out of range');
        }
        return this.items.splice(index, 1)[0];
    }

    extend(iterable: any) {
        if (Array.isArray(iterable)) {
            this.items.push(...iterable);
        } else if (iterable instanceof PythonList) {
            this.items.push(...iterable.items);
        } else {
            throw new Error('TypeError: object is not iterable');
        }
    }

    insert(index: number, item: any) {
        if (index < 0) {
            index = Math.max(0, this.items.length + index);
        }
        index = Math.min(index, this.items.length);
        this.items.splice(index, 0, item);
    }

    remove(item: any) {
        const index = this.items.findIndex(i => i === item); // Simple equality for now
        if (index === -1) {
            throw new Error('ValueError: list.remove(x): x not in list');
        }
        this.items.splice(index, 1);
    }

    clear() {
        this.items = [];
    }

    index(item: any, start: number = 0, end: number = this.items.length) {
        if (start < 0) start = Math.max(0, this.items.length + start);
        if (end < 0) end = Math.max(0, this.items.length + end);

        const idx = this.items.slice(start, end).findIndex(i => i === item);
        if (idx === -1) {
            throw new Error(`ValueError: ${item} is not in list`);
        }
        return start + idx;
    }

    count(item: any) {
        return this.items.filter(i => i === item).length;
    }

    sort(key?: (a: any) => number, reverse: boolean = false) {
        this.items.sort((a, b) => {
            const valA = key ? key(a) : a;
            const valB = key ? key(b) : b;
            if (valA < valB) return reverse ? 1 : -1;
            if (valA > valB) return reverse ? -1 : 1;
            return 0;
        });
    }

    reverse() {
        this.items.reverse();
    }

    copy() {
        return new PythonList([...this.items]);
    }
}

export class PythonDict {
    [key: string]: any;
    constructor(...pairs: any[][]) {
        pairs.forEach(pair => {
            if (Array.isArray(pair) && pair.length >= 2) {
                this[String(pair[0])] = pair[1];
            }
        });
    }

    keys(): string[] {
        return Object.keys(this).filter(k => typeof this[k] !== 'function');
    }

    values(): any[] {
        return this.keys().map(k => this[k]);
    }

    items(): [string, any][] {
        return this.keys().map(k => [k, this[k]] as [string, any]);
    }

    get(key: string, defaultValue: any = undefined): any {
        return key in this ? this[key] : defaultValue;
    }

    update(other: Record<string, any>): void {
        Object.assign(this, other);
    }

    pop(key: string, defaultValue?: any) {
        if (Object.prototype.hasOwnProperty.call(this, key)) {
            const val = this[key];
            delete this[key];
            return val;
        }
        if (defaultValue !== undefined) {
            return defaultValue;
        }
        throw new Error(`KeyError: '${key}'`);
    }

    popitem() {
        const keys = this.keys();
        if (keys.length === 0) {
            throw new Error('KeyError: popitem(): dictionary is empty');
        }
        const key = keys[keys.length - 1]; // LIFO
        const value = this[key];
        delete this[key];
        return [key, value];
    }

    clear() {
        this.keys().forEach(key => delete this[key]);
    }

    setdefault(key: string, defaultValue: any = null) {
        if (Object.prototype.hasOwnProperty.call(this, key)) {
            return this[key];
        }
        this[key] = defaultValue;
        return defaultValue;
    }

    static fromkeys(iterable: any, value: any = null) {
        const dict = new PythonDict();
        let keys: any[] = [];
        if (Array.isArray(iterable)) {
            keys = iterable;
        } else if (iterable instanceof PythonList) {
            keys = iterable.items;
        }

        keys.forEach(k => {
            dict[String(k)] = value;
        });
        return dict;
    }
}

export class PythonSet {
    items: Set<any>;

    constructor(iterable: any = null) {
        this.items = new Set();
        if (iterable) {
            if (Array.isArray(iterable)) {
                iterable.forEach(i => this.items.add(i));
            } else if (iterable instanceof PythonList) {
                iterable.items.forEach(i => this.items.add(i));
            } else if (iterable instanceof PythonSet) {
                iterable.items.forEach(i => this.items.add(i));
            } else if (iterable instanceof PythonTuple) {
                iterable.items.forEach(i => this.items.add(i));
            } else if (typeof iterable === 'string') {
                for (const char of iterable) {
                    this.items.add(char);
                }
            }
        }
    }

    add(item: any) {
        this.items.add(item);
    }

    remove(item: any) {
        if (!this.items.has(item)) {
            throw new Error(`KeyError: ${item}`);
        }
        this.items.delete(item);
    }

    discard(item: any) {
        this.items.delete(item);
    }

    pop() {
        if (this.items.size === 0) {
            throw new Error('pop from an empty set');
        }
        const value = this.items.values().next().value;
        this.items.delete(value);
        return value;
    }

    clear() {
        this.items.clear();
    }

    copy() {
        // Create new set with same items
        const newSet = new PythonSet();
        this.items.forEach(i => newSet.add(i));
        return newSet;
    }

    union(...others: (PythonSet | Set<any>)[]) {
        const result = this.copy();
        others.forEach(other => {
            const items = other instanceof PythonSet ? other.items : other;
            items.forEach(item => result.add(item));
        });
        return result;
    }

    intersection(...others: (PythonSet | Set<any>)[]) {
        const result = new PythonSet();
        this.items.forEach(item => {
            if (others.every(other => {
                const items = other instanceof PythonSet ? other.items : other;
                return items.has(item);
            })) {
                result.add(item);
            }
        });
        return result;
    }

    difference(...others: (PythonSet | Set<any>)[]) {
        const result = this.copy();
        others.forEach(other => {
            const items = other instanceof PythonSet ? other.items : other;
            items.forEach(item => result.discard(item));
        });
        return result;
    }

    symmetric_difference(other: PythonSet) {
        const result = new PythonSet();
        this.items.forEach(item => {
            if (!other.items.has(item)) result.add(item);
        });
        other.items.forEach(item => {
            if (!this.items.has(item)) result.add(item);
        });
        return result;
    }

    issubset(other: PythonSet) {
        for (const item of this.items) {
            if (!other.items.has(item)) return false;
        }
        return true;
    }

    issuperset(other: PythonSet) {
        return other.issubset(this);
    }

    toJSON() {
        // Serialize as array for JSON
        return Array.from(this.items);
    }

    toString(): string {
        if (this.items.size === 0) return 'set()';
        return `{${Array.from(this.items).join(', ')}}`;
    }

    get length() {
        return this.items.size;
    }

    [Symbol.iterator]() {
        return this.items[Symbol.iterator]();
    }
}

export class PythonTuple {
    items: any[];

    constructor(iterable: any = []) {
        if (Array.isArray(iterable)) {
            this.items = [...iterable];
        } else if (iterable instanceof PythonList || iterable instanceof PythonTuple) {
            this.items = [...iterable.items];
        } else if (iterable instanceof PythonSet) {
            this.items = Array.from(iterable.items);
        } else if (typeof iterable === 'string') {
            this.items = iterable.split('');
        } else {
            // Handle single argument as ...args pattern if called directly via new PythonTuple(1, 2)
            // But signature says iterable. Standard python tuple([1,2]).
            // If we support new PythonTuple(1, 2) like list, we need to check args.
            // Let's stick to standard constructor taking one iterable.
            // But wait, PythonList supports (...args). Let's support both for convenience here if needed.
            // Actually, to keep it simple and consistent with standard Python: tuple([1,2]) -> (1, 2).
            // If we want (1, 2), we usually construct literals.
            // Let's assume the parser creates Tuples from literals by passing an array.
            this.items = Array.isArray(iterable) ? iterable : [iterable];
        }
        // Fix for arguments: usage in codebase is new PythonTuple([elements])
    }

    index(item: any, start: number = 0, end: number = this.items.length) {
        if (start < 0) start = Math.max(0, this.items.length + start);
        if (end < 0) end = Math.max(0, this.items.length + end);

        const idx = this.items.slice(start, end).findIndex(i => i === item);
        if (idx === -1) {
            throw new Error(`ValueError: ${item} is not in tuple`);
        }
        return start + idx;
    }

    count(item: any) {
        return this.items.filter(i => i === item).length;
    }

    toJSON() {
        return this.items;
    }

    toString(): string {
        const elements: string[] = this.items.map(item => {
            if (typeof item === 'string') return `'${item}'`;
            if (item === null) return 'None';
            if (item === true) return 'True';
            if (item === false) return 'False';
            if (item && typeof item === 'object' && item.toString && (item instanceof PythonList || item instanceof PythonTuple || item instanceof PythonSet)) {
                return item.toString();
            }
            return String(item);
        });

        if (elements.length === 1) {
            return `(${elements[0]},)`;
        }
        return `(${elements.join(', ')})`;
    }

    get length() {
        return this.items.length;
    }

    [Symbol.iterator]() {
        return this.items[Symbol.iterator]();
    }

    // Immutable: No set/add/remove methods
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

// Helper function to bind function parameters with support for default values and rest params
function bindParameters(
    params: (t.Identifier | t.Pattern | t.RestElement | t.TSParameterProperty)[],
    args: unknown[],
    scope: Scope,
    state: InterpreterState,
    code: string
): void {
    params.forEach((param, i) => {
        // Handle TSParameterProperty (e.g. constructor(public x: number))
        let actualParam = param;
        if (t.isTSParameterProperty(param)) {
            actualParam = param.parameter;
        }

        if (t.isIdentifier(actualParam)) {
            // Regular parameter
            declareVariable(scope, actualParam.name, args[i]);
        } else if (t.isAssignmentPattern(actualParam) && t.isIdentifier(actualParam.left)) {
            // Default parameter: function foo(x = 10)
            const value = args[i] !== undefined
                ? args[i]
                : evaluateExpression(actualParam.right, state, code);
            declareVariable(scope, actualParam.left.name, value);
        } else if (t.isRestElement(actualParam) && t.isIdentifier(actualParam.argument)) {
            // Rest parameter: function foo(...args)
            declareVariable(scope, actualParam.argument.name, args.slice(i));
        }
    });
}

// Helper function to collect function arguments with support for spread
function collectArguments(
    argumentNodes: (t.Expression | t.SpreadElement | t.ArgumentPlaceholder)[],
    state: InterpreterState,
    code: string
): unknown[] {
    const args: unknown[] = [];
    argumentNodes.forEach(arg => {
        if (t.isSpreadElement(arg)) {
            // Spread element: foo(...arr)
            const spreadValue = evaluateExpression(arg.argument, state, code);
            if (Array.isArray(spreadValue)) {
                args.push(...spreadValue);
            } else if (spreadValue instanceof PythonList) {
                args.push(...spreadValue.items);
            }
        } else if (isExpressionOrLiteral(arg)) {
            args.push(evaluateExpression(arg as t.Expression, state, code));
        } else {
            args.push(undefined);
        }
    });
    return args;
}

function getVariableType(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    if (value instanceof PythonList) return 'list';
    if (value instanceof PythonSet) return 'set';
    if (value instanceof PythonTuple) return 'tuple';
    if (value instanceof PythonDict) return 'dict';
    return typeof value;
}

function cloneValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;

    if (seen.has(value as object)) return seen.get(value as object);

    if (value instanceof PythonList) {
        return cloneValue(value.items, seen);
    }

    if (value instanceof PythonTuple) {
        // Visualize tuple as array marked as tuple? Or just simple array for now.
        // Current visualizer probably handles arrays generally. 
        // Let's pass array but maybe we need type info in variable entry (which we have).
        return cloneValue(value.items, seen);
    }

    if (value instanceof PythonSet) {
        // Convert set to array for visualization
        return cloneValue(Array.from(value.items), seen);
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
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
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
    // console.log('CreateStep:', nodeId, 'Memory:', !!state.memory);
    return {
        stepIndex: state.steps.length,
        nodeId,
        lineNumber: node.loc?.start.line || 0,
        code: '', // We'll fill this from the source
        variables: collectVariables(state.scope),
        callStack: [...state.callStack],
        isBreakpoint: state.breakpoints.includes(node.loc?.start.line || 0),
        memory: state.memory ? {
            heap: state.memory.getHeapState().map((b: any) => ({
                address: b.address,
                size: b.size,
                value: b.data,
                type: b.type,
                isAllocated: !b.freed,
                line: b.allocLine
            })),
            stack: state.memory.getStackState().flatMap((frame: any) =>
                frame.variables.map((v: any) => {
                    let val: any = '?';
                    try {
                        if (state.memory) val = state.memory.read(v.address);
                    } catch (e) { /* ignore */ }
                    return {
                        name: v.name,
                        value: val,
                        address: v.address,
                        type: v.type
                    };
                })
            )
        } : undefined,
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
    language: 'javascript' | 'python' | 'c',
    breakpoints: number[] = []
): ExecutionTrace {

    let ast: t.File;

    try {
        if (language === 'python') {
            ast = parsePythonCode(code);
        } else if (language === 'c') {
            ast = parseCCode(code);
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
        memory: undefined,
        structDefs: new Map(),
    };

    if (language === 'c') {
        state.memory = new CMemory();
    }

    // First pass: collect function and class declarations
    const body = ast.program.body;
    for (const statement of body) {
        if (t.isFunctionDeclaration(statement) && statement.id) {
            state.functions.set(statement.id.name, statement);
        } else if (t.isClassDeclaration(statement) && statement.id) {
            state.classes.set(statement.id.name, statement);

            // For C, also create CStructDef
            if (language === 'c' && state.structDefs) {
                const fields: Array<{ name: string, type: string }> = [];
                // Check class body for fields
                for (const member of statement.body.body) {
                    if (t.isClassProperty(member) && t.isIdentifier(member.key)) {
                        // Extract type from typeAnnotation if we hacked it in there
                        let type = 'int'; // default
                        if (member.typeAnnotation && t.isTSTypeAnnotation(member.typeAnnotation)) {
                            const typeRef = member.typeAnnotation.typeAnnotation;
                            // Check if it's a type reference with identifier (our hack)
                            if (t.isTSTypeReference(typeRef) && t.isIdentifier(typeRef.typeName)) {
                                type = typeRef.typeName.name;
                            }
                        }
                        fields.push({ name: member.key.name, type });
                    }
                }
                const structDef = new CStructDef(statement.id.name, fields);
                state.structDefs.set(statement.id.name, structDef);
            }
        }
    }

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
    declareVariable(state.scope, 'Map', Map);
    declareVariable(state.scope, 'Set', Set);
    declareVariable(state.scope, 'WeakMap', WeakMap);
    declareVariable(state.scope, 'WeakSet', WeakSet);

    // Python Runtime Support
    if (language === 'python') {
        const pythonRuntime = {
            objects: {
                list: PythonList,
                dict: PythonDict,
                set: PythonSet,
                tuple: PythonTuple,
            },
            ops: {
                add: (a: any, b: any) => a + b,
                subtract: (a: any, b: any) => {
                    if (a instanceof PythonSet && b instanceof PythonSet) {
                        return a.difference(b);
                    }
                    return a - b;
                },
                multiply: (a: any, b: any) => a * b,
                divide: (a: any, b: any) => a / b,
                floorDivide: (a: any, b: any) => Math.floor(a / b),
                mod: (a: any, b: any) => a % b,
                pow: (a: any, b: any) => Math.pow(a, b),
                eq: (a: any, b: any) => {
                    // Deep equality for our structures?
                    // For now simple equality or if both are lists/sets/tuples
                    if (a instanceof PythonSet && b instanceof PythonSet) {
                        if (a.length !== b.length) return false;
                        return a.issubset(b);
                    }
                    // ... other type checks
                    if (a instanceof PythonList && b instanceof PythonList) {
                        // Quick compare strings (lazy)
                        return a.toString() === b.toString();
                    }
                    return a == b;
                },
                ne: (a: any, b: any) => a != b,
                lt: (a: any, b: any) => a < b,
                lte: (a: any, b: any) => a <= b,
                gt: (a: any, b: any) => a > b,
                gte: (a: any, b: any) => a >= b,
                in: (a: any, b: any) => {
                    if (Array.isArray(b)) return b.includes(a);
                    if (b instanceof PythonList) return b.items.includes(a);
                    if (b instanceof PythonTuple) return b.items.includes(a);
                    if (b instanceof PythonSet) return b.items.has(a);
                    if (typeof b === 'object' && b !== null) return a in b; // Check keys
                    return false;
                },
                notIn: (a: any, b: any) => {
                    if (Array.isArray(b)) return !b.includes(a);
                    if (b instanceof PythonList) return !b.items.includes(a);
                    if (b instanceof PythonTuple) return !b.items.includes(a);
                    if (b instanceof PythonSet) return !b.items.has(a);
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
                            if (arg instanceof PythonList || arg instanceof PythonSet || arg instanceof PythonTuple || (arg.constructor && arg.constructor.name === 'PythonDict')) {
                                return arg.toString();
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
                    if (obj instanceof PythonTuple) return obj.length;
                    if (obj instanceof PythonSet) return obj.length;
                    if (obj instanceof Set || obj instanceof Map) return obj.size;
                    if (typeof obj === 'object' && obj !== null) return Object.keys(obj).length;
                    return 0;
                },
                str: (obj: any) => {
                    if (obj instanceof PythonList) return obj.toString();
                    if (obj instanceof PythonSet) return obj.toString();
                    if (obj instanceof PythonTuple) return obj.toString();
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
                    if (args.length === 1) {
                        const arg = args[0];
                        if (Array.isArray(arg)) return Math.min(...arg);
                        if (arg instanceof PythonList || arg instanceof PythonTuple) return Math.min(...arg.items);
                        if (arg instanceof PythonSet) return Math.min(...Array.from(arg.items));
                    }
                    return Math.min(...args);
                },
                max: (...args: any[]) => {
                    if (args.length === 1) {
                        const arg = args[0];
                        if (Array.isArray(arg)) return Math.max(...arg);
                        if (arg instanceof PythonList || arg instanceof PythonTuple) return Math.max(...arg.items);
                        if (arg instanceof PythonSet) return Math.max(...Array.from(arg.items));
                    }
                    return Math.max(...args);
                },
                type: (obj: any) => {
                    if (obj === null) return 'NoneType';
                    if (obj instanceof PythonList) return 'list';
                    if (obj instanceof PythonSet) return 'set';
                    if (obj instanceof PythonTuple) return 'tuple';
                    if (Array.isArray(obj)) return 'list';
                    if (typeof obj === 'object') return 'dict';
                    return typeof obj;
                },
                set: (iterable: any) => new PythonSet(iterable),
                tuple: (iterable: any) => new PythonTuple(iterable),
                bool: (obj: any) => Boolean(obj),
                sum: (arr: any) => {
                    let items: any[] = [];
                    if (arr instanceof PythonList || arr instanceof PythonTuple) items = arr.items;
                    else if (arr instanceof PythonSet) items = Array.from(arr.items);
                    else if (Array.isArray(arr)) items = arr;

                    return items.reduce((a: number, b: number) => a + b, 0);
                }
            }
        };

        const pythonStringMethods: Record<string, (str: string, ...args: any[]) => any> = {
            lower: (str) => str.toLowerCase(),
            upper: (str) => str.toUpperCase(),
            strip: (str, chars?: string) => {
                if (!chars) return str.trim();
                const pattern = `^[${chars}]+|[${chars}]+$`;
                return str.replace(new RegExp(pattern, 'g'), '');
            },
            lstrip: (str, chars?: string) => {
                if (!chars) return str.trimStart();
                const pattern = `^[${chars}]+`;
                return str.replace(new RegExp(pattern, 'g'), '');
            },
            rstrip: (str, chars?: string) => {
                if (!chars) return str.trimEnd();
                const pattern = `[${chars}]+$`;
                return str.replace(new RegExp(pattern, 'g'), '');
            },
            split: (str, sep?: string, maxsplit: number = -1) => {
                if (sep === undefined || sep === null) {
                    // Python's default split behavior (whitespace), filtering empty strings
                    const parts = str.trim().split(/\s+/);
                    return new PythonList(parts[0] === '' ? [] : parts);
                }
                const result = str.split(sep);
                if (maxsplit >= 0 && result.length > maxsplit + 1) {
                    const leftover = result.slice(maxsplit).join(sep);
                    const finalArr = result.slice(0, maxsplit);
                    finalArr.push(leftover);
                    return new PythonList(finalArr);
                }
                return new PythonList(result);
            },
            join: (str, iterable: any) => {
                let items: any[] = [];
                if (Array.isArray(iterable)) items = iterable;
                else if (iterable instanceof PythonList || iterable instanceof PythonTuple) items = iterable.items;
                else if (iterable instanceof PythonSet) items = Array.from(iterable.items);

                return items.join(str);
            },
            replace: (str, oldVal: string, newVal: string, count: number = -1) => {
                if (count === undefined || count === -1) {
                    // Replace ALL occurrences using split/join pattern for reliable global replacement
                    return str.split(oldVal).join(newVal);
                }
                let result = str;
                for (let i = 0; i < count; i++) {
                    result = result.replace(oldVal, newVal);
                }
                return result;
            },
            find: (str, sub: string, start: number = 0, end: number = str.length) => {
                if (start < 0) start = Math.max(0, str.length + start);
                if (end < 0) end = Math.max(0, str.length + end);
                const slice = str.slice(start, end);
                const idx = slice.indexOf(sub);
                return idx === -1 ? -1 : start + idx;
            },
            count: (str, sub: string, start: number = 0, end: number = str.length) => {
                if (start < 0) start = Math.max(0, str.length + start);
                if (end < 0) end = Math.max(0, str.length + end);
                const slice = str.slice(start, end);
                return slice.split(sub).length - 1;
            },
            startswith: (str, prefix: string | string[]) => {
                if (Array.isArray(prefix)) return prefix.some(p => str.startsWith(p));
                // Handle Tuple of prefixes? We need to accept PythonTuple too?
                // For now assuming strings or array of strings (from tuple conversion)
                // If prefix is PythonTuple, we should unwrap it.
                // However, TS signature `...args: any[]` allows catching the tuple.
                return str.startsWith(prefix as string);
            },
            endswith: (str, suffix: string | string[]) => {
                if (Array.isArray(suffix)) return suffix.some(s => str.endsWith(s));
                return str.endsWith(suffix as string);
            },
            format: (str, ...args: any[]) => {
                // Very basic implementation: replace {}
                let i = 0;
                return str.replace(/\{\}/g, () => {
                    const arg = args[i++];
                    if (arg === undefined) return '{}';
                    if (typeof arg === 'object' && arg !== null) {
                        // Use our existing string conversion
                        if (arg.toString) return arg.toString();
                        return JSON.stringify(arg);
                    }
                    return String(arg);
                });
            }
        };

        declareVariable(state.scope, '__pythonRuntime', { ...pythonRuntime, stringMethods: pythonStringMethods });


        // Expose Python built-ins to global scope
        Object.entries(pythonRuntime.functions).forEach(([name, func]) => {
            declareVariable(state.scope, name, func);
        });
    }

    // C Runtime Support
    if (language === 'c') {
        const cRuntime = {
            types: {
                CInt,
                CFloat,
                CDouble,
                CChar,
                CArray,
            },
            functions: {
                printf: (...args: any[]) => {
                    if (args.length === 0) return 0;
                    const format = String(args[0]);
                    const result = printf(format, ...args.slice(1));
                    state.output.push(result);
                    return result.length;
                },
                puts: (str: any) => {
                    const text = String(str);
                    state.output.push(text);
                    return text.length;
                },
                putchar: (c: any) => {
                    const char = typeof c === 'number' ? String.fromCharCode(c) : String(c)[0];
                    state.output.push(char);
                    return char.charCodeAt(0);
                },
                getchar: () => {
                    // Simulate reading a character (return newline for now)
                    return '\n'.charCodeAt(0);
                },
                malloc: (size: number) => {
                    if (state.memory) {
                        return state.memory.malloc(size, state.steps.length);
                    }
                    return { __ptr: true, __size: size, __data: new Array(size).fill(0) };
                },
                free: (ptr: any) => {
                    if (state.memory && typeof ptr === 'number') {
                        state.memory.free(ptr, state.steps.length);
                    }
                },
                sizeof: (type: any) => {
                    // Check struct defs if available
                    if (typeof type === 'string' && state.structDefs && state.structDefs.has(type)) {
                        return state.structDefs.get(type)!.size;
                    }
                    if (type === 'int' || type === 'float') return 4;
                    if (type === 'double' || type === 'long') return 8;
                    if (type === 'char') return 1;
                    if (type === 'short') return 2;
                    if (typeof type === 'object' && type !== null) {
                        return JSON.stringify(type).length;
                    }
                    // Struct string handling "struct Point"
                    if (typeof type === 'string' && type.startsWith('struct ') && state.structDefs) {
                        const name = type.replace('struct ', '').trim();
                        if (state.structDefs.has(name)) {
                            return state.structDefs.get(name)!.size;
                        }
                    }
                    return 4;
                },
                abs: Math.abs,
                sqrt: Math.sqrt,
                pow: Math.pow,
                sin: Math.sin,
                cos: Math.cos,
                tan: Math.tan,
                log: Math.log,
                exp: Math.exp,
                floor: Math.floor,
                ceil: Math.ceil,
                round: Math.round,
                exit: (code: number) => {
                    throw new Error(`Program exited with code ${code}`);
                },
                atoi: (str: string) => parseInt(str, 10) || 0,
                atof: (str: string) => parseFloat(str) || 0.0,
                strlen: (str: string) => String(str).length,
                strcmp: (s1: string, s2: string) => {
                    if (s1 < s2) return -1;
                    if (s1 > s2) return 1;
                    return 0;
                },
            },
            createType: createCType,
            getDefaultValue: getDefaultValue,
        };

        declareVariable(state.scope, '__cRuntime', cRuntime);

        // Expose C built-ins to global scope
        Object.entries(cRuntime.functions).forEach(([name, func]) => {
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

        // C-specific: Call main() if it exists
        if (language === 'c') {
            const mainFunc = state.functions.get('main');
            if (mainFunc) {
                // Create synthetic call expression: main()
                const mainCall = t.callExpression(t.identifier('main'), []);
                evaluateExpression(mainCall, state, code);
            }
        }

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
            const value = decl.init ? evaluateExpression(decl.init, state, code) : undefined;

            if (t.isIdentifier(decl.id)) {
                declareVariable(state.scope, decl.id.name, value);
            } else if (t.isArrayPattern(decl.id)) {
                // Array destructuring: const [a, b] = [1, 2]
                const arr = Array.isArray(value) ? value : (value as PythonList)?.items || [];
                decl.id.elements.forEach((element, i) => {
                    if (t.isIdentifier(element)) {
                        declareVariable(state.scope, element.name, arr[i]);
                    }
                });
            } else if (t.isObjectPattern(decl.id)) {
                // Object destructuring: const { a, b } = { a: 1, b: 2 }
                const obj = value as Record<string, unknown>;
                if (obj || value === undefined) { // Allow destructuring undefined/null if patterns invoke errors? No, usually throws. But here we might be lenient or strict. JS throws.
                    // For safety in interpreter, let's assume obj is valid or handle gracefully.
                    // If strict JS, value must be coercible to object.
                }

                decl.id.properties.forEach(prop => {
                    if (t.isObjectProperty(prop)) {
                        if (t.isIdentifier(prop.key) && t.isIdentifier(prop.value)) {
                            // { a: b } or { a } (shorthand is key=value same name in AST usually?)
                            // In babel, shorthand: key=Identifier(a), value=Identifier(a), shorthand=true
                            const val = obj ? obj[prop.key.name] : undefined;
                            declareVariable(state.scope, prop.value.name, val);
                        } else if (t.isIdentifier(prop.key) && t.isAssignmentPattern(prop.value) && t.isIdentifier(prop.value.left)) {
                            // Default value: const { a = 10 } = {}
                            const existing = obj ? obj[prop.key.name] : undefined;
                            const val = existing !== undefined
                                ? existing
                                : evaluateExpression(prop.value.right, state, code);
                            declareVariable(state.scope, prop.value.left.name, val);
                        }
                    }
                });
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
                    if (result && typeof result === 'object') {
                        if ('isReturn' in result || 'isBreak' in result || 'isContinue' in result) {
                            return result;
                        }
                    }
                }
            } else {
                return evaluateStatement(statement.consequent, state, code);
            }
        } else if (statement.alternate) {
            if (t.isBlockStatement(statement.alternate)) {
                for (const stmt of statement.alternate.body) {
                    const result = evaluateStatement(stmt, state, code);
                    if (result && typeof result === 'object') {
                        if ('isReturn' in result || 'isBreak' in result || 'isContinue' in result) {
                            return result;
                        }
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
        outerFor: while (true) {
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
                    if (result && typeof result === 'object') {
                        if ('isReturn' in result) return result;
                        if ('isBreak' in result) break outerFor;
                        if ('isContinue' in result) break; // break inner loop, continue outer
                    }
                }
            } else {
                const result = evaluateStatement(statement.body, state, code);
                if (result && typeof result === 'object') {
                    if ('isReturn' in result) return result;
                    if ('isBreak' in result) break;
                }
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
        outerWhile: while (true) {
            if (iterations++ > MAX_ITERATIONS) {
                throw new Error('Maximum loop iterations exceeded. Possible infinite loop.');
            }

            addStep(state, statement);
            const condition = evaluateExpression(statement.test, state, code);
            if (!condition) break;

            if (t.isBlockStatement(statement.body)) {
                for (const stmt of statement.body.body) {
                    const result = evaluateStatement(stmt, state, code);
                    if (result && typeof result === 'object') {
                        if ('isReturn' in result) return result;
                        if ('isBreak' in result) break outerWhile;
                        if ('isContinue' in result) break; // break inner loop, continue outer
                    }
                }
            } else {
                const result = evaluateStatement(statement.body, state, code);
                if (result && typeof result === 'object') {
                    if ('isReturn' in result) return result;
                    if ('isBreak' in result) break;
                }
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

    if (t.isBreakStatement(statement)) {
        return { isBreak: true };
    }

    if (t.isContinueStatement(statement)) {
        return { isContinue: true };
    }

    if (t.isThrowStatement(statement)) {
        const errorValue = evaluateExpression(statement.argument, state, code);
        const error = errorValue instanceof Error ? errorValue : new Error(String(errorValue));
        throw error;
    }

    if (t.isTryStatement(statement)) {
        try {
            // Execute try block
            if (t.isBlockStatement(statement.block)) {
                for (const stmt of statement.block.body) {
                    addStep(state, stmt);
                    const result = evaluateStatement(stmt, state, code);
                    if (result && typeof result === 'object') {
                        if ('isReturn' in result || 'isBreak' in result || 'isContinue' in result) {
                            return result;
                        }
                    }
                }
            }
        } catch (error) {
            // Execute catch block if present
            if (statement.handler && t.isBlockStatement(statement.handler.body)) {
                const catchScope = createScope(state.scope);

                // Bind the error to the catch parameter
                if (statement.handler.param && t.isIdentifier(statement.handler.param)) {
                    declareVariable(catchScope, statement.handler.param.name, error);
                }

                const previousScope = state.scope;
                state.scope = catchScope;

                try {
                    for (const stmt of statement.handler.body.body) {
                        addStep(state, stmt);
                        const result = evaluateStatement(stmt, state, code);
                        if (result && typeof result === 'object') {
                            if ('isReturn' in result || 'isBreak' in result || 'isContinue' in result) {
                                state.scope = previousScope;
                                return result;
                            }
                        }
                    }
                } finally {
                    state.scope = previousScope;
                }
            }
        } finally {
            // Execute finally block if present
            if (statement.finalizer && t.isBlockStatement(statement.finalizer)) {
                for (const stmt of statement.finalizer.body) {
                    addStep(state, stmt);
                    evaluateStatement(stmt, state, code);
                }
            }
        }
        return undefined;
    }

    if (t.isSwitchStatement(statement)) {
        const discriminant = evaluateExpression(statement.discriminant, state, code);
        let matched = false;
        let shouldBreak = false;

        for (const caseClause of statement.cases) {
            // Check if this case matches (or is default)
            const isDefault = caseClause.test === null;
            const caseValue = caseClause.test
                ? evaluateExpression(caseClause.test, state, code)
                : undefined;

            if (matched || isDefault || discriminant === caseValue) {
                matched = true;
                for (const stmt of caseClause.consequent) {
                    if (t.isBreakStatement(stmt)) {
                        shouldBreak = true;
                        break;
                    }
                    addStep(state, stmt);
                    const result = evaluateStatement(stmt, state, code);
                    if (result && typeof result === 'object') {
                        if ('isReturn' in result) return result;
                        if ('isBreak' in result) { shouldBreak = true; break; }
                    }
                }
                if (shouldBreak) break;
            }
        }
        return undefined;
    }

    if (t.isDoWhileStatement(statement)) {
        let iterations = 0;
        outerDoWhile: do {
            if (iterations++ > MAX_ITERATIONS) {
                throw new Error('Maximum loop iterations exceeded. Possible infinite loop.');
            }

            addStep(state, statement);

            if (t.isBlockStatement(statement.body)) {
                for (const stmt of statement.body.body) {
                    const result = evaluateStatement(stmt, state, code);
                    if (result && typeof result === 'object') {
                        if ('isReturn' in result) return result;
                        if ('isBreak' in result) break outerDoWhile;
                        if ('isContinue' in result) break; // break inner, continue outer
                    }
                }
            } else {
                const result = evaluateStatement(statement.body, state, code);
                if (result && typeof result === 'object') {
                    if ('isReturn' in result) return result;
                    if ('isBreak' in result) break;
                }
            }
        } while (evaluateExpression(statement.test, state, code));
        return undefined;
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
            if (result && typeof result === 'object') {
                if ('isReturn' in result || 'isBreak' in result || 'isContinue' in result) {
                    return result;
                }
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
        outerForOf: for (const value of (right as Iterable<unknown>)) {
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
                    if (result && typeof result === 'object') {
                        if ('isReturn' in result) return result;
                        if ('isBreak' in result) break outerForOf;
                        if ('isContinue' in result) break; // break inner, continue outer
                    }
                }
            } else {
                const result = evaluateStatement(statement.body, state, code);
                if (result && typeof result === 'object') {
                    if ('isReturn' in result) return result;
                    if ('isBreak' in result) break;
                }
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
            // Bitwise operators
            case '|': return (left as number) | (right as number);
            case '&': return (left as number) & (right as number);
            case '^': return (left as number) ^ (right as number);
            case '<<': return (left as number) << (right as number);
            case '>>': return (left as number) >> (right as number);
            case '>>>': return (left as number) >>> (right as number);
            // Type checking operators
            case 'instanceof': return left instanceof (right as any);
            case 'in': return (left as string) in (right as object);
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
                    case '%=': finalValue = (current as number) % (value as number); break;
                    case '**=': finalValue = Math.pow(current as number, value as number); break;
                    // Bitwise compound assignment
                    case '&=': finalValue = (current as number) & (value as number); break;
                    case '|=': finalValue = (current as number) | (value as number); break;
                    case '^=': finalValue = (current as number) ^ (value as number); break;
                    case '<<=': finalValue = (current as number) << (value as number); break;
                    case '>>=': finalValue = (current as number) >> (value as number); break;
                    case '>>>=': finalValue = (current as number) >>> (value as number); break;
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

        if (t.isArrayPattern(expression.left)) {
            const arr = Array.isArray(value) ? value : (value as PythonList)?.items || [];
            expression.left.elements.forEach((element, i) => {
                if (t.isIdentifier(element)) {
                    setVariable(state.scope, element.name, arr[i]);
                }
            });
            return value;
        }

        if (t.isObjectPattern(expression.left)) {
            const obj = value as Record<string, unknown>;
            expression.left.properties.forEach(prop => {
                if (t.isObjectProperty(prop)) {
                    if (t.isIdentifier(prop.key) && t.isIdentifier(prop.value)) {
                        const val = obj ? obj[prop.key.name] : undefined;
                        setVariable(state.scope, prop.value.name, val);
                    } else if (t.isIdentifier(prop.key) && t.isAssignmentPattern(prop.value) && t.isIdentifier(prop.value.left)) {
                        const existing = obj ? obj[prop.key.name] : undefined;
                        const val = existing !== undefined
                            ? existing
                            : evaluateExpression(prop.value.right, state, code);
                        setVariable(state.scope, prop.value.left.name, val);
                    }
                }
            });
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
            // Intercept string methods for Python
            // Intercept string methods for Python
            if (typeof obj === 'string') {
                // Check if runtime has stringMethods (only in Python mode)
                const runtime = lookupVariable(state.scope, '__pythonRuntime') as any;
                if (runtime && runtime.stringMethods && typeof prop === 'string' && runtime.stringMethods[prop]) {
                    return (runtime.stringMethods[prop] as Function).bind(null, obj);
                }
                // Fallback to JS string methods (e.g. substring)
            }

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

            // Bind parameters using helper (supports default values and rest params)
            bindParameters(expression.params, args, funcScope, state, code);

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

                // Bind params using helper (supports default values and rest params)
                bindParameters(ctorMethod.params, args, funcScope, state, code);

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
        // C Memory Intrinsics
        if (state.memory && t.isIdentifier(expression.callee)) {
            const name = expression.callee.name;

            if (name === '__allocStruct') {
                const arg0 = expression.arguments[0];
                const typeName = t.isStringLiteral(arg0) ? arg0.value : '';
                if (state.structDefs && state.structDefs.has(typeName)) {
                    const def = state.structDefs.get(typeName)!;
                    const addr = state.memory.malloc(def.size, state.steps.length, `struct ${typeName}`);
                    return new CStructRef(addr, def, state.memory);
                }
            }

            if (name === '__arrow') {
                // __arrow(ptr, 'field')
                const ptrVal = evaluateExpression(expression.arguments[0] as t.Expression, state, code);
                const fieldName = (expression.arguments[1] as t.StringLiteral).value;

                let address = 0;
                let type = '';

                if (typeof ptrVal === 'number') {
                    address = ptrVal;
                    type = state.memory.getType(address);
                } else if (ptrVal instanceof CPointer) { // If we had CPointer class used at runtime
                    address = ptrVal.address;
                    type = ptrVal.type.replace('*', '').trim();
                }

                // Handle struct type
                if (type.startsWith('struct ')) {
                    const structName = type.replace('struct ', '').trim();
                    if (state.structDefs && state.structDefs.has(structName)) {
                        const def = state.structDefs.get(structName)!;
                        const field = def.getField(fieldName);
                        if (field) {
                            const fieldAddr = address + field.offset;
                            // Read value or return struct ref based on field type?
                            // For visualization, we might want intermediate ref.
                            // But usually we just read.
                            return state.memory.read(fieldAddr);
                        }
                    }
                }

                // Fallback: search all structs for field (educational/loose mode)
                if (state.structDefs) {
                    for (const def of state.structDefs.values()) {
                        if (def.hasField(fieldName)) {
                            const field = def.getField(fieldName)!;
                            // Heuristic: check if this plausible?
                            // Just try it.
                            const fieldAddr = address + field.offset;
                            try {
                                return state.memory.read(fieldAddr);
                            } catch (e) {
                                // continue searching
                            }
                        }
                    }
                }
            }
            if (name === '__assign_deref') {
                const ptrVal = evaluateExpression(expression.arguments[0] as t.Expression, state, code);
                const val = evaluateExpression(expression.arguments[1] as t.Expression, state, code);

                let address = 0;
                if (typeof ptrVal === 'number') {
                    address = ptrVal;
                } else if (ptrVal instanceof CPointer) {
                    address = ptrVal.address;
                }

                if (address && state.memory) {
                    // We don't have type info here easily unless we look it up or pass it.
                    // CMemory.write might handle it if we pass value?
                    // For now assume primitive write or use generic write.
                    state.memory.write(address, val);
                }
                return val;
            }

            if (name === '__assign_arrow') {
                const ptrVal = evaluateExpression(expression.arguments[0] as t.Expression, state, code);
                const fieldName = (expression.arguments[1] as t.StringLiteral).value;
                const val = evaluateExpression(expression.arguments[2] as t.Expression, state, code);

                let address = 0;
                let type = '';

                if (typeof ptrVal === 'number') {
                    address = ptrVal;
                    type = state.memory.getType(address);
                } else if (ptrVal instanceof CPointer) {
                    address = ptrVal.address;
                    type = ptrVal.type.replace('*', '').trim();
                }

                if (type.startsWith('struct ')) {
                    const structName = type.replace('struct ', '').trim();
                    if (state.structDefs && state.structDefs.has(structName)) {
                        const def = state.structDefs.get(structName)!;
                        const field = def.getField(fieldName);
                        if (field) {
                            state.memory.write(address + field.offset, val);
                            return val;
                        }
                    }
                }
                // Fallback
                if (state.structDefs) {
                    for (const def of state.structDefs.values()) {
                        if (def.hasField(fieldName)) {
                            const field = def.getField(fieldName)!;
                            try {
                                state.memory.write(address + field.offset, val);
                                return val;
                            } catch (e) { }
                        }
                    }
                }
                return val;
            }

            if (name === '__deref') {
                const val = evaluateExpression(expression.arguments[0] as t.Expression, state, code);
                if (typeof val === 'number') {
                    return state.memory.read(val);
                }
                // Handle CPointer object if we use it
                if (val instanceof CPointer) {
                    return state.memory.read(val.address);
                }
            }

            if (name === '__addr') {
                // Not fully implemented yet as it requires lvalue resolution
                return 0;
            }

            if (name === '__sizeof') {
                const arg0 = expression.arguments[0];
                if (t.isStringLiteral(arg0)) {
                    const type = arg0.value;
                    const primitives: Record<string, number> = { 'int': 4, 'float': 4, 'double': 8, 'char': 1, 'long': 8, 'short': 2 };
                    if (primitives[type]) return primitives[type];

                    // Struct string handling "struct Point"
                    if (typeof type === 'string' && type.startsWith('struct ')) {
                        const name = type.replace('struct ', '').trim();
                        if (state.structDefs && state.structDefs.has(name)) {
                            return state.structDefs.get(name)!.size;
                        }
                    }

                    // Handle pointer types
                    if (type.includes('*')) return 4;
                }

                // If expression passed, parse type from expression result?
                // or return default
                evaluateExpression(expression.arguments[0] as t.Expression, state, code);
                return 4;
            }
        }

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

            if (obj && typeof obj === 'string') {
                const runtime = lookupVariable(state.scope, '__pythonRuntime') as any;
                if (runtime && runtime.stringMethods && runtime.stringMethods[prop]) {
                    const method = runtime.stringMethods[prop];
                    const args = collectArguments(expression.arguments, state, code);
                    return method(obj, ...args);
                }
            }

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
                        // Use collectArguments helper (supports spread)
                        const args = collectArguments(expression.arguments, state, code);

                        if (state.callStack.length >= MAX_CALL_DEPTH) {
                            throw new Error('Maximum call stack depth exceeded.');
                        }

                        const funcScope = createScope(state.scope);

                        // Bind 'this'
                        declareVariable(funcScope, 'this', obj);

                        // Bind params using helper (supports default values and rest params)
                        bindParameters(method.params, args, funcScope, state, code);

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
        const args = collectArguments(expression.arguments, state, code);

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

            // Bind parameters using helper (supports default values and rest params)
            bindParameters(funcDecl.params, args, funcScope, state, code);

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
