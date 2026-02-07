# CodeFlow 🌊

> **See your code come to life.**
> A powerful, real-time code execution visualizer that transforms static code into dynamic, interactive flowcharts.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-7.0-646CFF?logo=vite&logoColor=white)

## 📖 Overview

CodeFlow is a developer tool designed to bridge the gap between reading code and understanding its execution. By parsing standard JavaScript, TypeScript, and Python code, CodeFlow generates accurate, real-time flowcharts and visualizes the step-by-step execution state.

Whether you are debugging complex logic, teaching algorithms, or simply exploring how code works under the hood, CodeFlow provides the visual context you need.

## ✨ Key Features

### 🔍 Deep Execution Visualization
- **Line-by-Line & Expression Tracing**: Watch the instruction pointer move through your code in real-time, with granular step tracking for expressions and template literals.
- **Variable Inspector**: Monitor the state of local and global variables, arrays, and objects as they mutate.
- **Sandboxed Environment**: Safe execution with support for standard JavaScript built-ins like `Array`, `Math`, `Object`, `Date`, and more.
- **Call Stack Tracking**: Visualize the stack frames pushing and popping during function calls and recursion.
- **Execution Timeline**: Scrub back and forth through the execution history to pinpoint logic errors.

### 🎨 Dynamic Flowcharts
- **Auto-Generation**: Instantly converts your code into an SVG-based flowchart.
- **Control Flow**: Explicitly visualizes loops (`for`, `while`, `do-while`), conditionals (`if/else`, `switch`), and exception handling (`try/catch`).
- **Smart Layout**: Automatically arranges nodes for maximum readability.

### 🛠️ Powerful Editor Environment
- **Monaco Editor**: A fully-featured code editor (powered by VS Code's core) with syntax highlighting and IntelliSense.
- **Multi-Language Support**:
  - **JavaScript/TypeScript**: Powered by a custom AST parser and interpreter.
  - **Python**: Powered by `filbert` for client-side Python execution.
  - **C**: Powered by a custom memory simulator with support for pointers, structs, and `malloc`/`free`.
- **Responsive Layout**: Resizable panels for the Editor, Flowchart, and Inspector tools.

## 🏗️ Technology Stack

CodeFlow is built with a modern, performance-focused stack:

- **Frontend Framework**: [React 19](https://react.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **Visualization**: [D3.js](https://d3js.org/) & SVGs
- **Parsers**:
  - `@babel/parser` for JS/TS AST generation.
  - `filbert` for Python parsing.
- **Animation**: [Framer Motion](https://www.framer.com/motion/) for smooth UI transitions.

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Shabari-K-S/codeflow.git
   cd codeflow
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```

4. **Open in Browser**
   Visit `http://localhost:5173` to start attempting to visualize your code.

## 📂 Project Structure

```
src/
├── components/          # React UI Components
│   ├── Editor/          # Monaco Editor integration
│   ├── FlowChart/       # D3.js based Flowchart renderer
│   ├── ExecutionPanel/  # Playback controls (Play, Pause, Step)
│   ├── VariablePanel/   # Variable state inspector
│   └── ...
├── core/                # Core Logic Engine
│   ├── parser/          # AST Parsers (JS, Python)
│   ├── interpreter/     # Custom code interpreter & state machine
│   └── visualizer/      # Node/Edge generation logic
├── stores/              # Global state (Zustand)
├── hooks/               # Custom React hooks
└── utils/               # Shared utilities
```

## 🤝 Contributing

Contributions are welcome! If you'd like to improve the parser, add new language support, or enhance the visualization engine:

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---

**Made with 💙 by Shabari K S**
