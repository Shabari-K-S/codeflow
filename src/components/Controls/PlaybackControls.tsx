import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../../stores/store';
import './PlaybackControls.css';

// Icons as inline SVGs
const PlayIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
        <path d="M8 5v14l11-7z" />
    </svg>
);

const PauseIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
);

const StepBackIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
        <path d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z" />
    </svg>
);

const StepForwardIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
        <path d="M6 18l8.5-6L6 6v12zm2 0V6l6.5 6L8 18zm8-12h2v12h-2V6z" />
    </svg>
);

const ResetIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
        <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
    </svg>
);

export function PlaybackControls() {
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
    } = useStore();

    const totalSteps = trace?.totalSteps || 0;
    const hasTrace = trace !== null && totalSteps > 0;
    const isPlaying = playbackState === 'playing';
    const isFinished = playbackState === 'finished';

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

    if (!hasTrace) {
        return null;
    }

    return (
        <div className="playback-controls">
            {/* Step Counter */}
            <div className="playback-controls__counter">
                <span className="playback-controls__step">{currentStepIndex + 1}</span>
                <span className="playback-controls__separator">/</span>
                <span className="playback-controls__total">{totalSteps}</span>
            </div>

            {/* Control Buttons */}
            <div className="playback-controls__buttons">
                <motion.button
                    className="playback-btn"
                    onClick={reset}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    title="Reset"
                >
                    <ResetIcon />
                </motion.button>

                <motion.button
                    className="playback-btn"
                    onClick={stepBackward}
                    disabled={currentStepIndex <= 0}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    title="Step Back"
                >
                    <StepBackIcon />
                </motion.button>

                <motion.button
                    className="playback-btn playback-btn--primary"
                    onClick={handlePlayPause}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    title={isPlaying ? 'Pause' : 'Play'}
                >
                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                </motion.button>

                <motion.button
                    className="playback-btn"
                    onClick={stepForward}
                    disabled={currentStepIndex >= totalSteps - 1}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    title="Step Forward"
                >
                    <StepForwardIcon />
                </motion.button>
            </div>

            {/* Speed Selector */}
            <div className="playback-controls__speed">
                <select
                    value={speed}
                    onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    className="speed-select"
                    title="Playback Speed"
                >
                    <option value="0.25">0.25x</option>
                    <option value="0.5">0.5x</option>
                    <option value="1">1x</option>
                    <option value="2">2x</option>
                    <option value="4">4x</option>
                </select>
            </div>
        </div>
    );
}
