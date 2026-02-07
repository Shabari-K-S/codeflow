/**
 * Lightweight C Parser for CodeFlow
 * 
 * Parses C code into Babel-compatible AST nodes for consistency with
 * the existing JavaScript/Python parser infrastructure.
 * 
 * Supported constructs:
 * - Variable declarations (int, float, char, double)
 * - Function declarations and calls
 * - Control flow (if/else, for, while, do-while, switch)
 * - Basic expressions and operators
 * - Arrays (single and multi-dimensional)
 * - Preprocessor directives (stripped for visualization)
 */

import * as t from '@babel/types';

// Token types for lexer
type TokenType =
    | 'KEYWORD' | 'IDENTIFIER' | 'NUMBER' | 'STRING' | 'CHAR'
    | 'OPERATOR' | 'PUNCTUATION' | 'EOF' | 'NEWLINE';

interface Token {
    type: TokenType;
    value: string;
    line: number;
    column: number;
}

// Location type is handled via 'any' return in createLoc for Babel compatibility

// C Keywords
const C_KEYWORDS = new Set([
    'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do',
    'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if',
    'int', 'long', 'register', 'return', 'short', 'signed', 'sizeof',
    'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void',
    'volatile', 'while', 'malloc', 'free', 'NULL', 'printf', 'scanf'
]);

// C Operators
const C_OPERATORS = [
    '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
    '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '->',
    '+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '<', '>', '=', '?', ':'
];

/**
 * Lexer: Tokenize C source code
 */
class CLexer {
    private code: string;
    private pos: number = 0;
    private line: number = 1;
    private column: number = 0;
    private tokens: Token[] = [];

    constructor(code: string) {
        // Preprocess: strip preprocessor directives
        this.code = this.preprocess(code);
    }

    private preprocess(code: string): string {
        // Remove #include, #define, etc. but keep line numbers
        return code.split('\n').map(line => {
            if (line.trim().startsWith('#')) {
                return ''; // Replace directive with empty line to preserve line numbers
            }
            return line;
        }).join('\n');
    }

    private peek(offset: number = 0): string {
        return this.code[this.pos + offset] || '';
    }

    private advance(): string {
        const char = this.code[this.pos++];
        if (char === '\n') {
            this.line++;
            this.column = 0;
        } else {
            this.column++;
        }
        return char;
    }

