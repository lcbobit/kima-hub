import { useRef, useCallback } from "react";

const DOUBLE_TAP_MS = 300;

/**
 * Hook for components where the play callback is stable (not inside a .map loop).
 * Returns onTouchEnd + onDoubleClick to spread on the row div.
 */
export function useDoubleTap(callback: () => void) {
    const lastTap = useRef(0);

    const onTouchEnd = useCallback(() => {
        const now = Date.now();
        if (now - lastTap.current < DOUBLE_TAP_MS) {
            callback();
            lastTap.current = 0;
        } else {
            lastTap.current = now;
        }
    }, [callback]);

    return { onTouchEnd, onDoubleClick: callback };
}

/**
 * Hook for list components that render rows in a .map() loop.
 * Uses data-track-index on each row to identify which item was tapped.
 * Returns a single onTouchEnd handler to attach to every row.
 */
export function useDoubleTapList(onPlay: (index: number) => void) {
    const lastTap = useRef<{ time: number; index: number }>({ time: 0, index: -1 });

    const onTouchEnd = useCallback(
        (e: React.TouchEvent<HTMLDivElement>) => {
            const index = Number(e.currentTarget.dataset.trackIndex);
            if (isNaN(index)) return;
            const now = Date.now();
            if (now - lastTap.current.time < DOUBLE_TAP_MS && lastTap.current.index === index) {
                onPlay(index);
                lastTap.current = { time: 0, index: -1 };
            } else {
                lastTap.current = { time: now, index };
            }
        },
        [onPlay]
    );

    return onTouchEnd;
}
