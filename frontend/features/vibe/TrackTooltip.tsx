"use client";

import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { MapTrack } from "./types";

interface TrackTooltipProps {
    track: MapTrack;
    position: THREE.Vector3;
}

export function TrackTooltip({ track, position }: TrackTooltipProps) {
    return (
        <Html
            position={position}
            center
            style={{ pointerEvents: "none" }}
            zIndexRange={[50, 0]}
        >
            <div className="bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-1.5 text-center whitespace-nowrap">
                <div className="text-white text-xs font-medium truncate max-w-48">
                    {track.title}
                </div>
                <div className="text-white/50 text-[10px] truncate max-w-48">
                    {track.artist}
                </div>
            </div>
        </Html>
    );
}
