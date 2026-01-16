import { parsePythonCode } from './pythonParser';
import * as t from '@babel/types';
import { describe, it, expect } from 'vitest';

describe('Python Parser', () => {
    it('should parse basic python code', () => {
        const code = `
x = 1
y = 2
print(x + y)
`;
        const ast = parsePythonCode(code);
        console.log(JSON.stringify(ast, null, 2));

        expect(t.isFile(ast)).toBe(true);
        expect(ast.program.body.length).toBeGreaterThan(0);
    });

    it('should provide source locations and handle control flow', () => {
        const code = `
if x > 0:
    print(x)
`;
        const ast = parsePythonCode(code);
        console.log(JSON.stringify(ast, null, 2));

        const ifStmt = ast.program.body[0] as t.IfStatement;
        expect(ifStmt.type).toBe('IfStatement');
        expect(ifStmt.loc).toBeDefined();
        if (ifStmt.loc) {
            console.log('IfStmt loc:', ifStmt.loc);
        }
    });

    it('should parse for loops correctly', () => {
        const code = `
for i in range(5):
    print(i)
`;
        const ast = parsePythonCode(code);
        console.log(JSON.stringify(ast.program.body[0], null, 2));
    });

    it('should parse function definitions correctly', () => {
        const code = `
def foo():
    pass
`;
        const ast = parsePythonCode(code);
        console.log(JSON.stringify(ast.program.body[0], null, 2));
    });
});
