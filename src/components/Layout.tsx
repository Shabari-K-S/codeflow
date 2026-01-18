import { useState } from 'react';
import { Header } from './Header';
import { CodeEditor } from './Editor/CodeEditor';
import { FlowChart } from './FlowChart/FlowChart';
import { PlaybackControls } from './Controls/PlaybackControls';
import { VariableInspector } from './VariablePanel/VariableInspector';
import { SplitPane } from './SplitPane/SplitPane';
import { useWindowSize } from '../hooks/useWindowSize';
import './Layout.css';

export function Layout() {
    const { width } = useWindowSize();
    const isMobile = width < 768;
    const [activeTab, setActiveTab] = useState<'editor' | 'flow' | 'inspector'>('editor');

    if (isMobile) {
        return (
            <div className="layout mobile-layout">
                <Header />
                <main className="mobile-content">
                    <div className="mobile-tab-content" style={{ display: activeTab === 'editor' ? 'block' : 'none' }}>
                        <CodeEditor />
                    </div>
                    <div className="mobile-tab-content" style={{ display: activeTab === 'flow' ? 'block' : 'none' }}>
                        <FlowChart />
                    </div>
                    <div className="mobile-tab-content" style={{ display: activeTab === 'inspector' ? 'block' : 'none' }}>
                        <VariableInspector />
                    </div>
                </main>

                {/* Mobile Bottom Timeline */}
                <div className="mobile-timeline-container">
                    <PlaybackControls />
                </div>

                <nav className="mobile-nav">
                    <button
                        className={`mobile-nav-btn ${activeTab === 'editor' ? 'active' : ''}`}
                        onClick={() => setActiveTab('editor')}
                    >
                        <span className="mobile-nav-icon">📝</span>
                        <span>Code</span>
                    </button>
                    <button
                        className={`mobile-nav-btn ${activeTab === 'flow' ? 'active' : ''}`}
                        onClick={() => setActiveTab('flow')}
                    >
                        <span className="mobile-nav-icon">🔷</span>
                        <span>Flow</span>
                    </button>
                    <button
                        className={`mobile-nav-btn ${activeTab === 'inspector' ? 'active' : ''}`}
                        onClick={() => setActiveTab('inspector')}
                    >
                        <span className="mobile-nav-icon">📦</span>
                        <span>Inspector</span>
                    </button>
                </nav>
            </div>
        );
    }

    return (
        <div className="layout">
            <Header />

            <main className="layout__main">
                <SplitPane
                    direction="horizontal"
                    defaultSizes={[30, 45, 25]}
                    minSizes={[280, 350, 220]}
                    persistKey="main-horizontal"
                >
                    <div className="layout__panel">
                        <CodeEditor />
                    </div>
                    <div className="layout__panel">
                        <FlowChart />
                    </div>
                    <div className="layout__panel">
                        <VariableInspector />
                    </div>
                </SplitPane>
            </main>
        </div>
    );
}
