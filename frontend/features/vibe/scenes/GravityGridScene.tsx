"use client";

import { useState, useMemo, useRef, useEffect, useLayoutEffect, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
    PerspectiveCamera,
    OrthographicCamera,
    MapControls,
    Text,
    Billboard,
} from "@react-three/drei";
// Post-processing disabled for GPU performance (see performance optimization)
import * as THREE from "three";
import type { MapTrack } from "../types";
import type { VibeOperation } from "@/lib/audio-state-context";

export interface VibeSceneProps {
    tracks: MapTrack[];
    highlightedIds: Set<string>;
    playingTrackId?: string | null;
    selectedTrackId: string | null;
    queueTrackIds?: string[];
    activeOperation?: VibeOperation;
    showLabels?: boolean;
    onTrackClick: (trackId: string) => void;
    onTrackDoubleClick?: (trackId: string) => void;
    onBackgroundClick: () => void;
}

const WORLD_SCALE = 1200;

// Warm gold palette -- everything subdued, active is just a gentle twinkle
const NODE_GOLD = new THREE.Color(0.12, 0.09, 0.03);
const NODE_ACTIVE = new THREE.Color(0.3, 0.22, 0.08);
const NODE_QUEUE = new THREE.Color(0.2, 0.15, 0.05);
const NODE_DIMMED = new THREE.Color(0.06, 0.04, 0.015);

const _scratchVec3 = new THREE.Vector3();

// Shared geometries for instanced rendering (created once, never disposed)
const CORE_GEO = new THREE.SphereGeometry(1, 8, 6);
const GLOW_GEO = new THREE.SphereGeometry(1, 6, 4);
const _dummy = new THREE.Object3D();
const _instanceColor = new THREE.Color();
const PULSE_RING_GEO = new THREE.RingGeometry(0.8, 1.0, 32);

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

function hashToFloat(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return ((h & 0x7fffffff) / 0x7fffffff) * 2 - 1;
}

function seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

function computeWorldPositions(tracks: MapTrack[]): Float32Array {
    const positions = new Float32Array(tracks.length * 3);
    for (let i = 0; i < tracks.length; i++) {
        positions[i * 3] = tracks[i].x * WORLD_SCALE;
        positions[i * 3 + 1] = tracks[i].y * WORLD_SCALE;
        positions[i * 3 + 2] = hashToFloat(tracks[i].id) * WORLD_SCALE * 0.25;
    }
    return positions;
}

// ---------------------------------------------------------------------------
// Space Grid -- sparse axis lines + per-star vertical depth ticks
// ---------------------------------------------------------------------------

function SpaceGrid({
    centerX = 0,
    centerY = 0,
    spread = WORLD_SCALE,
    starPositions,
}: {
    centerX?: number;
    centerY?: number;
    spread?: number;
    starPositions: Float32Array;
}) {
    const { gridGeo, tickGeo } = useMemo(() => {
        const half = spread * 1.2;
        const step = spread * 0.25;
        const lines: number[] = [];

        // XY grid -- horizontal and vertical lines across the plane
        for (let v = -half; v <= half + 0.01; v += step) {
            // horizontal line (along X)
            lines.push(centerX - half, centerY + v, 0,  centerX + half, centerY + v, 0);
            // vertical line (along Y)
            lines.push(centerX + v, centerY - half, 0,  centerX + v, centerY + half, 0);
        }

        // Z axis lines at grid intersections
        const zHalf = spread * 0.5;
        for (let xi = -half; xi <= half + 0.01; xi += step * 2) {
            for (let yi = -half; yi <= half + 0.01; yi += step * 2) {
                lines.push(centerX + xi, centerY + yi, -zHalf,  centerX + xi, centerY + yi, zHalf);
            }
        }

        const gridArr = new Float32Array(lines);
        const gGeo = new THREE.BufferGeometry();
        gGeo.setAttribute("position", new THREE.BufferAttribute(gridArr, 3));

        // Per-star vertical depth ticks -- short line from (x,y,0) to (x,y,z)
        const ticks: number[] = [];
        const count = starPositions.length / 3;
        for (let i = 0; i < count; i++) {
            const x = starPositions[i * 3];
            const y = starPositions[i * 3 + 1];
            const z = starPositions[i * 3 + 2];
            if (Math.abs(z) < 1) continue;
            ticks.push(x, y, 0,  x, y, z);
        }
        const tickArr = new Float32Array(ticks);
        const tGeo = new THREE.BufferGeometry();
        tGeo.setAttribute("position", new THREE.BufferAttribute(tickArr, 3));

        return { gridGeo: gGeo, tickGeo: tGeo };
    }, [centerX, centerY, spread, starPositions]);

    useEffect(() => {
        return () => { gridGeo.dispose(); tickGeo.dispose(); };
    }, [gridGeo, tickGeo]);

    return (
        <>
            <lineSegments geometry={gridGeo}>
                <lineBasicMaterial color="#ffffff" transparent opacity={0.025} depthWrite={false} />
            </lineSegments>
            <lineSegments geometry={tickGeo}>
                <lineBasicMaterial color="#ffffff" transparent opacity={0.015} depthWrite={false} />
            </lineSegments>
        </>
    );
}

