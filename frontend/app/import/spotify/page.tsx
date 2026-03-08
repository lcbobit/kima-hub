"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";

function SpotifyRedirect() {
    const searchParams = useSearchParams();
    const router = useRouter();

    useEffect(() => {
        const url = searchParams.get("url");
        router.replace(url ? `/import/playlist?url=${encodeURIComponent(url)}` : "/import/playlist");
    }, [searchParams, router]);

    return null;
}

export default function SpotifyRedirectPage() {
    return <Suspense><SpotifyRedirect /></Suspense>;
}
