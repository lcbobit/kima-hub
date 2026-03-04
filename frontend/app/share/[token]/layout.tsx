import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Shared Music - Kima",
    description: "Listen to shared music on Kima. Self-hosted music streaming. https://github.com/Chevron7Locked/kima-hub",
    openGraph: {
        title: "Shared Music - Kima",
        description: "Listen to shared music on Kima, a self-hosted music streaming platform.",
        siteName: "Kima",
        url: "https://github.com/Chevron7Locked/kima-hub",
        type: "music.song",
    },
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
    return children;
}