// ---------------------------------------------------------------------------
// Background Stars -- depth and atmosphere
// ---------------------------------------------------------------------------

function BackgroundStars({
    count = 1500,
    centerX = 0,
    centerY = 0,
    spread = WORLD_SCALE,
}: {
    count?: number;
    centerX?: number;
    centerY?: number;
    spread?: number;
}) {
    const { positions, colors } = useMemo(() => {
        const rng = seededRandom(7);
        const pos = new Float32Array(count * 3);
        const col = new Float32Array(count * 3);
        const halfSpread = spread * 1.5;

        for (let i = 0; i < count; i++) {
            pos[i * 3] = centerX + (rng() - 0.5) * halfSpread * 2;
            pos[i * 3 + 1] = centerY + (rng() - 0.5) * halfSpread * 2;
            pos[i * 3 + 2] = (rng() - 0.5) * halfSpread * 2;

            const brightness = 0.3 + rng() * 0.4;
            col[i * 3] = brightness * (0.6 + rng() * 0.2);     // slight red/violet
            col[i * 3 + 1] = brightness * (0.5 + rng() * 0.2); // muted green
            col[i * 3 + 2] = brightness * (0.9 + rng() * 0.1); // strong blue
        }
        return { positions: pos, colors: col };
    }, [count, centerX, centerY, spread]);

    return (
        <points>
            <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[positions, 3]} />
                <bufferAttribute attach="attributes-color" args={[colors, 3]} />
            </bufferGeometry>
            <pointsMaterial
                vertexColors
                size={0.8}
                sizeAttenuation
                transparent
                opacity={0.09}
                depthWrite={false}
            />
        </points>
    );
}

// ---------------------------------------------------------------------------
// Queue Connectors -- lines tracing the playback order of queued tracks
// ---------------------------------------------------------------------------