    private skipWhitespace(): void {
        while (this.pos < this.code.length) {
            const char = this.peek();
            if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
                this.advance();
            } else if (char === '/' && this.peek(1) === '/') {
                // Single-line comment
                while (this.pos < this.code.length && this.peek() !== '\n') {
                    this.advance();
                }
            } else if (char === '/' && this.peek(1) === '*') {
                // Multi-line comment
                this.advance(); // /
                this.advance(); // *
                while (this.pos < this.code.length) {
                    if (this.peek() === '*' && this.peek(1) === '/') {
                        this.advance(); // *
                        this.advance(); // /
                        break;
                    }
                    this.advance();
                }
            } else {
                break;
            }
        }
    }

    private readString(quote: string): Token {
        const startLine = this.line;
        const startColumn = this.column;
        this.advance(); // Opening quote
        let value = '';

        while (this.pos < this.code.length && this.peek() !== quote) {
            if (this.peek() === '\\') {
                this.advance();
                const escaped = this.advance();
                switch (escaped) {
                    case 'n': value += '\n'; break;
                    case 't': value += '\t'; break;
                    case 'r': value += '\r'; break;
                    case '\\': value += '\\'; break;
                    case "'": value += "'"; break;
                    case '"': value += '"'; break;
                    default: value += escaped;
                }
            } else {
                value += this.advance();
            }
        }
        this.advance(); // Closing quote

        return {
            type: quote === "'" ? 'CHAR' : 'STRING',
            value,
            line: startLine,
            column: startColumn
        };
    }

    private readNumber(): Token {
        const startLine = this.line;
        const startColumn = this.column;
        let value = '';

        // Handle hex numbers
        if (this.peek() === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X')) {
            value += this.advance() + this.advance();
            while (/[0-9a-fA-F]/.test(this.peek())) {
                value += this.advance();
            }
        } else {
            while (/[0-9]/.test(this.peek())) {
                value += this.advance();
            }
            if (this.peek() === '.' && /[0-9]/.test(this.peek(1))) {
                value += this.advance();
                while (/[0-9]/.test(this.peek())) {
                    value += this.advance();
                }
            }
            // Handle scientific notation
            if (this.peek() === 'e' || this.peek() === 'E') {
                value += this.advance();
                if (this.peek() === '+' || this.peek() === '-') {
                    value += this.advance();
                }
                while (/[0-9]/.test(this.peek())) {
                    value += this.advance();
                }
            }
        }

        // Handle type suffixes (f, l, u, etc.)
        if (/[fFlLuU]/.test(this.peek())) {
            this.advance();
        }

        return { type: 'NUMBER', value, line: startLine, column: startColumn };
    }

    private readIdentifier(): Token {
        const startLine = this.line;
        const startColumn = this.column;
        let value = '';

        while (/[a-zA-Z0-9_]/.test(this.peek())) {
            value += this.advance();
        }

        return {
            type: C_KEYWORDS.has(value) ? 'KEYWORD' : 'IDENTIFIER',
            value,
            line: startLine,
            column: startColumn
        };
    }

    private readOperator(): Token {
        const startLine = this.line;
        const startColumn = this.column;

        // Try to match longest operator first
        for (const op of C_OPERATORS) {
            if (this.code.substr(this.pos, op.length) === op) {
                for (let i = 0; i < op.length; i++) this.advance();
                return { type: 'OPERATOR', value: op, line: startLine, column: startColumn };
            }
        }

        // Single character operator
        return { type: 'OPERATOR', value: this.advance(), line: startLine, column: startColumn };
    }

    tokenize(): Token[] {
        while (this.pos < this.code.length) {
            this.skipWhitespace();
            if (this.pos >= this.code.length) break;

            const char = this.peek();
            const startLine = this.line;
            const startColumn = this.column;

            if (char === '"' || char === "'") {
                this.tokens.push(this.readString(char));
            } else if (/[0-9]/.test(char)) {
                this.tokens.push(this.readNumber());
            } else if (/[a-zA-Z_]/.test(char)) {
                this.tokens.push(this.readIdentifier());
            } else if ('{}[]();,.'.includes(char)) {
                this.tokens.push({
                    type: 'PUNCTUATION',
                    value: this.advance(),
                    line: startLine,
                    column: startColumn
                });
            } else {
                this.tokens.push(this.readOperator());
            }
        }

        this.tokens.push({ type: 'EOF', value: '', line: this.line, column: this.column });
        return this.tokens;
    }
}

/**
 * Parser: Parse tokens into Babel-compatible AST
 */
class CParser {
    private tokens: Token[] = [];
    private pos: number = 0;

    constructor(code: string) {
        const lexer = new CLexer(code);
        this.tokens = lexer.tokenize();
    }

    private peek(offset: number = 0): Token {
        return this.tokens[this.pos + offset] || { type: 'EOF', value: '', line: 0, column: 0 };
    }

    private advance(): Token {
        return this.tokens[this.pos++];
    }

    private expect(type: TokenType, value?: string): Token {
        const token = this.advance();
        if (token.type !== type || (value !== undefined && token.value !== value)) {
            throw new Error(`Expected ${type}${value ? ` '${value}'` : ''} at line ${token.line}, got ${token.type} '${token.value}'`);
        }
        return token;
    }

    private match(type: TokenType, value?: string): boolean {
        const token = this.peek();
        return token.type === type && (value === undefined || token.value === value);
    }

    private createLoc(startToken: Token, endToken?: Token): any {
        const end = endToken || startToken;
        return {
            start: { line: startToken.line, column: startToken.column },
            end: { line: end.line, column: end.column + end.value.length }
        };
    }

    private isType(): boolean {
        const types = ['int', 'float', 'double', 'char', 'void', 'long', 'short', 'unsigned', 'signed', 'struct'];
        return this.match('KEYWORD') && types.includes(this.peek().value);
    }

    parse(): t.File {
        const body: t.Statement[] = [];

        while (!this.match('EOF')) {
            const stmt = this.parseTopLevel();
            if (stmt) body.push(stmt);
        }

        return t.file(t.program(body, [], "module"), [], null);
    }

