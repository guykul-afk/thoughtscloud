const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const yaml = require('js-yaml');

const envPath = path.resolve(__dirname, '../.env.local');
let API_KEY = process.env.VITE_GEMINI_API_KEY;

if (!API_KEY && fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/VITE_GEMINI_API_KEY=(.+)/);
    if (match) {
        API_KEY = match[1].trim();
    }
}
if (!API_KEY) {
    console.error("No VITE_GEMINI_API_KEY found.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const promptTemplate = (nodeName, existingContent) => `
You are an expert psychological profiler and personal coach for "Guy" (גיא).
Analyze the following theoretical concept/node from Guy's knowledge graph.
Node Name: "${nodeName}"

Current Knowledge/Relations:
${existingContent}

Based on this context, generate a rich semantic and psychological profile for this concept in Guy's life.
Respond ONLY with a valid JSON object matching this structure (use Hebrew for all textual content):
{
  "essence": "A 1-2 sentence description of the core meaning and role of this concept in Guy's life.",
  "emotional_resonance": ["Emotion1", "Emotion2"],
  "aliases": ["Synonym1", "Synonym2"],
  "evolution_status": "Active Struggle OR Resolved OR Core Belief OR Emerging Goal",
  "core_conflict": "The main tension or conflict around this concept (e.g., 'X vs Y')",
  "blind_spots": ["Blind spot 1", "Blind spot 2"],
  "actionable_anchor": "A practical action or thought pattern that helps ground this concept",
  "domain": "Broad category (e.g., Work, Health, Relationships, Mental)"
}
`;

async function enrichMarkdownFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        // Parse frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) return false;
        
        const frontmatterStr = frontmatterMatch[1];
        let frontmatter = yaml.load(frontmatterStr);
        
        // Skip if already enriched
        if (frontmatter.essence && frontmatter.core_conflict) {
            return false;
        }

        const nodeName = frontmatter.id || path.basename(filePath, '.md');
        const prompt = promptTemplate(nodeName, content);
        
        const result = await model.generateContent(prompt);
        let jsonStr = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const enrichedData = JSON.parse(jsonStr);
        
        // Merge enriched data into frontmatter
        frontmatter = { ...frontmatter, ...enrichedData };
        
        // Rebuild markdown
        const newFrontmatterStr = yaml.dump(frontmatter);
        const newContent = content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFrontmatterStr}---`);
        
        fs.writeFileSync(filePath, newContent, 'utf8');
        return true;
    } catch (e) {
        console.error(`[!] Failed to enrich file ${filePath}:`, e.message);
        return false;
    }
}

async function run() {
    const graphDir = path.resolve(__dirname, '../okf_export/knowledge_graph');
    if (!fs.existsSync(graphDir)) {
        console.error("okf_export/knowledge_graph directory not found.");
        process.exit(1);
    }

    const files = fs.readdirSync(graphDir).filter(f => f.endsWith('.md'));
    const limit = 775; // Process all files
    let processedCount = 0;

    for (let i = 0; i < files.length; i++) {
        const filePath = path.join(graphDir, files[i]);
        
        console.log(`Checking [${i+1}/${files.length}]: ${files[i]}`);
        const wasEnriched = await enrichMarkdownFile(filePath);
        
        if (wasEnriched) {
            console.log(`-> Enriched!`);
            processedCount++;
            await new Promise(r => setTimeout(r, 1000)); // Delay to respect rate limits
        }
    }

    console.log(`Enrichment complete. Processed ${processedCount} new files.`);
}

run();
