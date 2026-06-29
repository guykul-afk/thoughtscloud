import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

// Read .env.local to get VITE_GEMINI_API_KEY
const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const apiKeyMatch = envContent.match(/VITE_GEMINI_API_KEY\s*=\s*(.+)/);
if (!apiKeyMatch) {
  console.error("VITE_GEMINI_API_KEY not found in .env.local");
  process.exit(1);
}
const apiKey = apiKeyMatch[1].trim();

// Initialize Google Gen AI
const ai = new GoogleGenAI({ apiKey });

// Load diary_state.json
const diaryStatePath = path.resolve('public/diary_state.json');
if (!fs.existsSync(diaryStatePath)) {
  console.error(`Could not find diary_state.json at ${diaryStatePath}`);
  process.exit(1);
}
const diaryData = JSON.parse(fs.readFileSync(diaryStatePath, 'utf8'));
const state = diaryData.state || diaryData;
const entries = state.entries || [];

console.log(`Loaded ${entries.length} entries from diary_state.json.`);
if (entries.length === 0) {
  console.error("No entries to analyze.");
  process.exit(1);
}

// Build graph text context for prompt
const nodesMap = new Map();
const edges = [];
const graph = state.knowledgeGraph || { nodes: [], edges: [] };

if (graph.nodes && graph.nodes.length > 0) {
  graph.nodes.forEach(n => nodesMap.set(n.id, n.val || 1));
}
if (graph.edges && graph.edges.length > 0) {
  graph.edges.forEach(e => edges.push(e));
}

// Fallback build if graph nodes are empty
if (nodesMap.size === 0) {
  entries.forEach(e => {
    if (!e.triples) return;
    e.triples.forEach(t => {
      let subject = '';
      let relation = '';
      let object = '';
      if (Array.isArray(t)) {
        subject = t[0] || '';
        relation = t[1] || '';
        object = t[2] || '';
      } else if (typeof t === 'object') {
        subject = t.subject || '';
        relation = t.relation || '';
        object = t.object || '';
      }
      if (subject && relation && object) {
        nodesMap.set(subject, (nodesMap.get(subject) || 0) + 1);
        nodesMap.set(object, (nodesMap.get(object) || 0) + 1);
        edges.push({ source: subject, relation, target: object });
      }
    });
  });
}

const nodesList = Array.from(nodesMap.entries()).map(([label, count]) => {
  return `- ${label} (חשיבות: ${Math.min(5.0, 1.0 + count * 0.2).toFixed(1)})`;
}).slice(0, 80);

const edgesList = edges.map(e => {
  return `- [${e.source}] --(${e.relation})--> [${e.target}]`;
}).slice(0, 150);

const graphText = `
להלן מידע מתוך גרף הידע (Knowledge Graph) האישי של גיא:
קשרים קיימים בגרף:
${edgesList.join('\n')}

צמתים חשובים בגרף:
${nodesList.join('\n')}
`;

const sortedEntries = [...entries].sort((a, b) => a.timestamp - b.timestamp);
const transcripts = sortedEntries
  .map(e => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`)
  .join('\n\n');

const FIXED_CONTEXT = `
שמות בני המשפחה של גיא:
- טלי: אשתי
- גיל: הבת שלי
- איתן: הבן שלי
- נוה: הבן שלי
`;

// Extract quotes
const extractedQuotes = entries.filter(entry => {
  const hasQuoteTopic = (entry.topics || []).some(topic => {
    if (!topic) return false;
    const clean = topic.replace(/[\u200e\u200f\s#]/g, '').toLowerCase();
    return clean.includes('ציטוט');
  });

  const normalizedTranscript = entry.transcript.replace(/[\u200e\u200f]/g, '');
  const hasQuoteHashtag = /#ציטוט/.test(normalizedTranscript) || /#\s*ציטוט/.test(normalizedTranscript);

  return hasQuoteTopic || hasQuoteHashtag;
});

console.log(`Extracted ${extractedQuotes.length} quotes.`);

async function generateInsights() {
  try {
    const todayStr = new Date().toLocaleDateString('en-CA');

    // 1. Quote Insights
    let quoteInsight = "אין עדיין מספיק ציטוטים במערכת כדי לייצר מהם תובנות.";
    if (extractedQuotes.length > 0) {
      console.log("Generating Quote Insights...");
      const quotesText = extractedQuotes
        .map(q => `[${new Date(q.timestamp).toLocaleDateString('he-IL')}]: ${q.transcript}`)
        .join('\n\n');

      const quotesPrompt = `
הנה הציטוטים של גיא:
${quotesText}

${graphText}

דרישות:
- כתוב תובנה אחת ממוקדת, חדה ומעוררת השראה (בין 2 ל-4 משפטים).
- פנה אל גיא בגוף שני ("אתה").
- התבסס ישירות על הרעיונות או רוח הדברים שעולים מהציטוטים שלו.
- החזר תשובה בפורמט JSON בלבד. המבנה חייב להיות אובייקט עם שדה "insight" (מחרוזת) ושדה "triples" (מערך של שלשות).

Return your response ONLY as a valid JSON object matching this structure:
{
  "insight": "Your quote insight in Hebrew...",
  "triples": [["Subject", "Relation", "Object"]]
}
`;

      const quotesRes = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: quotesPrompt,
        config: { responseMimeType: 'application/json' }
      });
      const parsedQuotes = JSON.parse(quotesRes.text);
      quoteInsight = parsedQuotes.insight;
      console.log("Quote insights generated.");
    }

    state.quoteInsights = {
      insights: quoteInsight !== "אין עדיין מספיק ציטוטים במערכת כדי לייצר מהם תובנות." ? [quoteInsight] : [],
      lastUpdateDate: todayStr
    };

    // Save back to diary_state.json
    fs.writeFileSync(diaryStatePath, JSON.stringify(diaryData, null, 2), 'utf8');
    console.log("Successfully generated and saved insights offline to public/diary_state.json!");

  } catch (err) {
    console.error("Error during offline generation:", err);
  }
}

generateInsights();
