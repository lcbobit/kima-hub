"use client";

export type AudioControllerEvent =
    | "play"
    | "pause"
    | "ended"
    | "timeupdate"
    | "loading"
    | "canplay"
    | "error"
    | "waiting"
    | "seeked"
    | "needs-resume";

export type AudioControllerCallback = (data?: unknown) => void;

export class AudioController {
    private audio: HTMLAudioElement;
    private audioContext: AudioContext | null = null;
    private sourceNode: MediaElementAudioSourceNode | null = null;
    private eventListeners: Map<AudioControllerEvent, Set<AudioControllerCallback>> = new Map();
    private nativeListeners: Array<{ event: string; handler: EventListener }> = [];
    private prefetchLink: HTMLLinkElement | null = null;

    private currentSrc: string | null = null;
    private volume = 1;
    private isMuted = false;

    private networkRetryCount = 0;
    private readonly MAX_NETWORK_RETRIES = 2;
    private networkRetryTimeout: ReturnType<typeof setTimeout> | null = null;
    private retrySeekTime: number | null = null;

    constructor(audio: HTMLAudioElement) {
        this.audio = audio;
        this.audio.preload = "auto";

        const events: AudioControllerEvent[] = [
            "play", "pause", "ended", "timeupdate",
            "loading", "canplay", "error", "waiting",
            "seeked", "needs-resume",
        ];
        events.forEach((e) => this.eventListeners.set(e, new Set()));

        this.attachNativeListeners();
        this.initializeVolume();
    }

    private ensureAudioContext(): void {
        if (this.audioContext) return;

        this.audioContext = new AudioContext();
        this.sourceNode = this.audioContext.createMediaElementSource(this.audio);
        this.sourceNode.connect(this.audioContext.destination);

        try {
            const nav = navigator as { audioSession?: { type: string } };
            if (nav.audioSession) {
                nav.audioSession.type = "playback";
            }
        } catch {
            // Not supported
        }
    }

    private attachNativeListeners(): void {
        const add = (event: string, handler: EventListener) => {
            this.audio.addEventListener(event, handler);
            this.nativeListeners.push({ event, handler });
        };

        add("playing", () => {
            this.networkRetryCount = 0;
            this.emit("play");
        });

        add("pause", () => {
            this.emit("pause");
        });

        add("ended", () => {
            this.emit("ended");
        });

        add("timeupdate", () => {
            this.emit("timeupdate", { time: this.audio.currentTime });
        });

        add("canplay", () => {
            if (this.retrySeekTime !== null) {
                const seekTo = this.retrySeekTime;
                this.retrySeekTime = null;
                try {
                    this.audio.currentTime = seekTo;
                } catch {
                    // Element not ready
                }
            }
            this.emit("canplay", { duration: this.audio.duration || 0 });
        });

        add("waiting", () => {
            this.emit("waiting");
        });

        add("loadstart", () => {
            this.emit("loading");
        });

        add("seeked", () => {
            this.emit("seeked", { time: this.audio.currentTime });
        });

        add("error", () => {
            const err = this.audio.error;

            if (
                err?.code === 2 &&
                this.networkRetryCount < this.MAX_NETWORK_RETRIES &&
                this.currentSrc
            ) {
                this.networkRetryCount++;
                const delay = this.networkRetryCount * 2000;
                console.warn(
                    `[AudioController] Network error, retrying in ${delay}ms (attempt ${this.networkRetryCount}/${this.MAX_NETWORK_RETRIES})`
                );
                this.networkRetryTimeout = setTimeout(() => {
                    if (this.currentSrc) {
                        this.retrySeekTime = this.audio.currentTime || null;
                        this.audio.src = this.currentSrc;
                        this.audio.load();
                        this.emit("needs-resume");
                    }
                }, delay);
                return;
            }

            this.emit("error", {
                error: err?.message || "Audio playback error",
                code: err?.code,
            });
        });
    }

    private detachNativeListeners(): void {
        for (const { event, handler } of this.nativeListeners) {
            this.audio.removeEventListener(event, handler);
        }
        this.nativeListeners = [];
    }

