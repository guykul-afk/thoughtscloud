import { GoogleGenerativeAI } from '@google/generative-ai';
import { getStartOfCurrentWeek } from '../utils/dateUtils';

// Initialize the SDK with the user-provided API key
const getGenAI = (apiKey: string) => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
        throw new Error("Missing Gemini API Key. Please enter it in the top settings.");
    }
    return new GoogleGenerativeAI(trimmedKey);
};

// Helper to convert Blob to base64
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                const base64data = reader.result.split(',')[1];
                resolve(base64data);
            } else {
                reject(new Error("Failed to read blob as string"));
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

export interface OKFTriple {
    subject: string;
    relation: string;
    object: string;
    domain?: 'Work' | 'Family' | 'Personal' | 'Health' | 'Finance' | 'General';
    temporalContext?: 'Past' | 'Present' | 'Future';
    confidence?: 'Fact' | 'Inference' | 'Opinion';
    sentiment?: number; // -1, 0, 1
    subjectType?: 'Person' | 'Project' | 'Concept' | 'Emotion' | 'Other';
    objectType?: 'Person' | 'Project' | 'Concept' | 'Emotion' | 'Other';
}

export interface ProcessedSession {
    transcript: string;
    openThreads: string[];
    insights: string[];
    topics: string[];
    mood: string;
    triples: OKFTriple[];
}

// Optimized Model Selection Logic based on current availability
export const SUPPORTED_MODELS = [
    { name: 'gemini-2.0-flash-exp', version: 'v1beta' },
    { name: 'gemini-2.0-flash-001', version: 'v1beta' },
    { name: 'gemini-1.5-flash-latest', version: 'v1beta' },
    { name: 'gemini-1.5-pro-latest', version: 'v1beta' }
];

let activeModelName = 'gemini-2.0-flash-exp';
let activeApiVersion = 'v1beta';
let liteModelName = 'gemini-2.0-flash-exp';

export const setActiveModel = (name: string, version: string = 'v1beta') => {
    activeModelName = name;
    activeApiVersion = version;
    liteModelName = name;
};

export async function autoDiscoverModel(apiKey: string): Promise<{name: string, version: string} | null> {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!response.ok) return null;
        const data = await response.json();
        const models = data.models || [];
        const modelNames = models.map((m: any) => m.name.replace('models/', ''));
        
        // Priority list of models from newest/best to oldest
        const priorityList = [
            'gemini-3.0-flash',
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-2.0-flash-001',
            'gemini-2.0-flash-exp',
            'gemini-1.5-flash',
            'gemini-1.5-flash-latest',
            'gemini-1.5-pro-latest',
            'gemini-1.5-pro'
        ];

        for (const preferred of priorityList) {
            if (modelNames.includes(preferred)) {
                setActiveModel(preferred, 'v1beta');
                console.log("Auto-discovered optimal model:", preferred);
                return { name: preferred, version: 'v1beta' };
            }
        }
    } catch (e) {
        console.warn("Failed to auto-discover models:", e);
    }
    return null;
}

export async function generateTextEmbedding(text: string, apiKey: string): Promise<number[]> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    try {
        const result = await model.embedContent(text);
        return result.embedding.values;
    } catch (error) {
        console.error("Error generating embedding:", error);
        throw error;
    }
}

// Fixed context for Guy's family
const FIXED_CONTEXT = `
שמות בני המשפחה של גיא:
- טלי: אשתי
- גיל: הבת שלי
- איתן: הבן שלי
- נוה: הבן שלי
`;

export const TRIPLES_SCHEMA_INSTRUCTION = `
KNOWLEDGE GRAPH TRIPLES:
Extract 3-7 meaningful relationships representing key facts, emotions, plans, or connections in this entry.
For each relationship, you MUST return a structured object instead of a flat array, according to this format:
{
  "subject": "שם הישות הראשונה (למשל: גיא, טלי, עבודה, לחץ). שמור על שמות ישויות עקביים וממוקדים (עד 3 מילים).",
  "relation": "סוג היחס (למשל: מרגיש, אוהב, מנהל, משפיע על, שואף ל)",
  "object": "שם הישות השנייה. עד 3 מילים.",
  "domain": "חייב להיות אחד מ: 'Work', 'Family', 'Personal', 'Health', 'Finance', 'General'",
  "temporalContext": "חייב להיות אחד מ: 'Past', 'Present', 'Future'",
  "confidence": "חייב להיות אחד מ: 'Fact', 'Inference', 'Opinion'",
  "sentiment": מספר שלם בלבד: -1 (שלילי/תסכול), 0 (ניטרלי), או 1 (חיובי/סיפוק),
  "subjectType": "חייב להיות אחד מ: 'Person', 'Project', 'Concept', 'Emotion', 'Other'",
  "objectType": "חייב להיות אחד מ: 'Person', 'Project', 'Concept', 'Emotion', 'Other'"
}
`;

// Helper to sanitize and parse JSON from AI response
const parseAIResponse = (text: string): any => {
    try {
        // Remove markdown code blocks if present
        const cleanJson = text
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
        
        // Attempt 1: Direct JSON parsing
        try {
            return JSON.parse(cleanJson);
        } catch (initialErr) {
            console.warn("Direct JSON parsing failed, attempting extraction...", initialErr);
            
            // Attempt 2: Extract the first JSON object using a greedy regex match
            const jsonObjectMatch = cleanJson.match(/\{[\s\S]*\}/);
            if (jsonObjectMatch) {
                try {
                    return JSON.parse(jsonObjectMatch[0]);
                } catch (objErr) {
                    console.warn("Failed to parse extracted JSON object:", objErr);
                }
            }
            
            // Attempt 3: Extract the first JSON array using a greedy regex match
            const jsonArrayMatch = cleanJson.match(/\[[\s\S]*\]/);
            if (jsonArrayMatch) {
                try {
                    return JSON.parse(jsonArrayMatch[0]);
                } catch (arrErr) {
                    console.warn("Failed to parse extracted JSON array:", arrErr);
                }
            }
            
            // If all parsing attempts failed, throw the original error
            throw initialErr;
        }
    } catch (e) {
        console.error("Failed to parse AI response as JSON:", text);
    }
};