    private parseTopLevel(): t.Statement | null {
        // Skip empty statements
        if (this.match('PUNCTUATION', ';')) {
            this.advance();
            return null;
        }

        // Handle struct declarations
        if (this.match('KEYWORD', 'struct')) {
            return this.parseStructDeclaration();
        }

        // Type declaration (variable or function)
        if (this.isType()) {
            return this.parseDeclaration();
        }

        // Expression statement
        return this.parseStatement();
    }

    private parseDeclaration(): t.Statement {
        const startToken = this.peek();
        const type = this.parseType();
        const name = this.expect('IDENTIFIER');

        // Check for function declaration
        if (this.match('PUNCTUATION', '(')) {
            return this.parseFunctionDeclaration(type, name, startToken);
        }

        // Variable declaration
        return this.parseVariableDeclaration(type, name, startToken);
    }

    private parseType(): string {
        let type = '';
        while (this.isType()) {
            if (type) type += ' ';
            const token = this.advance();
            type += token.value;

            // Handle struct Name
            if (token.value === 'struct' && this.match('IDENTIFIER')) {
                type += ' ' + this.advance().value;
            }
        }
        // Handle pointers
        while (this.match('OPERATOR', '*')) {
            this.advance();
            type += '*';
        }
        return type;
    }

    private parseVariableDeclaration(type: string, name: Token, startToken: Token): t.VariableDeclaration {
        const declarations: t.VariableDeclarator[] = [];
        let init: t.Expression | null = null;

        // Check for array declaration
        if (this.match('PUNCTUATION', '[')) {
            return this.parseArrayDeclaration(type, name, startToken);
        }

        // Check for initialization
        if (this.match('OPERATOR', '=')) {
            this.advance();
            init = this.parseExpression();
        } else if (type.startsWith('struct ') && !type.includes('*')) {
            // Auto-initialize struct declaration: struct Point p; -> let p = __allocStruct('Point');
            const structName = type.replace('struct ', '').trim();
            init = t.callExpression(t.identifier('__allocStruct'), [t.stringLiteral(structName)]);
        }

        const id = t.identifier(name.value);
        id.loc = this.createLoc(name);
        const declarator = t.variableDeclarator(id, init);
        declarations.push(declarator);

        // Handle multiple declarations: int a, b, c;
        while (this.match('PUNCTUATION', ',')) {
            this.advance();
            const nextName = this.expect('IDENTIFIER');
            let nextInit: t.Expression | null = null;
            if (this.match('OPERATOR', '=')) {
                this.advance();
                nextInit = this.parseExpression();
            } else if (type.startsWith('struct ') && !type.includes('*')) {
                const structName = type.replace('struct ', '').trim();
                nextInit = t.callExpression(t.identifier('__allocStruct'), [t.stringLiteral(structName)]);
            }
            const nextId = t.identifier(nextName.value);
            nextId.loc = this.createLoc(nextName);
            declarations.push(t.variableDeclarator(nextId, nextInit));
        }

        this.expect('PUNCTUATION', ';');

        const decl = t.variableDeclaration('let', declarations);
        decl.loc = this.createLoc(startToken, this.peek());
        return decl;
    }

    private parseArrayDeclaration(_type: string, name: Token, startToken: Token): t.VariableDeclaration {
        this.expect('PUNCTUATION', '[');
        let size: t.Expression | null = null;
        if (!this.match('PUNCTUATION', ']')) {
            size = this.parseExpression();
        }
        this.expect('PUNCTUATION', ']');

        let init: t.Expression | null = null;

        // Array initialization: int arr[] = {1, 2, 3};
        if (this.match('OPERATOR', '=')) {
            this.advance();
            if (this.match('PUNCTUATION', '{')) {
                init = this.parseArrayLiteral();
            } else {
                init = this.parseExpression();
            }
        } else if (size) {
            // Create array with size: new Array(size)
            init = t.newExpression(t.identifier('Array'), [size]);
        }

        this.expect('PUNCTUATION', ';');

        const id = t.identifier(name.value);
        id.loc = this.createLoc(name);
        const declarator = t.variableDeclarator(id, init);
        const decl = t.variableDeclaration('let', [declarator]);
        decl.loc = this.createLoc(startToken, this.peek());
        return decl;
    }

