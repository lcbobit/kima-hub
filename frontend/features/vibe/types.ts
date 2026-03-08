export interface MapTrack {
    id: string;
    x: number;
    y: number;
    title: string;
    artist: string;
    artistId: string;
    albumId: string;
    coverUrl: string | null;
    dominantMood: string;
    moodScore: number;
    energy: number | null;
    valence: number | null;
}

export interface MapData {
    tracks: MapTrack[];
    trackCount: number;
    computedAt: string;
}

export interface PathTrack {
    id: string;
    title: string;
    duration: number;
    albumId: string;
    albumTitle: string;
    albumCoverUrl: string | null;
    artistId: string;
    artistName: string;
}

export interface PathResult {
    startTrack: PathTrack;
    endTrack: PathTrack;
    path: PathTrack[];
    metadata: {
        totalTracks: number;
        embeddingDistance: number;
        averageStepSize: number;
        mode: string;
    };
}

export interface AlchemyTrack {
    id: string;
    title: string;
    duration: number;
    distance: number;
    similarity: number;
    album: { id: string; title: string; coverUrl: string | null };
    artist: { id: string; name: string };
}

export interface AlchemyResult {
    tracks: AlchemyTrack[];
}

export type VibeMode = "idle" | "similar" | "search" | "path-picking" | "path-result" | "alchemy";

export interface VibeState {
    mode: VibeMode;
    selectedTrackId: string | null;
    highlightedTrackIds: Set<string>;
    pathResult: PathResult | null;
    searchQuery: string;
}
