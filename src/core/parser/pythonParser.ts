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

        if (extractions.length === 0) return match;
        return `${quote}${processedContent}${quote}.format(${extractions.join(', ')})`;
    });
}

export function parsePythonCode(code: string): t.File {
    try {
        // Preprocess code to handle modern syntax not supported by filbert (like f-strings)
        const processedCode = preprocessPythonCode(code);

        const ast = filbert.parse(processedCode, { locations: true, ranges: true } as any) as any;

        let body = ast.body;
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
