import { create } from 'zustand';
import type {
    CodeFlowState,
    PlaybackState
} from '../types';
import { parseCode, generateFlowGraph } from '../core/parser/parser';
import { executeCode } from '../core/interpreter/interpreter';

const DEFAULT_CODE = `// Welcome to CodeFlow! 🌊
// Paste your code here and click "Visualize"

function fibonacci(n) {
  if (n <= 1) {
    return n;
  }
  return fibonacci(n - 1) + fibonacci(n - 2);
}

let result = fibonacci(5);
console.log("Result:", result);
`;

export const useStore = create<CodeFlowState>((set, get) => ({
    // === State ===
    code: DEFAULT_CODE,
    language: 'javascript',
    breakpoints: new Set<number>(),

    flowGraph: null,
    parseError: null,

    trace: null,
    currentStepIndex: -1,
    playbackState: 'idle' as PlaybackState,
    speed: 1,

    // === Editor Actions ===
    setCode: (code: string) => {
        set({ code, flowGraph: null, trace: null, currentStepIndex: -1, playbackState: 'idle' });
    },

    setLanguage: (language: 'javascript' | 'python') => {
        set({ language, flowGraph: null, trace: null, currentStepIndex: -1, playbackState: 'idle' });
    },

    toggleBreakpoint: (line: number) => {
        const breakpoints = new Set(get().breakpoints);
        if (breakpoints.has(line)) {
            breakpoints.delete(line);
        } else {
            breakpoints.add(line);
        }
        set({ breakpoints });
    },

    // === Core Actions ===
    visualize: () => {
        const { code, language } = get();
        try {
            const ast = parseCode(code, language);
            const flowGraph = generateFlowGraph(ast);
            set({ flowGraph, parseError: null });
        } catch (error) {
            set({
                flowGraph: null,
                parseError: error instanceof Error ? error.message : 'Parse error'
            });
        }
    },

    execute: () => {
        const { code, language, breakpoints } = get();
        try {
            const trace = executeCode(code, language, Array.from(breakpoints));
            set({
                trace,
                currentStepIndex: 0,
                playbackState: 'paused'
            });
        } catch (error) {
            set({
                trace: {
                    steps: [],
                    totalSteps: 0,
                    hasError: true,
                    errorMessage: error instanceof Error ? error.message : 'Execution error',
                    output: []
                },
                currentStepIndex: -1,
                playbackState: 'idle'
            });
        }
    },

    // === Playback Actions ===
    play: () => {
        const { trace, currentStepIndex } = get();
        if (!trace || currentStepIndex >= trace.totalSteps - 1) {
            return;
        }
        set({ playbackState: 'playing' });
    },

    pause: () => {
        set({ playbackState: 'paused' });
    },

    stepForward: () => {
        const { trace, currentStepIndex, playbackState } = get();
        if (!trace || currentStepIndex >= trace.totalSteps - 1) {
            set({ playbackState: 'finished' });
            return;
        }
        // Only set to paused if not currently playing (manual step)
        const newState = playbackState === 'playing' ? 'playing' : 'paused';
        set({ currentStepIndex: currentStepIndex + 1, playbackState: newState });
    },

    stepBackward: () => {
        const { currentStepIndex } = get();
        if (currentStepIndex <= 0) return;
        set({ currentStepIndex: currentStepIndex - 1, playbackState: 'paused' });
    },

    jumpToStep: (index: number) => {
        const { trace } = get();
        if (!trace) return;
        const clampedIndex = Math.max(0, Math.min(index, trace.totalSteps - 1));
        set({ currentStepIndex: clampedIndex, playbackState: 'paused' });
    },

    reset: () => {
        set({
            currentStepIndex: 0,
            playbackState: 'idle'
        });
    },

    setSpeed: (speed: number) => {
        set({ speed: Math.max(0.25, Math.min(4, speed)) });
    }
}));
