import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import './LandingNavbar.css';

export function LandingNavbar() {
    const navigate = useNavigate();
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            const isScrolled = window.scrollY > 20;
            if (isScrolled !== scrolled) {
                setScrolled(isScrolled);
            }
        };

        window.addEventListener('scroll', handleScroll);
        return () => {
            window.removeEventListener('scroll', handleScroll);
        };
    }, [scrolled]);

    return (
        <motion.nav
            className={`landing-navbar ${scrolled ? 'scrolled' : ''}`}
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
            <div className="navbar-container">
                <div className="navbar-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                    <motion.div
                        className="navbar-logo"
                        whileHover={{ rotate: 360 }}
                        transition={{ duration: 0.6 }}
                    >
                        🌊
                    </motion.div>
                    <span className="navbar-title">
                        Code<span className="navbar-title-accent">Flow</span>
                    </span>
                </div>

                <div className="navbar-links">
                    <a
                        href="#features"
                        className="navbar-link"
                        onClick={(e) => {
                            e.preventDefault();
                            document.querySelector('#features')?.scrollIntoView({ behavior: 'smooth' });
                        }}
                    >
                        Features
                    </a>
                    <a href="https://github.com/Shabari-K-S/codeflow" target="_blank" rel="noopener noreferrer" className="navbar-link">GitHub</a>
                </div>

                <div className="navbar-actions">
                    <motion.button
                        className="navbar-cta"
                        onClick={() => navigate('/app')}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        Launch App
                    </motion.button>
                </div>
            </div>
        </motion.nav>
    );
}
