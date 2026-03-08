-- CreateTable
CREATE TABLE "subsonic_bookmarks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "comment" TEXT,
    "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subsonic_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subsonic_bookmarks_userId_trackId_key" ON "subsonic_bookmarks"("userId", "trackId");

-- AddForeignKey
ALTER TABLE "subsonic_bookmarks" ADD CONSTRAINT "subsonic_bookmarks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subsonic_bookmarks" ADD CONSTRAINT "subsonic_bookmarks_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
