import { useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useStore } from '../../stores/store';
import './CodeEditor.css';

export function CodeEditor() {
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const decorationsRef = useRef<string[]>([]);

    const {
        code,
        language,
        breakpoints,
        currentStepIndex,
        trace,
        setCode,
        toggleBreakpoint,
    } = useStore();

    const handleEditorMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;

        // Define custom theme
        monaco.editor.defineTheme('codeflow-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
                { token: 'comment', foreground: '6e7681', fontStyle: 'italic' },
                { token: 'keyword', foreground: 'ff7b72' },
                { token: 'string', foreground: 'a5d6ff' },
                { token: 'number', foreground: '79c0ff' },
                { token: 'type', foreground: 'ffa657' },
                { token: 'function', foreground: 'd2a8ff' },
                { token: 'variable', foreground: 'ffa657' },
                { token: 'operator', foreground: 'ff7b72' },
            ],
            colors: {
                'editor.background': '#0d1117',
                'editor.foreground': '#e6edf3',
                'editor.lineHighlightBackground': '#161b2299',
                'editor.selectionBackground': '#264f78',
                'editorLineNumber.foreground': '#6e7681',
                'editorLineNumber.activeForeground': '#e6edf3',
                'editorGutter.background': '#0d1117',
                'editorCursor.foreground': '#58a6ff',
                'editor.selectionHighlightBackground': '#3fb95044',
            },
        });

        monaco.editor.setTheme('codeflow-dark');

        // Handle gutter clicks for breakpoints
        editor.onMouseDown((e) => {
            if (e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
                const lineNumber = e.target.position?.lineNumber;
                if (lineNumber) {
                    toggleBreakpoint(lineNumber);
                }
            }
        });
    };

    // Update decorations for current execution line and breakpoints
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;

        const decorations: editor.IModelDeltaDecoration[] = [];

        // Add breakpoint decorations
        breakpoints.forEach(line => {
            decorations.push({
                range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
                options: {
                    isWholeLine: true,
                    className: 'breakpoint-line',
                    glyphMarginClassName: 'breakpoint-glyph',
                },
            });
        });

        // Add current execution line decoration
        if (trace && currentStepIndex >= 0 && currentStepIndex < trace.steps.length) {
            const currentLine = trace.steps[currentStepIndex].lineNumber;
            if (currentLine > 0) {
                decorations.push({
                    range: {
                        startLineNumber: currentLine,
                        startColumn: 1,
                        endLineNumber: currentLine,
                        endColumn: 1,
                    },
                    options: {
                        isWholeLine: true,
                        className: 'execution-line',
                        glyphMarginClassName: 'execution-glyph',
                    },
                });
            }
        }

        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
    }, [breakpoints, currentStepIndex, trace]);

    return (
        <div className="code-editor">
            <div className="code-editor__header">
                <div className="code-editor__tabs">
                    <div className="code-editor__tab code-editor__tab--active">
                        <span className="code-editor__tab-icon">📄</span>
                        <span>main.{language === 'javascript' ? 'js' : 'py'}</span>
                    </div>
                </div>
            </div>
            <div className="code-editor__content">
                <Editor
                    height="100%"
                    language={language === 'javascript' ? 'javascript' : 'python'}
                    value={code}
                    onChange={(value) => setCode(value || '')}
                    onMount={handleEditorMount}
                    options={{
                        fontSize: 14,
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        lineNumbers: 'on',
                        glyphMargin: true,
                        folding: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        tabSize: 2,
                        renderLineHighlight: 'all',
                        cursorBlinking: 'smooth',
                        smoothScrolling: true,
                        padding: { top: 12 },
                    }}
                />
            </div>
        </div>
    );
}