    private parseArrayLiteral(): t.ArrayExpression {
        this.expect('PUNCTUATION', '{');
        const elements: t.Expression[] = [];

        while (!this.match('PUNCTUATION', '}')) {
            elements.push(this.parseExpression());
            if (this.match('PUNCTUATION', ',')) {
                this.advance();
            }
        }

        this.expect('PUNCTUATION', '}');
        return t.arrayExpression(elements);
    }

    private parseFunctionDeclaration(_returnType: string, name: Token, startToken: Token): t.FunctionDeclaration {
        this.expect('PUNCTUATION', '(');
        const params: t.Identifier[] = [];

        // Parse parameters
        while (!this.match('PUNCTUATION', ')')) {
            if (this.match('KEYWORD', 'void')) {
                this.advance();
                break;
            }

            this.parseType(); // Parameter type (ignored in AST for simplicity)
            const paramName = this.expect('IDENTIFIER');

            // Check for array parameter
            if (this.match('PUNCTUATION', '[')) {
                this.advance();
                if (!this.match('PUNCTUATION', ']')) {
                    this.parseExpression(); // Array size
                }
                this.expect('PUNCTUATION', ']');
            }

            const param = t.identifier(paramName.value);
            param.loc = this.createLoc(paramName);
            params.push(param);

            if (this.match('PUNCTUATION', ',')) {
                this.advance();
            }
        }

        this.expect('PUNCTUATION', ')');
        const body = this.parseBlock();

        const id = t.identifier(name.value);
        id.loc = this.createLoc(name);
        const func = t.functionDeclaration(id, params, body);
        func.loc = this.createLoc(startToken, this.peek());
        return func;
    }

    private parseBlock(): t.BlockStatement {
        const startToken = this.expect('PUNCTUATION', '{');
        const body: t.Statement[] = [];

        while (!this.match('PUNCTUATION', '}') && !this.match('EOF')) {
            const stmt = this.parseStatement();
            if (stmt) body.push(stmt);
        }

        const endToken = this.expect('PUNCTUATION', '}');
        const block = t.blockStatement(body);
        block.loc = this.createLoc(startToken, endToken);
        return block;
    }

    private parseStatement(): t.Statement | null {
        // Skip empty statements
        if (this.match('PUNCTUATION', ';')) {
            this.advance();
            return null as any;
        }

        // Control flow
        if (this.match('KEYWORD', 'if')) return this.parseIfStatement();
        if (this.match('KEYWORD', 'for')) return this.parseForStatement();
        if (this.match('KEYWORD', 'while')) return this.parseWhileStatement();
        if (this.match('KEYWORD', 'do')) return this.parseDoWhileStatement();
        if (this.match('KEYWORD', 'switch')) return this.parseSwitchStatement();
        if (this.match('KEYWORD', 'return')) return this.parseReturnStatement();
        if (this.match('KEYWORD', 'break')) return this.parseBreakStatement();
        if (this.match('KEYWORD', 'continue')) return this.parseContinueStatement();

        // Block
        if (this.match('PUNCTUATION', '{')) return this.parseBlock();

        // Variable declaration
        if (this.isType()) {
            return this.parseDeclaration();
        }

        // Expression statement
        return this.parseExpressionStatement();
    }

    private parseIfStatement(): t.IfStatement {
        const startToken = this.expect('KEYWORD', 'if');
        this.expect('PUNCTUATION', '(');
        const test = this.parseExpression();
        this.expect('PUNCTUATION', ')');

        const consequent = this.parseStatement() || t.emptyStatement();
        let alternate: t.Statement | null = null;

        if (this.match('KEYWORD', 'else')) {
            this.advance();
            alternate = this.parseStatement();
        }

        const stmt = t.ifStatement(test, consequent, alternate);
        stmt.loc = this.createLoc(startToken, this.peek());
        return stmt;
    }

