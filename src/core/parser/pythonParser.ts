import * as filbert from 'filbert';
import * as t from '@babel/types';

// Helper to preprocess Python code (handle f-strings)
function preprocessPythonCode(code: string): string {
    // Regex to match f-strings: f"..." or f'...'
    // This is a simplified regex and might not handle nested braces or escaped quotes perfectly,
    // but works for standard cases.
    return code.replace(/f(["'])(.*?)\1/g, (match, quote, content) => {
        // Find all {expression} blocks
        const extractions: string[] = [];
        let processedContent = content.replace(/\{([^}]+)\}/g, (_: string, expr: string) => {
            extractions.push(expr.trim());
            return '{}'; // Replace with placeholder
        });

        if (extractions.length === 0) return match; // No replacements needed

        // Reconstruct as ".format(...)"
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
