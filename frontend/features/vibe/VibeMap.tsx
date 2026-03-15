"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer, TextLayer, LineLayer } from "@deck.gl/layers";
import { OrthographicView } from "@deck.gl/core";
import type { PickingInfo } from "@deck.gl/core";
import { useAudioState } from "@/lib/audio-state-context";
import type { MapTrack, PathResult, VibeMode } from "./types";
import {
    getTrackColor,
    getTrackHighlightColor,
    getGlowColor,
    getTrackRadius,
    getGlowRadius,
    computeClusterLabels,
    computeInitialViewState,
} from "./mapUtils";

interface VibeMapProps {
    tracks: MapTrack[];
    highlightedIds: Set<string>;
    selectedTrackId: string | null;
    pathResult: PathResult | null;
    mode: VibeMode;
    trackMap: Map<string, MapTrack>;
    queueTrackIds?: string[];
    showLabels?: boolean;
    onTrackClick: (trackId: string) => void;
    onTrackDoubleClick?: (trackId: string) => void;
    onBackgroundClick: () => void;
}

const MAP_VIEW = new OrthographicView({
    id: "vibe-map",
    flipY: false,
    controller: true,
});

export function VibeMap({
    tracks,
    highlightedIds,
    selectedTrackId,
    pathResult,
    mode,
    trackMap,
    queueTrackIds,
    showLabels = true,
    onTrackClick,
    onTrackDoubleClick,
    onBackgroundClick,
}: VibeMapProps) {
    const { currentTrack, activeOperation } = useAudioState();
    const currentlyPlayingId = currentTrack?.id ?? null;

    const [viewState, setViewState] = useState(() => {
        try {
            const saved = sessionStorage.getItem("kima_vibemap_camera");
            if (saved) {
                const s = JSON.parse(saved);
                if (s.target && typeof s.zoom === "number") {
                    return { target: s.target as [number, number, number], zoom: s.zoom, minZoom: 2, maxZoom: 14 };
                }
            }
        } catch { /* noop */ }
        const fit = tracks.length > 0
            ? computeInitialViewState(tracks)
            : { target: [0.5, 0.5, 0] as [number, number, number], zoom: 8 };
        return { target: fit.target, zoom: fit.zoom, minZoom: 2, maxZoom: 14 };
    });

    // Only persist camera to sessionStorage after user has actually interacted.
    // DeckGL fires onViewStateChange during init/resize/strict-mode remount with
    // computed defaults that would overwrite the saved position.
    const userInteracted = useRef(false);

    const hasHighlights = highlightedIds.size > 0;
    const zoom = viewState.zoom;

    const lastClickRef = useRef<{ id: string; time: number } | null>(null);

    const handleClick = useCallback(
        (info: PickingInfo) => {
            const id = (info?.object as MapTrack | undefined)?.id;
            if (id) {
                const now = Date.now();
                const last = lastClickRef.current;
                if (last && last.id === id && now - last.time < 400) {
                    lastClickRef.current = null;
                    onTrackDoubleClick?.(id);
                    return;
                }
                lastClickRef.current = { id, time: now };
                onTrackClick(id);
            } else {
                lastClickRef.current = null;
                onBackgroundClick();
            }
        },
        [onTrackClick, onTrackDoubleClick, onBackgroundClick],
    );

    const glowLayer = useMemo(
        () =>
            new ScatterplotLayer<MapTrack>({
                id: "track-glow",
                data: tracks,
                getPosition: (d) => [d.x, d.y],
                getRadius: (d) => {
                    if (currentlyPlayingId === d.id)
                        return getGlowRadius(d, zoom) * 1.4;
                    return getGlowRadius(d, zoom);
                },
                radiusUnits: "pixels",
                getFillColor: (d) => {
                    if (selectedTrackId === d.id)
                        return [255, 255, 255, 40] as [number, number, number, number];
                    if (currentlyPlayingId === d.id) {
                        const c = getGlowColor(d);
                        return [c[0], c[1], c[2], Math.min(255, c[3] * 3)] as [number, number, number, number];
                    }
                    if (hasHighlights && !highlightedIds.has(d.id))
                        return [0, 0, 0, 0] as [number, number, number, number];
                    return getGlowColor(d);
                },
                pickable: false,
                updateTriggers: {
                    getFillColor: [selectedTrackId, highlightedIds, hasHighlights, currentlyPlayingId],
                    getRadius: [zoom, currentlyPlayingId],
                },
            }),
        [tracks, zoom, selectedTrackId, highlightedIds, hasHighlights, currentlyPlayingId],
    );

    const scatterLayer = useMemo(
        () =>
            new ScatterplotLayer<MapTrack>({
                id: "tracks",
                data: tracks,
                getPosition: (d) => [d.x, d.y],
                getRadius: (d) => {
                    const r = getTrackRadius(d, zoom);
                    if (currentlyPlayingId === d.id)
                        return r * 1.3;
                    return r;
                },
                radiusUnits: "pixels",
                getFillColor: (d) => {
                    if (currentlyPlayingId === d.id)
                        return [255, 255, 255, 255] as [number, number, number, number];
                    if (selectedTrackId === d.id)
                        return [255, 255, 255, 255] as [number, number, number, number];
                    if (hasHighlights && !highlightedIds.has(d.id))
                        return getTrackColor(d, true);
                    if (hasHighlights && highlightedIds.has(d.id))
                        return getTrackHighlightColor(d);
                    return getTrackColor(d);
                },
                pickable: true,
                autoHighlight: true,
                highlightColor: [255, 255, 255, 60],
                updateTriggers: {
                    getFillColor: [selectedTrackId, highlightedIds, hasHighlights, currentlyPlayingId],
                    getRadius: [zoom, currentlyPlayingId],
                },
            }),
        [tracks, zoom, selectedTrackId, highlightedIds, hasHighlights, currentlyPlayingId],
    );

    const ringLayer = useMemo(() => {
        if (!hasHighlights && !selectedTrackId && !currentlyPlayingId) return null;
        const ringTracks = tracks.filter(
            (d) =>
                selectedTrackId === d.id ||
                (hasHighlights && highlightedIds.has(d.id)) ||
                (currentlyPlayingId === d.id),
        );
        if (ringTracks.length === 0) return null;

        return new ScatterplotLayer<MapTrack>({
            id: "track-rings",
            data: ringTracks,
            getPosition: (d) => [d.x, d.y],
            getRadius: (d) => {
                const r = getTrackRadius(d, zoom);
                if (currentlyPlayingId === d.id)
                    return r * 1.3 + 3;
                return r + 2;
            },
            radiusUnits: "pixels",
            filled: false,
            stroked: true,
            getLineColor: (d) => {
                if (currentlyPlayingId === d.id)
                    return [255, 255, 255, 180] as [number, number, number, number];
                if (selectedTrackId === d.id)
                    return [255, 255, 255, 120] as [number, number, number, number];
                const c = getTrackHighlightColor(d);
                return [c[0], c[1], c[2], 80] as [number, number, number, number];
            },
            getLineWidth: (d) => {
                if (currentlyPlayingId === d.id) return 1.5;
                return 1;
            },
            lineWidthUnits: "pixels",
            pickable: false,
            updateTriggers: {
                getLineColor: [selectedTrackId, highlightedIds, currentlyPlayingId],
                getRadius: [zoom, currentlyPlayingId],
                getLineWidth: [currentlyPlayingId],
            },
        });
    }, [tracks, zoom, selectedTrackId, highlightedIds, hasHighlights, currentlyPlayingId]);

    const labelLayer = useMemo(() => {
        if (zoom > 9) return null;

        const labels = computeClusterLabels(
            tracks,
            { minX: 0, maxX: 1, minY: 0, maxY: 1 },
            zoom < 7 ? 4 : 6,
        );

        if (labels.length === 0) return null;

        return new TextLayer({
            id: "cluster-labels",
            data: labels,
            getPosition: (d) => [d.x, d.y],
            getText: (d) => d.label,
            getSize: zoom < 7 ? 13 : 10,
            getColor: [255, 255, 255, zoom < 7 ? 50 : 35],
            fontFamily: "var(--font-montserrat), Montserrat, system-ui, sans-serif",
            fontWeight: 500,
            getTextAnchor: "middle" as const,
            getAlignmentBaseline: "center" as const,
            sizeUnits: "pixels" as const,
            billboard: false,
            fontSettings: { sdf: true },
            outlineWidth: 3,
            outlineColor: [10, 10, 10, 200],
        });
    }, [tracks, zoom]);

    const pathLayer = useMemo(() => {
        if (!pathResult || mode !== "path-result") return null;

        const allPathTracks = [
            pathResult.startTrack,
            ...pathResult.path,
            pathResult.endTrack,
        ];

        const lineData: Array<{
            sourcePosition: [number, number];
            targetPosition: [number, number];
            color: [number, number, number, number];
        }> = [];

        const startTrackOnMap = trackMap.get(pathResult.startTrack.id);
        const endTrackOnMap = trackMap.get(pathResult.endTrack.id);
        if (!startTrackOnMap || !endTrackOnMap) return null;

        const startColor = getTrackHighlightColor(startTrackOnMap);
        const endColor = getTrackHighlightColor(endTrackOnMap);

        for (let i = 0; i < allPathTracks.length - 1; i++) {
            const from = trackMap.get(allPathTracks[i].id);
            const to = trackMap.get(allPathTracks[i + 1].id);
            if (!from || !to) continue;

            const t = i / Math.max(1, allPathTracks.length - 2);
            const color: [number, number, number, number] = [
                Math.round(startColor[0] + (endColor[0] - startColor[0]) * t),
                Math.round(startColor[1] + (endColor[1] - startColor[1]) * t),
                Math.round(startColor[2] + (endColor[2] - startColor[2]) * t),
                100,
            ];

            lineData.push({
                sourcePosition: [from.x, from.y],
                targetPosition: [to.x, to.y],
                color,
            });
        }

        return new LineLayer({
            id: "path-line",
            data: lineData,
            getSourcePosition: (d) => d.sourcePosition,
            getTargetPosition: (d) => d.targetPosition,
            getColor: (d) => d.color,
            getWidth: 1.5,
            widthUnits: "pixels",
        });
    }, [pathResult, mode, trackMap]);

    const queuePathLayer = useMemo(() => {
        if (!queueTrackIds || queueTrackIds.length < 2) return null;

        const playingIdx = currentlyPlayingId
            ? queueTrackIds.indexOf(currentlyPlayingId)
            : -1;

        const lineData: Array<{
            sourcePosition: [number, number];
            targetPosition: [number, number];
            color: [number, number, number, number];
        }> = [];

        for (let i = 0; i < queueTrackIds.length - 1; i++) {
            const from = trackMap.get(queueTrackIds[i]);
            const to = trackMap.get(queueTrackIds[i + 1]);
            if (!from || !to) continue;

            const isPast = playingIdx >= 0 && i < playingIdx;
            const alpha = isPast ? 25 : 50;

            lineData.push({
                sourcePosition: [from.x, from.y],
                targetPosition: [to.x, to.y],
                color: [180, 160, 120, alpha],
            });
        }

        if (lineData.length === 0) return null;

        return new LineLayer({
            id: "queue-path",
            data: lineData,
            getSourcePosition: (d) => d.sourcePosition,
            getTargetPosition: (d) => d.targetPosition,
            getColor: (d) => d.color,
            getWidth: 1,
            widthUnits: "pixels",
        });
    }, [queueTrackIds, trackMap, currentlyPlayingId]);

    const sourceRingLayer = useMemo(() => {
        if (!activeOperation || activeOperation.type === 'idle' || activeOperation.type === 'blend') return null;

        let sourceId: string;
        let color: [number, number, number, number];

        if (activeOperation.type === 'drift') {
            sourceId = activeOperation.startTrackId;
            color = [236, 178, 0, 120];
        } else if (activeOperation.type === 'vibe') {
            sourceId = activeOperation.sourceTrackId;
            color = [29, 185, 84, 120];
        } else {
            sourceId = activeOperation.sourceTrackId;
            color = [92, 141, 214, 120];
        }

        const sourceTrack = trackMap.get(sourceId);
        if (!sourceTrack) return null;

        return new ScatterplotLayer<MapTrack>({
            id: "operation-source-ring",
            data: [sourceTrack],
            getPosition: (d) => [d.x, d.y],
            getRadius: () => getTrackRadius(sourceTrack, zoom) * 3,
            radiusUnits: "pixels",
            filled: false,
            stroked: true,
            getLineColor: () => color,
            getLineWidth: 2,
            lineWidthUnits: "pixels",
            pickable: false,
        });
    }, [activeOperation, trackMap, zoom]);

    // Track name labels with leader lines -- only when zoomed in
    const trackNameLayers = useMemo(() => {
        if (!showLabels || zoom < 10) return { labels: null, leaders: null };

        // Offset in coordinate space -- scales inversely with zoom so it
        // stays a consistent pixel distance above the dot
        const offsetY = 18 / Math.pow(2, zoom);
        const leaderStart = 6 / Math.pow(2, zoom);

        return {
            labels: new TextLayer<MapTrack>({
                id: "track-names",
                data: tracks,
                getPosition: (d) => [d.x, d.y + offsetY],
                getText: (d) => d.title,
                getSize: 10,
                getColor: [255, 255, 255, 70],
                fontFamily: "Montserrat, system-ui, sans-serif",
                fontWeight: 400,
                getTextAnchor: "middle" as const,
                getAlignmentBaseline: "bottom" as const,
                sizeUnits: "pixels" as const,
                outlineWidth: 3,
                outlineColor: [5, 5, 5, 200],
            }),
            leaders: new LineLayer<MapTrack>({
                id: "track-name-leaders",
                data: tracks,
                getSourcePosition: (d) => [d.x, d.y + leaderStart],
                getTargetPosition: (d) => [d.x, d.y + offsetY * 0.75],
                getColor: [255, 255, 255, 25],
                getWidth: 0.5,
                widthUnits: "pixels",
            }),
        };
    }, [tracks, zoom, showLabels]);

    const layers = useMemo(() => {
        const result: (ScatterplotLayer<MapTrack> | TextLayer | LineLayer | null)[] =
            [glowLayer, scatterLayer];
        if (ringLayer) result.push(ringLayer);
        if (sourceRingLayer) result.push(sourceRingLayer);
        if (labelLayer) result.push(labelLayer);
        if (trackNameLayers.leaders) result.push(trackNameLayers.leaders);
        if (trackNameLayers.labels) result.push(trackNameLayers.labels);
        if (queuePathLayer) result.push(queuePathLayer);
        if (pathLayer) result.push(pathLayer);
        return result.filter(Boolean);
    }, [glowLayer, scatterLayer, ringLayer, sourceRingLayer, labelLayer, trackNameLayers, queuePathLayer, pathLayer]);

    const getTooltip = useCallback((info: PickingInfo) => {
        if (!info?.object) return null;
        const track = info.object as MapTrack;
        return {
            text: `${track.title}\n${track.artist}`,
            style: {
                backgroundColor: "rgba(15, 15, 15, 0.95)",
                color: "#e5e5e5",
                fontSize: "12px",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid rgba(255,255,255,0.08)",
                fontFamily: "var(--font-montserrat), Montserrat, system-ui, sans-serif",
                boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                lineHeight: "1.4",
            },
        };
    }, []);

    return (
        <div className="w-full h-full relative">
            <div className="absolute inset-0 vibe-map-bg" />
            <DeckGL
                views={MAP_VIEW}
                viewState={viewState}
                onViewStateChange={({ viewState: vs, interactionState }) => {
                    const next = vs as typeof viewState;
                    setViewState(next);
                    if (interactionState?.isDragging || interactionState?.isZooming || interactionState?.isPanning) {
                        userInteracted.current = true;
                    }
                    if (userInteracted.current) {
                        try { sessionStorage.setItem("kima_vibemap_camera", JSON.stringify({ target: next.target, zoom: next.zoom })); } catch { /* noop */ }
                    }
                }}
                layers={layers}
                onClick={handleClick}
                getTooltip={getTooltip}
                controller={true}
                getCursor={({ isDragging, isHovering }) => {
                    if (mode === "path-picking") return "crosshair";
                    if (isDragging) return "grabbing";
                    if (isHovering) return "pointer";
                    return "grab";
                }}
                style={{ background: "transparent" }}
            />
            {mode === "path-picking" && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded-lg text-sm backdrop-blur-sm border border-white/10">
                    Click a destination track
                </div>
            )}
        </div>
    );
}
