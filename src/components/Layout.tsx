import { Header } from './Header';
import { CodeEditor } from './Editor/CodeEditor';
import { FlowChart } from './FlowChart/FlowChart';
import { VariableInspector } from './VariablePanel/VariableInspector';
import { SplitPane } from './SplitPane/SplitPane';
import './Layout.css';

export function Layout() {
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
