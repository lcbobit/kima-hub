import * as fs from "fs";
import * as path from "path";

export interface ScanResult {
    valid: boolean;
    error?: string;
}

const AUDIO_SIGNATURES: Array<{
    name: string;
    check: (buf: Buffer) => boolean;
}> = [
    { name: "FLAC", check: (buf) => buf.toString("ascii", 0, 4) === "fLaC" },
    { name: "OGG", check: (buf) => buf.toString("ascii", 0, 4) === "OggS" },
    { name: "WAV", check: (buf) => buf.toString("ascii", 0, 4) === "RIFF" },
    { name: "M4A/AAC", check: (buf) => buf.toString("ascii", 4, 8) === "ftyp" },
    { name: "APE", check: (buf) => buf.toString("ascii", 0, 4) === "MAC " },
    { name: "WavPack", check: (buf) => buf.toString("ascii", 0, 4) === "wvpk" },
    { name: "ID3", check: (buf) => buf.toString("ascii", 0, 3) === "ID3" },
    { name: "MP3", check: (buf) => buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 },
];

export async function validateAudioHeader(filePath: string): Promise<ScanResult> {
    let fh: fs.promises.FileHandle | null = null;
    try {
        fh = await fs.promises.open(filePath, "r");
        const buf = Buffer.alloc(16);
        const { bytesRead } = await fh.read(buf, 0, 16, 0);

        if (bytesRead === 0) {
            return { valid: false, error: "Empty file (0 bytes)" };
        }

        for (const sig of AUDIO_SIGNATURES) {
            if (sig.check(buf)) {
                return { valid: true };
            }
        }

        const hex = buf.subarray(0, Math.min(bytesRead, 8)).toString("hex");
        return {
            valid: false,
            error: `Invalid audio header for ${path.extname(filePath)}: ${hex}`,
        };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { valid: false, error: message };
    } finally {
        await fh?.close();
    }
}