export function normalizeTriples(triples: any[] | undefined): OKFTriple[] {
    if (!triples) return [];
    return triples.map((t: any) => {
        if (Array.isArray(t)) {
            return {
                subject: t[0] || '',
                relation: t[1] || '',
                object: t[2] || '',
                domain: 'General',
                temporalContext: 'Present',
                confidence: 'Fact',
                sentiment: 0,
                subjectType: 'Other',
                objectType: 'Other'
            };
        }
        return {
            subject: t.subject || t.s || '',
            relation: t.relation || t.r || '',
            object: t.object || t.o || '',
            domain: t.domain || 'General',
            temporalContext: t.temporalContext || 'Present',
            confidence: t.confidence || 'Fact',
            sentiment: typeof t.sentiment === 'number' ? t.sentiment : 0,
            subjectType: t.subjectType || 'Other',
            objectType: t.objectType || 'Other'
        };
    });
}

const buildGraphContext = (knowledgeGraph?: { nodes: any[]; edges: any[] }): string => {
    if (!knowledgeGraph || !knowledgeGraph.edges || knowledgeGraph.edges.length === 0) {
        return "";
    }
    const nodesStr = knowledgeGraph.nodes.map(n => `- ${n.label} (סוג: ${n.type || 'Other'}, חשיבות: ${n.val ? n.val.toFixed(1) : '1.0'})`).join('\n');
    const edgesStr = knowledgeGraph.edges.map(e => `- [${e.source}] --(${e.relation}, תחום: ${e.domain || 'General'}, סנטימנט: ${e.sentiment ?? 0})--> [${e.target}]`).join('\n');
    return `
להלן מידע מתוך גרף הידע (Knowledge Graph) האישי של גיא:
קשרים קיימים בגרף:
${edgesStr}

צמתים חשובים בגרף:
${nodesStr}
`;
};

export async function processAudioSession(audioBlob: Blob, apiKey: string, currentOpenThreads: string[] = []): Promise<ProcessedSession> {
    const genAI = getGenAI(apiKey);
    // Removed responseMimeType to fix "Unknown name" 400 error
    const model = genAI.getGenerativeModel({
        model: activeModelName
    }, { apiVersion: activeApiVersion as any });

    const base64Audio = await blobToBase64(audioBlob);

    const prompt = `
  You are an expert personal assistant and psychological profiler.
  You are assisting "גיא" (Guy).
  I am providing you with an audio recording of Guy's personal diary entry or a conversation.
  
  Please analyze the audio and provide exactly the following in clear, valid JSON format (do not include markdown code block syntax around the JSON):
  {
    "transcript": "The full exact transcript. MUST BE IN HEBREW. If the audio is silent, only contains noise, or has no clear speech, output exactly 'NO_SPEECH_DETECTED'. Do NOT hallucinate or invent any speech.",
    "openThreads": ["Array of unresolved thoughts, dilemmas, or active intentions Guy wants to resolve or advance. Phrase them as a short reflective statement or question, e.g., 'איך לקדם את השיחה מול הבוס?' or 'הרצון למצוא זמן שקט לעצמי'. MUST BE IN HEBREW.", ...],
    "insights": ["Array of psychological or general insights. MUST BE IN HEBREW.", ...],
    "topics": ["Array of short tags/categories. MUST BE IN HEBREW.", ...],
    "mood": "A short description of tone/mood. MUST BE IN HEBREW.",
    "triples": [
      {
        "subject": "שם הישות (למשל: גיא)",
        "relation": "קשר (למשל: מרגיש)",
        "object": "מושא (למשל: סיפוק)",
        "domain": "Work/Family/Personal/Health/Finance/General",
        "temporalContext": "Past/Present/Future",
        "confidence": "Fact/Inference/Opinion",
        "sentiment": 1/0/-1,
        "subjectType": "Person/Project/Concept/Emotion/Other",
        "objectType": "Person/Project/Concept/Emotion/Other"
      }
    ]
  }

  CRITICAL HALUCINATION PREVENTION:
  If the audio is silent or contains no meaningful speech, you MUST return empty arrays for openThreads, insights, topics, and triples, and set mood to "N/A". DO NOT invent any information, openThreads, or insights that are not explicitly present in the audio.

  CRITICAL RULES FOR OPEN THREADS (חוטים פתוחים):
  1. Focus on unresolved emotional issues, relationships, work or personal dilemmas, plans, or internal conflicts that Guy is reflecting upon.
  2. Avoid dry list-style tasks (like "buy groceries"). Instead, capture the underlying intention or dilemma.
  3. DEDUPLICATION: Compare identified open threads with the "Current Open Threads" list below. If a thread is already open and covers the same issue, ignore it to prevent duplicates.

  ${TRIPLES_SCHEMA_INSTRUCTION}

  Current Open Threads:
  ${currentOpenThreads.length > 0 ? currentOpenThreads.map(t => `- ${t}`).join('\n') : 'None'}
  
  CRITICAL: ALL text values MUST be in Hebrew.
  
  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;


    try {
        const result = await model.generateContent([
            {
                inlineData: {
                    data: base64Audio,
                    mimeType: audioBlob.type || 'audio/webm',
                }
            },
            {
                text: prompt
            }
        ]);

        const response = await result.response;
        return parseAIResponse(response.text());

    } catch (error: any) {
        console.error("Error processing audio with Gemini:", error);
        throw error;
    }
}

export async function processTextSession(textData: string, apiKey: string, currentOpenThreads: string[] = []): Promise<ProcessedSession> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: activeModelName
    }, { apiVersion: activeApiVersion as any });

    const prompt = `
  You are an expert personal assistant and psychological profiler.
  You are assisting "גיא" (Guy).
  I am providing you with a raw text entry from Guy's personal diary.
  
  Please analyze the text and provide exactly the following in clear, valid JSON format:
  {
    "openThreads": ["Array of unresolved thoughts, dilemmas, or active intentions Guy wants to resolve or advance. Phrase them as a short reflective statement or question, e.g., 'איך לקדם את השיחה מול הבוס?' or 'הרצון למצוא זמן שקט לעצמי'. MUST BE IN HEBREW.", ...],
    "insights": ["Array of psychological or general insights. MUST BE IN HEBREW.", ...],
    "topics": ["Array of short tags/categories. MUST BE IN HEBREW.", ...],
    "mood": "A short description of tone/mood. MUST BE IN HEBREW.",
    "triples": [
      {
        "subject": "שם הישות (למשל: גיא)",
        "relation": "קשר (למשל: מרגיש)",
        "object": "מושא (למשל: סיפוק)",
        "domain": "Work/Family/Personal/Health/Finance/General",
        "temporalContext": "Past/Present/Future",
        "confidence": "Fact/Inference/Opinion",
        "sentiment": 1/0/-1,
        "subjectType": "Person/Project/Concept/Emotion/Other",
        "objectType": "Person/Project/Concept/Emotion/Other"
      }
    ]
  }

  CRITICAL HALUCINATION PREVENTION:
  If the text is too short, meaningless, or contains no actionable/insightful information, you MUST return empty arrays for openThreads, insights, topics, and triples, and set mood to "N/A". DO NOT invent any information, openThreads, or insights that are not explicitly present in the text.

  CRITICAL RULES FOR OPEN THREADS (חוטים פתוחים):
  1. Focus on unresolved emotional issues, relationships, work or personal dilemmas, plans, or internal conflicts that Guy is reflecting upon.
  2. Avoid dry list-style tasks (like "buy groceries"). Instead, capture the underlying intention or dilemma.
  3. DEDUPLICATION: Compare identified open threads with the "Current Open Threads" list below. If a thread is already open and covers the same issue, ignore it to prevent duplicates.

  ${TRIPLES_SCHEMA_INSTRUCTION}

  Current Open Threads:
  ${currentOpenThreads.length > 0 ? currentOpenThreads.map(t => `- ${t}`).join('\n') : 'None'}

  CRITICAL: ALL text values MUST be in Hebrew. Supporting and personal tone.

  Here is the text:
  ${textData}

  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;


    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        // Since we removed transcript from the AI prompt to prevent hallucination, we inject the original text back here.
        parsed.transcript = textData;
        return parsed;

    } catch (error: any) {
        console.error("Error processing text with Gemini:", error);
        throw error;
    }
}

