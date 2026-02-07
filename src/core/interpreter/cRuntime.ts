/**
 * C Runtime for CodeFlow
 * 
 * Simulates C types and built-in functions for the interpreter.
 * Provides type wrappers that track values with C semantics.
 */

// ============================================================================
// C Type Wrappers
// ============================================================================

/**
 * Base class for all C types
 */
export abstract class CType {
    abstract get value(): any;
    abstract set value(v: any);
    abstract get typeName(): string;
    abstract toString(): string;
    abstract clone(): CType;
}

/**
 * C int type (32-bit signed integer simulation)
 */
export class CInt extends CType {
    private _value: number;

    constructor(value: number = 0) {
        super();
        this._value = Math.trunc(value) | 0; // Simulate 32-bit truncation
    }

    get value(): number { return this._value; }
    set value(v: number) { this._value = Math.trunc(v) | 0; }

    get typeName(): string { return 'int'; }

    toString(): string { return String(this._value); }

    clone(): CInt { return new CInt(this._value); }

    // Arithmetic operations
    add(other: number | CType): CInt {
        const val = other instanceof CType ? other.value : other;
        return new CInt(this._value + val);
    }

    sub(other: number | CType): CInt {
        const val = other instanceof CType ? other.value : other;
        return new CInt(this._value - val);
    }

    mul(other: number | CType): CInt {
        const val = other instanceof CType ? other.value : other;
        return new CInt(this._value * val);
    }

    div(other: number | CType): CInt {
        const val = other instanceof CType ? other.value : other;
        if (val === 0) throw new Error('Division by zero');
        return new CInt(Math.trunc(this._value / val));
    }

    mod(other: number | CType): CInt {
        const val = other instanceof CType ? other.value : other;
        if (val === 0) throw new Error('Modulo by zero');
        return new CInt(this._value % val);
    }

    // Increment/decrement
    increment(): CInt { this._value++; return this; }
    decrement(): CInt { this._value--; return this; }
}

/**
 * C float type (single precision floating point)
 */
export class CFloat extends CType {
    private _value: number;

    constructor(value: number = 0.0) {
        super();
        this._value = Math.fround(value); // Simulate single precision
    }

    get value(): number { return this._value; }
    set value(v: number) { this._value = Math.fround(v); }

    get typeName(): string { return 'float'; }

    toString(): string {
        // Format like C printf %f
        return this._value.toFixed(6);
    }

    clone(): CFloat { return new CFloat(this._value); }
}

/**
 * C double type (double precision floating point)
 */
export class CDouble extends CType {
    private _value: number;

    constructor(value: number = 0.0) {
        super();
        this._value = value;
    }

    get value(): number { return this._value; }
    set value(v: number) { this._value = v; }

    get typeName(): string { return 'double'; }

    toString(): string {
        return this._value.toFixed(6);
    }

    clone(): CDouble { return new CDouble(this._value); }
}

/**
 * C char type (single character)
 */
export class CChar extends CType {
    private _value: number; // Store as ASCII code

    constructor(value: string | number = 0) {
        super();
        if (typeof value === 'string') {
            this._value = value.charCodeAt(0) || 0;
        } else {
            this._value = value & 0xFF; // Keep in byte range
        }
    }

    get value(): number { return this._value; }
    set value(v: number | string) {
        if (typeof v === 'string') {
            this._value = v.charCodeAt(0) || 0;
        } else {
            this._value = v & 0xFF;
        }
    }

    get charValue(): string { return String.fromCharCode(this._value); }

    get typeName(): string { return 'char'; }

    toString(): string { return String.fromCharCode(this._value); }

    clone(): CChar { return new CChar(this._value); }
}

/**
 * C array type
 */
export class CArray extends CType {
    private _data: any[];
    private _elementType: string;
    private _size: number;

    constructor(elementType: string, size: number, initialValues?: any[]) {
        super();
        this._elementType = elementType;
        this._size = size;
        this._data = new Array(size);

        // Initialize with default values based on type
        for (let i = 0; i < size; i++) {
            if (initialValues && i < initialValues.length) {
                this._data[i] = initialValues[i];
            } else {
                this._data[i] = this.getDefaultValue(elementType);
            }
        }
    }

