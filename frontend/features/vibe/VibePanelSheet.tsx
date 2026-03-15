"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, useDragControls, type PanInfo } from "framer-motion";
import { ActivityIconBar, type ActivityType } from "./ActivityIconBar";
import {
    type VibeTab,
    ActivityContent,
    ActivityHeader,
    TabBar,
    TabContent,
} from "./panel-shared";
import { useMediaQuery } from "@/hooks/useMediaQuery";

type SnapPoint = "peek" | "half" | "full";

const PEEK_HEIGHT = 80;

export function VibePanelSheet() {
    const [snap, setSnap] = useState<SnapPoint>("peek");
    const [activeTab, setActiveTab] = useState<VibeTab>("now-playing");
    const [expandedActivity, setExpandedActivity] = useState<ActivityType | null>(null);
    const [sheetHeight, setSheetHeight] = useState(600);
    const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
    const dragControls = useDragControls();

    useEffect(() => {
        const update = () => setSheetHeight(window.innerHeight * 0.9);
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);

    const snapY = useMemo(() => ({
        peek: sheetHeight - PEEK_HEIGHT,
        half: sheetHeight * 0.5,
        full: 0,
    }), [sheetHeight]);

    const handleDragEnd = useCallback((_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const currentY = snapY[snap] + info.offset.y;
        const vy = info.velocity.y;

        if (vy > 500) {
            setSnap(snap === "full" ? "half" : "peek");
        } else if (vy < -500) {
            setSnap(snap === "peek" ? "half" : "full");
        } else {
            const entries = Object.entries(snapY) as [SnapPoint, number][];
            entries.sort((a, b) => Math.abs(a[1] - currentY) - Math.abs(b[1] - currentY));
            setSnap(entries[0][0]);
        }
    }, [snap, snapY]);

    const handleToggleActivity = (type: ActivityType) => {
        setExpandedActivity((prev) => (prev === type ? null : type));
        if (snap === "peek") setSnap("half");
    };

    const handleTabClick = (tab: VibeTab) => {
        setActiveTab(tab);
        setExpandedActivity(null);
        if (snap === "peek") setSnap("half");
    };

    return (
        <motion.div
            className="fixed bottom-0 left-0 right-0 z-30 bg-[#0a0a0a] rounded-t-2xl border-t border-white/10 flex flex-col"
            style={{ height: sheetHeight }}
            animate={{ y: snapY[snap] }}
            transition={prefersReducedMotion
                ? { duration: 0 }
                : { type: "spring", damping: 30, stiffness: 300 }
            }
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: snapY.peek }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
        >
            {/* Drag handle */}
            <div
                className="flex justify-center py-3 cursor-grab active:cursor-grabbing touch-none shrink-0"
                onPointerDown={(e) => dragControls.start(e)}
            >
                <div className="w-10 h-1 bg-white/20 rounded-full" />
            </div>

            {/* Activity icon bar */}
            <div className="shrink-0">
                <ActivityIconBar
                    expandedActivity={expandedActivity}
                    onToggleActivity={handleToggleActivity}
                />
            </div>

            {expandedActivity ? (
                <>
                    <ActivityHeader
                        type={expandedActivity}
                        onClose={() => setExpandedActivity(null)}
                    />
                    <div className="flex-1 overflow-y-auto overscroll-contain">
                        <ActivityContent type={expandedActivity} />
                    </div>
                </>
            ) : (
                <>
                    <TabBar activeTab={activeTab} onTabClick={handleTabClick} />
                    <TabContent activeTab={activeTab} />
                </>
            )}
        </motion.div>
    );
}
