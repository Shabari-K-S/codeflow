import type { MemorySnapshot } from '../../types';
import './MemoryPanel.css';
import { motion, AnimatePresence } from 'framer-motion';
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
                    <AnimatePresence mode="popLayout">
                        {stack.length === 0 ? (
                            <motion.div
                                className="empty-memory"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                            >
                                Empty Stack
                            </motion.div>
                        ) : (
                            stack.map((frame) => (
                                <motion.div
                                    key={frame.address}
                                    layout
                                    initial={{ opacity: 0, y: -20, scale: 0.9 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.2 } }}
                                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                    className="memory-item stack-item"
                                >
                                    <span className="memory-addr">0x{frame.address.toString(16)}</span>
                                    <span className="memory-name">{frame.name}</span>
                                    <span className="memory-type">{frame.type}</span>
                                    <span className="memory-value">{String(frame.value)}</span>
                                </motion.div>
                            ))
                        )}
                    </AnimatePresence>
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
