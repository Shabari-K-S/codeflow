# CodeFlow 🌊

> Real-time code execution flow visualizer - Watch your code come alive

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)
![Vite](https://img.shields.io/badge/Vite-5.0-646CFF)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## 📋 Overview

CodeFlow is an innovative developer tool that transforms static code into dynamic, visual flowcharts. Watch as your code executes line-by-line, see variables change in real-time, and understand complex logic flows through beautiful, interactive visualizations. Perfect for debugging, learning, teaching, and code reviews.

## ✨ Features

### Core Visualization
- **🎯 Line-by-Line Execution** - Highlight and track code execution in real-time
- **📊 Dynamic Flowchart Generation** - Automatic flowchart creation from your code
- **🔄 Control Flow Visualization** - See loops, conditionals, and function calls visually
- **� Recursive Call Visualization** - Distinct visual representation for recursive function calls
- **�💾 Variable State Tracking** - Watch variables change with each execution step
- **🎨 Syntax Highlighting** - Beautiful code editor with multi-language support
- **⚡ Call Stack Visualization** - Understand function calls and returns
- **🧹 Smart Graph Cleanup** - Automatic removal of redundant merge nodes for cleaner flowcharts

### Advanced Features
- **🔍 Step-Through Debugging** - Step forward, backward, or jump to breakpoints
- **🎬 Execution Replay** - Record and replay code execution
- **📈 Complexity Analysis** - Visualize time/space complexity in real-time
- **🌳 Data Structure Visualization** - See arrays, objects, trees, and graphs animate
- **🔗 Dependency Graph** - Map function dependencies and module imports
- **📸 Snapshot & Compare** - Capture execution states and compare different runs
- **🎓 Educational Mode** - Built-in tutorials and explanations

### Developer Experience
- **🚀 Multi-Language Support** - JavaScript, TypeScript, Python, Java, C++
- **💻 Monaco Editor Integration** - Full VS Code editing experience
- **🎨 Multiple Visualization Styles** - Flowchart, UML, Sequence diagrams
- **📱 Responsive Design** - Works on desktop, tablet, and mobile
- **🌗 Theme System** - Dark/Light/Custom themes
- **💾 Session Persistence** - Auto-save your work
- **🔗 Share & Collaborate** - Generate shareable links with embedded code
- **📤 Export Options** - Export as PNG, SVG, MP4, or GIF

### Analytics & Insights
- **⏱️ Performance Metrics** - Execution time, iterations, recursive depth
- **🎯 Code Coverage** - Highlight executed vs unexecuted code paths
- **⚠️ Bottleneck Detection** - Identify slow code sections
- **📊 Execution Statistics** - Function call counts, loop iterations
- **🔥 Heat Map** - Show most-executed code sections

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm, yarn, or pnpm

### Installation

```bash
# Clone the repository
git clone https://github.com/Shabari-K-S/codeflow.git
cd codeflow

# Install dependencies
npm install

# Start development server
npm run dev
```

Visit `http://localhost:5173` and start visualizing!

### Quick Example

```javascript
// Paste this code and hit "Visualize"
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log(fibonacci(5));
```

Watch the recursive calls visualize in real-time! 🎉

## 🏗️ Tech Stack

### Frontend
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite 5.x
- **Styling**: Tailwind CSS + shadcn/ui
- **Code Editor**: Monaco Editor
- **State Management**: Zustand + Immer
- **Animation**: Framer Motion
- **Visualization**: D3.js + React Flow

### Code Execution
- **JavaScript/TypeScript**: Custom AST Parser + Interpreter
- **Python**: Pyodide (Python in WebAssembly)
- **Syntax Analysis**: Babel Parser, @typescript/eslint-parser
- **Code Transformation**: Babel Transform

### Additional Tools
- **Diagram Generation**: Mermaid.js, Cytoscape.js
- **Performance**: Web Workers for heavy processing
- **Storage**: IndexedDB for session persistence

## 📂 Project Structure

```
codeflow/
├── src/
│   ├── components/
│   │   ├── Editor/              # Monaco code editor wrapper
│   │   ├── FlowChart/           # Flowchart visualization
│   │   ├── ExecutionPanel/      # Execution controls
│   │   ├── VariableInspector/   # Variable state viewer
│   │   ├── CallStack/           # Call stack display
│   │   └── Timeline/            # Execution timeline
│   ├── core/
│   │   ├── parser/              # Code parsing engines
│   │   ├── interpreter/         # Code execution engines
│   │   ├── analyzer/            # Static code analysis
│   │   └── visualizer/          # Flow generation logic
│   ├── hooks/                   # Custom React hooks
│   ├── stores/                  # State management
│   ├── workers/                 # Web Workers
│   ├── types/                   # TypeScript definitions
│   └── utils/                   # Helper functions
├── public/
│   ├── examples/                # Sample code files
│   └── tutorials/               # Tutorial content
└── docs/                        # Documentation
```

## 🎮 Usage Examples

### Basic Execution Visualization

```typescript
import { CodeFlowVisualizer } from 'codeflow';

const visualizer = new CodeFlowVisualizer({
  language: 'javascript',
  visualizationType: 'flowchart',
  speed: 'normal'
});

visualizer.loadCode(`
  function findMax(arr) {
    let max = arr[0];
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] > max) {
        max = arr[i];
      }
    }
    return max;
  }
  
  findMax([3, 7, 2, 9, 1]);