    private getDefaultValue(type: string): any {
        if (type.includes('int')) return 0;
        if (type.includes('float') || type.includes('double')) return 0.0;
        if (type.includes('char')) return 0;
        return 0;
    }

    get value(): any[] { return this._data; }
    set value(v: any[]) { this._data = v; }

    get typeName(): string { return `${this._elementType}[]`; }
    get size(): number { return this._size; }
    get elementType(): string { return this._elementType; }

    get(index: number): any {
        if (index < 0 || index >= this._size) {
            throw new Error(`Array index out of bounds: ${index}`);
        }
        return this._data[index];
    }

    set(index: number, value: any): void {
        if (index < 0 || index >= this._size) {
            throw new Error(`Array index out of bounds: ${index}`);
        }
        this._data[index] = value instanceof CType ? value.value : value;
    }

    toString(): string {
        return `[${this._data.join(', ')}]`;
    }

    clone(): CArray {
        return new CArray(this._elementType, this._size, [...this._data]);
    }
}

// ============================================================================
// C Struct Type
// ============================================================================

interface StructFieldDef {
    name: string;
    type: string;
    offset: number;
    size: number;
}

/**
 * C struct type definition (like a class/blueprint)
 */
export class CStructDef {
    private _name: string;
    private _fields: StructFieldDef[];
    private _size: number;

    constructor(name: string, fieldDefs: Array<{ name: string; type: string }>) {
        this._name = name;
        this._fields = [];
        let offset = 0;

        for (const def of fieldDefs) {
            const size = this.getFieldSize(def.type);
            this._fields.push({
                name: def.name,
                type: def.type,
                offset,
                size
            });
            offset += size;
        }

        this._size = offset;
    }

    private getFieldSize(type: string): number {
        if (type.includes('char')) return 1;
        if (type.includes('short')) return 2;
        if (type.includes('int') || type.includes('float')) return 4;
        if (type.includes('double') || type.includes('long')) return 8;
        if (type.includes('*')) return 8; // Pointer size
        return 4;
    }

    get name(): string { return this._name; }
    get fields(): StructFieldDef[] { return [...this._fields]; }
    get size(): number { return this._size; }

    getField(name: string): StructFieldDef | undefined {
        return this._fields.find(f => f.name === name);
    }

    hasField(name: string): boolean {
        return this._fields.some(f => f.name === name);
    }
}

/**
 * C struct instance (actual data)
 */
export class CStruct extends CType {
    private _typeName: string;
    private _definition: CStructDef;
    private _fieldValues: Map<string, any>;

    constructor(definition: CStructDef, initialValues?: Record<string, any>) {
        super();
        this._typeName = definition.name;
        this._definition = definition;
        this._fieldValues = new Map();

        // Initialize all fields with default values
        for (const field of definition.fields) {
            const defaultVal = initialValues?.[field.name] ?? this.getDefaultValue(field.type);
            this._fieldValues.set(field.name, defaultVal);
        }
    }

    private getDefaultValue(type: string): any {
        if (type.includes('char')) return 0;
        if (type.includes('float') || type.includes('double')) return 0.0;
        if (type.includes('*')) return null; // NULL pointer
        return 0;
    }

    get value(): Record<string, any> {
        const obj: Record<string, any> = {};
        this._fieldValues.forEach((val, key) => {
            obj[key] = val instanceof CType ? val.value : val;
        });
        return obj;
    }

    set value(v: Record<string, any>) {
        for (const [key, val] of Object.entries(v)) {
            if (this._definition.hasField(key)) {
                this._fieldValues.set(key, val);
            }
        }
    }

    get typeName(): string { return `struct ${this._typeName}`; }
    get definition(): CStructDef { return this._definition; }
    get fieldNames(): string[] { return this._definition.fields.map(f => f.name); }

    /**
     * Get field value: struct.field
     */
    get(fieldName: string): any {
        if (!this._definition.hasField(fieldName)) {
            throw new Error(`struct ${this._typeName} has no member named '${fieldName}'`);
        }
        const val = this._fieldValues.get(fieldName);
        return val instanceof CType ? val.value : val;
    }