function QueueConnectors({
    trackPosMap,
    queueTrackIds,
    playingTrackId,
}: {
    trackPosMap: Map<string, THREE.Vector3>;
    queueTrackIds: string[];
    playingTrackId?: string | null;
}) {
    const playingIdx = playingTrackId
        ? queueTrackIds.indexOf(playingTrackId)
        : -1;

    const geometry = useMemo(() => {
        const validIds = queueTrackIds.filter(id => trackPosMap.has(id));
        if (validIds.length < 2) {
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
            return g;
        }

        const segCount = validIds.length - 1;
        const positions = new Float32Array(segCount * 6);
        const colors = new Float32Array(segCount * 6);

        for (let i = 0; i < segCount; i++) {
            const a = trackPosMap.get(validIds[i])!;
            const b = trackPosMap.get(validIds[i + 1])!;
            positions[i * 6] = a.x;
            positions[i * 6 + 1] = a.y;
            positions[i * 6 + 2] = a.z;
            positions[i * 6 + 3] = b.x;
            positions[i * 6 + 4] = b.y;
            positions[i * 6 + 5] = b.z;

            const isPast = playingIdx >= 0 && i < playingIdx;
            // Upcoming: brand amber (#fca200). Past: dimmed.
            const r = isPast ? 0.15 : 0.988;
            const g = isPast ? 0.10 : 0.635;
            const bCol = isPast ? 0.04 : 0.0;
            colors[i * 6] = r; colors[i * 6 + 1] = g; colors[i * 6 + 2] = bCol;
            colors[i * 6 + 3] = r; colors[i * 6 + 4] = g; colors[i * 6 + 5] = bCol;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        return geo;
    }, [queueTrackIds, trackPosMap, playingIdx]);

    useEffect(() => {
        return () => { geometry.dispose(); };
    }, [geometry]);

    if (queueTrackIds.length < 2) return null;

    return (
        <lineSegments geometry={geometry}>
            <lineBasicMaterial
                vertexColors
                transparent
                opacity={0.7}
                depthWrite={false}
            />
        </lineSegments>
    );
}

// ---------------------------------------------------------------------------
// Track Instances -- InstancedMesh replacing per-track meshes (3000 -> 2 draw calls)
// ---------------------------------------------------------------------------

function TrackInstances({
    tracks,
    worldPositions,
    highlightedIds,
    playingTrackId,
    selectedTrackId,
    queueTrackIds,
    onTrackClick,
    onTrackDoubleClick,
}: {
    tracks: MapTrack[];
    worldPositions: Float32Array;
    highlightedIds: Set<string>;
    playingTrackId?: string | null;
    selectedTrackId: string | null;
    queueTrackIds?: string[];
    onTrackClick: (trackId: string) => void;
    onTrackDoubleClick?: (trackId: string) => void;
}) {
    const coreRef = useRef<THREE.InstancedMesh>(null);
    const glowRef = useRef<THREE.InstancedMesh>(null);
    const lastClickRef = useRef<{ id: string; time: number } | null>(null);
    const count = tracks.length;

    const coreMat = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xffffff }), []);
    const glowMat = useMemo(() => new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
    }), []);

    useLayoutEffect(() => {
        const core = coreRef.current;
        const glow = glowRef.current;
        if (!core || !glow || count === 0) return;

        const queueSet = new Set(queueTrackIds ?? []);
        const hasActive = highlightedIds.size > 0 || !!playingTrackId || !!selectedTrackId;

        for (let i = 0; i < count; i++) {
            const track = tracks[i];
            const energy = track.energy ?? 0.5;
            const isSelected = track.id === selectedTrackId;
            const isPlaying = track.id === playingTrackId;
            const isInActiveList = highlightedIds.has(track.id);
            const isInQueue = queueSet.has(track.id);
            const isLit = isSelected || isPlaying || isInActiveList || isInQueue;

            let scale: number;
            let nodeColor: THREE.Color;
            let coreOpacity: number;

            if (isPlaying) {
                scale = 1.6 + energy * 1.2;
                nodeColor = NODE_ACTIVE;
                coreOpacity = 0.85;
            } else if (isSelected) {
                scale = 1.4 + energy * 1;
                nodeColor = NODE_ACTIVE;
                coreOpacity = 0.85;
            } else if (isInActiveList || isInQueue) {
                scale = 1.2 + energy * 0.9;
                nodeColor = isInQueue ? NODE_QUEUE : NODE_ACTIVE;
                coreOpacity = 0.85;
            } else if (hasActive) {
                scale = 1 + energy * 0.8;
                nodeColor = NODE_DIMMED;
                coreOpacity = 0.7;
            } else {
                scale = 1.1 + energy * 1;
                nodeColor = NODE_GOLD;
                coreOpacity = 0.7;
            }

            const px = worldPositions[i * 3];
            const py = worldPositions[i * 3 + 1];
            const pz = worldPositions[i * 3 + 2];

            // Core: bake opacity into color (on dark background, result is identical)
            _instanceColor.copy(nodeColor).multiplyScalar(coreOpacity);
            core.setColorAt(i, _instanceColor);
            _dummy.position.set(px, py, pz);
            _dummy.scale.setScalar(scale);
            _dummy.updateMatrix();
            core.setMatrixAt(i, _dummy.matrix);

            // Glow: bake opacity into color for additive blending
            const glowRadius = (isLit ? 6.2 : 4.0) + energy * 3.5;
            const glowOpacity = isLit ? 0.025 : 0.008;
            _instanceColor.copy(nodeColor).multiplyScalar(glowOpacity);
            glow.setColorAt(i, _instanceColor);
            _dummy.scale.setScalar(glowRadius);
            _dummy.updateMatrix();
            glow.setMatrixAt(i, _dummy.matrix);
        }

        core.instanceMatrix.needsUpdate = true;
        glow.instanceMatrix.needsUpdate = true;
        if (core.instanceColor) core.instanceColor.needsUpdate = true;
        if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
        core.computeBoundingSphere();
    }, [count, tracks, worldPositions, highlightedIds, playingTrackId, selectedTrackId, queueTrackIds]);

    useEffect(() => {
        return () => { coreMat.dispose(); glowMat.dispose(); };
    }, [coreMat, glowMat]);

    const trackIdToIndex = useMemo(() => {
        const map = new Map<string, number>();
        for (let i = 0; i < tracks.length; i++) map.set(tracks[i].id, i);
        return map;
    }, [tracks]);

    const lastPulseTime = useRef(0);

    useFrame((state) => {
        if (!playingTrackId) return;

        // Throttle pulse to ~30fps -- subtle animation doesn't need 60+
        const now = state.clock.elapsedTime;
        if (now - lastPulseTime.current < 0.033) return;
        lastPulseTime.current = now;

        const core = coreRef.current;
        const glow = glowRef.current;
        if (!core || !glow || count === 0) return;

        const playingIdx = trackIdToIndex.get(playingTrackId) ?? -1;
        if (playingIdx === -1) return;

        const pulse = 1 + Math.sin(now * 2.5) * 0.12;

        const track = tracks[playingIdx];
        const energy = track.energy ?? 0.5;
        const baseScale = 1.6 + energy * 1.2;

        const px = worldPositions[playingIdx * 3];
        const py = worldPositions[playingIdx * 3 + 1];
        const pz = worldPositions[playingIdx * 3 + 2];

        _dummy.position.set(px, py, pz);
        _dummy.scale.setScalar(baseScale * pulse);
        _dummy.updateMatrix();
        core.setMatrixAt(playingIdx, _dummy.matrix);
        core.instanceMatrix.needsUpdate = true;

        const glowRadius = (6.2 + energy * 3.5) * pulse;
        _dummy.scale.setScalar(glowRadius);
        _dummy.updateMatrix();
        glow.setMatrixAt(playingIdx, _dummy.matrix);
        glow.instanceMatrix.needsUpdate = true;

        state.invalidate();
    });

    return (
        <>
            <instancedMesh
                ref={coreRef}
                args={[CORE_GEO, coreMat, count]}
                onClick={(e) => {
                    e.stopPropagation();
                    if (e.instanceId !== undefined) {
                        const id = tracks[e.instanceId].id;
                        const now = Date.now();
                        const last = lastClickRef.current;
                        if (last && last.id === id && now - last.time < 400) {
                            lastClickRef.current = null;
                            onTrackDoubleClick?.(id);
                            return;
                        }
                        lastClickRef.current = { id, time: now };
                        onTrackClick(id);
                    }
                }}
            />
            <instancedMesh
                ref={glowRef}
                args={[GLOW_GEO, glowMat, count]}
            />
        </>
    );
}

