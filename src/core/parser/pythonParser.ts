import * as filbert from 'filbert';
import * as t from '@babel/types';

export function parsePythonCode(code: string): t.File {
    try {
        const ast = filbert.parse(code, { locations: true, ranges: true }) as any;

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