    /**
     * Set field value: struct.field = value
     */
    set(fieldName: string, value: any): void {
        if (!this._definition.hasField(fieldName)) {
            throw new Error(`struct ${this._typeName} has no member named '${fieldName}'`);
        }
        this._fieldValues.set(fieldName, value instanceof CType ? value.value : value);
    }

    /**
     * Get raw field value (preserving CType wrapper)
     */
    getRaw(fieldName: string): any {
        if (!this._definition.hasField(fieldName)) {
            throw new Error(`struct ${this._typeName} has no member named '${fieldName}'`);
        }
        return this._fieldValues.get(fieldName);
    }

    toString(): string {
        const fields: string[] = [];
        this._fieldValues.forEach((val, key) => {
            const displayVal = val instanceof CType ? val.toString() : String(val);
            fields.push(`${key}: ${displayVal}`);
        });
        return `{${fields.join(', ')}}`;
    }

    clone(): CStruct {
        const cloned = new CStruct(this._definition);
        this._fieldValues.forEach((val, key) => {
            if (val instanceof CType) {
                cloned._fieldValues.set(key, val.clone());
            } else if (typeof val === 'object' && val !== null) {
                cloned._fieldValues.set(key, JSON.parse(JSON.stringify(val)));
            } else {
                cloned._fieldValues.set(key, val);
            }
        });
        return cloned;
    }

    toJSON() {
        return {
            type: this.typeName,
            fields: this.value
        };
    }
}

// ============================================================================
// C Built-in Functions
// ============================================================================

/**
 * Implementation of printf
 * Supports: %d, %i, %f, %lf, %c, %s, %x, %o, %%
 */
export function printf(format: string, ...args: any[]): string {
    let result = '';
    let argIndex = 0;
    let i = 0;

    while (i < format.length) {
        if (format[i] === '%') {
            i++;
            if (i >= format.length) break;

            // Handle %%
            if (format[i] === '%') {
                result += '%';
                i++;
                continue;
            }

            // Parse width and precision (simplified)
            let width = '';
            let precision = '';
            let leftAlign = false;
            let zeroPad = false;

            if (format[i] === '-') {
                leftAlign = true;
                i++;
            }
            if (format[i] === '0') {
                zeroPad = true;
                i++;
            }
            while (format[i] >= '0' && format[i] <= '9') {
                width += format[i];
                i++;
            }
            if (format[i] === '.') {
                i++;
                while (format[i] >= '0' && format[i] <= '9') {
                    precision += format[i];
                    i++;
                }
            }

            // Handle length modifiers (l, h)
            if (format[i] === 'l' || format[i] === 'h') {
                i++;
            }

            const spec = format[i];
            const arg = args[argIndex++];
            const val = arg instanceof CType ? arg.value : arg;

            let formatted = '';

            switch (spec) {
                case 'd':
                case 'i':
                    formatted = String(Math.trunc(val || 0));
                    break;
                case 'u':
                    formatted = String(Math.abs(Math.trunc(val || 0)));
                    break;
                case 'f':
                case 'F':
                    const prec = precision ? parseInt(precision) : 6;
                    formatted = Number(val || 0).toFixed(prec);
                    break;
                case 'e':
                case 'E':
                    formatted = Number(val || 0).toExponential(precision ? parseInt(precision) : 6);
                    break;
                case 'c':
                    if (typeof val === 'number') {
                        formatted = String.fromCharCode(val);
                    } else if (typeof val === 'string') {
                        formatted = val[0] || '';
                    } else {
                        formatted = '';
                    }
                    break;
                case 's':
                    formatted = String(val || '');
                    break;
                case 'x':
                    formatted = (val >>> 0).toString(16);
                    break;
                case 'X':
                    formatted = (val >>> 0).toString(16).toUpperCase();
                    break;
                case 'o':
                    formatted = (val >>> 0).toString(8);
                    break;
                case 'p':
                    formatted = '0x' + (val >>> 0).toString(16);
                    break;
                default:
                    formatted = '';
            }

            // Apply width padding
            if (width) {
                const w = parseInt(width);
                if (formatted.length < w) {
                    const pad = (zeroPad && !leftAlign) ? '0' : ' ';
                    if (leftAlign) {
                        formatted = formatted.padEnd(w, ' ');
                    } else {
                        formatted = formatted.padStart(w, pad);
                    }
                }
            }

            result += formatted;
            i++;
        } else if (format[i] === '\\') {
            i++;
            switch (format[i]) {
                case 'n': result += '\n'; break;
                case 't': result += '\t'; break;
                case 'r': result += '\r'; break;
                case '\\': result += '\\'; break;
                case '0': result += '\0'; break;
                default: result += format[i];
            }
            i++;
        } else {
            result += format[i];
            i++;
        }
    }

    return result;
}

