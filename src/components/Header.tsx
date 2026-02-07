import { useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../stores/store';
import { PlaybackControls } from './Controls/PlaybackControls';
import './Header.css';

export function Header() {
    const { language, setLanguage, visualize, execute, flowGraph, trace } = useStore();
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    const handleVisualize = () => {
        visualize();
        execute();
    };

    return (
        <header className="header">
            <div className="header__brand">
                <motion.div
                    className="header__logo"
                    whileHover={{ rotate: 360 }}
                    transition={{ duration: 0.5 }}
                >
                    🌊
                </motion.div>
                <h1 className="header__title">
                    Code<span className="header__title-accent">Flow</span>
                </h1>
                <span className="header__version">v1.0</span>
            </div>

            <div className="header__actions">
                {/* Language Selector */}
                {/* Language Selector */}
                <div className="language-selector">
                    <button
                        className="language-dropdown-trigger"
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
                    >
                        <span className="language-icon">
                            {language === 'javascript' ? '🟨' : language === 'python' ? '🐍' : '🔵'}
                        </span>
                        <span className="language-name">
                            {language === 'javascript' ? 'JavaScript' : language === 'python' ? 'Python' : 'C'}
                        </span>
                        <span className={`dropdown-arrow ${isDropdownOpen ? 'open' : ''}`}>
                            ▼
                        </span>
                    </button>

                    {isDropdownOpen && (
                        <div className="language-dropdown-menu">
                            <button
                                className={`language-option ${language === 'javascript' ? 'active' : ''}`}
                                onClick={() => {
                                    setLanguage('javascript');
                                    setIsDropdownOpen(false);
                                }}
                            >
                                <span className="language-icon">🟨</span>
                                <span>JavaScript</span>
                            </button>
                            <button
                                className={`language-option ${language === 'python' ? 'active' : ''}`}
                                onClick={() => {
                                    setLanguage('python');
                                    setIsDropdownOpen(false);
                                }}
                            >
                                <span className="language-icon">🐍</span>
                                <span>Python</span>
                            </button>
                            <button
                                className={`language-option ${language === 'c' ? 'active' : ''}`}
                                onClick={() => {
                                    setLanguage('c');
                                    setIsDropdownOpen(false);
                                }}
                            >
                                <span className="language-icon">🔵</span>
                                <span>C</span>
                            </button>
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="header__buttons">
                    <motion.button
                        className="action-btn action-btn--visualize"
                        onClick={handleVisualize}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                    >
                        <span className="action-btn__icon">📊</span>
                        <span>Visualize</span>
                    </motion.button>

                    <motion.button
                        className="action-btn action-btn--run"
                        onClick={execute}
                        disabled={!flowGraph}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                    >
                        <span className="action-btn__icon">▶️</span>
                        <span>Run</span>
                    </motion.button>
                </div>

                {/* Playback Controls */}
                <PlaybackControls />
            </div>

            {/* Status Indicators */}
            <div className="header__status">
                {flowGraph && (
                    <span className="status-badge status-badge--success">
                        ✓ Parsed
                    </span>
                )}
                {trace && !trace.hasError && (
                    <span className="status-badge status-badge--info">
                        {trace.totalSteps} steps
                    </span>
                )}
                {trace?.hasError && (
                    <span className="status-badge status-badge--error">
                        Error
                    </span>
                )}
            </div>

            <a
                href="https://github.com/Shabari-K-S/codeflow"
                target="_blank"
                rel="noopener noreferrer"
                className="github-btn"
                title="View on GitHub"
            >
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
                </svg>
            </a>
        </header>
    );
}