// ---------------------------------------------------------------------------
// Track Labels -- Billboard text for selected/playing tracks (0-2 labels max)
// ---------------------------------------------------------------------------

function TrackLabels({
    tracks,
    worldPositions,
    selectedTrackId,
    playingTrackId,
}: {
    tracks: MapTrack[];
    worldPositions: Float32Array;
    selectedTrackId: string | null;
    playingTrackId?: string | null;
}) {
    const labels = useMemo(() => {
        const result: Array<{ track: MapTrack; index: number; isSelected: boolean }> = [];
        for (let i = 0; i < tracks.length; i++) {
            const id = tracks[i].id;
            if (id === selectedTrackId || id === playingTrackId) {
                result.push({ track: tracks[i], index: i, isSelected: id === selectedTrackId });
            }
        }
        return result;
    }, [tracks, selectedTrackId, playingTrackId]);

    if (labels.length === 0) return null;

    return (
        <>
            {labels.map(({ track, index, isSelected }) => {
                const energy = track.energy ?? 0.5;
                const isPlaying = track.id === playingTrackId;
                const scale = isPlaying ? 1.6 + energy * 1.2 : 1.4 + energy * 1;

                return (
                    <Billboard
                        key={track.id}
                        position={[
                            worldPositions[index * 3],
                            worldPositions[index * 3 + 1] + scale * 2,
                            worldPositions[index * 3 + 2],
                        ]}
                    >
                        <Text
                            fontSize={scale * 0.7}
                            color="#e8d5b0"
                            fillOpacity={isSelected ? 0.7 : 0.5}
                            anchorX="center"
                            anchorY="bottom"
                            maxWidth={scale * 10}
                            textAlign="center"
                        >
                            {track.title + "\n" + track.artist}
                        </Text>
                    </Billboard>
                );
            })}
        </>
    );
}

// ---------------------------------------------------------------------------
// Chart Labels -- astronomical map style labels with leader lines (2D only)
// ---------------------------------------------------------------------------

const LEADER_LINE_MAT = new THREE.LineBasicMaterial({
    color: new THREE.Color(0.6, 0.55, 0.4),
    transparent: true,
    opacity: 0.15,
});

