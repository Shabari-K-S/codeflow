import { Header } from './Header';
import { CodeEditor } from './Editor/CodeEditor';
import { FlowChart } from './FlowChart/FlowChart';
import { VariableInspector } from './VariablePanel/VariableInspector';
import { ExecutionControls } from './Controls/ExecutionControls';
import './Layout.css';

export function Layout() {
    return (
        <div className="layout">
            <Header />

            <main className="layout__main">
                <div className="layout__editor">
                    <CodeEditor />
                </div>

                <div className="layout__flowchart">
                    <FlowChart />
                </div>

                <div className="layout__inspector">
                    <VariableInspector />
                </div>
            </main>

            <ExecutionControls />
        </div>
    );
}
