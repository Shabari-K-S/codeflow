import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../stores/store';
import type { VariableValue } from '../../types';
import './VariableInspector.css';

function formatValue(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'function') return '[Function]';
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        if (value.length <= 5) {
            return `[${value.map(v => formatValue(v)).join(', ')}]`;
        }
        return `[${value.slice(0, 3).map(v => formatValue(v)).join(', ')}, ... +${value.length - 3}]`;
    }
    if (typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 0) return '{}';
        if (keys.length <= 3) {
            return `{${keys.map(k => `${k}: ${formatValue((value as Record<string, unknown>)[k])}`).join(', ')}}`;
        }
        return `{${keys.slice(0, 2).map(k => `${k}: ${formatValue((value as Record<string, unknown>)[k])}`).join(', ')}, ...}`;
    }
    return String(value);
}

function getTypeColor(type: string): string {
    switch (type) {
        case 'number': return 'var(--color-accent-cyan)';
        case 'string': return 'var(--color-accent-green)';
        case 'boolean': return 'var(--color-accent-orange)';
        case 'undefined': return 'var(--color-text-muted)';
        case 'null': return 'var(--color-text-muted)';
        case 'array': return 'var(--color-accent-purple)';
        case 'object': return 'var(--color-accent-yellow)';
        case 'function': return 'var(--color-accent-pink)';
        default: return 'var(--color-text-secondary)';
    }
}

function VariableItem({ variable, isNew }: { variable: VariableValue; isNew: boolean }) {
    return (
        <motion.div
            className={`variable-item ${isNew ? 'variable-item--new' : ''}`}
            initial={isNew ? { opacity: 0, x: -20, backgroundColor: 'rgba(88, 166, 255, 0.3)' } : false}
            animate={{ opacity: 1, x: 0, backgroundColor: 'transparent' }}
            transition={{ duration: 0.3 }}
            layout
        >
            <div className="variable-item__header">
                <span className="variable-item__name">{variable.name}</span>
                <span
                    className="variable-item__type"
                    style={{ color: getTypeColor(variable.type) }}
                >
                    {variable.type}
                </span>
            </div>
            <div className="variable-item__value">
                <code>{formatValue(variable.value)}</code>
            </div>
        </motion.div>
    );
}

export function VariableInspector() {
    const { trace, currentStepIndex } = useStore();

    const { variables, callStack, output } = useMemo(() => {
        if (!trace || currentStepIndex < 0 || currentStepIndex >= trace.steps.length) {
            return { variables: [], callStack: [], output: [] };
        }

        const step = trace.steps[currentStepIndex];
        const prevStep = currentStepIndex > 0 ? trace.steps[currentStepIndex - 1] : null;

        // Mark new/changed variables
        const prevVarMap = new Map(prevStep?.variables.map(v => [v.name, v.value]) || []);
        const varsWithChange = step.variables.map(v => ({
            ...v,
            changed: !prevVarMap.has(v.name) || prevVarMap.get(v.name) !== v.value,
        }));

        return {
            variables: varsWithChange.filter(v => v.name !== 'console'),
            callStack: step.callStack,
            output: trace.output.slice(0, currentStepIndex + 1),
        };
    }, [trace, currentStepIndex]);

    return (
        <div className="variable-inspector">
            {/* Variables Section */}
            <div className="inspector-section">
                <div className="inspector-section__header">
                    <span className="inspector-section__icon">📦</span>
                    <h3>Variables</h3>
                    <span className="inspector-section__count">{variables.length}</span>
                </div>
                <div className="inspector-section__content">
                    {variables.length === 0 ? (
                        <div className="inspector-empty">
                            <span className="inspector-empty__icon">🔍</span>
                            <p>No variables yet</p>
                        </div>
                    ) : (
                        <AnimatePresence mode="popLayout">
                            {variables.map(variable => (
                                <VariableItem
                                    key={variable.name}
                                    variable={variable}
                                    isNew={variable.changed || false}
                                />
                            ))}
                        </AnimatePresence>
                    )}
                </div>
            </div>

            {/* Call Stack Section */}
            <div className="inspector-section">
                <div className="inspector-section__header">
                    <span className="inspector-section__icon">📚</span>
                    <h3>Call Stack</h3>
                    <span className="inspector-section__count">{callStack.length}</span>
                </div>
                <div className="inspector-section__content">
                    {callStack.length === 0 ? (
                        <div className="inspector-empty">
                            <span className="inspector-empty__icon">🏠</span>
                            <p>Global scope</p>
                        </div>
                    ) : (
                        <div className="call-stack">
                            {callStack.map((frame, index) => (
                                <motion.div
                                    key={frame.id}
                                    className={`call-stack__frame ${index === callStack.length - 1 ? 'call-stack__frame--active' : ''}`}
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 10 }}
                                >
                                    <span className="call-stack__index">{callStack.length - index}</span>
                                    <span className="call-stack__name">{frame.functionName}()</span>
                                    <span className="call-stack__line">:{frame.lineNumber}</span>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Console Output Section */}
            <div className="inspector-section inspector-section--output">
                <div className="inspector-section__header">
                    <span className="inspector-section__icon">💬</span>
                    <h3>Console</h3>
                    <span className="inspector-section__count">{output.length}</span>
                </div>
                <div className="inspector-section__content inspector-section__console">
                    {output.length === 0 ? (
                        <div className="inspector-empty">
                            <span className="inspector-empty__icon">📝</span>
                            <p>No output yet</p>
                        </div>
                    ) : (
                        output.map((line, index) => (
                            <div key={index} className="console-line">
                                <span className="console-line__prefix">&gt;</span>
                                <span className="console-line__text">{line}</span>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
