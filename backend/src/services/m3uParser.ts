export interface M3UEntry {
    filePath: string;
    artist: string | null;
    title: string | null;
    durationSeconds: number | null;
}

interface ParseOptions {
    maxEntries?: number;
}

export function parseM3U(content: string, options: ParseOptions = {}): M3UEntry[] {
    const { maxEntries = 10000 } = options;

    if (content.includes("\0")) {
        throw new Error("M3U content contains null bytes");
    }

    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const entries: M3UEntry[] = [];
    let pendingMeta: { artist: string | null; title: string | null; duration: number | null } | null = null;

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        if (line === "#EXTM3U") continue;

        if (line.startsWith("#EXTINF:")) {
            const afterHash = line.slice(8);
            const commaIdx = afterHash.indexOf(",");
            if (commaIdx === -1) continue;

            const duration = parseInt(afterHash.slice(0, commaIdx), 10);
            const display = afterHash.slice(commaIdx + 1).trim();

            const sepIdx = display.indexOf(" - ");
            if (sepIdx > 0) {
                pendingMeta = {
                    artist: display.slice(0, sepIdx).trim(),
                    title: display.slice(sepIdx + 3).trim(),
                    duration: isNaN(duration) ? null : duration,
                };
            } else {
                pendingMeta = { artist: null, title: display || null, duration: isNaN(duration) ? null : duration };
            }
            continue;
        }

        if (line.startsWith("#")) continue;

        const filePath = line.replace(/\\/g, "/");

        entries.push({
            filePath,
            artist: pendingMeta?.artist ?? null,
            title: pendingMeta?.title ?? null,
            durationSeconds: pendingMeta?.duration ?? null,
        });
        pendingMeta = null;

        if (entries.length > maxEntries) {
            throw new Error(`M3U file exceeds maximum of ${maxEntries} entries`);
        }
    }

    return entries;
}
