import { Job } from "bullmq";
import { logger } from "../../utils/logger";
import { spotifyImportService } from "../../services/spotifyImport";

export interface ImportJobData {
    importJobId: string;
    userId: string;
    albumMbidsToDownload?: string[];
    quickImport?: boolean;
    url?: string;
    playlistName?: string;
}

export async function processImportJob(job: Job<ImportJobData>): Promise<void> {
    const { importJobId, userId, quickImport, url, playlistName, albumMbidsToDownload } = job.data;
    logger.info(`[ImportWorker] Processing import job ${importJobId} for user ${userId}${quickImport ? " (quick)" : ""}`);

    if (quickImport) {
        if (!url) throw new Error("Quick import requires a URL");
        await spotifyImportService.processQuickImportFromQueue(importJobId, url, playlistName);
    } else {
        await spotifyImportService.processImportFromQueue(importJobId, albumMbidsToDownload || []);
    }
}
