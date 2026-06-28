import { OkfStorageService } from './OkfStorageService';
import type { DiaryEntry, KnowledgeGraph } from '../store';

const MIGRATION_FLAG = 'okf-migration-done';
const OLD_STORAGE_KEY = 'ai-diary-storage';

export async function runOkfMigration(): Promise<void> {
    const isMigrated = localStorage.getItem(MIGRATION_FLAG);
    
    if (isMigrated === 'true') {
        return; // Migration already completed
    }

    const oldDataStr = localStorage.getItem(OLD_STORAGE_KEY);
    if (!oldDataStr) {
        // No old data, just set flag
        localStorage.setItem(MIGRATION_FLAG, 'true');
        return;
    }

    try {
        console.log('[OKF Migration] Starting migration from localStorage JSON to OKF OPFS...');
        const parsedData = JSON.parse(oldDataStr);
        const state = parsedData.state;

        if (!state) {
            console.warn('[OKF Migration] Invalid state structure in localStorage');
            return;
        }

        // Migrate Entries
        if (state.entries && Array.isArray(state.entries)) {
            for (const entry of state.entries as DiaryEntry[]) {
                await OkfStorageService.saveEntry(entry);
            }
            console.log(`[OKF Migration] Migrated ${state.entries.length} entries.`);
        }

        // Migrate Knowledge Graph
        if (state.knowledgeGraph && state.knowledgeGraph.nodes && state.knowledgeGraph.edges) {
            await OkfStorageService.saveKnowledgeGraph(state.knowledgeGraph as KnowledgeGraph);
            console.log(`[OKF Migration] Migrated knowledge graph.`);
        }

        // Migrate Insights
        await OkfStorageService.saveInsights({
            weeklyInsight: state.weeklyInsight,
            majorInsights: state.majorInsights
        });
        console.log(`[OKF Migration] Migrated insights.`);

        // Set flag to prevent future migrations
        localStorage.setItem(MIGRATION_FLAG, 'true');
        console.log('[OKF Migration] Completed successfully! Old data remains in localStorage as backup.');

    } catch (e) {
        console.error('[OKF Migration] Failed to migrate data:', e);
    }
}

