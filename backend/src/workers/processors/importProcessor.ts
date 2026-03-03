import { Job } from "bullmq";
import { logger } from "../../utils/logger";
import { spotifyImportService } from "../../services/spotifyImport";

export interface ImportJobData {
    importJobId: string;
    userId: string;
    albumMbidsToDownload: string[];
}

export async function processImportJob(job: Job<ImportJobData>): Promise<void> {
    const { importJobId, userId, albumMbidsToDownload } = job.data;
    logger.info(`[ImportWorker] Processing import job ${importJobId} for user ${userId}`);
    await spotifyImportService.processImportFromQueue(importJobId, albumMbidsToDownload);
}
