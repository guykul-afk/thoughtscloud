import { FirebaseStorageService } from './FirebaseStorageService';
import { generateTextEmbedding } from './ai';

export async function runVectorMigration(apiKey: string): Promise<void> {
    if (!apiKey) {
        console.error("[Vector Migration] API key is missing.");
        return;
    }

    try {
        console.log("[Vector Migration] Starting migration...");
        const entries = await FirebaseStorageService.loadAllEntries();
        const entriesToMigrate = entries.filter(e => !e.embedding || e.embedding.length === 0);
        
        console.log(`[Vector Migration] Found ${entriesToMigrate.length} entries out of ${entries.length} that need embeddings.`);
        
        if (entriesToMigrate.length === 0) {
            console.log("[Vector Migration] All entries are already migrated.");
            return;
        }

        let successCount = 0;
        let failCount = 0;

        for (const entry of entriesToMigrate) {
            try {
                console.log(`[Vector Migration] Processing entry ${entry.id} (${new Date(entry.timestamp).toLocaleDateString()})...`);
                const embedding = await generateTextEmbedding(entry.transcript, apiKey);
                
                // Update the entry in memory and save it back
                const updatedEntry = { ...entry, embedding };
                await FirebaseStorageService.saveEntry(updatedEntry, apiKey);
                successCount++;
                
                // Add a small delay to avoid hitting API rate limits
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (err) {
                console.error(`[Vector Migration] Failed to process entry ${entry.id}:`, err);
                failCount++;
            }
        }

        console.log(`[Vector Migration] Completed. Success: ${successCount}, Failed: ${failCount}.`);
    } catch (error) {
        console.error("[Vector Migration] Migration failed:", error);
    }
}