function ChartLabels({
    tracks,
    worldPositions,
}: {
    tracks: MapTrack[];
    worldPositions: Float32Array;
}) {
    const { leaderGeo, labelData } = useMemo(() => {
        const leaderPoints: number[] = [];
        const labels: Array<{ x: number; y: number; z: number; title: string }> = [];
        const leaderHeight = 12;
        const gap = 3;

        for (let i = 0; i < tracks.length; i++) {
            const px = worldPositions[i * 3];
            const py = worldPositions[i * 3 + 1];
            const pz = worldPositions[i * 3 + 2];

            // Leader line: from just above dot to label anchor
            leaderPoints.push(px, py + gap, pz);
            leaderPoints.push(px, py + leaderHeight, pz);

            labels.push({ x: px, y: py + leaderHeight + 1, z: pz, title: tracks[i].title });
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(leaderPoints, 3));

        return { leaderGeo: geo, labelData: labels };
    }, [tracks, worldPositions]);

    useEffect(() => {
        return () => { leaderGeo.dispose(); };
    }, [leaderGeo]);

    return (
        <>
            <lineSegments geometry={leaderGeo} material={LEADER_LINE_MAT} />
            {labelData.map((label, i) => (
                <Billboard key={i} position={[label.x, label.y, label.z]}>
                    <Text
                        fontSize={2.2}
                        color="#c8b888"
                        fillOpacity={0.25}
                        anchorX="center"
                        anchorY="bottom"
                        maxWidth={60}
                        textAlign="center"
                    >
                        {label.title}
                    </Text>
                </Billboard>
            ))}
        </>
    );
}

// ---------------------------------------------------------------------------
// Operation Source Pulse -- expanding ring at the vibe/drift/similar source track
// ---------------------------------------------------------------------------

function OperationSourcePulse({
    tracks,
    worldPositions,
    sourceTrackId,
    color,
}: {
    tracks: MapTrack[];
    worldPositions: Float32Array;
    sourceTrackId: string;
    color: string;
}) {
    const meshRef = useRef<THREE.Mesh>(null);
    const matRef = useRef<THREE.MeshBasicMaterial>(null);

    const sourceIdx = useMemo(() => {
        for (let i = 0; i < tracks.length; i++) {
            if (tracks[i].id === sourceTrackId) return i;
        }
        return -1;
    }, [tracks, sourceTrackId]);

    useFrame((state) => {
        if (sourceIdx === -1) return;
        const mesh = meshRef.current;
        const mat = matRef.current;
        if (!mesh || !mat) return;

        const time = state.clock.elapsedTime;
        const cycle = (time * 0.5) % 1;

        mesh.position.set(
            worldPositions[sourceIdx * 3],
            worldPositions[sourceIdx * 3 + 1],
            worldPositions[sourceIdx * 3 + 2],
        );
        mesh.lookAt(state.camera.position);

        const scale = 5 + cycle * 35;
        mesh.scale.setScalar(scale);
        mat.opacity = 0.2 * (1 - cycle * cycle);

        state.invalidate();
    });

    if (sourceIdx === -1) return null;

    return (
        <mesh ref={meshRef} geometry={PULSE_RING_GEO}>
            <meshBasicMaterial
                ref={matRef}
                color={color}
                transparent
                opacity={0.2}
                side={THREE.DoubleSide}
                depthWrite={false}
            />
        </mesh>
    );
}

// ---------------------------------------------------------------------------
// FPS Controls -- direct Pointer Lock API for mouse look + WASD movement
// ---------------------------------------------------------------------------

const _euler = new THREE.Euler(0, 0, 0, "YXZ");