/**
 * Implementation of scanf (simplified - returns parsed values)
 */
export function scanf(format: string, input: string): any[] {
    const values: any[] = [];
    let inputIndex = 0;
    let i = 0;

    while (i < format.length && inputIndex < input.length) {
        if (format[i] === '%') {
            i++;

            // Skip whitespace in input
            while (inputIndex < input.length && /\s/.test(input[inputIndex])) {
                inputIndex++;
            }

            const spec = format[i];
            let value = '';

            switch (spec) {
                case 'd':
                case 'i':
                    // Read integer
                    if (input[inputIndex] === '-' || input[inputIndex] === '+') {
                        value += input[inputIndex++];
                    }
                    while (inputIndex < input.length && /[0-9]/.test(input[inputIndex])) {
                        value += input[inputIndex++];
                    }
                    values.push(parseInt(value) || 0);
                    break;

                case 'f':
                case 'lf':
                    // Read float/double
                    if (input[inputIndex] === '-' || input[inputIndex] === '+') {
                        value += input[inputIndex++];
                    }
                    while (inputIndex < input.length && /[0-9.]/.test(input[inputIndex])) {
                        value += input[inputIndex++];
                    }
                    values.push(parseFloat(value) || 0);
                    break;

                case 'c':
                    // Read single character
                    values.push(input[inputIndex++] || '');
                    break;

                case 's':
                    // Read string (until whitespace)
                    while (inputIndex < input.length && !/\s/.test(input[inputIndex])) {
                        value += input[inputIndex++];
                    }
                    values.push(value);
                    break;
            }
            i++;
        } else if (/\s/.test(format[i])) {
            // Skip whitespace in format and input
            while (i < format.length && /\s/.test(format[i])) i++;
            while (inputIndex < input.length && /\s/.test(input[inputIndex])) inputIndex++;
        } else {
            // Match literal character
            if (format[i] === input[inputIndex]) {
                i++;
                inputIndex++;
            } else {
                break;
            }
        }
    }

    return values;
}

// ============================================================================
// Type Creation Helpers
// ============================================================================

/**
 * Create a C type instance from a type string and value
 */
export function createCType(typeStr: string, value?: any): CType | any {
    const type = typeStr.trim().toLowerCase();

    if (type === 'int' || type === 'long' || type === 'short') {
        return new CInt(value ?? 0);
    }
    if (type === 'float') {
        return new CFloat(value ?? 0.0);
    }
    if (type === 'double') {
        return new CDouble(value ?? 0.0);
    }
    if (type === 'char') {
        return new CChar(value ?? 0);
    }

    // For unknown types, return raw value
    return value ?? 0;
}

/**
 * Get the default value for a C type
 */
export function getDefaultValue(typeStr: string): any {
    const type = typeStr.trim().toLowerCase();

    if (type.includes('int') || type.includes('long') || type.includes('short')) {
        return 0;
    }
    if (type.includes('float') || type.includes('double')) {
        return 0.0;
    }
    if (type.includes('char')) {
        return 0;
    }

    return 0;
}

/**
 * Convert a value to the appropriate C type representation for display
 */
export function formatCValue(value: any, type?: string): string {
    if (value instanceof CType) {
        return value.toString();
    }
    if (value instanceof CArray) {
        return value.toString();
    }
    if (Array.isArray(value)) {
        return `[${value.join(', ')}]`;
    }
    if (typeof value === 'number') {
        if (type?.includes('float') || type?.includes('double')) {
            return value.toFixed(6);
        }
        return String(Math.trunc(value));
    }
    return String(value);
}