export interface ChatMessageContext {
    role: 'user' | 'ai';
    content: string;
}

export async function queryInsights(
    question: string,
    allEntries: { transcript: string; timestamp: number }[],
    apiKey: string,
    context?: { 
        weeklyInsight?: string; 
        categoricalInsights?: { work: string; family: string; personal: string };
        chatHistory?: ChatMessageContext[];
        relevantPastEntries?: { transcript: string; timestamp: number }[];
    }
): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    const now = new Date();
    const currentDateTime = now.toLocaleString('he-IL', { dateStyle: 'full', timeStyle: 'short' });

    let contextData = "";
    if (context) {
        if (context.weeklyInsight) {
            contextData += `\n[תובנה שבועית]: ${context.weeklyInsight}\n`;
        }
        if (context.categoricalInsights) {
            contextData += `\n[תובנת עבודה]: ${context.categoricalInsights.work}`;
            contextData += `\n[תובנת משפחה]: ${context.categoricalInsights.family}`;
            contextData += `\n[תובנה אישית]: ${context.categoricalInsights.personal}\n`;
        }
        if (context.chatHistory && context.chatHistory.length > 0) {
            contextData += `\n[היסטוריית שיחה אחרונה]:\n`;
            contextData += context.chatHistory.slice(-10).map(m => 
                `${m.role === 'user' ? 'גיא שאל' : 'אתה ענית'}: ${m.content}`
            ).join('\n');
            contextData += `\n`;
        }
    }

    const includesAllHistory = question.includes("כל ההיסטוריה");
    const recentEntriesForQuery = includesAllHistory
        ? [...allEntries].sort((a, b) => a.timestamp - b.timestamp)
        : [...allEntries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30).sort((a, b) => a.timestamp - b.timestamp);

    const prompt = `
  You are an expert personal assistant for "גיא" (Guy).
  You have access to Guy's past diary transcripts and potentially some generated weekly/categorical insights.
  Today is: ${currentDateTime} (Current Date and Time).
  Guy is asking you a question about his past entries or the insights you've provided.
  
  When answering, address him directly in the second person ("אתה"). 
  Be warm, insightful, and supportive.

  Here is Guy's question:
  "${question}"
  
  ${contextData ? `להלן התובנות הנוכחיות שלך כהקשר נוסף:\n${contextData}` : ""}
  
  

  Here are all of Guy's past transcripts with their recorded dates:
  ${recentEntriesForQuery.map((e) => `[Entry Date: ${new Date(e.timestamp).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })}]: ${e.transcript}`).join('\n\n')}
  
  

  Please provide a helpful, deep, and insightful answer to Guy's question based on the transcripts and context provided above. 
  CRITICAL: Answer MUST be in fluent Hebrew. If the answer is not in the material, state that gently in Hebrew, addressing the user in second person.

  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;


    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text() || "לא הצלחתי למצוא תשובה.";
    } catch (error: any) {
        console.error("Error querying insights with Gemini:", error);
        throw error;
    }
}

export async function generateWeeklyBriefing(
    allEntries: { transcript: string; timestamp: number }[],
    apiKey: string,
    _relevantPastEntries?: { transcript: string; timestamp: number }[],
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ insight: string; triples: OKFTriple[] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const now = new Date();
    const currentDateTime = now.toLocaleString('he-IL', { dateStyle: 'full', timeStyle: 'short' });

    // Filter entries from the current week (Sunday-Saturday)
    const weekStart = getStartOfCurrentWeek();
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= weekStart)
        .map((e) => `[Entry Date: ${new Date(e.timestamp).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })}]: ${e.transcript}`)
        .join('\n\n');

    if (!recentTranscripts) {
        return { insight: "אין עדיין מספיק נתונים מהשבוע האחרון כדי לייצר תובנה שבועית.", triples: [] };
    }

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = `
  You are an expert personal growth coach and analyst for "גיא" (Guy).
  Today is: ${currentDateTime}.
  I am providing you with all of Guy's diary entries from the past week.
  Please provide a deep, high-level "Weekly Insight" (תובנה שבועית) that summarizes the main themes, emotional patterns, and progress Guy has made.
  
  *CRITICAL SHADOW WORK REQUIREMENT*: Look for contradictions. What is Guy avoiding? What excuses is he making? Point out any cognitive dissonance or "stories" he tells himself to avoid pain or effort. Be direct but constructive (Devil's Advocate approach).

  CRITICAL: 
  - Address the user directly in the second person ("אתה").
  - Provide a concise yet deep analysis.
  - MUST BE IN FLUENT HEBREW.
  - Use a warm, professional, and encouraging tone, but don't hold back on the Shadow Work critique.

  Recent material:
  ${recentTranscripts}

  ${graphText}

  ${TRIPLES_SCHEMA_INSTRUCTION}
  Return your response ONLY as a valid JSON object matching this structure:
  {
    "insight": "Your deep weekly insight in Hebrew...",
    "triples": [
      {
        "subject": "שם הישות",
        "relation": "קשר",
        "object": "מושא",
        "domain": "Work/Family/Personal/Health/Finance/General",
        "temporalContext": "Past/Present/Future",
        "confidence": "Fact/Inference/Opinion",
        "sentiment": 1/0/-1,
        "subjectType": "Person/Project/Concept/Emotion/Other",
        "objectType": "Person/Project/Concept/Emotion/Other"
      }
    ]
  }

  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (typeof parsed === 'string') return { insight: parsed, triples: [] };
        return {
            insight: parsed.insight || '',
            triples: normalizeTriples(parsed.triples)
        };
    } catch (error: any) {
        console.error("Error generating weekly briefing:", error);
        throw error;
    }
}

