"use client";

import { useMemo } from "react";
import { useAudioState, AudioFeatures } from "@/lib/audio-state-context";
import { useAudioPlayback } from "@/lib/audio-playback-context";
import { cn } from "@/utils/cn";
import { Music } from "lucide-react";
import { motion } from "framer-motion";
import Image from "next/image";
import { api } from "@/lib/api";
import { computeVibeMatchScore } from "@/utils/vibeMatchScore";
import {
    ResponsiveContainer,
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    Radar,
} from "recharts";

const RADAR_FEATURES = [
    { key: "energy", label: "Energy", min: 0, max: 1 },
    { key: "valence", label: "Mood", min: 0, max: 1 },
    { key: "arousal", label: "Arousal", min: 0, max: 1 },
    { key: "danceability", label: "Dance", min: 0, max: 1 },
    { key: "bpm", label: "Tempo", min: 60, max: 200 },
    { key: "moodHappy", label: "Happy", min: 0, max: 1 },
    { key: "moodSad", label: "Sad", min: 0, max: 1 },
    { key: "moodRelaxed", label: "Relaxed", min: 0, max: 1 },
    { key: "moodAggressive", label: "Aggressive", min: 0, max: 1 },
    { key: "moodParty", label: "Party", min: 0, max: 1 },
    { key: "moodAcoustic", label: "Acoustic", min: 0, max: 1 },
    { key: "moodElectronic", label: "Electronic", min: 0, max: 1 },
];

const ML_MOODS = [
    { key: "moodHappy", label: "Happy", color: "#ecb200" },
    { key: "moodSad", label: "Sad", color: "#5c8dd6" },
    { key: "moodRelaxed", label: "Relaxed", color: "#1db954" },
    { key: "moodAggressive", label: "Aggressive", color: "#e35656" },
    { key: "moodParty", label: "Party", color: "#e056a0" },
    { key: "moodAcoustic", label: "Acoustic", color: "#d4a656" },
    { key: "moodElectronic", label: "Electronic", color: "#a056e0" },
];

