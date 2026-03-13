"use client";

import { useState, useCallback, useMemo, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import {
    OrthographicCamera,
    PerspectiveCamera,
    OrbitControls,
    Stars,
} from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import type { MapTrack } from "./types";
import { TrackCloud } from "./TrackCloud";
import { TrackTooltip } from "./TrackTooltip";

interface VibeUniverseProps {
    tracks: MapTrack[];
    highlightedIds: Set<string>;
    selectedTrackId: string | null;
    onTrackClick: (trackId: string) => void;
    onBackgroundClick: () => void;
}

function useIsMobile(): boolean {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 768;
}

function SceneContent({
    tracks,
    highlightedIds,
    selectedTrackId,
    is3D,
    isMobile,
    onTrackClick,
    onBackgroundClick,
}: VibeUniverseProps & { is3D: boolean; isMobile: boolean }) {
    const [hoveredTrack, setHoveredTrack] = useState<MapTrack | null>(null);
    const [hoverPosition, setHoverPosition] = useState<THREE.Vector3 | null>(null);

    const handleTrackHover = useCallback((track: MapTrack | null, point: THREE.Vector3 | null) => {
        setHoveredTrack(track);
        setHoverPosition(point);
    }, []);

    const { center, cameraZ } = useMemo(() => {
        if (tracks.length === 0) {
            return { center: [0.5, 0.5] as const, cameraZ: 2 };
        }
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const t of tracks) {
            if (t.x < minX) minX = t.x;
            if (t.x > maxX) maxX = t.x;
            if (t.y < minY) minY = t.y;
            if (t.y > maxY) maxY = t.y;
        }
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const span = Math.max(maxX - minX, maxY - minY) || 1;
        return { center: [cx, cy] as const, cameraZ: span * 1.2 };
    }, [tracks]);

    return (
        <>
            {is3D ? (
                <PerspectiveCamera
                    makeDefault
                    position={[center[0], center[1], cameraZ]}
                    fov={60}
                    near={0.001}
                    far={100}
                />
            ) : (
                <OrthographicCamera
                    makeDefault
                    position={[center[0], center[1], 5]}
                    zoom={typeof window !== "undefined"
                        ? Math.min(window.innerWidth, window.innerHeight) / (cameraZ * 0.85)
                        : 400
                    }
                    near={0.001}
                    far={100}
                />
            )}

            <OrbitControls
                enableRotate={is3D}
                enableDamping
                dampingFactor={0.12}
                minDistance={0.05}
                maxDistance={10}
                target={[center[0], center[1], 0]}
            />

            <Stars
                radius={50}
                depth={50}
                count={isMobile ? 1000 : 3000}
                factor={3}
                saturation={0}
                fade
                speed={0.5}
            />

            <TrackCloud
                tracks={tracks}
                highlightedIds={highlightedIds}
                selectedTrackId={selectedTrackId}
                onTrackClick={onTrackClick}
                onTrackHover={handleTrackHover}
            />

            {hoveredTrack && hoverPosition && (
                <TrackTooltip track={hoveredTrack} position={hoverPosition} />
            )}

            <mesh
                position={[center[0], center[1], -0.1]}
                onClick={(e) => {
                    e.stopPropagation();
                    onBackgroundClick();
                }}
                visible={false}
            >
                <planeGeometry args={[100, 100]} />
                <meshBasicMaterial />
            </mesh>

            {!isMobile && (
                <EffectComposer>
                    <Bloom
                        mipmapBlur
                        intensity={1.2}
                        luminanceThreshold={0.9}
                        luminanceSmoothing={0.025}
                    />
                </EffectComposer>
            )}
        </>
    );
}

export function VibeUniverse({
    tracks,
    highlightedIds,
    selectedTrackId,
    onTrackClick,
    onBackgroundClick,
}: VibeUniverseProps) {
    const [is3D, setIs3D] = useState(false);
    const isMobile = useIsMobile();

    return (
        <div className="w-full h-full relative">
            <Canvas
                dpr={[1, 1.5]}
                gl={{
                    antialias: true,
                    toneMapping: THREE.NoToneMapping,
                    outputColorSpace: THREE.SRGBColorSpace,
                }}
                style={{ background: "black" }}
                onPointerMissed={onBackgroundClick}
            >
                <Suspense fallback={null}>
                    <SceneContent
                        tracks={tracks}
                        highlightedIds={highlightedIds}
                        selectedTrackId={selectedTrackId}
                        is3D={is3D}
                        isMobile={isMobile}
                        onTrackClick={onTrackClick}
                        onBackgroundClick={onBackgroundClick}
                    />
                </Suspense>
            </Canvas>

            <div className="absolute top-4 right-4 z-10">
                <button
                    onClick={() => setIs3D(!is3D)}
                    className="px-3 py-1.5 rounded-lg backdrop-blur-md border text-xs font-medium transition-colors bg-white/10 border-white/10 text-white/70 hover:text-white hover:bg-white/15"
                >
                    {is3D ? "2D" : "3D"}
                </button>
            </div>

            <div className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] z-10 text-white/15 text-[10px] tracking-widest uppercase font-medium">
                {tracks.length} tracks
            </div>
        </div>
    );
}
