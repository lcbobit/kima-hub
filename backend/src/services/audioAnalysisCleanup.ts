import { prisma } from "../utils/db";
import { logger } from "../utils/logger";
import { enrichmentFailureService } from "./enrichmentFailureService";

// Keep in sync with the INTERVAL '15 minutes' literals in cleanupStaleProcessing() raw SQL.
// Cannot parameterize intervals in Prisma tagged templates ($queryRaw treats interpolated
// values as query parameters, and PostgreSQL rejects parameterized INTERVAL literals).
const STALE_THRESHOLD_MINUTES = 15;
const MAX_RETRIES = 3;
const CIRCUIT_BREAKER_THRESHOLD = 30;
const CIRCUIT_BREAKER_WINDOW_MS = 5 * 60 * 1000;

type CircuitState = "closed" | "open" | "half-open";

class AudioAnalysisCleanupService {
    private state: CircuitState = "closed";
    private failureCount = 0;
    private lastFailureTime: Date | null = null;
    private circuitOpenedAt: Date | null = null;

    private shouldAttemptReset(): boolean {
        if (!this.circuitOpenedAt) return false;
        const timeSinceOpen = Date.now() - this.circuitOpenedAt.getTime();
        return timeSinceOpen >= CIRCUIT_BREAKER_WINDOW_MS;
    }

    private onSuccess(): void {
        if (this.state === "half-open") {
            logger.info(
                `[AudioAnalysisCleanup] Circuit breaker CLOSED - recovery successful after ${this.failureCount} failures`
            );
            this.state = "closed";
            this.failureCount = 0;
            this.lastFailureTime = null;
            this.circuitOpenedAt = null;
        } else if (this.state === "closed" && this.failureCount > 0) {
            logger.debug(
                "[AudioAnalysisCleanup] Resetting failure counter on success"
            );
            this.failureCount = 0;
            this.lastFailureTime = null;
            this.circuitOpenedAt = null;
        }
    }

    private onFailure(
        resetCount: number,
        permanentlyFailedCount: number
    ): void {
        // Count cleanup runs, not individual tracks -- a single batch of stale
        // tracks shouldn't immediately trip the breaker
        this.failureCount += 1;
        this.lastFailureTime = new Date();

        if (this.state === "half-open") {
            this.state = "open";
            // Don't reset circuitOpenedAt — keep original open time so the
            // next shouldAttemptReset() fires immediately and retries HALF-OPEN
            logger.warn(
                `[AudioAnalysisCleanup] Circuit breaker REOPENED - recovery attempt failed (${this.failureCount} total failures)`
            );
        } else if (this.failureCount >= CIRCUIT_BREAKER_THRESHOLD && this.circuitOpenedAt === null) {
            this.state = "open";
            this.circuitOpenedAt = new Date(); // fixed point — not updated on subsequent failures
            logger.warn(
                `[AudioAnalysisCleanup] Circuit breaker OPEN - ${this.failureCount} failures in window. ` +
                    `Pausing audio analysis queuing until analyzer shows signs of life.`
            );
        }
    }

    isCircuitOpen(): boolean {
        if (this.state === "open" && this.shouldAttemptReset()) {
            this.state = "half-open";
            logger.info(
                `[AudioAnalysisCleanup] Circuit breaker HALF-OPEN - attempting recovery after ${
                    CIRCUIT_BREAKER_WINDOW_MS / 60000
                } minute cooldown`
            );
        }
        return this.state === "open";
    }

    recordSuccess(): void {
        this.onSuccess();
    }

    resetCircuitBreaker(): void {
        this.state = "closed";
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.circuitOpenedAt = null;
        logger.debug("[AudioAnalysisCleanup] Circuit breaker reset");
    }