function normalizeValue(value: number | null | undefined, min: number, max: number): number {
    if (value == null) return 0;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function getFeatureValue(features: AudioFeatures | null | undefined, key: string): number | null {
    if (!features) return null;
    const value = (features as Record<string, unknown>)[key];
    if (typeof value === "number") return value;
    return null;
}

export function NowPlayingTab() {
    const { currentTrack, activeOperation } = useAudioState();
    const { isPlaying } = useAudioPlayback();

    const currentFeatures = currentTrack?.audioFeatures as AudioFeatures | null | undefined;

    const sourceFeatures = useMemo(() => {
        if (activeOperation.type !== "idle" && "sourceFeatures" in activeOperation) {
            return activeOperation.sourceFeatures as AudioFeatures;
        }
        return null;
    }, [activeOperation]);

    const displayFeatures = currentFeatures || sourceFeatures;
    const hasOperation = activeOperation.type !== "idle";

    const radarData = useMemo(() => {
        return RADAR_FEATURES.map((feature) => {
            const sourceVal = getFeatureValue(
                sourceFeatures,
                feature.key,
            );
            const currentVal = getFeatureValue(
                displayFeatures,
                feature.key,
            );
            return {
                feature: feature.label,
                source: normalizeValue(sourceVal, feature.min, feature.max) * 100,
                current: normalizeValue(currentVal, feature.min, feature.max) * 100,
                fullMark: 100,
            };
        });
    }, [sourceFeatures, displayFeatures]);

    const matchScore = useMemo(
        () => computeVibeMatchScore(sourceFeatures, currentFeatures),
        [sourceFeatures, currentFeatures],
    );

    const coverUrl = currentTrack?.album?.coverArt
        ? api.getCoverArtUrl(currentTrack.album.coverArt, 300)
        : null;

    if (!currentTrack) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
                <Music className="w-10 h-10 text-white/15 mb-4" />
                <p className="text-sm text-white/30">
                    Start listening to see what&apos;s playing here
                </p>
            </div>
        );
    }

    const bpmValue = getFeatureValue(
        displayFeatures,
        "bpm",
    );
    const keyValue = displayFeatures?.keyScale ?? null;
    const energyValue = getFeatureValue(
        displayFeatures,
        "energy",
    );
    const danceValue = getFeatureValue(
        displayFeatures,
        "danceability",
    );
    const valenceValue = getFeatureValue(
        displayFeatures,
        "valence",
    );
    const arousalValue = getFeatureValue(
        displayFeatures,
        "arousal",
    );

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-4">
                {/* Album art */}
                <div className="relative aspect-square w-full max-w-[280px] mx-auto rounded-lg overflow-hidden bg-[#181818]">
                    {coverUrl ? (
                        <Image
                            src={coverUrl}
                            alt={currentTrack.album?.title || "Album art"}
                            fill
                            sizes="280px"
                            className="object-cover"
                            unoptimized
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <Music className="w-16 h-16 text-white/10" />
                        </div>
                    )}
                    {isPlaying && (
                        <div className="absolute bottom-2 right-2 w-2.5 h-2.5 rounded-full bg-[#1db954] animate-pulse" />
                    )}
                </div>

                {/* Track info */}
                <div className="text-center">
                    <p className="text-lg font-semibold text-white truncate">
                        {currentTrack.title}
                    </p>
                    <p className="text-sm text-white/70 truncate">
                        {currentTrack.artist?.name || "Unknown Artist"}
                    </p>
                    <p className="text-xs text-white/50 truncate">
                        {currentTrack.album?.title}
                    </p>
                </div>

                {/* Match score badge */}
                {hasOperation && matchScore !== null && (
                    <div className="flex justify-center">
                        <span
                            className={cn(
                                "text-xs font-bold px-3 py-1 rounded-full",
                                matchScore >= 80
                                    ? "bg-[#1db954]/20 text-[#1db954]"
                                    : matchScore >= 60
                                      ? "bg-[#ecb200]/20 text-[#ecb200]"
                                      : "bg-[#e35656]/20 text-[#e35656]",
                            )}
                        >
                            {matchScore}% Match
                        </span>
                    </div>
                )}

                {/* Radar chart */}
                {displayFeatures && (
                    <div className="h-[240px] w-full bg-[#181818] rounded-lg p-2">
                        <ResponsiveContainer width="100%" height="100%">
                            <RadarChart
                                data={radarData}
                                margin={{ top: 20, right: 30, bottom: 20, left: 30 }}
                            >
                                <PolarGrid stroke="#282828" strokeDasharray="3 3" />
                                <PolarAngleAxis
                                    dataKey="feature"
                                    tick={{ fill: "#b3b3b3", fontSize: 9, fontWeight: 500 }}
                                    tickLine={false}
                                />
                                {hasOperation && sourceFeatures && (
                                    <Radar
                                        name="Source"
                                        dataKey="source"
                                        stroke="#ecb200"
                                        fill="#ecb200"
                                        fillOpacity={0.1}
                                        strokeWidth={2}
                                        strokeDasharray="5 5"
                                    />
                                )}
                                <Radar
                                    name="Current"
                                    dataKey="current"
                                    stroke="#ffffff"
                                    fill="#ffffff"
                                    fillOpacity={0.15}
                                    strokeWidth={2}
                                />
                            </RadarChart>
                        </ResponsiveContainer>
                        {hasOperation && (
                            <div className="flex items-center justify-center gap-6 pb-1">
                                <div className="flex items-center gap-2">
                                    <div className="w-4 h-0.5 bg-[#ecb200] border-dashed" />
                                    <span className="text-[10px] text-[#b3b3b3]">Source</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-4 h-2 rounded-sm bg-white/30" />
                                    <span className="text-[10px] text-[#b3b3b3]">Current</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Mood spectrum bars */}
                {displayFeatures && (
                    <div className="bg-[#181818] rounded-lg p-4">
                        <div className="text-[10px] text-[#b3b3b3] uppercase tracking-wider mb-3">
                            Mood Spectrum
                        </div>
                        <div className="space-y-3">
                            {ML_MOODS.map((mood) => {
                                const value = getFeatureValue(
                                    displayFeatures,
                                    mood.key,
                                );
                                const percentage = value != null ? Math.round(value * 100) : 0;
                                const hasValue = value != null;

                                return (
                                    <div key={mood.key} className="flex items-center gap-3">
                                        <div
                                            className="w-2 h-2 rounded-full shrink-0"
                                            style={{ backgroundColor: mood.color }}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-center mb-1.5">
                                                <span className="text-xs text-[#b3b3b3]">
                                                    {mood.label}
                                                </span>
                                                <span className="text-xs font-medium tabular-nums text-white">
                                                    {hasValue ? `${percentage}%` : "--"}
                                                </span>
                                            </div>
                                            <div className="w-full bg-[#282828] rounded-full h-1 overflow-hidden">
                                                <motion.div
                                                    initial={{ width: 0 }}
                                                    animate={{
                                                        width: hasValue
                                                            ? `${Math.max(percentage, 2)}%`
                                                            : "0%",
                                                    }}
                                                    transition={{ duration: 0.6, ease: "easeOut" }}
                                                    className="h-full rounded-full"
                                                    style={{ backgroundColor: mood.color }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Audio features grid */}
                {displayFeatures && (
                    <div className="grid grid-cols-2 gap-2">
                        <FeatureCard
                            label="BPM"
                            value={bpmValue != null ? `${Math.round(bpmValue)}` : "--"}
                        />
                        <FeatureCard label="Key" value={keyValue || "--"} />
                        <FeatureCard
                            label="Energy"
                            value={energyValue != null ? `${Math.round(energyValue * 100)}%` : "--"}
                        />
                        <FeatureCard
                            label="Danceability"
                            value={danceValue != null ? `${Math.round(danceValue * 100)}%` : "--"}
                        />
                        <FeatureCard
                            label="Valence"
                            value={valenceValue != null ? `${Math.round(valenceValue * 100)}%` : "--"}
                        />
                        <FeatureCard
                            label="Arousal"
                            value={arousalValue != null ? `${Math.round(arousalValue * 100)}%` : "--"}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

function FeatureCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-[#181818] rounded-lg p-3">
            <div className="text-[10px] text-[#b3b3b3] uppercase tracking-wider mb-1">
                {label}
            </div>
            <div className="text-sm font-semibold text-white">{value}</div>
        </div>
    );
}
