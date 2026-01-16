
import { parsePythonCode } from './src/core/parser/pythonParser.ts';
import { generateFlowGraph } from './src/core/parser/parser.ts';

const pythonCode = `
def loop_test():
    x = 0
    while x < 10:
        x += 1
        if x == 5:
            continue
        if x == 8:
            break
        print(f"Propagating {x}")
`;

console.log('--- Testing Python Loop Control Flow ---');
try {
    const ast = parsePythonCode(pythonCode);
    const { nodes, edges } = generateFlowGraph(ast, pythonCode);

    console.log('Nodes:', nodes.map(n => ({ id: n.id, label: n.label, type: n.type })));
    console.log('Edges:', edges.map(e => ({ source: e.source, target: e.target, label: e.label, type: e.type })));

    // Verify Break
    const breakNode = nodes.find(n => n.label === 'break');
    if (breakNode) {
        const breakEdges = edges.filter(e => e.source === breakNode.id);
        console.log('Break Edge Targets:', breakEdges.map(e => e.target));
        // Should target loop exit
    } else {
        console.error('Break node not found');
    }

    // Verify Continue
    const continueNode = nodes.find(n => n.label === 'continue');
    if (continueNode) {
        const continueEdges = edges.filter(e => e.source === continueNode.id);
        console.log('Continue Edge Targets:', continueEdges.map(e => e.target));
        // Should target loop start/condition
    } else {
        console.error('Continue node not found');
    }

} catch (error) {
    console.error('Error:', error);
}
