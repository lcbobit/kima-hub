"use client";

import { useCallback, useMemo, useState } from "react";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer, TextLayer, LineLayer } from "@deck.gl/layers";
import { OrthographicView } from "@deck.gl/core";
import type { PickingInfo } from "@deck.gl/core";
import type { MapTrack, PathResult } from "./types";
import {
    getTrackColor,
    getTrackHighlightColor,
    getRadiusForZoom,
    computeClusterLabels,
} from "./mapUtils";

interface VibeMapProps {
    tracks: MapTrack[];
    highlightedIds: Set<string>;
    selectedTrackId: string | null;
    pathResult: PathResult | null;
    mode: string;
    trackMap: Map<string, MapTrack>;
    onTrackClick: (trackId: string) => void;
    onBackgroundClick: () => void;
}

const INITIAL_VIEW_STATE = {
    target: [0.5, 0.5, 0] as [number, number, number],
    zoom: 1,
    minZoom: -1,
    maxZoom: 10,
};

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
    onTrackClick,
    onBackgroundClick,
}: VibeMapProps) {
    const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);

    const hasHighlights = highlightedIds.size > 0;
    const zoom = viewState.zoom;

    const handleClick = useCallback(
        (info: PickingInfo) => {
            const id = (info?.object as MapTrack | undefined)?.id;
            if (id) {
                onTrackClick(id);
            } else {
                onBackgroundClick();
            }
        },
        [onTrackClick, onBackgroundClick],
    );

    const scatterLayer = useMemo(
        () =>
            new ScatterplotLayer<MapTrack>({
                id: "tracks",
                data: tracks,
                getPosition: (d) => [d.x, d.y],
                getRadius: () => getRadiusForZoom(zoom),
                radiusUnits: "pixels",
                getFillColor: (d) => {
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
                highlightColor: [255, 255, 255, 80],
                updateTriggers: {
                    getFillColor: [selectedTrackId, highlightedIds, hasHighlights],
                    getRadius: [zoom],
                },
            }),
        [tracks, zoom, selectedTrackId, highlightedIds, hasHighlights],
    );

    const labelLayer = useMemo(() => {
        if (zoom > 4) return null;

        const labels = computeClusterLabels(
            tracks,
            { minX: 0, maxX: 1, minY: 0, maxY: 1 },
            zoom < 1 ? 4 : 6,
        );

        if (labels.length === 0) return null;

        return new TextLayer({
            id: "cluster-labels",
            data: labels,
            getPosition: (d) => [d.x, d.y],
            getText: (d) => d.label,
            getSize: zoom < 1 ? 14 : 11,
            getColor: [255, 255, 255, zoom < 1 ? 120 : 80],
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: 600,
            getTextAnchor: "middle" as const,
            getAlignmentBaseline: "center" as const,
            sizeUnits: "pixels" as const,
            billboard: false,
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

        for (let i = 0; i < allPathTracks.length - 1; i++) {
            const from = trackMap.get(allPathTracks[i].id);
            const to = trackMap.get(allPathTracks[i + 1].id);
            if (!from || !to) continue;

            const t = i / Math.max(1, allPathTracks.length - 2);
            const startTrackOnMap = trackMap.get(pathResult.startTrack.id);
            const endTrackOnMap = trackMap.get(pathResult.endTrack.id);
            if (!startTrackOnMap || !endTrackOnMap) continue;
            const startColor = getTrackHighlightColor(startTrackOnMap);
            const endColor = getTrackHighlightColor(endTrackOnMap);
            const color: [number, number, number, number] = [
                Math.round(startColor[0] + (endColor[0] - startColor[0]) * t),
                Math.round(startColor[1] + (endColor[1] - startColor[1]) * t),
                Math.round(startColor[2] + (endColor[2] - startColor[2]) * t),
                200,
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
            getWidth: 2,
            widthUnits: "pixels",
        });
    }, [pathResult, mode, trackMap]);

    const layers = useMemo(() => {
        const result: (ScatterplotLayer<MapTrack> | TextLayer | LineLayer | null)[] =
            [scatterLayer];
        if (labelLayer) result.push(labelLayer);
        if (pathLayer) result.push(pathLayer);
        return result.filter(Boolean);
    }, [scatterLayer, labelLayer, pathLayer]);

    const getTooltip = useCallback((info: PickingInfo) => {
        if (!info?.object) return null;
        const track = info.object as MapTrack;
        return {
            text: `${track.title}\n${track.artist}`,
            style: {
                backgroundColor: "rgba(0, 0, 0, 0.85)",
                color: "#fff",
                fontSize: "12px",
                padding: "6px 10px",
                borderRadius: "6px",
                fontFamily: "Inter, system-ui, sans-serif",
            },
        };
    }, []);

    return (
        <div className="w-full h-full bg-[#0a0a0a] relative">
            <DeckGL
                views={MAP_VIEW}
                viewState={viewState}
                onViewStateChange={({ viewState: vs }) => setViewState(vs as typeof viewState)}
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
            />
            {mode === "path-picking" && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded-lg text-sm backdrop-blur-sm">
                    Click a destination track
                </div>
            )}
        </div>
    );
}
