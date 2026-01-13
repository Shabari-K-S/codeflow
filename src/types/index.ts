// Core type definitions for CodeFlow

// === Flow Graph Types ===

export type FlowNodeType =
    | 'start'
    | 'end'
    | 'process'      // Regular statements
    | 'decision'     // if/else, switch
    | 'loop'         // for, while, do-while
    | 'function'     // Function declarations
    | 'call'         // Function calls
    | 'return'       // Return statements
    | 'input'        // User input / parameters
    | 'output';      // console.log, return values

export interface FlowNode {
    id: string;
    type: FlowNodeType;
    label: string;
    code: string;
    lineNumber: number;
    endLineNumber?: number;
    children?: string[];  // For nested structures
    x?: number;
    y?: number;
    width?: number;
    height?: number;
}

export type FlowEdgeType = 'normal' | 'true' | 'false' | 'loop-back' | 'call' | 'recursive';

export interface FlowEdge {
    id: string;
    source: string;
    target: string;
    label?: string;       // 'true', 'false', 'loop', etc.
    type?: FlowEdgeType;
}

export interface FlowGraph {
    nodes: FlowNode[];
    edges: FlowEdge[];
    entryNodeId: string;
    exitNodeId: string;
}

// === Execution Types ===

export interface VariableValue {
    name: string;
    value: unknown;
    type: string;
    changed?: boolean;   // Did this variable change in current step?
    previousValue?: unknown;
}

export interface CallFrame {
    id: string;
    functionName: string;
    lineNumber: number;
    variables: Map<string, VariableValue>;
}

export interface ExecutionStep {
    stepIndex: number;
    nodeId: string;
    lineNumber: number;
    code: string;
    variables: VariableValue[];
    callStack: CallFrame[];
    output?: string;           // console.log output
    error?: string;            // Runtime error
    isBreakpoint?: boolean;
}

export interface ExecutionTrace {
    steps: ExecutionStep[];
    totalSteps: number;
    hasError: boolean;
    errorMessage?: string;
    output: string[];          // All console outputs
}

// === Editor Types ===

export interface Breakpoint {
    lineNumber: number;
    enabled: boolean;
}

export interface EditorState {
    code: string;
    language: 'javascript' | 'python';
    breakpoints: Breakpoint[];
    currentLine: number | null;
}

// === Playback Types ===

export type PlaybackState = 'idle' | 'playing' | 'paused' | 'finished';

export interface PlaybackSettings {
    speed: number;           // 0.25 to 4.0
    autoPlay: boolean;
}

// === Store Types ===

export interface CodeFlowState {
    // Editor
    code: string;
    language: 'javascript' | 'python';
    breakpoints: Set<number>;

    // Parsing
    flowGraph: FlowGraph | null;
    parseError: string | null;

    // Execution
    trace: ExecutionTrace | null;
    currentStepIndex: number;
    playbackState: PlaybackState;
    speed: number;

    // Actions
    setCode: (code: string) => void;
    setLanguage: (lang: 'javascript' | 'python') => void;
    toggleBreakpoint: (line: number) => void;

    visualize: () => void;
    execute: () => void;

    play: () => void;
    pause: () => void;
    stepForward: () => void;
    stepBackward: () => void;
    jumpToStep: (index: number) => void;
    reset: () => void;
    setSpeed: (speed: number) => void;
}