function FPSControls({
    speed = 80,
    lookAtX,
    lookAtY,
    onLockChange,
}: {
    speed?: number;
    lookAtX: number;
    lookAtY: number;
    onLockChange: (locked: boolean) => void;
}) {
    const { camera, gl, invalidate } = useThree();
    const keys = useRef<Set<string>>(new Set());
    const isLocked = useRef(false);
    const hasInitLook = useRef(false);

    useEffect(() => {
        if (!hasInitLook.current) {
            camera.lookAt(lookAtX, lookAtY, 0);
            hasInitLook.current = true;
        }
    }, [camera, lookAtX, lookAtY]);

    useEffect(() => {
        const canvas = gl.domElement;

        const onClick = () => {
            if (!isLocked.current) {
                canvas.requestPointerLock();
            }
        };

        const onLockChangeEvent = () => {
            const locked = document.pointerLockElement === canvas;
            isLocked.current = locked;
            onLockChange(locked);
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!isLocked.current) return;
            const sensitivity = 0.002;
            _euler.setFromQuaternion(camera.quaternion);
            _euler.y -= e.movementX * sensitivity;
            _euler.x -= e.movementY * sensitivity;
            _euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, _euler.x));
            camera.quaternion.setFromEuler(_euler);
            invalidate();
        };

        canvas.addEventListener("click", onClick);
        document.addEventListener("pointerlockchange", onLockChangeEvent);
        document.addEventListener("mousemove", onMouseMove);

        return () => {
            canvas.removeEventListener("click", onClick);
            document.removeEventListener("pointerlockchange", onLockChangeEvent);
            document.removeEventListener("mousemove", onMouseMove);
            if (document.pointerLockElement === canvas) {
                document.exitPointerLock();
            }
        };
    }, [camera, gl, onLockChange, invalidate]);

    useEffect(() => {
        const down = (e: KeyboardEvent) => keys.current.add(e.code);
        const up = (e: KeyboardEvent) => keys.current.delete(e.code);
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
        };
    }, []);

    useFrame((state, delta) => {
        if (!isLocked.current) return;
        const v = _scratchVec3.set(0, 0, 0);
        const boost = keys.current.has("KeyR") ? 3 : 1;
        const s = speed * boost;
        if (keys.current.has("KeyW") || keys.current.has("ArrowUp")) v.z -= 1;
        if (keys.current.has("KeyS") || keys.current.has("ArrowDown")) v.z += 1;
        if (keys.current.has("KeyA") || keys.current.has("ArrowLeft")) v.x -= 1;
        if (keys.current.has("KeyD") || keys.current.has("ArrowRight")) v.x += 1;
        if (keys.current.has("Space")) v.y += 1;
        if (keys.current.has("ShiftLeft") || keys.current.has("ShiftRight")) v.y -= 1;
        if (v.length() > 0) {
            v.normalize().multiplyScalar(s * delta);
            v.applyQuaternion(camera.quaternion);
            camera.position.add(v);
            state.invalidate();
        }
    });

    return null;
}

// ---------------------------------------------------------------------------
// Camera persistence -- save/restore view position across reloads
// ---------------------------------------------------------------------------

const GALAXY_CAM_KEY = "kima_galaxy_camera";

interface SavedCameraState {
    px: number; py: number; pz: number;
    qx: number; qy: number; qz: number; qw: number;
    zoom: number;
    is3D: boolean;
}

function saveCameraState(camera: THREE.Camera, is3D: boolean) {
    const state: SavedCameraState = {
        px: camera.position.x, py: camera.position.y, pz: camera.position.z,
        qx: camera.quaternion.x, qy: camera.quaternion.y,
        qz: camera.quaternion.z, qw: camera.quaternion.w,
        zoom: (camera as THREE.OrthographicCamera).zoom ?? 1,
        is3D,
    };
    try { sessionStorage.setItem(GALAXY_CAM_KEY, JSON.stringify(state)); } catch { /* noop */ }
}