    async play(): Promise<void> {
        if (!this.audio.src) return;

        this.ensureAudioContext();

        if (this.audioContext?.state === "suspended") {
            try {
                await this.audioContext.resume();
            } catch {
                // Resume failed
            }
        }

        try {
            await this.audio.play();
        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
                return;
            }
            console.error("[AudioController] Play failed:", err);
            this.emit("error", { error: err instanceof Error ? err.message : String(err) });
        }
    }

    async tryResume(): Promise<boolean> {
        if (!this.audio.src) return false;
        if (!this.audio.paused) return true;

        this.ensureAudioContext();

        if (this.audioContext?.state === "suspended") {
            try {
                await this.audioContext.resume();
            } catch {
                return false;
            }
        }

        try {
            await this.audio.play();
            return true;
        } catch {
            return false;
        }
    }

    pause(): void {
        this.audio.pause();
    }

    stop(): void {
        this.audio.pause();
        this.audio.currentTime = 0;
    }

    load(src: string, autoplay: boolean = false): void {
        if (this.currentSrc === src && this.audio.readyState >= 2) {
            if (autoplay && this.audio.paused) {
                this.play();
            }
            return;
        }

        this.cancelNetworkRetry();
        this.currentSrc = src;
        this.audio.src = src;

        if (autoplay) {
            this.play();
        }
    }

    seek(time: number): void {
        const duration = this.audio.duration;
        if (duration && isFinite(duration) && duration > 0) {
            time = Math.max(0, Math.min(time, duration));
        } else {
            time = Math.max(0, time);
        }
        try {
            this.audio.currentTime = time;
        } catch {
            console.warn("[AudioController] Seek failed: element not ready");
        }
    }

    preloadHint(src: string): void {
        if (this.prefetchLink) {
            this.prefetchLink.remove();
            this.prefetchLink = null;
        }

        const link = document.createElement("link");
        link.rel = "prefetch";
        link.as = "fetch";
        link.href = src;
        link.dataset.preloadAudio = "true";
        document.head.appendChild(link);
        this.prefetchLink = link;
    }

    getCurrentTime(): number {
        return this.audio.currentTime || 0;
    }

    getDuration(): number {
        const d = this.audio.duration;
        return d && isFinite(d) ? d : 0;
    }

    isPlaying(): boolean {
        return !this.audio.paused && !this.audio.ended;
    }

    hasAudio(): boolean {
        return this.audio.readyState >= 2;
    }

    getState(): Readonly<{ currentSrc: string | null; volume: number; isMuted: boolean }> {
        return { currentSrc: this.currentSrc, volume: this.volume, isMuted: this.isMuted };
    }

    setVolume(volume: number): void {
        this.volume = Math.max(0, Math.min(1, volume));
        if (!this.isMuted) {
            this.audio.volume = this.volume;
        }
    }

    setMuted(muted: boolean): void {
        this.isMuted = muted;
        this.audio.volume = muted ? 0 : this.volume;
    }

    initializeVolume(): void {
        if (typeof window === "undefined") return;

        try {
            const savedVolume = localStorage.getItem("kima_volume");
            const savedMuted = localStorage.getItem("kima_muted");

            if (savedVolume) {
                const parsed = parseFloat(savedVolume);
                if (!isNaN(parsed)) {
                    this.volume = Math.max(0, Math.min(1, parsed));
                }
            }
            if (savedMuted === "true") {
                this.isMuted = true;
            }

            this.audio.volume = this.isMuted ? 0 : this.volume;
        } catch (error) {
            console.error("[AudioController] Failed to initialize from storage:", error);
        }
    }

    on(event: AudioControllerEvent, callback: AudioControllerCallback): void {
        this.eventListeners.get(event)?.add(callback);
    }

    off(event: AudioControllerEvent, callback: AudioControllerCallback): void {
        this.eventListeners.get(event)?.delete(callback);
    }

    private emit(event: AudioControllerEvent, data?: unknown): void {
        this.eventListeners.get(event)?.forEach((callback) => {
            try {
                callback(data);
            } catch (err) {
                console.error(`[AudioController] Event listener error (${event}):`, err);
            }
        });
    }

    private cancelNetworkRetry(): void {
        if (this.networkRetryTimeout) {
            clearTimeout(this.networkRetryTimeout);
            this.networkRetryTimeout = null;
        }
        this.networkRetryCount = 0;
        this.retrySeekTime = null;
    }

    cleanup(): void {
        this.cancelNetworkRetry();
        this.audio.pause();
        this.audio.removeAttribute("src");
        this.audio.load();
        this.currentSrc = null;

        if (this.prefetchLink) {
            this.prefetchLink.remove();
            this.prefetchLink = null;
        }
    }

    destroy(): void {
        this.cleanup();
        this.detachNativeListeners();

        if (this.audioContext) {
            this.audioContext.close().catch(() => {
                // Already closed or failed
            });
            this.audioContext = null;
            this.sourceNode = null;
        }

        this.eventListeners.clear();
    }
}
