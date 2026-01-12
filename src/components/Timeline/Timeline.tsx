import { useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../stores/store';
import './Timeline.css';

export function Timeline() {
    const containerRef = useRef<HTMLDivElement>(null);
    const { trace, currentStepIndex, jumpToStep } = useStore();

    const steps = useMemo(() => {
        if (!trace) return [];
        return trace.steps.map((step, index) => ({
            index,
            lineNumber: step.lineNumber,
            code: step.code,
            isBreakpoint: step.isBreakpoint,
            functionName: step.callStack.length > 0
                ? step.callStack[step.callStack.length - 1].functionName
                : 'global',
            hasOutput: !!step.output,
            hasError: !!step.error,
        }));
    }, [trace]);

    // Auto-scroll to keep current step visible
    useEffect(() => {
        if (!containerRef.current || currentStepIndex < 0) return;

        const container = containerRef.current;
        const stepElements = container.querySelectorAll('.timeline__step');
        const currentElement = stepElements[currentStepIndex] as HTMLElement;

        if (currentElement) {
            const containerRect = container.getBoundingClientRect();
            const elementRect = currentElement.getBoundingClientRect();

            // Check if element is outside visible area
            if (elementRect.left < containerRect.left || elementRect.right > containerRect.right) {
                currentElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'center'
                });
            }
        }
    }, [currentStepIndex]);

    if (!trace || steps.length === 0) {
        return (
            <div className="timeline timeline--empty">
                <div className="timeline__placeholder">
                    <span className="timeline__placeholder-icon">⏱️</span>
                    <span>Run code to see execution timeline</span>
                </div>
            </div>
        );
    }

    return (
        <div className="timeline">
            <div className="timeline__header">
                <span className="timeline__icon">⏱️</span>
                <span className="timeline__title">Execution Timeline</span>
                <span className="timeline__count">{steps.length} steps</span>
            </div>

            <div className="timeline__track-container" ref={containerRef}>
                <div className="timeline__track">
                    {/* Connector line */}
                    <div className="timeline__connector">
                        <motion.div
                            className="timeline__connector-progress"
                            initial={{ width: 0 }}
                            animate={{
                                width: `${((currentStepIndex + 1) / steps.length) * 100}%`
                            }}
                            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        />
                    </div>

                    {/* Step markers */}
                    <AnimatePresence>
                        {steps.map((step, index) => {
                            const isCurrent = index === currentStepIndex;
                            const isPast = index < currentStepIndex;
                            const isFuture = index > currentStepIndex;

                            return (
                                <motion.div
                                    key={index}
                                    className={`timeline__step ${isCurrent ? 'timeline__step--current' : ''
                                        } ${isPast ? 'timeline__step--past' : ''} ${isFuture ? 'timeline__step--future' : ''
                                        } ${step.hasError ? 'timeline__step--error' : ''}`}
                                    initial={{ opacity: 0, scale: 0.5 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.5 }}
                                    transition={{ delay: index * 0.02 }}
                                    onClick={() => jumpToStep(index)}
                                    title={`Step ${index + 1}: Line ${step.lineNumber}\n${step.code}`}
                                >
                                    {/* Step marker */}
                                    <div className="timeline__marker">
                                        {step.hasError ? (
                                            <span className="timeline__marker-icon">⚠</span>
                                        ) : step.hasOutput ? (
                                            <span className="timeline__marker-icon">💬</span>
                                        ) : (
                                            <span className="timeline__marker-number">{step.lineNumber}</span>
                                        )}
                                    </div>

                                    {/* Pulse animation for current */}
                                    {isCurrent && (
                                        <motion.div
                                            className="timeline__pulse"
                                            initial={{ opacity: 0.8, scale: 1 }}
                                            animate={{ opacity: 0, scale: 1.5 }}
                                            transition={{
                                                duration: 1.2,
                                                repeat: Infinity,
                                                ease: 'easeIn'
                                            }}
                                        />
                                    )}

                                    {/* Function label */}
                                    {step.functionName !== 'global' && (
                                        <div className="timeline__function">
                                            {step.functionName}
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}
