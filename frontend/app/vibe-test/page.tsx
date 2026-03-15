"use client";

import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { MapTrack } from "@/features/vibe/types";

const VibeUniverse = dynamic(
    () => import("@/features/vibe/VibeUniverse").then(m => ({ default: m.VibeUniverse })),
    { ssr: false }
);

export default function VibeTestPage() {
    const { data: mapData, isLoading, error, refetch } = useQuery({
        queryKey: ["vibe-map"],
        queryFn: () => api.getVibeMap(),
        staleTime: 1000 * 60 * 60,
        gcTime: 1000 * 60 * 60 * 24,
        retry: 1,
    });

    const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
    const [highlightedIds] = useState<Set<string>>(new Set());

    const tracks = mapData?.tracks;
    const trackMap = useMemo(() => {
        if (!tracks) return new Map<string, MapTrack>();
        const map = new Map<string, MapTrack>();
        for (const track of tracks) {
            map.set(track.id, track);
        }
        return map;
    }, [tracks]);

    const selectedTrack = selectedTrackId ? trackMap.get(selectedTrackId) ?? null : null;

    const handleTrackClick = useCallback((trackId: string) => {
        setSelectedTrackId(trackId);
    }, []);

    const handleBackgroundClick = useCallback(() => {
        setSelectedTrackId(null);
    }, []);

    if (isLoading) {
        return (
            <div className="w-full h-full bg-black flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-6 h-6 text-[var(--color-ai)] animate-spin mx-auto mb-3 opacity-60" />
                    <p className="text-white/40 text-sm tracking-wide">Loading universe data</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full h-full bg-black flex items-center justify-center">
                <div className="text-center">
                    <p className="text-white/40 text-sm">Failed to load universe data</p>
                    <p className="text-white/20 text-xs mt-1">
                        {error instanceof Error ? error.message : "Unknown error"}
                    </p>
                    <button
                        onClick={() => refetch()}
                        className="mt-3 px-4 py-1.5 bg-white/10 hover:bg-white/15 rounded text-xs text-white/60 hover:text-white"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    if (!mapData || mapData.tracks.length === 0) {
        return (
            <div className="w-full h-full bg-black flex items-center justify-center">
                <div className="text-center">
                    <p className="text-white/40 text-sm">No tracks with vibe analysis yet</p>
                    <p className="text-white/20 text-xs mt-1">Run enrichment to generate embeddings</p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full relative overflow-hidden">
            <VibeUniverse
                tracks={mapData.tracks}
                highlightedIds={highlightedIds}
                selectedTrackId={selectedTrackId}
                onTrackClick={handleTrackClick}
                onBackgroundClick={handleBackgroundClick}
            />

            {selectedTrack && (
                <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 bg-black/70 backdrop-blur-md border border-white/10 rounded-lg px-4 py-2 text-center">
                    <div className="text-white text-sm font-medium truncate max-w-64">
                        {selectedTrack.title}
                    </div>
                    <div className="text-white/50 text-xs truncate max-w-64">
                        {selectedTrack.artist}
                    </div>
                </div>
            )}
        </div>
    );
}
