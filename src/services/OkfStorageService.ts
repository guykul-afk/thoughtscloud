import yaml from 'js-yaml';
import type { DiaryEntry, KnowledgeGraph } from '../store';

const OKF_DIR = 'okf_data';
const ENTRIES_DIR = 'entries';
const GRAPH_DIR = 'knowledge_graph';

export class OkfStorageService {
    private static async getRootDirectory(): Promise<FileSystemDirectoryHandle> {
        const root = await navigator.storage.getDirectory();
        return await root.getDirectoryHandle(OKF_DIR, { create: true });
    }

    private static async getDirectory(pathName: string): Promise<FileSystemDirectoryHandle> {
        const root = await this.getRootDirectory();
        return await root.getDirectoryHandle(pathName, { create: true });
    }

    private static async writeFile(dirHandle: FileSystemDirectoryHandle, filename: string, content: string): Promise<void> {
        const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
    }

    private static async readFile(dirHandle: FileSystemDirectoryHandle, filename: string): Promise<string> {
        const fileHandle = await dirHandle.getFileHandle(filename);
        const file = await fileHandle.getFile();
        return await file.text();
    }

    private static serializeToMarkdown(frontmatter: any, content: string): string {
        const yamlStr = yaml.dump(frontmatter);
        return `---\n${yamlStr}---\n\n${content}`;
    }

    private static parseMarkdown(markdown: string): { frontmatter: any, content: string } {
        const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (match) {
            try {
                const frontmatter = yaml.load(match[1]);
                return { frontmatter, content: match[2].trim() };
            } catch (e) {
                console.error("Failed to parse YAML", e);
            }
        }
        return { frontmatter: {}, content: markdown };
    }

    static async saveEntry(entry: DiaryEntry): Promise<void> {
        const entriesDir = await this.getDirectory(ENTRIES_DIR);
        const date = new Date(entry.timestamp).toISOString().split('T')[0];
        const filename = `${date}_${entry.id}.md`;

        const frontmatter = {
            id: entry.id,
            date: date,
            timestamp: entry.timestamp,
            topics: entry.topics || [],
            insights: entry.insights || [],
            triples: entry.triples || [],
            mood: entry.mood || 'ניטרלי',
            open_threads: (entry.openThreads || []).filter(t => !t.isResolved).map(t => t.text)
        };

        const markdownContent = `# Diary Entry: ${date}\n\n${entry.transcript}`;
        const fileContent = this.serializeToMarkdown(frontmatter, markdownContent);

        await this.writeFile(entriesDir, filename, fileContent);

    }

    static async deleteEntry(id: string, timestamp: number): Promise<void> {
        const entriesDir = await this.getDirectory(ENTRIES_DIR);
        const date = new Date(timestamp).toISOString().split('T')[0];
        const filename = `${date}_${id}.md`;

        try {
            await entriesDir.removeEntry(filename);
        } catch (e) {
            console.error("Failed to delete entry locally from OPFS", e);
        }

    }

    static async saveKnowledgeGraph(graph: KnowledgeGraph): Promise<void> {
        const graphDir = await this.getDirectory(GRAPH_DIR);

        for (const node of graph.nodes) {
            const filename = `${node.id}.md`;
            const relatedEdges = graph.edges.filter(e => e.source === node.id || e.target === node.id);
            const links = relatedEdges.map(e => {
                const targetNode = e.source === node.id ? e.target : e.source;
                return `- [[${targetNode}]] (${e.relation})`;
            });

            const frontmatter = {
                type: node.type || 'Concept',
                id: node.id,
                weight: node.val || 1
            };

            let content = `# ${node.label}\n\n`;
            if (links.length > 0) {
                content += `## Relations\n${links.join('\n')}\n`;
            }

            const fileContent = this.serializeToMarkdown(frontmatter, content);
            await this.writeFile(graphDir, filename, fileContent);

            }
    }

    static async saveInsights(insights: { weeklyInsight?: string, majorInsights?: string[] }): Promise<void> {
        const rootDir = await this.getRootDirectory();

        const frontmatter = { type: 'Insights' };
        let content = `# Application Insights\n\n`;

        if (insights.weeklyInsight) {
            content += `## Weekly Insight\n${insights.weeklyInsight}\n\n`;
        }
        if (insights.majorInsights && insights.majorInsights.length > 0) {
            content += `## Major Insights\n`;
            insights.majorInsights.forEach(insight => {
                content += `- ${insight}\n`;
            });
        }

        const fileContent = this.serializeToMarkdown(frontmatter, content);
        await this.writeFile(rootDir, 'insights.md', fileContent);

    }

