import * as filbert from 'filbert';
import * as t from '@babel/types';

// Helper to preprocess Python code (handle f-strings)
// Helper to preprocess Python code (handle f-strings, trailing commas)
function preprocessPythonCode(code: string): string {
    let out = '';
    let i = 0;
    const len = code.length;
    let inString: string | null = null; // ' or " or ''' or """
    let inComment = false;

    // Helper to peek ahead
    const slice = (n: number) => code.slice(i, i + n);

    while (i < len) {
        const char = code[i];

        if (inComment) {
            if (char === '\n') {
                inComment = false;
            }
            out += char;
            i++;
            continue;
        }

        if (inString) {
            // Check for end of string
            if (inString.length === 3) {
                if (slice(3) === inString) {
                    out += inString;
                    i += 3;
                    inString = null;
                    continue;
                }
            } else {
                if (char === inString && code[i - 1] !== '\\') {
                    out += char;
                    i++;
                    inString = null;
                    continue;
                }
            }
            // Check for f-string placeholder logic inside string (simplified)
            // We can't easily transform f-strings inside this loop without a full parser.
            // So we will stick to basic string skipping and rely on regex for f-strings LATER?
            // Or we just preserve content.
            out += char;
            i++;
            continue;
        }

        // Detect String Start
        if (char === '"' || char === "'") {
            // Check triple quote
            if (slice(3) === `\${char}\${char}\${char}`) {
                inString = char + char + char;
                out += inString;
                i += 3;
                continue;
            }
            // Check f-string prefix
            // Actually f-string conversion is complex to do here. 
            // Let's rely on the previous REGEX for f-strings, applied *after* comma cleanup? 
            // NO, cleaning commas is safer *before* any other mangling, but we need to respect strings.

            inString = char;
            out += char;
            i++;
            continue;
        }

        if (char === '#') {
            inComment = true;
            out += char;
            i++;
            continue;
        }

        // Trailing Comma Logic
        // If we see a closer, check if previous non-whitespace in 'out' was a comma
        if (char === ']' || char === '}' || char === ')') {
            // scan backwards in 'out'
            let j = out.length - 1;
            while (j >= 0 && /\s/.test(out[j])) j--;
            if (j >= 0 && out[j] === ',') {
                // Replace comma with space
                out = out.substring(0, j) + ' ' + out.substring(j + 1);
            }
        }

        out += char;
        i++;
    }

    // After comma cleanup, apply f-string regex
    // Note: F-string regex assumes valid python.
    return out.replace(/f(["'])(.*?)\1/g, (match, quote, content) => {
        const extractions: string[] = [];
        let processedContent = content.replace(/\{([^}]+)\}/g, (_: string, expr: string) => {
            extractions.push(expr.trim());
            return '{}';
        });

        if (extractions.length === 0) return `${quote}${content}${quote}`;
        return `${quote}${processedContent}${quote}.format(${extractions.join(', ')})`;
    });
}

// Function to simplify Filbert's AST output
// Filbert transpiles for loops into complex (var declaraction + if/else check + loop),
// which hides the original loop structure from our parser. We need to restore it.
function simplifyFilbertAST(node: any): any {
    if (!node || typeof node !== 'object') return node;

    // Handle Array of nodes (e.g. body of a block)
    if (Array.isArray(node)) {
        // First recurse on elements
        for (let i = 0; i < node.length; i++) {
            node[i] = simplifyFilbertAST(node[i]);
        }

        // Then look for patterns to simplify in this list of statements
        for (let i = 0; i < node.length - 1; i++) {
            const current = node[i];
            const next = node[i + 1];

            // Pattern:
            // 1. VariableDeclaration: var __filbertRightX = ...
            // 2. IfStatement: if (__filbertRightX instanceof ...) ... else { for (i in __filbertRightX) ... }
            if (current && current.type === 'VariableDeclaration' &&
                next && next.type === 'IfStatement') {

                if (current.declarations && current.declarations.length === 1 &&
                    t.isIdentifier(current.declarations[0].id) &&
                    current.declarations[0].id.name.startsWith('__filbertRight')) {

                    const internalVarName = current.declarations[0].id.name;
                    const initValue = current.declarations[0].init;

                    // Check if 'next' uses this internal variable
                    if (t.isBinaryExpression(next.test) &&
                        t.isIdentifier(next.test.left) &&
                        next.test.left.name === internalVarName) {

                        // Check Alternate (Else)
                        // Filbert puts the loop in the else block
                        if (next.alternate && next.alternate.type === 'BlockStatement') {
                            const blockBody = next.alternate.body;
                            // Sometimes blockBody has the loop as single item
                            if (blockBody.length === 1 && (blockBody[0].type === 'ForInStatement' || blockBody[0].type === 'ForOfStatement')) {
                                const loop = blockBody[0];

                                // Check if loop iterates over the internal variable
                                if (t.isIdentifier(loop.right) && loop.right.name === internalVarName) {
                                    // Found the pattern!
                                    // 1. Restore the original right-side expression (iterator)
                                    loop.right = initValue;

                                    // 2. Ensure type is ForInStatement (standardize)
                                    loop.type = 'ForInStatement';

                                    // Replace the IfStatement with the simplified Loop
                                    node[i + 1] = loop;

                                    // Remove the VariableDeclaration
                                    node.splice(i, 1);

                                    // Stay on this index to check next pair (though we just modified structure)
                                    i--;
                                }
                            }
                        }
                    }
                }
            }
        }
        return node;
    }

    // Traverse Object properties
    for (const key of Object.keys(node)) {
        if (key !== 'loc' && key !== 'range' && key !== 'start' && key !== 'end') {
            node[key] = simplifyFilbertAST(node[key]);
        }
    }

    return node;
}

export function parsePythonCode(code: string): t.File {
    try {
        // Preprocess code to handle modern syntax not supported by filbert (like f-strings)
        const processedCode = preprocessPythonCode(code);

        const ast = filbert.parse(processedCode, { locations: true, ranges: true } as any) as any;

        // Simplify AST to fix Loop structure
        const simplifiedAst = simplifyFilbertAST(ast);

        let body = simplifiedAst.body;
        // Filbert sometimes wraps the entire program in a BlockStatement
        if (Array.isArray(body) && body.length === 1 && body[0].type === 'BlockStatement') {
            body = body[0].body;
        }

        // Wrap in a Babel File node to match existing architecture
        return t.file(t.program(body, [], "module"), [], null);
    } catch (error) {
        console.error("Python parsing error:", error);
        throw error;
    }
}
