import { parsePythonCode } from './src/core/parser/pythonParser';

const code = `
def multiply(a, b):
    return a * b
`;

const ast = parsePythonCode(code);
console.log(JSON.stringify(ast, null, 2));
