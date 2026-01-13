import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import './SplitPane.css';

interface SplitPaneProps {
    direction: 'horizontal' | 'vertical';
    children: ReactNode[];
    defaultSizes?: number[];
    minSizes?: number[];
    maxSizes?: number[];
    persistKey?: string;
    onResize?: (sizes: number[]) => void;
}

export function SplitPane({
    direction,
    children,
    defaultSizes,
    minSizes,
    maxSizes,
    persistKey,
    onResize,
}: SplitPaneProps) {
    const childCount = children.length;
    const containerRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{
        index: number;
        startPos: number;
        startSizes: number[];
    } | null>(null);

    // Initialize sizes from localStorage or defaults
    const getInitialSizes = useCallback(() => {
        if (persistKey) {
            const stored = localStorage.getItem(`splitpane-${persistKey}`);
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    if (Array.isArray(parsed) && parsed.length === childCount) {
                        return parsed;
                    }
                } catch {
                    // Ignore parse errors
                }
            }
        }
        if (defaultSizes && defaultSizes.length === childCount) {
            return defaultSizes;
        }
        // Equal distribution
        return Array(childCount).fill(100 / childCount);
    }, [childCount, defaultSizes, persistKey]);

    const [sizes, setSizes] = useState<number[]>(getInitialSizes);

    // Persist sizes to localStorage
    useEffect(() => {
        if (persistKey) {
            localStorage.setItem(`splitpane-${persistKey}`, JSON.stringify(sizes));
        }
    }, [sizes, persistKey]);

    // Convert percentage to pixels
    const getContainerSize = useCallback(() => {
        if (!containerRef.current) return 0;
        return direction === 'horizontal'
            ? containerRef.current.offsetWidth
            : containerRef.current.offsetHeight;
    }, [direction]);

    // Apply constraints
    const applyConstraints = useCallback(
        (newSizes: number[]) => {
            const containerSize = getContainerSize();
            if (!containerSize) return newSizes;

            const result = [...newSizes];

            for (let i = 0; i < result.length; i++) {
                const pxSize = (result[i] / 100) * containerSize;
                const minPx = minSizes?.[i] ?? 50;
                const maxPx = maxSizes?.[i] ?? containerSize;

                if (pxSize < minPx) {
                    result[i] = (minPx / containerSize) * 100;
                } else if (pxSize > maxPx) {
                    result[i] = (maxPx / containerSize) * 100;
                }
            }

            // Normalize to 100%
            const total = result.reduce((a, b) => a + b, 0);
            return result.map((s) => (s / total) * 100);
        },
        [getContainerSize, minSizes, maxSizes]
    );

    // Handle mouse down on divider
    const handleMouseDown = useCallback(
        (index: number, e: React.MouseEvent) => {
            e.preventDefault();
            dragRef.current = {
                index,
                startPos: direction === 'horizontal' ? e.clientX : e.clientY,
                startSizes: [...sizes],
            };

            document.body.style.cursor =
                direction === 'horizontal' ? 'col-resize' : 'row-resize';
            document.body.style.userSelect = 'none';
        },
        [direction, sizes]
    );

    // Handle mouse move
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!dragRef.current || !containerRef.current) return;

            const { index, startPos, startSizes } = dragRef.current;
            const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
            const delta = currentPos - startPos;
            const containerSize = getContainerSize();

            if (!containerSize) return;

            const deltaPercent = (delta / containerSize) * 100;

            const newSizes = [...startSizes];
            newSizes[index] = Math.max(0, startSizes[index] + deltaPercent);
            newSizes[index + 1] = Math.max(0, startSizes[index + 1] - deltaPercent);

            const constrainedSizes = applyConstraints(newSizes);
            setSizes(constrainedSizes);
            onResize?.(constrainedSizes);
        };

        const handleMouseUp = () => {
            if (dragRef.current) {
                dragRef.current = null;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [direction, getContainerSize, applyConstraints, onResize]);

    // Handle double-click to reset
    const handleDoubleClick = useCallback(
        () => {
            const resetSizes = getInitialSizes();
            setSizes(resetSizes);
            onResize?.(resetSizes);
        },
        [getInitialSizes, onResize]
    );

    // Handle keyboard navigation
    const handleKeyDown = useCallback(
        (index: number, e: React.KeyboardEvent) => {
            const step = 2; // Percentage step
            let delta = 0;

            if (direction === 'horizontal') {
                if (e.key === 'ArrowLeft') delta = -step;
                else if (e.key === 'ArrowRight') delta = step;
            } else {
                if (e.key === 'ArrowUp') delta = -step;
                else if (e.key === 'ArrowDown') delta = step;
            }

            if (delta !== 0) {
                e.preventDefault();
                const newSizes = [...sizes];
                newSizes[index] = Math.max(0, sizes[index] + delta);
                newSizes[index + 1] = Math.max(0, sizes[index + 1] - delta);

                const constrainedSizes = applyConstraints(newSizes);
                setSizes(constrainedSizes);
                onResize?.(constrainedSizes);
            }
        },
        [direction, sizes, applyConstraints, onResize]
    );

    return (
        <div
            ref={containerRef}
            className={`split-pane split-pane--${direction}`}
        >
            {children.map((child, i) => (
                <div key={i} className="split-pane__wrapper">
                    <div
                        className="split-pane__pane"
                        style={{
                            [direction === 'horizontal' ? 'width' : 'height']:
                                `calc(${sizes[i]}% - ${((childCount - 1) * 4) / childCount}px)`,
                        }}
                    >
                        {child}
                    </div>
                    {i < childCount - 1 && (
                        <div
                            className={`split-pane__divider split-pane__divider--${direction}`}
                            onMouseDown={(e) => handleMouseDown(i, e)}
                            onDoubleClick={handleDoubleClick}
                            onKeyDown={(e) => handleKeyDown(i, e)}
                            tabIndex={0}
                            role="separator"
                            aria-orientation={direction}
                            aria-valuenow={sizes[i]}
                            aria-label={`Resize panel ${i + 1}`}
                        >
                            <div className="split-pane__divider-line" />
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
