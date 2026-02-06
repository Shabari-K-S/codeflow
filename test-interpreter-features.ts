
import { executeCode } from './src/core/interpreter/interpreter.ts';

function runTest(name: string, code: string, expectedOutput: string[]) {
    console.log(`Running Test: ${name}`);
    const result = executeCode(code, 'javascript');

    if (result.hasError) {
        console.error(`❌ Failed: ${result.errorMessage}`);
        return;
    }

    const actualOutput = result.output;
    const isSuccess = JSON.stringify(actualOutput) === JSON.stringify(expectedOutput);

    if (isSuccess) {
        console.log(`✅ Passed`);
    } else {
        console.error(`❌ Failed`);
        console.error(`   Expected: ${JSON.stringify(expectedOutput)}`);
        console.error(`   Actual:   ${JSON.stringify(actualOutput)}`);
    }
    console.log('---');
}

// 1. Control Flow Tests
runTest('Break/Continue in Loops', `
    for (let i = 0; i < 5; i++) {
        if (i === 1) continue;
        if (i === 3) break;
        console.log(i);
    }
`, ['0', '2']);

// 2. Exception Handling
runTest('Try-Catch-Finally', `
    try {
        console.log("Start");
        throw "Error!";
    } catch (e) {
        console.log("Caught " + e.message);
    } finally {
        console.log("Finally");
    }
`, ['Start', 'Caught Error!', 'Finally']);

// 3. Operators
runTest('Bitwise & Compound', `
    let a = 5; // 101
    let b = 3; // 011
    console.log(a & b); // 1
    console.log(a | b); // 7
    a += 10;
    console.log(a); // 15
`, ['1', '7', '15']);

// 4. Default Params
runTest('Default Parameters', `
    function greet(name = "Guest") {
        console.log("Hello " + name);
    }
    greet();
    greet("Alice");
`, ['Hello Guest', 'Hello Alice']);

// 5. Rest / Spread
runTest('Rest & Spread', `
    function sum(...args) {
        let total = 0;
        for (let n of args) total += n;
        return total;
    }
    const nums = [1, 2, 3];
    console.log(sum(...nums));
    console.log(sum(10, 20));
`, ['6', '30']);

// 6. Destructuring
runTest('Destructuring', `
    const [x, y] = [10, 20];
    console.log(x);
    console.log(y);
    const { a, b = 5 } = { a: 1 };
    console.log(a);
    console.log(b);
`, ['10', '20', '1', '5']);

// 7. Python Features (Mock check via JS binding logic)
// CodeFlow interpreter might expose PythonDict/List if running in 'python' mode or if exposed vars.
// We'll test standard JS functionality here mostly.