export async function generateCategoricalInsights(
    allEntries: { transcript: string; timestamp: number }[],
    apiKey: string,
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ work: string; family: string; personal: string; triples: OKFTriple[] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: liteModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const weekStart = getStartOfCurrentWeek();
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= weekStart)
        .map((e) => `[Entry Date: ${new Date(e.timestamp).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })}]: ${e.transcript}`)
        .join('\n\n');

    if (!recentTranscripts) {
        return {
            work: "אין מספיק נתונים מהשבוע האחרון.",
            family: "אין מספיק נתונים מהשבוע האחרון.",
            personal: "אין מספיק נתונים מהשבוע האחרון.",
            triples: []
        };
    }

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = `
  You are an expert personal growth coach and psychological analyst for "גיא" (Guy).
  Analyze his transcripts from the last week and extract exactly 3 key insights in the following categories:
  1. Work (עבודה)
  2. Family (משפחה)
  3. Personal/Psychological (אישי - ניתוח פסיכולוגי)

  ${graphText}

  ${TRIPLES_SCHEMA_INSTRUCTION}
  Return the result in clear JSON format:
  {
    "work": "Insight about work, addressing Guy personally",
    "family": "Insight about family, addressing Guy personally",
    "personal": "Deep psychological insight, addressing the user directly",
    "triples": [
      {
        "subject": "שם הישות",
        "relation": "קשר",
        "object": "מושא",
        "domain": "Work/Family/Personal/Health/Finance/General",
        "temporalContext": "Past/Present/Future",
        "confidence": "Fact/Inference/Opinion",
        "sentiment": 1/0/-1,
        "subjectType": "Person/Project/Concept/Emotion/Other",
        "objectType": "Person/Project/Concept/Emotion/Other"
      }
    ]
  }

  CRITICAL:
  - Address the user directly in the second person ("אתה").
  - MUST BE IN FLUENT HEBREW.
  - Tone should be warm and professional.

  Transcripts:
  ${recentTranscripts}

  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        return {
            work: parsed.work || '',
            family: parsed.family || '',
            personal: parsed.personal || '',
            triples: normalizeTriples(parsed.triples)
        };
    } catch (error: any) {
        console.error("Error generating categorical insights:", error);
        return {
            work: "שגיאה בעיבוד הנתונים.",
            family: "שגיאה בעיבוד הנתונים.",
            personal: "שגיאה בעיבוד הנתונים.",
            triples: []
        };
    }
}

export async function generateQuoteInsight(
    quotes: { transcript: string; timestamp: number }[],
    existingInsights: string[],
    apiKey: string,
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ insight: string; triples: OKFTriple[] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    if (quotes.length === 0) {
        return { insight: "עדיין אין ציטוטים מוגדרים במערכת כדי לייצר מהם תובנות.", triples: [] };
    }

    const quotesText = quotes
        .map(q => `[${new Date(q.timestamp).toLocaleDateString('he-IL')}]: ${q.transcript}`)
        .join('\n\n');

    const existingInsightsText = existingInsights && existingInsights.length > 0
        ? existingInsights.map((insight, idx) => `${idx + 1}. ${insight}`).join('\n')
        : "אין תובנות קודמות.";

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = `
  אתה מומחה לניתוח פילוסופי וקוגניטיבי, ועובד עם שיטת ארגון הידע OKF.
  תפקידך לנתח את הציטוטים שגיא שמר ביומן שלו, ולייצר תובנה עמוקה, מעשית ומעוררת מחשבה (חדשה ושונה מהתובנות הקודמות).
  
  הנה הציטוטים של גיא:
  ${quotesText}

  הנה תובנות מציטוטים שכבר ייצרת בעבר (אל תחזור עליהן, נסה להציע זווית חדשה או להעמיק בנושא אחר שעולה מהציטוטים):
  ${existingInsightsText}

  ${graphText}

  ${TRIPLES_SCHEMA_INSTRUCTION}

  דרישות:
  - כתוב תובנה אחת ממוקדת, חדה ומעוררת השראה (בין 2 ל-4 משפטים).
  - פנה אל גיא בגוף שני ("אתה").
  - התבסס ישירות על הרעיונות או רוח הדברים שעולים מהציטוטים שלו.
  - החזר תשובה בפורמט JSON בלבד. המבנה חייב להיות אובייקט עם שדה "insight" (מחרוזת) ושדה "triples" (מערך של שלשות). דוגמה:
    {
      "insight": "התובנה שלך כאן...",
      "triples": [
        {
          "subject": "שם הישות",
          "relation": "קשר",
          "object": "מושא",
          "domain": "Work/Family/Personal/Health/Finance/General",
          "temporalContext": "Past/Present/Future",
          "confidence": "Fact/Inference/Opinion",
          "sentiment": 1/0/-1,
          "subjectType": "Person/Project/Concept/Emotion/Other",
          "objectType": "Person/Project/Concept/Emotion/Other"
        }
      ]
    }
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (typeof parsed === 'string') return { insight: parsed, triples: [] };
        return {
            insight: parsed.insight || '',
            triples: normalizeTriples(parsed.triples)
        };
    } catch (error: any) {
        console.error("Error generating quote insight:", error);
        return {
            insight: "שגיאה ביצירת תובנה מציטוטים.",
            triples: []
        };
    }
}


