import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import './LandingPage.css';

export function LandingPage() {
    const navigate = useNavigate();

    return (
        <div className="landing-page">
            <div className="landing-content">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    className="hero-section"
                >
                    <motion.div
                        className="logo-container"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                    >
                        <span className="hero-icon">🌊</span>
                    </motion.div>

                    <h1 className="hero-title">
                        Code<span className="hero-accent">Flow</span>
                    </h1>

                    <p className="hero-subtitle">
                        Visualize your code execution flow in real-time.
                        <br />
                        Understand complex logic with interactive diagrams.
                    </p>

                    <motion.button
                        className="cta-button"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => navigate('/app')}
                    >
                        Get Started
                        <span className="arrow">→</span>
                    </motion.button>
                </motion.div>
            </div>

            <div className="features-section">
                <div className="features-container">
                    <FeatureRow
                        title="Multi-Language Editor"
                        description="Start by writing in your favorite language. Whether it's JavaScript, TypeScript, or Python, our Monaco-powered editor provides intelligent syntax highlighting and a seamless coding experience."
                        image="/assets/editor-preview.png"
                        align="left"
                    />
                    <FeatureRow
                        title="Dynamic Visualization"
                        description="Watch your code transform instantly. CodeFlow analyzes your logic and generates beautiful, interactive SVG flowcharts that map out control flow, loops, and decision points."
                        image="/assets/flowchart-preview.png"
                        align="right"
                    />
                    <FeatureRow
                        title="Real-Time Execution"
                        description="Don't just read code—watch it run. Follow the instruction pointer line-by-line as it executes, helping you visualize the exact path your logic takes."
                        image="/assets/execution-preview.png"
                        align="left"
                    />
                    <FeatureRow
                        title="Deep State Inspection"
                        description="Understand what's happening under the hood. Monitor variables, arrays, and objects in real-time as they mutate, giving you complete clarity on your program's state."
                        image="/assets/inspector-preview.png"
                        align="right"
                    />
                </div>
            </div>

            <footer className="landing-footer">
                <div className="footer-content">
                    <h2 className="footer-brand">CodeFlow</h2>
                    <div className="footer-bottom">
                        <div className="footer-links">
                            <span className="footer-link-group">
                                <a href="#">About CodeFlow</a>
                                <a href="#">Features</a>
                                <a href="#">Privacy</a>
                                <a href="#">Terms</a>
                            </span>
                        </div>
                        <div className="footer-signature">
                            Created by <a href="https://github.com/Shabari-K-S" target="_blank" rel="noopener noreferrer">Shabari K S</a>
                        </div>
                    </div>
                </div>
            </footer>

            <div className="landing-background">
                <div className="gradient-sphere sphere-1"></div>
                <div className="gradient-sphere sphere-2"></div>
            </div>
        </div>
    );
}

function FeatureRow({ title, description, image, align }: { title: string, description: string, image: string, align: 'left' | 'right' }) {
    return (
        <motion.div
            className={`feature-row ${align === 'right' ? 'feature-row-reverse' : ''}`}
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            viewport={{ once: true, margin: "-100px" }}
        >
            <div className="feature-text">
                <h3>{title}</h3>
                <p>{description}</p>
            </div>
            <div className="feature-visual">
                <div className="visual-frame">
                    <img src={image} alt={title} />
                    <div className="visual-glow"></div>
                </div>
            </div>
        </motion.div>
    );
}