    static async loadAllEntries(): Promise<DiaryEntry[]> {
        const entriesDir = await this.getDirectory(ENTRIES_DIR);
        const entries: DiaryEntry[] = [];
        
        // OPFS iteration
        // @ts-ignore
        for await (const [name, handle] of entriesDir.entries()) {
            if (handle.kind === 'file' && name.endsWith('.md')) {
                const text = await this.readFile(entriesDir, name);
                const { frontmatter, content } = this.parseMarkdown(text);
                
                // Convert markdown body back to transcript (strip title)
                const transcriptMatch = content.match(/# Diary Entry: .*?\n\n([\s\S]*)/);
                const transcript = transcriptMatch ? transcriptMatch[1] : content;

                entries.push({
                    id: frontmatter.id,
                    timestamp: frontmatter.timestamp,
                    transcript: transcript.trim(),
                    topics: frontmatter.topics || [],
                    insights: frontmatter.insights || [],
                    triples: frontmatter.triples || [],
                    mood: frontmatter.mood || 'ניטרלי',
                    openThreads: (frontmatter.open_threads || []).map((t: string) => ({ text: t, isResolved: false }))
                });
            }
        }
        
        return entries.sort((a, b) => b.timestamp - a.timestamp);
    }

    static async loadKnowledgeGraph(): Promise<KnowledgeGraph> {
        const graphDir = await this.getDirectory(GRAPH_DIR);
        const nodes: any[] = [];
        const edges: any[] = [];
        
        try {
            // @ts-ignore
            for await (const [name, handle] of graphDir.entries()) {
                if (handle.kind === 'file' && name.endsWith('.md')) {
                    const text = await this.readFile(graphDir, name);
                    const { frontmatter, content } = this.parseMarkdown(text);
                    
                    const nodeId = frontmatter.id;
                    const labelMatch = content.match(/# (.*?)\n/);
                    const label = labelMatch ? labelMatch[1] : nodeId;
                    
                    nodes.push({
                        id: nodeId,
                        label: label,
                        val: frontmatter.weight || 1
                    });
                    
                    const relationLines = content.match(/- \[\[(.*?)\]\] \((.*?)\)/g) || [];
                    relationLines.forEach(line => {
                        const match = line.match(/- \[\[(.*?)\]\] \((.*?)\)/);
                        if (match) {
                            const targetNode = match[1];
                            const relation = match[2];
                            const exists = edges.some(e => 
                                (e.source === nodeId && e.target === targetNode && e.relation === relation) ||
                                (e.source === targetNode && e.target === nodeId && e.relation === relation)
                            );
                            if (!exists) {
                                edges.push({
                                    source: nodeId,
                                    target: targetNode,
                                    relation: relation,
                                    timestamp: Date.now()
                                });
                            }
                        }
                    });
                }
            }
        } catch (e) {
            console.error("Failed to load knowledge graph from OPFS", e);
        }
        
        return { nodes, edges };
    }

    static async loadInsights(): Promise<{ weeklyInsight?: string, majorInsights?: string[] } | null> {
        const rootDir = await this.getRootDirectory();
        try {
            const text = await this.readFile(rootDir, 'insights.md');
            const { content } = this.parseMarkdown(text);
            
            const weeklyInsightMatch = content.match(/## Weekly Insight\n([\s\S]*?)(?:\n\n##|$)/);
            const weeklyInsight = weeklyInsightMatch ? weeklyInsightMatch[1].trim() : '';
            
            const majorInsightsMatch = content.match(/## Major Insights\n([\s\S]*?)$/);
            const majorInsights: string[] = [];
            if (majorInsightsMatch) {
                const lines = majorInsightsMatch[1].split('\n');
                lines.forEach(line => {
                    const cleaned = line.replace(/^-\s+/, '').trim();
                    if (cleaned) {
                        majorInsights.push(cleaned);
                    }
                });
            }
            
            return { weeklyInsight, majorInsights };
        } catch (e) {
            return null;
        }
    }

    static async writeRawFile(folderName: 'entries' | 'knowledge_graph' | 'root', filename: string, content: string): Promise<void> {
        let dirHandle: FileSystemDirectoryHandle;
        if (folderName === 'root') {
            dirHandle = await this.getRootDirectory();
        } else {
            dirHandle = await this.getDirectory(folderName === 'entries' ? ENTRIES_DIR : GRAPH_DIR);
        }
        await this.writeFile(dirHandle, filename, content);
    }

}