export async function generateAdvices(
    allEntries: { transcript: string; timestamp: number }[],
    apiKey: string,
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ work: string; family: string; mental: string; triples: OKFTriple[] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= thirtyDaysAgo)
        .map(e => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`)
        .join('\n\n');

    if (!recentTranscripts) {
        return {
            work: "אין מספיק נתונים לחודש האחרון כדי לייצר עצה בעבודה.",
            family: "אין מספיק נתונים לחודש האחרון כדי לייצר עצה למשפחה.",
            mental: "אין מספיק נתונים לחודש האחרון כדי לייצר עצה לרווחה הנפשית.",
            triples: []
        };
    }

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = `
  אתה יועץ אישי ופסיכולוגי בכיר של "גיא".
  תפקידך לסקור את יומנו מ-30 הימים האחרונים ולספק לו 3 עצות קונקרטיות ופעילות בתחומים הבאים:
  1. עבודה (Work)
  2. משפחה (Family)
  3. רווחה נפשית (Mental Well-being)

  ${graphText}

  ${TRIPLES_SCHEMA_INSTRUCTION}

  דרישות:
  - על כל עצה להיות **קצרה מאוד, עד 3 שורות לכל היותר**. עצה פרקטית וישירה אליו.
  - פנה למשתמש ישירות בגוף שני ("אתה", למשל: "כדאי לך...").
  - כתוב בעברית קולחת ומעוררת השראה.
  - החזר תשובה בפורמט JSON בלבד (ללא טקסט נוסף):
  {
    "work": "עצה קצרה ואקטיבית לעבודה",
    "family": "עצה קצרה ואקטיבית למשפחה",
    "mental": "עצה קצרה ואקטיבית לרווחה",
    "triples": [
      {
        "subject": "שם הישות",
        "relation": "קשר",
        "object": "מושא",
        "domain": "Work/Family/Personal/Health/Finance/General",
        "temporalContext": "Past/Present/Future",
        "confidence": "Fact/Inference/Opinion",
        "sentiment": 1/0/-1,
        "subjectType": "Person/Project/Concept/Emotion/Other",
        "objectType": "Person/Project/Concept/Emotion/Other"
      }
    ]
  }

  הקשר קבוע לגבי המשפחה:
  ${FIXED_CONTEXT}

  היומנים מהחודש האחרון:
  ${recentTranscripts}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        return {
            work: parsed.work || '',
            family: parsed.family || '',
            mental: parsed.mental || '',
            triples: normalizeTriples(parsed.triples)
        };
    } catch (error: any) {
        console.error("Error generating advices:", error);
        throw error;
    }
}

