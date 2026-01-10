import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../../stores/store';
import './ExecutionControls.css';

// Icons as inline SVGs for better control
const PlayIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
        <path d="M8 5v14l11-7z" />
    </svg>
);

const PauseIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
);

const StepBackIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
        <path d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z" />
    </svg>
);

const StepForwardIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
        <path d="M6 18l8.5-6L6 6v12zm2 0V6l6.5 6L8 18zm8-12h2v12h-2V6z" />
    </svg>
);

const ResetIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
        <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
    </svg>
);

export function ExecutionControls() {
    const intervalRef = useRef<number | null>(null);

    const {
        trace,
        currentStepIndex,
        playbackState,
        speed,
        play,
        pause,
        stepForward,
        stepBackward,
        reset,
        setSpeed,
        jumpToStep,
    } = useStore();

    const totalSteps = trace?.totalSteps || 0;
    const hasTrace = trace !== null && totalSteps > 0;
    const isPlaying = playbackState === 'playing';
    const isFinished = playbackState === 'finished';
    const progress = totalSteps > 0 ? ((currentStepIndex + 1) / totalSteps) * 100 : 0;

    // Handle auto-play
    useEffect(() => {
        if (isPlaying && hasTrace) {
            const intervalTime = 1000 / speed;
            intervalRef.current = window.setInterval(() => {
                const state = useStore.getState();
                if (state.currentStepIndex >= (state.trace?.totalSteps || 0) - 1) {
                    state.pause();
                } else {
                    state.stepForward();
                }
            }, intervalTime);

            return () => {
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                }
            };
        }
    }, [isPlaying, speed, hasTrace]);

    const handlePlayPause = () => {
        if (isPlaying) {
            pause();
        } else if (isFinished) {
            reset();
            play();
        } else {
            play();
        }
    };

    const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!hasTrace) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = x / rect.width;
        const step = Math.floor(percent * totalSteps);
        jumpToStep(step);
    };

    return (
        <div className="execution-controls">
            <div className="execution-controls__main">
                {/* Step Counter */}
                <div className="execution-controls__counter">
                    <span className="execution-controls__step">
                        {hasTrace ? currentStepIndex + 1 : 0}
                    </span>
                    <span className="execution-controls__separator">/</span>
                    <span className="execution-controls__total">{totalSteps}</span>
                </div>

                {/* Control Buttons */}
                <div className="execution-controls__buttons">
                    <motion.button
                        className="control-btn"
                        onClick={reset}
                        disabled={!hasTrace}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        title="Reset"
                    >
                        <ResetIcon />
                    </motion.button>

                    <motion.button
                        className="control-btn"
                        onClick={stepBackward}
                        disabled={!hasTrace || currentStepIndex <= 0}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        title="Step Back"
                    >
                        <StepBackIcon />
                    </motion.button>

                    <motion.button
                        className="control-btn control-btn--primary"
                        onClick={handlePlayPause}
                        disabled={!hasTrace}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        title={isPlaying ? 'Pause' : 'Play'}
                    >
                        {isPlaying ? <PauseIcon /> : <PlayIcon />}
                    </motion.button>

                    <motion.button
                        className="control-btn"
                        onClick={stepForward}
                        disabled={!hasTrace || currentStepIndex >= totalSteps - 1}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        title="Step Forward"
                    >
                        <StepForwardIcon />
                    </motion.button>
                </div>

                {/* Progress Bar */}
                <div
                    className="execution-controls__progress"
                    onClick={handleProgressClick}
                    title={`Step ${currentStepIndex + 1} of ${totalSteps}`}
                >
                    <div className="progress-bar">
                        <motion.div
                            className="progress-bar__fill"
                            initial={false}
                            animate={{ width: `${progress}%` }}
                            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        />
                        <motion.div
                            className="progress-bar__handle"
                            initial={false}
                            animate={{ left: `${progress}%` }}
                            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        />
                    </div>
                </div>

                {/* Speed Control */}
                <div className="execution-controls__speed">
                    <span className="speed-label">{speed}x</span>
                    <input
                        type="range"
                        min="0.25"
                        max="4"
                        step="0.25"
                        value={speed}
                        onChange={(e) => setSpeed(parseFloat(e.target.value))}
                        className="speed-slider"
                        title={`Speed: ${speed}x`}
                    />
                </div>
            </div>

            {/* Status indicator */}
            {trace?.hasError && (
                <div className="execution-controls__error">
                    <span className="error-icon">⚠️</span>
                    <span className="error-text">{trace.errorMessage}</span>
                </div>
            )}
        </div>
    );
}
