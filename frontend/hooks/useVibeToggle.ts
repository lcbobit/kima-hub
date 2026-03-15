"use client";

import { useState, useCallback } from "react";
import { useAudioState } from "@/lib/audio-state-context";
import { useAudioControls } from "@/lib/audio-controls-context";
import { useToast } from "@/lib/toast-context";

export function useVibeToggle() {
    const { currentTrack, activeOperation } = useAudioState();
    const { startVibeMode, stopVibeMode } = useAudioControls();
    const { toast } = useToast();
    const [isVibeLoading, setIsVibeLoading] = useState(false);

    const handleVibeToggle = useCallback(async () => {
        if (!currentTrack?.id) return;

        if (activeOperation.type !== "idle") {
            stopVibeMode();
            toast.success("Vibe mode off");
            return;
        }

        setIsVibeLoading(true);
        try {
            const result = await startVibeMode();

            if (result.success && result.trackCount > 0) {
                toast.success(
                    `Vibe mode on -- ${result.trackCount} similar tracks queued`,
                );
            } else {
                toast.error("Couldn't find matching tracks in your library");
            }
        } catch (error) {
            console.error("Failed to start vibe match:", error);
            toast.error("Failed to match vibe");
        } finally {
            setIsVibeLoading(false);
        }
    }, [currentTrack?.id, activeOperation.type, startVibeMode, stopVibeMode, toast]);

    return { handleVibeToggle, isVibeLoading };
}