export async function generateLifeThemesAnalysis(
    allEntries: { transcript: string; timestamp: number }[],
    apiKey: string,
    type: 'weekly' | 'monthly',
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ insight: string; triples: OKFTriple[] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const timeRangeText = type === 'weekly' ? 'מהשבוע האחרון' : 'מהחודש האחרון';
    const threshold = type === 'weekly' ? 7 : 30;
    const entriesToAnalyze = allEntries.filter(e => e.timestamp >= (Date.now() - threshold * 24 * 60 * 60 * 1000));

    if (entriesToAnalyze.length === 0) return { insight: `אין מספיק נתונים ${timeRangeText} לניתוח תמות חיים.`, triples: [] };

    const transcripts = entriesToAnalyze
        .map(e => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`)
        .join('\n\n');

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = `
  אתה אנליסט דפוסים אישי ומומחה בפסיכולוגיה של "תמות חיים" (Life Themes).
  המשימה שלך: לנתח את המחשבות של גיא ${timeRangeText} ולזהות 2-3 "תמות על" - נושאים מרכזיים שחוזרים על עצמם, גם אם בדרכים שונות.
  בנוסף, השווה את התמות האלו למה שאתה מזהה כ"עבר רחוק יותר" (מתוך כלל החומר) וציין אם יש שינוי, התקדמות או נסיגה.

  ${graphText}

  ${TRIPLES_SCHEMA_INSTRUCTION}

  דרישות:
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - כתוב בעברית קולחת ומקצועית אך נגישה.
  - התמקד ב"למה" מאחורי הדברים, לא רק ב"מה".
  
  Return your response ONLY as a valid JSON object matching this structure:
  {
    "insight": "Your life themes analysis in Hebrew...",
    "triples": [
      {
        "subject": "שם הישות",
        "relation": "קשר",
        "object": "מושא",
        "domain": "Work/Family/Personal/Health/Finance/General",
        "temporalContext": "Past/Present/Future",
        "confidence": "Fact/Inference/Opinion",
        "sentiment": 1/0/-1,
        "subjectType": "Person/Project/Concept/Emotion/Other",
        "objectType": "Person/Project/Concept/Emotion/Other"
      }
    ]
  }

  החומר לניתוח:
  ${transcripts}

  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (typeof parsed === 'string') return { insight: parsed, triples: [] };
        return {
            insight: parsed.insight || '',
            triples: normalizeTriples(parsed.triples)
        };
    } catch (error) {
        console.error("Error generating life themes:", error);
        throw error;
    }
}

export async function analyzeExecutionGap(
    allEntries: { transcript: string; tasks?: any[]; timestamp: number }[],
    apiKey: string,
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ insight: string; triples: OKFTriple[] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    // Focus on recent actions vs intentions (last 30 days roughly)
    const recentEntries = [...allEntries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);
    if (recentEntries.length === 0) return { insight: "אין עדיין נתונים לבדיקת פערי ביצוע.", triples: [] };

    const transcriptsAndTasks = recentEntries
        .map(e => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]\nמחשבות בדיווח: ${e.transcript}\nמשימות שהוגדרו: ${(e.tasks || []).map(t => typeof t === 'string' ? t : t.text).join(', ')}`)
        .join('\n\n');

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = `
  אתה מומחה לפסיכולוגיה התנהגותית. המשימה שלך היא לבדוק את "פער הביצוע" (Expectation vs. Reality Mapping) של גיא - הפער בין התוכניות המשימות והכוונות שהוא מצהיר עליהן ביומן, לבין מה שהוא עושה בפועל בדיווחים ובמחשבות העוקבות.
  זהה "דחיינות כרונית" או אזורים בהם יש הימנעות רגשית מתמדת למרות כוונות טובות.
  
  ${graphText}

  ${TRIPLES_SCHEMA_INSTRUCTION}

  דרישות:
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - הבא דוגמה קונקרטית מתוך הנתונים שלו (משימה או כוונה שנמנעה מספר פעמים ואת התירוצים שניתנו).
  - היה ביקורתי (פרקליט השטן) אבל תן הצעה טיפולית.
  - כתוב בעברית בלבד. 2-3 פסקאות קצרות.

  Return your response ONLY as a valid JSON object matching this structure:
  {
    "insight": "Your execution gap analysis in Hebrew...",
    "triples": [
      {
        "subject": "שם הישות",
        "relation": "קשר",
        "object": "מושא",
        "domain": "Work/Family/Personal/Health/Finance/General",
        "temporalContext": "Past/Present/Future",
        "confidence": "Fact/Inference/Opinion",
        "sentiment": 1/0/-1,
        "subjectType": "Person/Project/Concept/Emotion/Other",
        "objectType": "Person/Project/Concept/Emotion/Other"
      }
    ]
  }

  נתונים לניתוח (הצהרות מול דיווח על מה שקרה באמת בימים העוקבים):
  ${transcriptsAndTasks}

  הקשר:
  ${FIXED_CONTEXT}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (typeof parsed === 'string') return { insight: parsed, triples: [] };
        return {
            insight: parsed.insight || '',
            triples: normalizeTriples(parsed.triples)
        };
    } catch (error) {
        console.error("Error analyzing execution gap:", error);
        return { insight: "שגיאה בניתוח פער הביצוע.", triples: [] };
    }
}

