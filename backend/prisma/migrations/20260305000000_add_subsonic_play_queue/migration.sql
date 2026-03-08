-- CreateTable
CREATE TABLE "subsonic_play_queue" (
    "userId" TEXT NOT NULL,
    "current" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "trackIds" JSONB NOT NULL DEFAULT '[]',
    "changedBy" TEXT NOT NULL DEFAULT '',
    "changed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subsonic_play_queue_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "subsonic_play_queue" ADD CONSTRAINT "subsonic_play_queue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
