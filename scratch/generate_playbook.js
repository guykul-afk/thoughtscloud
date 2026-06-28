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
const diaryData = JSON.parse(fs.readFileSync(diaryStatePath, 'utf8'));

const entries = diaryData.entries || [];
console.log(`Loaded ${entries.length} entries.`);

if (entries.length === 0) {
  console.error("No entries to analyze.");
  process.exit(1);
}

// Build knowledge graph from entries' triples
const nodesMap = new Map();
const edges = [];

entries.forEach(e => {
  if (!e.triples) return;
  e.triples.forEach(t => {
    let subject = '';
    let relation = '';
    let object = '';
    let domain = 'General';
    let sentiment = 0;
    
    if (Array.isArray(t)) {
      subject = t[0] || '';
      relation = t[1] || '';
      object = t[2] || '';
    } else if (typeof t === 'object') {
      subject = t.subject || '';
      relation = t.relation || '';
      object = t.object || '';
      domain = t.domain || 'General';
      sentiment = t.sentiment ?? 0;
    }
    
    if (subject && relation && object) {
      nodesMap.set(subject, (nodesMap.get(subject) || 0) + 1);
      nodesMap.set(object, (nodesMap.get(object) || 0) + 1);
      edges.push({ source: subject, relation, target: object, domain, sentiment });
    }
  });
});

// Format nodes and edges for prompt
const nodesList = Array.from(nodesMap.entries()).map(([label, count]) => {
  return `- ${label} (חשיבות: ${Math.min(5.0, 1.0 + count * 0.2).toFixed(1)})`;
}).slice(0, 80); // Top 80 nodes

const edgesList = edges.map(e => {
  return `- [${e.source}] --(${e.relation}, תחום: ${e.domain}, סנטימנט: ${e.sentiment})--> [${e.target}]`;
}).slice(0, 150); // Top 150 edges

const graphText = `
להלן מידע מתוך גרף הידע (Knowledge Graph) האישי של גיא:
קשרים קיימים בגרף:
${edgesList.join('\n')}

צמתים חשובים בגרף:
${nodesList.join('\n')}
`;

// Sort entries by timestamp (oldest first) to build a logical narrative
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

const prompt = `
אתה מומחה לניתוח דפוסי התנהגות ופסיכולוגיה קוגניטיבית. המטרה שלך היא לכתוב את "ספר ההפעלה" (Personal Operating Manual) של גיא.
זהו מסמך פרקטי שמרכז את התובנות העמוקות ביותר על איך גיא "עובד" הכי טוב, מה מניע אותו, ומה עוצר אותו.
עליך לפעול כ"פרקליט השטן" מול דפוסים מתחמקים או סתירות פנימיות, מתוך סקירת רשת הידע OKF שלו וההיסטוריה שלו.

המשימה שלך: נתח את כל המחשבות, קשרי הידע והשיחות של גיא וחלץ דפוסים חוזרים בנקודות קצרות וברורות בנושאים הבאים:
1. תנאים להצלחה ומוטיבציה (מה עוזר לו להיות במיטבו).
2. טריגרים רגשיים וחסמים (מה מוציא אותו מאיזון - דגש על פערים בין הצהרות למציאות).
3. סביבת עבודה ותקשורת (איך כדאי לו לגשת למשימות או לאנשים בהתבסס על הצלחות העבר).
4. המלצות פרקטיות למניעה (מה הוא יכול לעשות כשמתחיל דפוס שלילי).

${graphText}

דרישות חובה:
- כתוב בבוליטים (bullets) קצרים, חדים וברורים.
- פנה למשתמש ישירות בגוף שני ("אתה").
- כתוב בעברית בלבד.
- התמקד במידע פרקטי ויישומי לטווח ארוך.

In addition, extract OKF Knowledge Graph triples summarizing these core operating principles.
Return your response ONLY as a valid JSON object matching this structure:
{
  "insight": "Your operating manual in Hebrew...",
  "triples": [["Subject", "Relation", "Object"]]
}

החומר לניתוח:
${transcripts}

הקשר קבוע לגבי בני משפחה:
${FIXED_CONTEXT}
`;

console.log("Generating operating manual from all entries using Gemini API...");

async function generate() {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const text = response.text;
    console.log("Response received from Gemini.");
    
    // Parse response
    const parsed = JSON.parse(text);
    if (!parsed.insight) {
      throw new Error("Missing 'insight' field in model output.");
    }
    
    // Save back to diary_state.json
    const todayStr = new Date().toLocaleDateString('en-CA');
    diaryData.operatingManual = {
      insight: parsed.insight,
      lastDate: todayStr
    };
    
    fs.writeFileSync(diaryStatePath, JSON.stringify(diaryData, null, 2), 'utf8');
    console.log("Successfully generated and saved new playbook to public/diary_state.json!");
    console.log("\nGenerated Playbook Preview:\n");
    console.log(parsed.insight);
  } catch (err) {
    console.error("Error during generation/save:", err);
  }
}

generate();