function loadCameraState(): SavedCameraState | null {
    try {
        const raw = sessionStorage.getItem(GALAXY_CAM_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function CameraPersistence({ is3D }: { is3D: boolean }) {
    const cameraRef = useRef<THREE.Camera | null>(null);
    const frameCount = useRef(0);
    const restored = useRef(false);

    useFrame((state) => {
        cameraRef.current = state.camera;

        if (!restored.current) {
            const saved = loadCameraState();
            if (saved) {
                const cam = state.camera;
                cam.position.set(saved.px, saved.py, saved.pz);
                if (is3D) {
                    cam.quaternion.set(saved.qx, saved.qy, saved.qz, saved.qw);
                }
                if (!is3D && "zoom" in cam) {
                    (cam as THREE.OrthographicCamera).zoom = saved.zoom;
                    cam.updateProjectionMatrix();
                }
            }
            restored.current = true;
        }

        frameCount.current++;
        if (restored.current && frameCount.current % 60 === 0) {
            saveCameraState(state.camera, is3D);
        }
    });

    return null;
}

// ---------------------------------------------------------------------------
// Scene content
// ---------------------------------------------------------------------------

function SceneContent({
    tracks,
    highlightedIds,
    playingTrackId,
    selectedTrackId,
    queueTrackIds,
    activeOperation,
    showLabels = true,
    is3D,
    animated: _animated,
    onLockChange,
    onTrackClick,
    onTrackDoubleClick,
    onRecenterRef,
}: Omit<VibeSceneProps, "onBackgroundClick"> & {
    is3D: boolean;
    animated: boolean;
    onLockChange: (locked: boolean) => void;
    onRecenterRef: React.MutableRefObject<(() => void) | null>;
}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const controlsRef = useRef<any>(null);

    const worldPositions = useMemo(
        () => computeWorldPositions(tracks),
        [tracks],
    );

    const trackPosMap = useMemo(() => {
        const map = new Map<string, THREE.Vector3>();
        for (let i = 0; i < tracks.length; i++) {
            map.set(tracks[i].id, new THREE.Vector3(
                worldPositions[i * 3],
                worldPositions[i * 3 + 1],
                worldPositions[i * 3 + 2],
            ));
        }
        return map;
    }, [tracks, worldPositions]);

    const { center, span } = useMemo(() => {
        if (tracks.length === 0) {
            return { center: [0.5, 0.5] as const, span: 1 };
        }
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const t of tracks) {
            if (t.x < minX) minX = t.x;
            if (t.x > maxX) maxX = t.x;
            if (t.y < minY) minY = t.y;
            if (t.y > maxY) maxY = t.y;
        }
        return {
            center: [(minX + maxX) / 2, (minY + maxY) / 2] as const,
            span: Math.max(maxX - minX, maxY - minY) || 1,
        };
    }, [tracks]);

    const worldCenterX = center[0] * WORLD_SCALE;
    const worldCenterY = center[1] * WORLD_SCALE;

    const { camera } = useThree();

    const orthoZoom = useMemo(() => {
        if (typeof window === "undefined") return 2;
        const viewportMin = Math.min(window.innerWidth, window.innerHeight);
        const worldSpan = span * WORLD_SCALE;
        return viewportMin / (worldSpan * 0.5);
    }, [span]);

    useEffect(() => {
        onRecenterRef.current = () => {
            camera.position.set(worldCenterX, worldCenterY, camera.position.z);
            if (controlsRef.current?.target) {
                controlsRef.current.target.set(worldCenterX, worldCenterY, 0);
                controlsRef.current.update();
            }
            if ("zoom" in camera && typeof camera.zoom === "number") {
                (camera as THREE.OrthographicCamera).zoom = orthoZoom;
                camera.updateProjectionMatrix();
            }
        };
        return () => { onRecenterRef.current = null; };
    }, [camera, worldCenterX, worldCenterY, orthoZoom, onRecenterRef]);

    const mapTarget = useMemo(
        () => new THREE.Vector3(worldCenterX, worldCenterY, 0),
        [worldCenterX, worldCenterY],
    );

    return (
        <>
            {is3D ? (
                <>
                    <PerspectiveCamera
                        makeDefault
                        position={[
                            worldCenterX - span * WORLD_SCALE * 0.35,
                            worldCenterY,
                            0,
                        ]}
                        fov={70}
                        near={0.1}
                        far={WORLD_SCALE * 50}
                    />
                    <FPSControls
                        speed={WORLD_SCALE * 0.08}
                        lookAtX={worldCenterX}
                        lookAtY={worldCenterY}
                        onLockChange={onLockChange}
                    />
                </>
            ) : (
                <>
                    <OrthographicCamera
                        makeDefault
                        position={[worldCenterX, worldCenterY, WORLD_SCALE * 2]}
                        zoom={orthoZoom}
                        near={0.1}
                        far={WORLD_SCALE * 50}
                    />
                    <MapControls
                        ref={controlsRef}
                        enableRotate={false}
                        enableDamping
                        dampingFactor={0.12}
                        screenSpacePanning
                        target={mapTarget}
                        minZoom={0.05}
                        maxZoom={orthoZoom * 12}
                    />
                </>
            )}

            <CameraPersistence is3D={is3D} />

            <SpaceGrid
                centerX={worldCenterX}
                centerY={worldCenterY}
                spread={span * WORLD_SCALE}
                starPositions={worldPositions}
            />

            <BackgroundStars
                count={300}
                centerX={worldCenterX}
                centerY={worldCenterY}
                spread={span * WORLD_SCALE}
            />

            {queueTrackIds && queueTrackIds.length >= 2 && (
                <QueueConnectors
                    trackPosMap={trackPosMap}
                    queueTrackIds={queueTrackIds}
                    playingTrackId={playingTrackId}
                />
            )}

            {tracks.length > 0 && (
                <>
                    <TrackInstances
                        tracks={tracks}
                        worldPositions={worldPositions}
                        highlightedIds={highlightedIds}
                        playingTrackId={playingTrackId}
                        selectedTrackId={selectedTrackId}
                        queueTrackIds={queueTrackIds}
                        onTrackClick={onTrackClick}
                        onTrackDoubleClick={onTrackDoubleClick}
                    />
                    <TrackLabels
                        tracks={tracks}
                        worldPositions={worldPositions}
                        selectedTrackId={selectedTrackId}
                        playingTrackId={playingTrackId}
                    />
                    {!is3D && showLabels && (
                        <ChartLabels
                            tracks={tracks}
                            worldPositions={worldPositions}
                        />
                    )}
                </>
            )}

            {activeOperation?.type === 'vibe' && tracks.length > 0 && (
                <OperationSourcePulse
                    tracks={tracks}
                    worldPositions={worldPositions}
                    sourceTrackId={activeOperation.sourceTrackId}
                    color="#1db954"
                />
            )}
            {activeOperation?.type === 'drift' && tracks.length > 0 && (
                <OperationSourcePulse
                    tracks={tracks}
                    worldPositions={worldPositions}
                    sourceTrackId={activeOperation.startTrackId}
                    color="#ecb200"
                />
            )}
            {activeOperation?.type === 'similar' && tracks.length > 0 && (
                <OperationSourcePulse
                    tracks={tracks}
                    worldPositions={worldPositions}
                    sourceTrackId={activeOperation.sourceTrackId}
                    color="#5c8dd6"
                />
            )}

            {/* EffectComposer disabled -- saves a full-screen pass per frame
            <EffectComposer>
                <Noise opacity={0.02} />
                <Vignette offset={0.3} darkness={0.65} />
            </EffectComposer>
            */}
        </>
    );
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

export function GravityGridScene({
    tracks,
    highlightedIds,
    playingTrackId,
    selectedTrackId,
    queueTrackIds,
    activeOperation,
    showLabels = true,
    onTrackClick,
    onTrackDoubleClick,
    onBackgroundClick,
}: VibeSceneProps) {
    const [is3D, setIs3D] = useState(false);
    const [isLocked, setIsLocked] = useState(false);
    const [animated, setAnimated] = useState(true);
    const recenterRef = useRef<(() => void) | null>(null);

    return (
        <div className="w-full h-full relative">
            <Canvas
                id="galactic-canvas"
                frameloop="demand"
                dpr={[1, 1.5]}
                gl={{
                    antialias: false,
                    toneMapping: THREE.NoToneMapping,
                    outputColorSpace: THREE.SRGBColorSpace,
                    powerPreference: "high-performance",
                }}
                style={{ background: "#000000" }}
                onPointerMissed={onBackgroundClick}
            >
                <Suspense fallback={null}>
                    <SceneContent
                        tracks={tracks}
                        highlightedIds={highlightedIds}
                        playingTrackId={playingTrackId}
                        selectedTrackId={selectedTrackId}
                        queueTrackIds={queueTrackIds}
                        activeOperation={activeOperation}
                        showLabels={showLabels}
                        is3D={is3D}
                        animated={animated}
                        onLockChange={setIsLocked}
                        onTrackClick={onTrackClick}
                        onTrackDoubleClick={onTrackDoubleClick}
                        onRecenterRef={recenterRef}
                    />
                </Suspense>
            </Canvas>

            <div className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))] z-10 flex gap-2">
                <button
                    onClick={() => setAnimated(!animated)}
                    className={`px-3 py-1.5 rounded-lg backdrop-blur-md border text-xs font-medium transition-colors bg-black/20 border-white/8 hover:bg-black/30 ${
                        animated ? "text-white/40 hover:text-white/70" : "text-white/20 hover:text-white/40"
                    }`}
                >
                    {animated ? "Pause" : "Play"}
                </button>
                <button
                    onClick={() => recenterRef.current?.()}
                    className="px-3 py-1.5 rounded-lg backdrop-blur-md border text-xs font-medium transition-colors bg-black/20 border-white/8 text-white/40 hover:text-white/70 hover:bg-black/30"
                >
                    Recenter
                </button>
                <button
                    onClick={() => setIs3D(!is3D)}
                    className="px-3 py-1.5 rounded-lg backdrop-blur-md border text-xs font-medium transition-colors bg-black/20 border-white/8 text-white/40 hover:text-white/70 hover:bg-black/30"
                >
                    {is3D ? "2D" : "3D"}
                </button>
            </div>

            {is3D && !isLocked && (
                <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                    <div className="text-center">
                        <p className="text-white/30 text-sm mb-1">Click to explore</p>
                        <p className="text-white/15 text-xs">
                            WASD to move -- Mouse to look -- R for boost -- ESC to exit
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
