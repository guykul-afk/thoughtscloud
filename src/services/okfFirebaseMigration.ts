import { storage } from './firebase';
import { ref, uploadString } from 'firebase/storage';
import yaml from 'js-yaml';

const MIGRATION_FLAG = 'okf-firebase-storage-migration-done';

const jsonToYamlFrontmatter = (obj: any) => {
    const yamlStr = yaml.dump(obj);
    return `---\n${yamlStr}---\n\n`;
};

export async function triggerOkfFirebaseMigration(uid: string): Promise<void> {
    const isMigrated = localStorage.getItem(MIGRATION_FLAG);
    if (isMigrated === 'true') {
        console.log('[OKF Firebase Migration] Already done. Skipping.');
        return;
    }

    try {
        console.log('[OKF Firebase Migration] Checking for diary_state.json...');
        const res = await fetch('/diary_state.json');
        if (!res.ok) {
            console.log('[OKF Firebase Migration] No local diary_state.json found in public directory. Skipping.');
            localStorage.setItem(MIGRATION_FLAG, 'true');
            return;
        }
        
        console.log('[OKF Firebase Migration] Parsing diary_state.json...');
        const data = await res.json();
        const state = data.state || data;
        
        const entries = state.entries || [];
        const kgNodes = state.knowledgeGraph?.nodes || [];
        const kgEdges = state.knowledgeGraph?.edges || [];
        
        console.log(`[OKF Firebase Migration] Starting upload for ${entries.length} entries, ${kgNodes.length} nodes to Firebase Storage for UID: ${uid}...`);
        
        // Upload entries
        for (const entry of entries) {
            const date = new Date(entry.timestamp).toISOString().split('T')[0];
            const filename = `${date}_${entry.id}.md`;
            
            const frontmatter = {
                id: entry.id,
                date: date,
                topics: entry.topics || [],
                insights: entry.insights || [],
                triples: entry.triples || [],
                mood: entry.mood || 'ניטרלי',
                open_threads: (entry.openThreads || []).filter((t: any) => !t.isResolved).map((t: any) => t.text)
            };

            const content = `${jsonToYamlFrontmatter(frontmatter)}# Diary Entry: ${date}\n\n${entry.transcript}\n`;
            const storageRef = ref(storage, `users/${uid}/okf_data/entries/${filename}`);
            await uploadString(storageRef, content, 'raw');
        }
        console.log('[OKF Firebase Migration] Entries uploaded successfully to Storage.');

        // Upload knowledge graph nodes
        for (const node of kgNodes) {
            const filename = `${node.id}.md`;
            const relatedEdges = kgEdges.filter((e: any) => e.source === node.id || e.target === node.id);
            const links = relatedEdges.map((e: any) => {
                const targetNode = e.source === node.id ? e.target : e.source;
                return `- [[${targetNode}]] (${e.relation})`;
            });

            const frontmatter = {
                type: 'Concept',
                id: node.id,
                weight: node.val || 1
            };

            let content = `${jsonToYamlFrontmatter(frontmatter)}# ${node.label}\n\n`;
            if (links.length > 0) {
                content += `## Relations\n${links.join('\n')}\n`;
            }
            
            const storageRef = ref(storage, `users/${uid}/okf_data/knowledge_graph/${filename}`);
            await uploadString(storageRef, content, 'raw');
        }
        console.log('[OKF Firebase Migration] Knowledge graph nodes uploaded successfully to Storage.');

        // Upload insights
        let insightsContent = `---\ntype: Insights\n---\n\n# Application Insights\n\n`;
        if (state.weeklyInsight) {
            insightsContent += `## Weekly Insight\n${state.weeklyInsight}\n\n`;
        }
        if (state.majorInsights && state.majorInsights.length > 0) {
            insightsContent += `## Major Insights\n`;
            state.majorInsights.forEach((insight: string) => {
                insightsContent += `- ${insight}\n`;
            });
        }
        const insightsRef = ref(storage, `users/${uid}/okf_data/insights.md`);
        await uploadString(insightsRef, insightsContent, 'raw');
        console.log('[OKF Firebase Migration] Insights uploaded successfully to Storage.');

        localStorage.setItem(MIGRATION_FLAG, 'true');
        console.log('[OKF Firebase Migration] OKF Firebase Storage Migration completed successfully!');
    } catch (error) {
        console.error('[OKF Firebase Migration] Failed during migration:', error);
    }
}
