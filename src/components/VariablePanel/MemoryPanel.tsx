import type { MemorySnapshot } from '../../types';
import './MemoryPanel.css';
import './MemoryPanel.css';

interface MemoryPanelProps {
    memory: MemorySnapshot;
}

export function MemoryPanel({ memory }: MemoryPanelProps) {
    const { heap, stack } = memory;

    return (
        <div className="memory-panel">
            <div className="memory-section">
                <h4 className="memory-header">Stack</h4>
                <div className="memory-list stack-list">
                    {stack.length === 0 ? (
                        <div className="empty-memory">Empty Stack</div>
                    ) : (
                        stack.map((frame, i) => (
                            <div key={i} className="memory-item stack-item">
                                <span className="memory-addr">0x{frame.address.toString(16)}</span>
                                <span className="memory-name">{frame.name}</span>
                                <span className="memory-type">{frame.type}</span>
                                <span className="memory-value">{String(frame.value)}</span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div className="memory-section">
                <h4 className="memory-header">Heap</h4>
                <div className="memory-list heap-list">
                    {heap.length === 0 ? (
                        <div className="empty-memory">Empty Heap</div>
                    ) : (
                        heap.map((block, i) => (
                            <div key={i} className={`memory-item heap-item ${block.isAllocated ? 'allocated' : 'freed'}`}>
                                <span className="memory-addr">0x{block.address.toString(16)}</span>
                                <span className="memory-size">Size: {block.size}</span>
                                <span className="memory-type">{block.type}</span>
                                <span className="memory-status">{block.isAllocated ? 'Alloc' : 'Free'}</span>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