    async cleanupStaleProcessing(): Promise<{
        reset: number;
        permanentlyFailed: number;
        recovered: number;
    }> {
        // Raw SQL with server-side NOW() - INTERVAL to avoid Prisma's timezone bug.
        // analysisStartedAt is `timestamp without time zone` stored as CDT local time
        // (Python sends tz-aware UTC, PostgreSQL converts to session tz before storing).
        // Prisma serializes JS Date as naive ISO (no TZ suffix) which PostgreSQL interprets
        // as local time -- shifting the cutoff by the UTC offset and making every processing
        // track appear stale. NOW() - INTERVAL stays as timestamptz, and PostgreSQL correctly
        // casts the naive column via session tz when comparing.
        const staleTracks = await prisma.$queryRaw<Array<{
            id: string;
            analysisRetryCount: bigint | null;
            analysisStartedAt: Date | null;
            updatedAt: Date;
            filePath: string;
            title: string;
            artistName: string;
        }>>`
            SELECT t.id, t."analysisRetryCount", t."analysisStartedAt", t."updatedAt",
                   t."filePath", t.title, a.name as "artistName"
            FROM "Track" t
            JOIN "Album" al ON t."albumId" = al.id
            JOIN "Artist" a ON al."artistId" = a.id
            WHERE t."analysisStatus" = 'processing'
            AND (
                t."analysisStartedAt" < NOW() - INTERVAL '15 minutes'
                OR (t."analysisStartedAt" IS NULL AND t."updatedAt" < NOW() - INTERVAL '15 minutes')
            )
        `;

        if (staleTracks.length === 0) {
            return { reset: 0, permanentlyFailed: 0, recovered: 0 };
        }

        logger.debug(
            `[AudioAnalysisCleanup] Found ${staleTracks.length} stale tracks (processing > ${STALE_THRESHOLD_MINUTES} min)`
        );

        let resetCount = 0;
        let permanentlyFailedCount = 0;
        let recoveredCount = 0;

        for (const track of staleTracks) {
            const currentRetryCount = Number(track.analysisRetryCount) || 0;
            const trackName = `${track.artistName} - ${track.title}`;

            const existingEmbedding = await prisma.$queryRaw<[{ count: bigint }]>`
                SELECT COUNT(*) as count FROM track_embeddings WHERE track_id = ${track.id}
            `;

            if (Number(existingEmbedding[0]?.count) > 0) {
                // Re-check staleness at UPDATE time to avoid resetting a freshly-claimed track
                const recovered = await prisma.$executeRaw`
                    UPDATE "Track"
                    SET "analysisStatus" = 'completed',
                        "analysisError" = NULL,
                        "analysisStartedAt" = NULL,
                        "updatedAt" = NOW() AT TIME ZONE 'UTC'
                    WHERE id = ${track.id}
                    AND "analysisStatus" = 'processing'
                    AND (
                        "analysisStartedAt" < NOW() - INTERVAL '15 minutes'
                        OR ("analysisStartedAt" IS NULL AND "updatedAt" < NOW() - INTERVAL '15 minutes')
                    )
                `;
                if (recovered > 0) {
                    logger.info(
                        `[AudioAnalysisCleanup] Recovered stale track with existing embedding: ${trackName}`
                    );
                    recoveredCount++;
                }
                continue;
            }

            if (currentRetryCount >= MAX_RETRIES) {
                const errorMsg = `Exceeded ${MAX_RETRIES} retry attempts (stale processing)`;
                const failed = await prisma.$executeRaw`
                    UPDATE "Track"
                    SET "analysisStatus" = 'permanently_failed',
                        "analysisError" = ${errorMsg},
                        "analysisStartedAt" = NULL,
                        "updatedAt" = NOW() AT TIME ZONE 'UTC'
                    WHERE id = ${track.id}
                    AND "analysisStatus" = 'processing'
                    AND (
                        "analysisStartedAt" < NOW() - INTERVAL '15 minutes'
                        OR ("analysisStartedAt" IS NULL AND "updatedAt" < NOW() - INTERVAL '15 minutes')
                    )
                `;
                if (failed > 0) {
                    await enrichmentFailureService.recordFailure({
                        entityType: "audio",
                        entityId: track.id,
                        entityName: trackName,
                        errorMessage: `Analysis timed out ${MAX_RETRIES} times - track may be corrupted or unsupported`,
                        errorCode: "MAX_RETRIES_EXCEEDED",
                        metadata: {
                            filePath: track.filePath,
                            retryCount: currentRetryCount,
                        },
                    });
                    logger.warn(
                        `[AudioAnalysisCleanup] Permanently failed: ${trackName}`
                    );
                    permanentlyFailedCount++;
                }
            } else {
                const resetMsg = `Reset after stale processing (attempt ${currentRetryCount}/${MAX_RETRIES})`;
                const reset = await prisma.$executeRaw`
                    UPDATE "Track"
                    SET "analysisStatus" = 'pending',
                        "analysisStartedAt" = NULL,
                        "analysisError" = ${resetMsg},
                        "updatedAt" = NOW() AT TIME ZONE 'UTC'
                    WHERE id = ${track.id}
                    AND "analysisStatus" = 'processing'
                    AND (
                        "analysisStartedAt" < NOW() - INTERVAL '15 minutes'
                        OR ("analysisStartedAt" IS NULL AND "updatedAt" < NOW() - INTERVAL '15 minutes')
                    )
                `;
                if (reset > 0) {
                    logger.debug(
                        `[AudioAnalysisCleanup] Reset for retry (${currentRetryCount}/${MAX_RETRIES}): ${trackName}`
                    );
                    resetCount++;
                }
            }
        }

        if (resetCount > 0) {
            this.onFailure(resetCount, permanentlyFailedCount);
        }

        if (recoveredCount > 0) {
            this.onSuccess();
        }

        logger.debug(
            `[AudioAnalysisCleanup] Cleanup complete: ${resetCount} reset, ${permanentlyFailedCount} permanently failed, ${recoveredCount} recovered`
        );

        return { reset: resetCount, permanentlyFailed: permanentlyFailedCount, recovered: recoveredCount };
    }

    async getStats(): Promise<{
        pending: number;
        processing: number;
        completed: number;
        failed: number;
        permanentlyFailed: number;
        circuitOpen: boolean;
        circuitState: CircuitState;
        failureCount: number;
    }> {
        const [pending, processing, completed, failed, permanentlyFailed] = await Promise.all([
            prisma.track.count({ where: { analysisStatus: "pending" } }),
            prisma.track.count({ where: { analysisStatus: "processing" } }),
            prisma.track.count({ where: { analysisStatus: "completed" } }),
            prisma.track.count({ where: { analysisStatus: "failed" } }),
            prisma.track.count({ where: { analysisStatus: "permanently_failed" } }),
        ]);

        return {
            pending,
            processing,
            completed,
            failed,
            permanentlyFailed,
            circuitOpen: this.state === "open",
            circuitState: this.state,
            failureCount: this.failureCount,
        };
    }
}

export const audioAnalysisCleanupService = new AudioAnalysisCleanupService();
