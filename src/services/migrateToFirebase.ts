import { OkfStorageService } from './OkfStorageService';
import { FirebaseStorageService } from './FirebaseStorageService';


export async function runMigrationToFirebase() {
    console.log("Starting migration from OPFS to Firebase...");
    try {
        // Ensure user is authenticated in Firebase
        await FirebaseStorageService.init();

        // 1. Migrate Entries
        const entries = await OkfStorageService.loadAllEntries();
        console.log(`Found ${entries.length} entries to migrate.`);
        for (const entry of entries) {
            await FirebaseStorageService.saveEntry(entry);
        }

        // 2. Migrate Knowledge Graph
        const graph = await OkfStorageService.loadKnowledgeGraph();
        console.log(`Found ${graph.nodes.length} nodes to migrate.`);
        if (graph.nodes.length > 0) {
            await FirebaseStorageService.saveKnowledgeGraph(graph);
        }

        // 3. Migrate Insights
        const insights = await OkfStorageService.loadInsights();
        if (insights && (insights.weeklyInsight || (insights.majorInsights && insights.majorInsights.length > 0))) {
            console.log("Migrating insights...");
            await FirebaseStorageService.saveInsights(insights);
        }

        console.log("Migration completed successfully!");
        
        // Optional: you can set a flag in localStorage so it doesn't run again
        localStorage.setItem('has_migrated_to_firebase', 'true');
        return true;
    } catch (err) {
        console.error("Migration failed:", err);
        return false;
    }
}
