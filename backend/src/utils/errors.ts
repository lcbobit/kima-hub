import { Response } from "express";
import { logger } from "./logger";

/**
 * Log the full error server-side and return a generic message to the client.
 * Prevents leaking internal details (stack traces, DB errors, file paths).
 */
export function safeError(res: Response, context: string, error: unknown, statusCode = 500): void {
    logger.error(`${context}:`, error);
    res.status(statusCode).json({ error: "Internal server error" });
}

/**
 * Error categories for classification
 */
export enum ErrorCategory {
    RECOVERABLE = "RECOVERABLE", // Retry might succeed
    TRANSIENT = "TRANSIENT", // Temporary issue, will resolve
    FATAL = "FATAL", // Cannot continue
}

/**
 * Error codes for specific error types
 */
export enum ErrorCode {
    // Configuration errors
    MUSIC_PATH_NOT_ACCESSIBLE = "MUSIC_PATH_NOT_ACCESSIBLE",
    TRANSCODE_CACHE_NOT_WRITABLE = "TRANSCODE_CACHE_NOT_WRITABLE",
    FFMPEG_NOT_FOUND = "FFMPEG_NOT_FOUND",
    INVALID_CONFIG = "INVALID_CONFIG",

    // File system errors
    FILE_NOT_FOUND = "FILE_NOT_FOUND",
    FILE_READ_ERROR = "FILE_READ_ERROR",
    DISK_FULL = "DISK_FULL",
    PERMISSION_DENIED = "PERMISSION_DENIED",

    // Transcoding errors
    TRANSCODE_FAILED = "TRANSCODE_FAILED",

    // Database errors
    DB_QUERY_ERROR = "DB_QUERY_ERROR",
}

/**
 * Custom application error class
 */
export class AppError extends Error {
    constructor(
        public code: ErrorCode,
        public category: ErrorCategory,
        message: string,
        public details?: any
    ) {
        super(message);
        this.name = "AppError";
        Object.setPrototypeOf(this, AppError.prototype);
    }

    toJSON() {
        return {
            name: this.name,
            code: this.code,
            category: this.category,
            message: this.message,
            details: this.details,
        };
    }
}

export class UserFacingError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
    public code?: string
  ) {
    super(message);
    this.name = 'UserFacingError';
    Object.setPrototypeOf(this, UserFacingError.prototype);
  }
}

export class IntegrationError extends Error {
  constructor(
    message: string,
    public integration: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'IntegrationError';
    Object.setPrototypeOf(this, IntegrationError.prototype);
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