`);

visualizer.execute();
```

### Data Structure Visualization

```typescript
// Visualize a binary tree traversal
const tree = {
  value: 10,
  left: { value: 5, left: null, right: null },
  right: { value: 15, left: null, right: null }
};

visualizer.visualizeDataStructure(tree, 'binary-tree');
```

## 🎯 Use Cases

### For Students
- **Learn algorithms** visually (sorting, searching, recursion)
- **Understand control flow** (if/else, loops, switches)
- **Debug homework** assignments by seeing execution
- **Prepare for interviews** with visual practice

### For Teachers
- **Live demonstrations** in lectures
- **Create tutorials** with embedded visualizations
- **Grade assignments** with execution traces
- **Share examples** via links

### For Developers
- **Debug complex logic** with step-through visualization
- **Code reviews** with execution flows
- **Document algorithms** with visual examples
- **Performance profiling** with execution analytics

### For Technical Writers
- **Create documentation** with animated code examples
- **Blog posts** with embedded visualizations
- **Tutorial videos** with recorded executions

## 🎯 Roadmap

### Version 1.1
- [ ] Collaborative mode (multiple users)
- [ ] AI-powered code explanations
- [ ] Mobile app (iOS/Android)
- [ ] VS Code extension

### Version 1.2
- [ ] Real-time collaboration
- [ ] Advanced data structure library
- [ ] Custom visualization plugins
- [ ] Integration with GitHub/GitLab

### Version 2.0
- [ ] Multi-file project support
- [ ] Debugger protocol integration
- [ ] Remote code execution
- [ ] Classroom management features

## 🎨 Visualization Types

1. **Flowchart** - Traditional flowchart with shapes
2. **Sequence Diagram** - UML-style sequence flows
3. **Call Graph** - Function call relationships
4. **Control Flow Graph** - Low-level control flow
5. **Data Flow** - Variable dependencies
6. **Timeline** - Chronological execution view

```bash
# Setup development environment
npm install
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## 📦 Deployment

```bash
# Build optimized production bundle
npm run build

# Preview production build
npm run preview

# Deploy to Vercel/Netlify
npm run deploy
```

## ⚙️ Configuration

Create a `codeflow.config.ts` in your project root:

```typescript
export default {
  defaultLanguage: 'javascript',
  theme: 'dark',
  executionSpeed: 500, // ms per step
  maxExecutionTime: 30000, // 30 seconds
  visualizationStyle: 'flowchart',
  enableAnalytics: true
};
```

## 🔒 Security

- Code execution runs in isolated sandboxes
- No server-side code execution
- All processing happens in browser
- No data collection without consent

## 🙏 Acknowledgments

- Inspired by Python Tutor, VisuAlgo, and Algorithm Visualizer
- Built with modern web technologies
- Community-driven feature development

## 📈 Stats

- ⭐ Star us on GitHub
- 🍴 Fork and contribute
- 📢 Share with your team
- ❤️ Used by 10,000+ developers worldwide

---

**Made with 💙 for developers who love to understand code deeply**

*"Code is poetry, let's make it dance" - CodeFlow Team*