    private parseForStatement(): t.ForStatement {
        const startToken = this.expect('KEYWORD', 'for');
        this.expect('PUNCTUATION', '(');

        // Init
        let init: t.VariableDeclaration | t.Expression | null = null;
        if (!this.match('PUNCTUATION', ';')) {
            if (this.isType()) {
                const type = this.parseType();
                const name = this.expect('IDENTIFIER');
                init = this.parseVariableDeclarationNoSemi(type, name);
            } else {
                init = this.parseExpression();
            }
        }
        this.expect('PUNCTUATION', ';');

        // Test
        let test: t.Expression | null = null;
        if (!this.match('PUNCTUATION', ';')) {
            test = this.parseExpression();
        }
        this.expect('PUNCTUATION', ';');

        // Update
        let update: t.Expression | null = null;
        if (!this.match('PUNCTUATION', ')')) {
            update = this.parseExpression();
        }
        this.expect('PUNCTUATION', ')');

        const body = this.parseStatement() || t.emptyStatement();

        const stmt = t.forStatement(init, test, update, body);
        stmt.loc = this.createLoc(startToken, this.peek());
        return stmt;
    }

    private parseVariableDeclarationNoSemi(_type: string, name: Token): t.VariableDeclaration {
        let init: t.Expression | null = null;
        if (this.match('OPERATOR', '=')) {
            this.advance();
            init = this.parseExpression();
        }
        const id = t.identifier(name.value);
        const declarator = t.variableDeclarator(id, init);
        return t.variableDeclaration('let', [declarator]);
    }

    private parseWhileStatement(): t.WhileStatement {
        const startToken = this.expect('KEYWORD', 'while');
        this.expect('PUNCTUATION', '(');
        const test = this.parseExpression();
        this.expect('PUNCTUATION', ')');
        const body = this.parseStatement() || t.emptyStatement();

        const stmt = t.whileStatement(test, body);
        stmt.loc = this.createLoc(startToken, this.peek());
        return stmt;
    }

    private parseDoWhileStatement(): t.DoWhileStatement {
        const startToken = this.expect('KEYWORD', 'do');
        const body = this.parseStatement() || t.emptyStatement();
        this.expect('KEYWORD', 'while');
        this.expect('PUNCTUATION', '(');
        const test = this.parseExpression();
        this.expect('PUNCTUATION', ')');
        this.expect('PUNCTUATION', ';');

        const stmt = t.doWhileStatement(test, body);
        stmt.loc = this.createLoc(startToken, this.peek());
        return stmt;
    }

    private parseSwitchStatement(): t.SwitchStatement {
        const startToken = this.expect('KEYWORD', 'switch');
        this.expect('PUNCTUATION', '(');
        const discriminant = this.parseExpression();
        this.expect('PUNCTUATION', ')');
        this.expect('PUNCTUATION', '{');

        const cases: t.SwitchCase[] = [];
        while (!this.match('PUNCTUATION', '}')) {
            if (this.match('KEYWORD', 'case')) {
                this.advance();
                const test = this.parseExpression();
                this.expect('PUNCTUATION', ':');
                const consequent: t.Statement[] = [];
                while (!this.match('KEYWORD', 'case') && !this.match('KEYWORD', 'default') && !this.match('PUNCTUATION', '}')) {
                    const stmt = this.parseStatement();
                    if (stmt) consequent.push(stmt);
                }
                cases.push(t.switchCase(test, consequent));
            } else if (this.match('KEYWORD', 'default')) {
                this.advance();
                this.expect('PUNCTUATION', ':');
                const consequent: t.Statement[] = [];
                while (!this.match('KEYWORD', 'case') && !this.match('PUNCTUATION', '}')) {
                    const stmt = this.parseStatement();
                    if (stmt) consequent.push(stmt);
                }
                cases.push(t.switchCase(null, consequent));
            }
        }

        this.expect('PUNCTUATION', '}');
        const stmt = t.switchStatement(discriminant, cases);
        stmt.loc = this.createLoc(startToken, this.peek());
        return stmt;
    }

    private parseReturnStatement(): t.ReturnStatement {
        const startToken = this.expect('KEYWORD', 'return');
        let argument: t.Expression | null = null;
        if (!this.match('PUNCTUATION', ';')) {
            argument = this.parseExpression();
        }
        this.expect('PUNCTUATION', ';');

        const stmt = t.returnStatement(argument);
        stmt.loc = this.createLoc(startToken, this.peek());
        return stmt;
    }

    private parseBreakStatement(): t.BreakStatement {
        const startToken = this.expect('KEYWORD', 'break');
        this.expect('PUNCTUATION', ';');
        const stmt = t.breakStatement();
        stmt.loc = this.createLoc(startToken, this.peek());
        return stmt;
    }

