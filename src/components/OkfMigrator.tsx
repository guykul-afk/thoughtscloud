import React, { useState } from 'react';
import { auth, storage } from '../services/firebase';
import { ref, uploadString } from 'firebase/storage';
import yaml from 'js-yaml';

export const OkfMigrator: React.FC = () => {
    const [status, setStatus] = useState<string>('Idle');
    const [progress, setProgress] = useState<{current: number, total: number} | null>(null);

    const jsonToYamlFrontmatter = (obj: any) => {
        const yamlStr = yaml.dump(obj);
        return `---\n${yamlStr}---\n\n`;
    };

    const runMigration = async () => {
        try {
            if (!auth.currentUser) {
                setStatus('Error: Not authenticated. Please log in first.');
                return;
            }
            const uid = auth.currentUser.uid;
            setStatus('Fetching diary_state.json...');
            
            const res = await fetch('/diary_state.json');
            if (!res.ok) throw new Error('Failed to fetch diary_state.json');
            const data = await res.json();
            
            const state = data.state || data;
            
            const entries = state.entries || [];
            const kgNodes = state.knowledgeGraph?.nodes || [];
            const kgEdges = state.knowledgeGraph?.edges || [];
            
            let totalTasks = entries.length + kgNodes.length + 1; // +1 for insights
            let currentTask = 0;
            
            setStatus('Uploading Entries...');
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
                
                currentTask++;
                setProgress({ current: currentTask, total: totalTasks });
            }

            setStatus('Uploading Knowledge Graph...');
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
                
                currentTask++;
                setProgress({ current: currentTask, total: totalTasks });
            }

            setStatus('Uploading Insights...');
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
            currentTask++;
            setProgress({ current: currentTask, total: totalTasks });

            setStatus('Migration Complete!');
            setTimeout(() => {
                setStatus('Idle');
                setProgress(null);
            }, 5000);

        } catch (e: any) {
            console.error(e);
            setStatus(`Error: ${e.message}`);
        }
    };

    return (
        <div className="fixed top-4 left-4 z-[9999] p-5 border border-white/30 rounded-2xl bg-slate-900 text-white max-w-md shadow-2xl">
            <h2 className="text-xl font-bold mb-2">OKF Firebase Storage Migration</h2>
            <p className="text-sm mb-4">Migrate historical local JSON data to Firebase Storage (OKF Method)</p>
            
            <button 
                onClick={runMigration}
                disabled={status !== 'Idle' && status !== 'Migration Complete!'}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-bold py-2 px-4 rounded mb-2 transition-colors cursor-pointer"
            >
                Run Migration
            </button>
            
            <div className="text-sm">Status: {status}</div>
            
            {progress && (
                <div className="mt-2">
                    <div className="w-full bg-gray-700 rounded-full h-2.5">
                        <div className="bg-blue-500 h-2.5 rounded-full transition-all" style={{ width: `${(progress.current / progress.total) * 100}%` }}></div>
                    </div>
                    <div className="text-xs mt-1 text-center">{progress.current} / {progress.total}</div>
                </div>
            )}
        </div>
    );
};
