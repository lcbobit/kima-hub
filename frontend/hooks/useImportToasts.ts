import { useEffect } from "react";
import { useToast } from "@/lib/toast-context";

export function useImportToasts() {
    const { toast } = useToast();

    useEffect(() => {
        const handler = (e: Event) => {
            const { status, playlistName, error } = (e as CustomEvent).detail;
            const name = playlistName || "playlist";
            if (status === "started") {
                toast.success("Import started -- running in the background.");
            } else if (status === "completed") {
                toast.success(`Import complete: "${name}"`);
            } else if (status === "failed") {
                toast.error(`Import failed: ${error || "Unknown error"}`);
            } else if (status === "cancelled") {
                toast.info(`Import cancelled: "${name}"`);
            }
        };

        window.addEventListener("import-status-change", handler);
        return () => window.removeEventListener("import-status-change", handler);
    }, [toast]);
}