export async function generateEmotionalGTDInsight(
    allEntries: { transcript: string; timestamp: number }[],
    apiKey: string,
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ insight: string; triples: OKFTriple[] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: liteModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const recentTranscripts = allEntries
        .slice(0, 10) 
        .map(e => e.transcript)
        .join('\n\n');

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = `
  אתה מומחה לניתוח מעמקים רגשי ותובנות יומיומיות. במקום להתמקד רק ברשימות משימות, אתה עוזר לגיא להבין אילו נושאים "תוקעים" אותו רגשית ואיך לגשת אליהם.
  נתח את מצבו היום, תוך הסתמכות על יומניו האחרונים ועל רשת הידע (Knowledge Graph) שלו, והצע לו "תובנה רגשית יומית עיקרית" אחת - ניתוח קצר של מה שהכי מעסיק אותו היום, ואיך הוא יכול לפעול בנושא.

  ${graphText}

  ${TRIPLES_SCHEMA_INSTRUCTION}

  דרישות חובה:
  - השתמש בבולטים (bullets) ברורים וקצרים.
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - כתוב בעברית בלבד.
  - מבנה התשובה: פתיחה קצרה, ואם יש 2-3 בולטים של תובנות/פעולות מוצעות.
  
  Return your response ONLY as a valid JSON object matching this structure:
  {
    "insight": "Your emotional GTD analysis in Hebrew...",
    "triples": [
      {
        "subject": "שם הישות",
        "relation": "קשר",
        "object": "מושא",
        "domain": "Work/Family/Personal/Health/Finance/General",
        "temporalContext": "Past/Present/Future",
        "confidence": "Fact/Inference/Opinion",
        "sentiment": 1/0/-1,
        "subjectType": "Person/Project/Concept/Emotion/Other",
        "objectType": "Person/Project/Concept/Emotion/Other"
      }
    ]
  }

  הקשר אחרון:
  ${recentTranscripts}

  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (typeof parsed === 'string') return { insight: parsed, triples: [] };
        return {
            insight: parsed.insight || '',
            triples: normalizeTriples(parsed.triples)
        };
    } catch (error) {
        console.error("Error generating emotional GTD insight:", error);
        throw error;
    }
}

export async function generateOperatingManual(
    allEntries: { transcript: string; timestamp: number }[],
    apiKey: string,
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ insight: string; triples: OKFTriple[] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const isFirstOfMonth = new Date().getDate() === 1;
    
    // Only send full history on the 1st of the month, otherwise limit to last 30 entries
    const entriesToAnalyze = isFirstOfMonth
        ? [...allEntries].sort((a, b) => b.timestamp - a.timestamp)
        : [...allEntries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);

    if (entriesToAnalyze.length === 0) return { insight: "עדיין אין מספיק נתונים כדי לייצר את ספר ההפעלה שלך. המשך לשתף במחשבות!", triples: [] };

    const transcripts = entriesToAnalyze
        .map(e => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`)
        .join('\n\n');

    const graphText = buildGraphContext(knowledgeGraph);

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

  ${TRIPLES_SCHEMA_INSTRUCTION}

  דרישות חובה:
  - כתוב בבוליטים (bullets) קצרים, חדים וברורים.
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - כתוב בעברית בלבד.
  - התמקד במידע פרקטי ויישומי לטווח ארוך.
  
  Return your response ONLY as a valid JSON object matching this structure:
  {
    "insight": "Your operating manual in Hebrew...",
    "triples": [
      {
        "subject": "שם הישות",
        "relation": "קשר",
        "object": "מושא",
        "domain": "Work/Family/Personal/Health/Finance/General",
        "temporalContext": "Past/Present/Future",
        "confidence": "Fact/Inference/Opinion",
        "sentiment": 1/0/-1,
        "subjectType": "Person/Project/Concept/Emotion/Other",
        "objectType": "Person/Project/Concept/Emotion/Other"
      }
    ]
  }

  החומר לניתוח:
  ${transcripts}

  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (typeof parsed === 'string') return { insight: parsed, triples: [] };
        
        let finalInsight = parsed.insight || '';
        if (typeof finalInsight === 'object' && finalInsight !== null) {
            const obj = finalInsight;
            let text = '';
            if (obj.title) text += obj.title + '\n\n';
            if (obj.introduction) text += obj.introduction + '\n\n';
            if (Array.isArray(obj.sections)) {
                obj.sections.forEach((sec: any) => {
                    text += sec.title + '\n';
                    if (Array.isArray(sec.bullets)) {
                        sec.bullets.forEach((b: any) => {
                            text += '- ' + b + '\n';
                        });
                    }
                    text += '\n';
                });
            }
            finalInsight = text.trim();
        }

        return {
            insight: finalInsight,
            triples: normalizeTriples(parsed.triples)
        };
    } catch (error) {
        console.error("Error generating operating manual:", error);
        throw error;
    }
}