    private parseContinueStatement(): t.ContinueStatement {
        const startToken = this.expect('KEYWORD', 'continue');
        this.expect('PUNCTUATION', ';');
        const stmt = t.continueStatement();
        stmt.loc = this.createLoc(startToken, this.peek());
        return stmt;
    }

    private parseExpressionStatement(): t.ExpressionStatement {
        const expr = this.parseExpression();
        this.expect('PUNCTUATION', ';');
        return t.expressionStatement(expr);
    }

    private parseExpression(): t.Expression {
        return this.parseAssignment();
    }

    private parseAssignment(): t.Expression {
        const left = this.parseTernary();

        const assignOps = ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='];
        if (this.match('OPERATOR') && assignOps.includes(this.peek().value)) {
            const op = this.advance().value;
            const right = this.parseAssignment();

            if (op === '=') {
                // Handle assignment to pointer dereference: *p = val -> __assign_deref(p, val)
                if (t.isCallExpression(left) && t.isIdentifier(left.callee)) {
                    if (left.callee.name === '__deref') {
                        return t.callExpression(t.identifier('__assign_deref'), [left.arguments[0], right]);
                    }
                    if (left.callee.name === '__arrow') {
                        return t.callExpression(t.identifier('__assign_arrow'), [left.arguments[0], left.arguments[1], right]);
                    }
                }
                return t.assignmentExpression('=', left as any, right);
            }
            // Compound assignment: a += b -> a = a + b
            const binaryOp = op.slice(0, -1) as any;
            return t.assignmentExpression('=', left as any,
                t.binaryExpression(binaryOp, left, right));
        }

        return left;
    }

    private parseTernary(): t.Expression {
        let condition = this.parseLogicalOr();

        if (this.match('OPERATOR', '?')) {
            this.advance();
            const consequent = this.parseExpression();
            this.expect('OPERATOR', ':');
            const alternate = this.parseTernary();
            return t.conditionalExpression(condition, consequent, alternate);
        }

        return condition;
    }

    private parseLogicalOr(): t.Expression {
        let left = this.parseLogicalAnd();
        while (this.match('OPERATOR', '||')) {
            this.advance();
            const right = this.parseLogicalAnd();
            left = t.logicalExpression('||', left, right);
        }
        return left;
    }

    private parseLogicalAnd(): t.Expression {
        let left = this.parseBitwiseOr();
        while (this.match('OPERATOR', '&&')) {
            this.advance();
            const right = this.parseBitwiseOr();
            left = t.logicalExpression('&&', left, right);
        }
        return left;
    }

    private parseBitwiseOr(): t.Expression {
        let left = this.parseBitwiseXor();
        while (this.match('OPERATOR', '|') && this.peek(1).value !== '|') {
            this.advance();
            const right = this.parseBitwiseXor();
            left = t.binaryExpression('|', left, right);
        }
        return left;
    }

    private parseBitwiseXor(): t.Expression {
        let left = this.parseBitwiseAnd();
        while (this.match('OPERATOR', '^')) {
            this.advance();
            const right = this.parseBitwiseAnd();
            left = t.binaryExpression('^', left, right);
        }
        return left;
    }

    private parseBitwiseAnd(): t.Expression {
        let left = this.parseEquality();
        while (this.match('OPERATOR', '&') && this.peek(1).value !== '&') {
            this.advance();
            const right = this.parseEquality();
            left = t.binaryExpression('&', left, right);
        }
        return left;
    }

    private parseEquality(): t.Expression {
        let left = this.parseRelational();
        while (this.match('OPERATOR', '==') || this.match('OPERATOR', '!=')) {
            const op = this.advance().value as '==' | '!=';
            const right = this.parseRelational();
            left = t.binaryExpression(op === '==' ? '===' : '!==', left, right);
        }
        return left;
    }

    private parseRelational(): t.Expression {
        let left = this.parseShift();
        while (this.match('OPERATOR', '<') || this.match('OPERATOR', '>') ||
            this.match('OPERATOR', '<=') || this.match('OPERATOR', '>=')) {
            const op = this.advance().value as '<' | '>' | '<=' | '>=';
            const right = this.parseShift();
            left = t.binaryExpression(op, left, right);
        }
        return left;
    }

