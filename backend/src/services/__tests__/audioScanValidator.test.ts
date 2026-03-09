import { validateAudioHeader } from "../audioScanValidator";
import * as fs from "fs";

jest.mock("fs", () => ({
    promises: {
        open: jest.fn(),
    },
}));

const mockOpen = fs.promises.open as jest.MockedFunction<typeof fs.promises.open>;

function mockFileHandle(bytes: Buffer) {
    return {
        read: jest.fn().mockImplementation((buf: Buffer) => {
            bytes.copy(buf, 0, 0, Math.min(bytes.length, buf.length));
            return Promise.resolve({ bytesRead: bytes.length, buffer: buf });
        }),
        close: jest.fn().mockResolvedValue(undefined),
    } as any;
}

describe("validateAudioHeader", () => {
    afterEach(() => jest.clearAllMocks());

    it("accepts valid MP3 (0xFFE0+ frame sync)", async () => {
        const mp3Header = Buffer.alloc(16);
        mp3Header[0] = 0xff;
        mp3Header[1] = 0xfb;
        mockOpen.mockResolvedValue(mockFileHandle(mp3Header));
        const result = await validateAudioHeader("/music/test.mp3");
        expect(result.valid).toBe(true);
    });

    it("accepts valid MP3 with ID3 tag", async () => {
        const id3Header = Buffer.from("ID3" + "\0".repeat(13));
        mockOpen.mockResolvedValue(mockFileHandle(id3Header));
        const result = await validateAudioHeader("/music/test.mp3");
        expect(result.valid).toBe(true);
    });

    it("accepts valid FLAC", async () => {
        const flacHeader = Buffer.from("fLaC" + "\0".repeat(12));
        mockOpen.mockResolvedValue(mockFileHandle(flacHeader));
        const result = await validateAudioHeader("/music/test.flac");
        expect(result.valid).toBe(true);
    });

    it("accepts valid OGG", async () => {
        const oggHeader = Buffer.from("OggS" + "\0".repeat(12));
        mockOpen.mockResolvedValue(mockFileHandle(oggHeader));
        const result = await validateAudioHeader("/music/test.ogg");
        expect(result.valid).toBe(true);
    });

    it("accepts valid WAV (RIFF)", async () => {
        const wavHeader = Buffer.from("RIFF" + "\0".repeat(12));
        mockOpen.mockResolvedValue(mockFileHandle(wavHeader));
        const result = await validateAudioHeader("/music/test.wav");
        expect(result.valid).toBe(true);
    });

    it("accepts valid M4A (ftyp at offset 4)", async () => {
        const m4aHeader = Buffer.alloc(16);
        m4aHeader.write("ftyp", 4);
        mockOpen.mockResolvedValue(mockFileHandle(m4aHeader));
        const result = await validateAudioHeader("/music/test.m4a");
        expect(result.valid).toBe(true);
    });

    it("rejects JPEG disguised as MP3", async () => {
        const jpegHeader = Buffer.alloc(16);
        jpegHeader[0] = 0xff;
        jpegHeader[1] = 0xd8;
        mockOpen.mockResolvedValue(mockFileHandle(jpegHeader));
        const result = await validateAudioHeader("/music/fake.mp3");
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/invalid.*header/i);
    });

    it("rejects PNG disguised as FLAC", async () => {
        const pngHeader = Buffer.from("\x89PNG" + "\0".repeat(12));
        mockOpen.mockResolvedValue(mockFileHandle(pngHeader));
        const result = await validateAudioHeader("/music/fake.flac");
        expect(result.valid).toBe(false);
    });

    it("rejects zero-byte file", async () => {
        mockOpen.mockResolvedValue(mockFileHandle(Buffer.alloc(0)));
        const result = await validateAudioHeader("/music/empty.mp3");
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/empty|zero/i);
    });

    it("rejects file that cannot be opened", async () => {
        mockOpen.mockRejectedValue(new Error("ENOENT"));
        const result = await validateAudioHeader("/music/missing.mp3");
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/ENOENT/);
    });
});
