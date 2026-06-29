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
    const pathsToTry = [
        dataJsonPath,
        path.join(__dirname, 'public', 'diary_state.json'),
        path.join(__dirname, 'diary_state (5).json'),
        path.join(__dirname, 'diary_state.json')
    ];

    for (const p of pathsToTry) {
        if (fs.existsSync(p)) {
            try {
                rawData = fs.readFileSync(p, 'utf-8');
                console.log(`[-] Successfully read data from: ${p}`);
                break;
            } catch (err) {
                console.warn(`[!] Failed to read path: ${p}`, err);
            }
        }
    }

    if (!rawData) {
        console.log(`[!] Could not read any data file. Creating dummy data.`);
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
                        transcript: "Had a great family dinner with Tali.",
                        topics: ["Family", "Relaxation"],
                        openThreads: []
                    }
                ],
                knowledgeGraph: {
                    nodes: [
                        { id: 'work', label: 'Work', val: 1.5, type: 'Concept' },
                        { id: 'ai', label: 'AI', val: 1.2, type: 'Concept' },
                        { id: 'family', label: 'Family', val: 2.0, type: 'Concept' },
                        { id: 'טלי', label: 'טלי', val: 1.0, type: 'Person' }
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

    // Reconstruct knowledge graph from entry triples if it is missing or empty
    if (!state.knowledgeGraph || !state.knowledgeGraph.nodes || state.knowledgeGraph.nodes.length === 0) {
        console.log("[-] Knowledge graph empty/missing. Reconstructing from entry triples...");
        const nodesMap = new Map();
        const edges = [];
        const entries = state.entries || [];
        const peopleList = ['טלי', 'גיל', 'איתן', 'נוה', 'אמא', 'אבא', 'אסף'];

        entries.forEach(entry => {
            if (!entry.triples) return;
            entry.triples.forEach(t => {
                let subject = '';
                let relation = '';
                let object = '';
                let subjectType = 'Other';
                let objectType = 'Other';

                if (Array.isArray(t)) {
                    subject = t[0] || '';
                    relation = t[1] || '';
                    object = t[2] || '';
                } else if (typeof t === 'object') {
                    subject = t.subject || '';
                    relation = t.relation || '';
                    object = t.object || '';
                    subjectType = t.subjectType || 'Other';
                    objectType = t.objectType || 'Other';
                }

                subject = subject.trim();
                object = object.trim();
                relation = relation.trim();

                if (!subject || !object) return;

                // Determine if a node represents a Person
                if (peopleList.some(p => subject.includes(p)) || subjectType === 'Person') {
                    subjectType = 'Person';
                }
                if (peopleList.some(p => object.includes(p)) || objectType === 'Person') {
                    objectType = 'Person';
                }

                if (!nodesMap.has(subject)) {
                    nodesMap.set(subject, { id: subject, label: subject, val: 1, type: subjectType });
                } else {
                    const node = nodesMap.get(subject);
                    node.val += 0.1;
                    if (subjectType !== 'Other') node.type = subjectType;
                }

                if (!nodesMap.has(object)) {
                    nodesMap.set(object, { id: object, label: object, val: 1, type: objectType });
                } else {
                    const node = nodesMap.get(object);
                    node.val += 0.1;
                    if (objectType !== 'Other') node.type = objectType;
                }

                edges.push({
                    source: subject,
                    target: object,
                    relation: relation,
                    timestamp: entry.timestamp
                });
            });
        });

        state.knowledgeGraph = {
            nodes: Array.from(nodesMap.values()),
            edges: edges
        };
        console.log(`[-] Reconstructed knowledge graph with ${state.knowledgeGraph.nodes.length} nodes and ${state.knowledgeGraph.edges.length} edges.`);
    }

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
            // Sanitize node ID for filename (avoiding forward slashes, etc.)
            const safeNodeId = node.id.replace(/[\/\\?%*:|"<>\s]/g, '_');
            const filename = path.join(graphDir, `${safeNodeId}.md`);
            
            // Find related edges
            const relatedEdges = (state.knowledgeGraph.edges || []).filter(e => e.source === node.id || e.target === node.id);
            const links = relatedEdges.map(e => {
                const targetNode = e.source === node.id ? e.target : e.source;
                const safeTargetNode = targetNode.replace(/[\/\\?%*:|"<>\s]/g, '_');
                return `- [[${safeTargetNode}]] (${e.relation})`;
            });

            const frontmatter = {
                type: node.type || 'Concept',
                id: node.id,
                weight: Number(node.val ? node.val.toFixed(2) : 1)
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