    private parseShift(): t.Expression {
        let left = this.parseAdditive();
        while (this.match('OPERATOR', '<<') || this.match('OPERATOR', '>>')) {
            const op = this.advance().value as '<<' | '>>';
            const right = this.parseAdditive();
            left = t.binaryExpression(op, left, right);
        }
        return left;
    }

    private parseAdditive(): t.Expression {
        let left = this.parseMultiplicative();
        while (this.match('OPERATOR', '+') || this.match('OPERATOR', '-')) {
            const op = this.advance().value as '+' | '-';
            const right = this.parseMultiplicative();
            left = t.binaryExpression(op, left, right);
        }
        return left;
    }

    private parseMultiplicative(): t.Expression {
        let left = this.parseUnary();
        while (this.match('OPERATOR', '*') || this.match('OPERATOR', '/') || this.match('OPERATOR', '%')) {
            const op = this.advance().value as '*' | '/' | '%';
            const right = this.parseUnary();
            left = t.binaryExpression(op, left, right);
        }
        return left;
    }

    private parseUnary(): t.Expression {
        // Prefix operators
        if (this.match('OPERATOR', '!') || this.match('OPERATOR', '~') ||
            this.match('OPERATOR', '-') || this.match('OPERATOR', '+')) {
            const op = this.advance().value;
            const argument = this.parseUnary();
            return t.unaryExpression(op as any, argument, true);
        }

        // Increment/Decrement
        if (this.match('OPERATOR', '++') || this.match('OPERATOR', '--')) {
            const op = this.advance().value;
            const argument = this.parseUnary();
            return t.updateExpression(op as '++' | '--', argument, true);
        }

        // Pointer dereference
        if (this.match('OPERATOR', '*')) {
            this.advance();
            const argument = this.parseUnary();
            // Represent as a call to __deref for the interpreter
            return t.callExpression(t.identifier('__deref'), [argument]);
        }

        // Address-of
        if (this.match('OPERATOR', '&')) {
            this.advance();
            const argument = this.parseUnary();
            // Represent as a call to __addr for the interpreter
            return t.callExpression(t.identifier('__addr'), [argument]);
        }

        // sizeof
        if (this.match('KEYWORD', 'sizeof')) {
            this.advance();
            this.expect('PUNCTUATION', '(');
            // Could be a type or expression
            if (this.isType()) {
                const type = this.parseType();
                this.expect('PUNCTUATION', ')');
                // Return size based on type (primitives only)
                const sizes: Record<string, number> = { 'int': 4, 'float': 4, 'double': 8, 'char': 1, 'long': 8, 'short': 2 };
                if (sizes[type]) {
                    return t.numericLiteral(sizes[type]);
                }
                // Defer to runtime for complex types (structs, pointers, etc.)
                return t.callExpression(t.identifier('__sizeof'), [t.stringLiteral(type)]);
            }
            const expr = this.parseExpression();
            this.expect('PUNCTUATION', ')');
            return t.callExpression(t.identifier('__sizeof'), [expr]);
        }

        return this.parsePostfix();
    }

    private parsePostfix(): t.Expression {
        let expr = this.parsePrimary();

        while (true) {
            // Array access
            if (this.match('PUNCTUATION', '[')) {
                this.advance();
                const index = this.parseExpression();
                this.expect('PUNCTUATION', ']');
                expr = t.memberExpression(expr, index, true);
            }
            // Function call
            else if (this.match('PUNCTUATION', '(')) {
                this.advance();
                const args: t.Expression[] = [];
                while (!this.match('PUNCTUATION', ')')) {
                    args.push(this.parseExpression());
                    if (this.match('PUNCTUATION', ',')) {
                        this.advance();
                    }
                }
                this.expect('PUNCTUATION', ')');
                expr = t.callExpression(expr, args);
            }
            // Member access
            else if (this.match('OPERATOR', '.')) {
                this.advance();
                const prop = this.expect('IDENTIFIER');
                expr = t.memberExpression(expr, t.identifier(prop.value), false);
            }
            // Pointer member access (->)
            else if (this.match('OPERATOR', '->')) {
                this.advance();
                const prop = this.expect('IDENTIFIER');
                // Transform a->b to __arrow(a, 'b')
                // This allows interpreter to resolve type at runtime
                const args = [expr, t.stringLiteral(prop.value)];
                expr = t.callExpression(t.identifier('__arrow'), args);
            }
            // Post increment/decrement
            else if (this.match('OPERATOR', '++') || this.match('OPERATOR', '--')) {
                const op = this.advance().value;
                expr = t.updateExpression(op as '++' | '--', expr, false);
            }
            else {
                break;
            }
        }

        return expr;
    }

