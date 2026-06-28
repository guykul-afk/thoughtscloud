const fs = require('fs');
const path = require('path');

// Helper to convert object to YAML frontmatter
function jsonToYamlFrontmatter(obj) {
    let yaml = '---\n';
    for (const [key, value] of Object.entries(obj)) {
        if (Array.isArray(value)) {
            yaml += `${key}:\n`;
            value.forEach(item => {
                yaml += `  - ${typeof item === 'object' ? JSON.stringify(item) : item}\n`;
            });
        } else {
            yaml += `${key}: ${value}\n`;
        }
    }
    yaml += '---\n';
    return yaml;
}

function convertToOKF(dataJsonPath) {
    const outputDir = path.join(__dirname, 'okf_export');
    
    // Create output directories
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }
    const entriesDir = path.join(outputDir, 'entries');
    if (!fs.existsSync(entriesDir)) fs.mkdirSync(entriesDir);
    
    const graphDir = path.join(outputDir, 'knowledge_graph');
    if (!fs.existsSync(graphDir)) fs.mkdirSync(graphDir);

    let rawData;
    try {
        rawData = fs.readFileSync(dataJsonPath, 'utf-8');
    } catch (e) {
        console.log(`[!] Could not read ${dataJsonPath}. Let's create some dummy data to test the OKF structure.`);
        rawData = JSON.stringify({
            state: {
                entries: [
                    {
                        id: 'dummy1',
                        timestamp: Date.now() - 86400000,
                        transcript: "Today I focused on building the new AI feature. It was challenging but I made good progress.",
                        topics: ["Work", "AI", "Development"],
                        openThreads: [{text: "Need to fix the bug in the UI", isResolved: false}]
                    },
                    {
                        id: 'dummy2',
                        timestamp: Date.now(),
                        transcript: "Had a great family dinner. Feeling refreshed.",
                        topics: ["Family", "Relaxation"],
                        openThreads: []
                    }
                ],
                knowledgeGraph: {
                    nodes: [
                        { id: 'work', label: 'Work', val: 1.5 },
                        { id: 'ai', label: 'AI', val: 1.2 },
                        { id: 'family', label: 'Family', val: 2.0 }
                    ],
                    edges: [
                        { source: 'work', target: 'ai', relation: 'involves', timestamp: Date.now() }
                    ]
                },
                weeklyInsight: "Balancing work and family has been successful this week.",
                majorInsights: ["AI development is accelerating"]
            }
        });
    }

    const appState = JSON.parse(rawData);
    // Zustand persist stores data under 'state'
    const state = appState.state || appState;

    // 1. Process Entries
    if (state.entries) {
        state.entries.forEach(entry => {
            const date = new Date(entry.timestamp).toISOString().split('T')[0];
            const filename = path.join(entriesDir, `${date}_${entry.id}.md`);
            
            const frontmatter = {
                id: entry.id,
                date: date,
                topics: entry.topics || [],
                open_threads: (entry.openThreads || []).filter(t => !t.isResolved).map(t => t.text)
            };

            const content = `${jsonToYamlFrontmatter(frontmatter)}\n# Diary Entry: ${date}\n\n${entry.transcript}\n`;
            fs.writeFileSync(filename, content);
        });
        console.log(`[-] Exported ${state.entries.length} entries to OKF markdown files.`);
    }

    // 2. Process Knowledge Graph Nodes
    if (state.knowledgeGraph && state.knowledgeGraph.nodes) {
        state.knowledgeGraph.nodes.forEach(node => {
            const filename = path.join(graphDir, `${node.id}.md`);
            
            // Find related edges
            const relatedEdges = (state.knowledgeGraph.edges || []).filter(e => e.source === node.id || e.target === node.id);
            const links = relatedEdges.map(e => {
                const targetNode = e.source === node.id ? e.target : e.source;
                return `- [[${targetNode}]] (${e.relation})`;
            });

            const frontmatter = {
                type: 'Concept',
                id: node.id,
                weight: node.val || 1
            };

            let content = `${jsonToYamlFrontmatter(frontmatter)}\n# ${node.label}\n\n`;
            if (links.length > 0) {
                content += `## Relations\n${links.join('\n')}\n`;
            }

            fs.writeFileSync(filename, content);
        });
        console.log(`[-] Exported ${state.knowledgeGraph.nodes.length} knowledge graph nodes to OKF markdown files.`);
    }

    // 3. Process General Insights
    const insightsFilename = path.join(outputDir, `insights.md`);
    let insightsContent = `---\ntype: Insights\n---\n# Application Insights\n\n`;
    
    if (state.weeklyInsight) {
        insightsContent += `## Weekly Insight\n${state.weeklyInsight}\n\n`;
    }
    if (state.majorInsights && state.majorInsights.length > 0) {
        insightsContent += `## Major Insights\n`;
        state.majorInsights.forEach(insight => {
            insightsContent += `- ${insight}\n`;
        });
    }
    fs.writeFileSync(insightsFilename, insightsContent);
    console.log(`[-] Exported general insights to insights.md.`);

    console.log(`\n[SUCCESS] OKF Export complete! Check the 'okf_export' folder.`);
}

const dataPath = path.join(__dirname, 'data.json');
convertToOKF(dataPath);