export async function generateMajorInsights(
    allEntries: { transcript: string; timestamp: number }[], 
    apiKey: string,
    currentInsights: string[] = [],
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ insights: string[]; triples: OKFTriple[] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const weekStart = getStartOfCurrentWeek();
    
    // Sort and limit
    const sortedEntries = [...allEntries].sort((a, b) => b.timestamp - a.timestamp);
    const weeklyEntries = sortedEntries.filter(e => e.timestamp >= weekStart);
    const globalEntriesSubset = sortedEntries.slice(0, 30);

    const weeklyTranscripts = weeklyEntries
        .map((e) => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`)
        .join('\n\n');

    const globalTranscripts = globalEntriesSubset
        .map((e) => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`)
        .join('\n\n');

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = `
  אתה אנליסט דפוסים אישי ומומחה בפסיכולוגיה קוגניטיבית של "גיא" (Guy).
  המשימה שלך היא לייצר 4 תובנות על מרכזיות, מעמיקות ומשנות תפיסה (בעלות ערך טיפולי/אימוני עמוק).
  
  סוגי התובנות הנדרשים:
  1. תובנת על גלובלית (Global Insight): תמה מרכזית שמנהלת אותו לאחרונה על סמך כלל היומנים והקשרים בגרף הידע.
  2. תובנה מעשית/ביצועית (Execution Insight): זיהוי פערים בין כוונות למציאות והתנהלות סביב משימות.
  3. תובנת מערכות יחסים (Relational Insight): תובנה על קשריו עם בני משפחתו וסביבתו.
  4. תובנת תת מונע (Subconscious Insight): חשיפת קורלציות חבויות. האם יש נושא שורש רגשי שמנהל אותו מתחת לפני השטח בהתבסס על ההיסטוריה וקשרי הידע החדשים?
  
  דרישות חובה:
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - כתוב בעברית בלבד.
  - כל תובנה חייבת להיות קצרה (3 שורות מקסימום).
  - אל תכתוב כותרות כמו "תובנה גלובלית:", פשוט את הטקסט עצמו.

  ${graphText}

  ${TRIPLES_SCHEMA_INSTRUCTION}
  החזר את התשובה בפורמט JSON אובייקט עם "insights" (מערך מחרוזות) ו-"triples". דוגמה:
  {
    "insights": ["טקסט 1", ...],
    "triples": [
      {
        "subject": "שם הישות",
        "relation": "קשר",
        "object": "מושא",
        "domain": "Work/Family/Personal/Health/Finance/General",
        "temporalContext": "Past/Present/Future",
        "confidence": "Fact/Inference/Opinion",
        "sentiment": 1/0/-1,
        "subjectType": "Person/Project/Concept/Emotion/Other",
        "objectType": "Person/Project/Concept/Emotion/Other"
      }
    ]
  }

  חומר שבועי:
  ${weeklyTranscripts || "אין מספיק נתונים מהשבוע."}

  חומר גלובלי (נציגותי):
  ${globalTranscripts}

  תובנות קיימות (למטרת יציבות):
  ${currentInsights.length > 0 ? currentInsights.join('\n') : "אין תובנות קודמות."}

  הנחיות יציבות (stability):
  - אם התובנה החדשה שאתה מייצר אינה "חזקה", עמוקה או רלוונטית משמעותית יותר מהתובנה הקיימת באותו המיקום, העדף להחזיר את הטקסט הקיים כמעט כלשונו או עם שינויים מזעריים.
  - עדכן תובנה רק אם יש "בשר" חדש או תובנה עמוקה יותר שנובעת מהחומר החדש.

  הקשר משפחתי:
  ${FIXED_CONTEXT}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (Array.isArray(parsed)) return { insights: parsed, triples: [] };
        return {
            insights: parsed.insights || [],
            triples: normalizeTriples(parsed.triples)
        };
    } catch (error) {
        console.error("Error generating major insights:", error);
        throw error;
    }
}


export async function generateBiDailyThreads(
    allEntries: { id: string; transcript: string; timestamp: number }[],
    knowledgeGraph: { nodes: any[]; edges: any[] },
    apiKey: string
): Promise<{ threads: string[]; triples: OKFTriple[] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000;
    const newEntries = allEntries.filter(e => e.timestamp >= fortyEightHoursAgo);
    
    if (newEntries.length === 0) { return { threads: [], triples: [] }; }

    // Filter edges from the last 48 hours to pass as OKF context
    const recentEdges = knowledgeGraph.edges.filter(e => e.timestamp && e.timestamp >= fortyEightHoursAgo);
    const recentEdgesStr = recentEdges.map(e => `- [${e.source}] --(${e.relation})--> [${e.target}]`).join('\n');

    const recentTranscripts = newEntries
        .map(e => `[Entry Date: ${new Date(e.timestamp).toLocaleString('he-IL')}]: ${e.transcript}`)
        .join('\n\n');

    const prompt = `
  You are an expert personal growth coach and analyst for "גיא" (Guy).
  Your task is to identify key unresolved thoughts, dilemmas, or active intentions Guy wants to resolve or advance.
  Instead of doing this per-entry, you are scanning the new developments from the last 48 hours.
  
  We are using the OKF (Obsidian Knowledge Folder) structure. Here are the NEW relations/concepts that were added to Guy's Knowledge Graph in the last 48 hours:
  ${recentEdgesStr || 'No new graph relationships.'}
  
  And here are the transcripts of the diary entries from the last 48 hours:
  ${recentTranscripts}
  
  Analyze the new graph relations and the diary transcripts. Extract up to 4 of the MOST IMPORTANT and critical unresolved open threads or dilemmas.
  
  ${TRIPLES_SCHEMA_INSTRUCTION}

  Rules:
  1. Return a maximum of 4 open threads. Only choose the ones that carry significant emotional weight, recurrent conflict, or are key decisions.
  2. Phrase them as a short reflective statement or question in Hebrew (e.g., 'איך לקדם את השיחה מול הבוס?' or 'הרצון למצוא זמן שקט לעצמי').
  3. Avoid simple lists of tasks (e.g., "buy milk"). Focus on the underlying intention or psychological dilemma.
  4. Return the result in clear JSON format containing "threads" (array of strings) and "triples" (new OKF relations). Example:
  {
    "threads": ["חוט 1"],
    "triples": [
      {
        "subject": "שם הישות",
        "relation": "קשר",
        "object": "מושא",
        "domain": "Work/Family/Personal/Health/Finance/General",
        "temporalContext": "Past/Present/Future",
        "confidence": "Fact/Inference/Opinion",
        "sentiment": 1/0/-1,
        "subjectType": "Person/Project/Concept/Emotion/Other",
        "objectType": "Person/Project/Concept/Emotion/Other"
      }
    ]
  }
  
  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (Array.isArray(parsed)) return { threads: parsed, triples: [] };
        return {
            threads: parsed.threads || [],
            triples: normalizeTriples(parsed.triples)
        };
    } catch (error) {
        console.error("Error generating bi-daily threads:", error);
        return { threads: [], triples: [] };
    }
}