    private parsePrimary(): t.Expression {
        const token = this.peek();

        // Parenthesized expression or type cast
        if (this.match('PUNCTUATION', '(')) {
            this.advance();
            // Check if this is a type cast
            if (this.isType()) {
                this.parseType(); // Ignore cast type for now
                this.expect('PUNCTUATION', ')');
                return this.parseUnary();
            }
            const expr = this.parseExpression();
            this.expect('PUNCTUATION', ')');
            return expr;
        }

        // Number
        if (this.match('NUMBER')) {
            const value = this.advance().value;
            if (value.includes('.') || value.includes('e') || value.includes('E')) {
                return t.numericLiteral(parseFloat(value));
            }
            if (value.startsWith('0x') || value.startsWith('0X')) {
                return t.numericLiteral(parseInt(value, 16));
            }
            return t.numericLiteral(parseInt(value, 10));
        }

        // String
        if (this.match('STRING')) {
            return t.stringLiteral(this.advance().value);
        }

        // Character
        if (this.match('CHAR')) {
            const char = this.advance().value;
            return t.stringLiteral(char);
        }

        // NULL
        if (this.match('KEYWORD', 'NULL')) {
            this.advance();
            return t.nullLiteral();
        }

        // Identifier
        if (this.match('IDENTIFIER') || this.match('KEYWORD', 'printf') ||
            this.match('KEYWORD', 'scanf') || this.match('KEYWORD', 'malloc') ||
            this.match('KEYWORD', 'free')) {
            return t.identifier(this.advance().value);
        }

        throw new Error(`Unexpected token: ${token.type} '${token.value}' at line ${token.line}`);
    }

    private parseStructDeclaration(): t.Statement {
        const startToken = this.expect('KEYWORD', 'struct');
        const name = this.expect('IDENTIFIER');

        this.expect('PUNCTUATION', '{');
        const members: t.ClassProperty[] = [];

        while (!this.match('PUNCTUATION', '}')) {
            if (this.isType()) {
                const type = this.parseType();
                const memberName = this.expect('IDENTIFIER');

                // Handle array members
                let arraySize: t.Expression | null = null;
                if (this.match('PUNCTUATION', '[')) {
                    this.advance();
                    if (!this.match('PUNCTUATION', ']')) {
                        arraySize = this.parseExpression();
                    }
                    this.expect('PUNCTUATION', ']');
                }

                this.expect('PUNCTUATION', ';');

                // Store field info in ClassProperty with type annotation
                const id = t.identifier(memberName.value);
                // We use TS type annotation to store the C type string
                const typeRef = t.tsTypeReference(t.identifier(type));
                const typeAnn = t.tsTypeAnnotation(typeRef);

                const prop = t.classProperty(id, null, typeAnn as any);
                // If it's an array, denote it in the type ref name? e.g. "int[10]"
                // Or just store it as "int" and let runtime handle arrayness via initialization?
                // CStructDef needs to know if it's an array to calculate size.
                // Let's hack it: if array, append size to type name in the reference
                if (arraySize && t.isNumericLiteral(arraySize)) {
                    typeRef.typeName = t.identifier(`${type}[${arraySize.value}]`);
                }

                members.push(prop);
            }
        }

        this.expect('PUNCTUATION', '}');
        this.expect('PUNCTUATION', ';');

        const classBody = t.classBody(members);
        const classDecl = t.classDeclaration(t.identifier(name.value), null, classBody);
        classDecl.loc = this.createLoc(startToken, this.peek());
        return classDecl;
    }
}

/**
 * Main entry point: Parse C code into Babel-compatible AST
 */
export function parseCCode(code: string): t.File {
    try {
        const parser = new CParser(code);
        return parser.parse();
    } catch (error) {
        console.error("C parsing error:", error);
        throw error;
    }
}
