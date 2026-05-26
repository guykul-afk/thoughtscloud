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

export interface ProcessedSession {
    transcript: string;
    openThreads: string[];
    insights: string[];
    topics: string[];
    mood: string;
    triples: [string, string, string][];
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

// Fixed context for Guy's family
const FIXED_CONTEXT = `
שמות בני המשפחה של גיא:
- טלי: אשתי
- גיל: הבת שלי
- איתן: הבן שלי
- נוה: הבן שלי
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
        throw new Error("התגובה מה-AI לא הייתה בפורמט תקין. נסה שוב.");
    }
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
    "triples": [["Subject", "Relation", "Object"], ["שינה", "משפיעה על", "עבודה"]]
  }

  CRITICAL HALUCINATION PREVENTION:
  If the audio is silent or contains no meaningful speech, you MUST return empty arrays for openThreads, insights, topics, and triples, and set mood to "N/A". DO NOT invent any information, openThreads, or insights that are not explicitly present in the audio.

  CRITICAL RULES FOR OPEN THREADS (חוטים פתוחים):
  1. Focus on unresolved emotional issues, relationships, work or personal dilemmas, plans, or internal conflicts that Guy is reflecting upon.
  2. Avoid dry list-style tasks (like "buy groceries"). Instead, capture the underlying intention or dilemma.
  3. DEDUPLICATION: Compare identified open threads with the "Current Open Threads" list below. If a thread is already open and covers the same issue, ignore it to prevent duplicates.

  KNOWLEDGE GRAPH TRIPLES:
  Extract exactly 3-7 meaningful relationships as [Subject, Relation, Object].
  - Focus on people (family members), work projects, persistent emotions, and causes/effects.
  - Examples: ["טלי", "ביקשה", "להכין ארוחת ערב"], ["פרויקט X", "גורם ל", "לחץ"], ["גיא", "מרגיש", "סיפוק"].
  - Use consistent naming for the same entities.

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
    "triples": [["Subject", "Relation", "Object"], ["שינה", "משפיעה על", "עבודה"]]
  }

  CRITICAL HALUCINATION PREVENTION:
  If the text is too short, meaningless, or contains no actionable/insightful information, you MUST return empty arrays for openThreads, insights, topics, and triples, and set mood to "N/A". DO NOT invent any information, openThreads, or insights that are not explicitly present in the text.

  CRITICAL RULES FOR OPEN THREADS (חוטים פתוחים):
  1. Focus on unresolved emotional issues, relationships, work or personal dilemmas, plans, or internal conflicts that Guy is reflecting upon.
  2. Avoid dry list-style tasks (like "buy groceries"). Instead, capture the underlying intention or dilemma.
  3. DEDUPLICATION: Compare identified open threads with the "Current Open Threads" list below. If a thread is already open and covers the same issue, ignore it to prevent duplicates.

  KNOWLEDGE GRAPH TRIPLES:
  Extract exactly 3-7 meaningful relationships as [Subject, Relation, Object].
  - Focus on people (family members), work projects, persistent emotions, and causes/effects.
  - Examples: ["טלי", "ביקשה", "להכין ארוחת ערב"], ["פרויקט X", "גורם ל", "לחץ"], ["גיא", "מרגיש", "סיפוק"].
  - Use consistent naming for the same entities.

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

export async function generateWeeklyBriefing(allEntries: { transcript: string; timestamp: number }[], apiKey: string): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    const now = new Date();
    const currentDateTime = now.toLocaleString('he-IL', { dateStyle: 'full', timeStyle: 'short' });

    // Filter entries from the current week (Sunday-Saturday)
    const weekStart = getStartOfCurrentWeek();
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= weekStart)
        .map((e) => `[Entry Date: ${new Date(e.timestamp).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })}]: ${e.transcript}`)
        .join('\n\n');

    if (!recentTranscripts) {
        return "אין עדיין מספיק נתונים מהשבוע האחרון כדי לייצר תובנה שבועית.";
    }

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

  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;


    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text() || "לא הצלחתי לייצר תובנה שבועית כרגע.";
    } catch (error: any) {
        console.error("Error generating weekly briefing:", error);
        throw error;
    }
}

export async function generateCategoricalInsights(allEntries: { transcript: string; timestamp: number }[], apiKey: string): Promise<{ work: string; family: string; personal: string }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: liteModelName }, { apiVersion: activeApiVersion as any });

    const weekStart = getStartOfCurrentWeek();
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= weekStart)
        .map((e) => `[Entry Date: ${new Date(e.timestamp).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })}]: ${e.transcript}`)
        .join('\n\n');

    if (!recentTranscripts) {
        return {
            work: "אין מספיק נתונים מהשבוע האחרון.",
            family: "אין מספיק נתונים מהשבוע האחרון.",
            personal: "אין מספיק נתונים מהשבוע האחרון."
        };
    }

    const prompt = `
  You are an expert personal growth coach and psychological analyst for "גיא" (Guy).
  Analyze his transcripts from the last week and extract exactly 3 key insights in the following categories:
  1. Work (עבודה)
  2. Family (משפחה)
  3. Personal/Psychological (אישי - ניתוח פסיכולוגי)

  Return the result in clear JSON format:
  {
    "work": "Insight about work, addressing Guy personally",
    "family": "Insight about family, addressing Guy personally",
    "personal": "Deep psychological insight, addressing the user directly"
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
        return parseAIResponse(response.text());
    } catch (error: any) {
        console.error("Error generating categorical insights:", error);
        return {
            work: "שגיאה בעיבוד הנתונים.",
            family: "שגיאה בעיבוד הנתונים.",
            personal: "שגיאה בעיבוד הנתונים."
        };
    }
}

export async function generateShadowQuickAdvices(shadowWorkInsight: string, allEntries: { transcript: string; timestamp: number }[], apiKey: string): Promise<string[]> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= fourteenDaysAgo)
        .map(e => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`)
        .join('\n\n');

    if (!shadowWorkInsight) {
        return ["אין מספיק נתוני עבודת צללים (Shadow Work) זמינים עדיין כדי לייצר עצות."];
    }

    const prompt = `
  אתה פסיכולוג ומומחה עבודת צללים של "גיא". 
  לפניך סיכום נקודת העבודה הנוכחית של גיא מתוך ניתוח עבודת הצללים (Shadow Work) שלו:
  "${shadowWorkInsight}"

  קח בחשבון את הסיכום הזה ואת היומנים מהשבועיים האחרונים, וצור בדיוק 5 עצות קצרות ומהירות להתמודדות מעשית.
  
  דרישות:
  - כל עצה חייבת להיות בין משפט אחד לשניים בלבד.
  - פנה ישירות לגיא בגוף שני ("אתה", "כדאי ש...").
  - התמקד ביישום יומיומי קצר ומיידי שיכול לעזור לו עם הפער שתואר בעבודת הצללים.
  - החזר תשובה בפורמט JSON בלבד. המבנה חייב להיות מערך של 5 מחרוזות. (לדוגמה: ["עצה 1", "עצה 2", "עצה 3", "עצה 4", "עצה 5"]). ללא שום טקסט נוסף לפני או אחרי עטיפת ה-JSON.

  היומנים מהשבועיים האחרונים:
  ${recentTranscripts}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return parseAIResponse(response.text());
    } catch (error: any) {
        console.error("Error generating shadow quick advices:", error);
        return [
            "שגיאה ביצירת עצות המבוססות על עבודת צללים."
        ];
    }
}

export async function generateSingleShadowQuickAdvice(shadowWorkInsight: string, allEntries: { transcript: string; timestamp: number }[], existingAdvices: string[], apiKey: string): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= fourteenDaysAgo)
        .map(e => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`)
        .join('\n\n');

    if (!shadowWorkInsight) {
        return "אין מספיק נתוני עבודת צללים זמינים כרגע כדי לייצר עצה חדשה.";
    }

    const existingListStr = existingAdvices.map((a, i) => `${i + 1}. ${a}`).join('\n');

    const prompt = `
  אתה פסיכולוג ומומחה עבודת צללים של "גיא". 
  לפניך סיכום נקודת העבודה הנוכחית של גיא מתוך ניתוח עבודת הצללים (Shadow Work) שלו:
  "${shadowWorkInsight}"

  קח בחשבון את הסיכום הזה ואת היומנים מהשבועיים האחרונים.
  כמו כן, לפניך העצות המהירות הקיימות כרגע ברשימה שלו:
  ${existingListStr}

  צור עצה מהירה אחת חדשה לגמרי להתמודדות מעשית, שתחליף את העצה הכי פחות רלוונטית או הכי ותיקה שלו.
  העצה החדשה חייבת להיות שונה מכל העצות הקיימות ברשימה!
  
  דרישות:
  - העצה חייבת להיות בין משפט אחד לשניים בלבד.
  - פנה ישירות לגיא בגוף שני ("אתה", "כדאי ש...").
  - התמקד ביישום יומיומי קצר ומיידי שיכול לעזור לו עם הפער שתואר בעבודת הצללים.
  - החזר תשובה בפורמט JSON בלבד. המבנה חייב להיות אובייקט עם שדה "advice" המכיל את מחרוזת העצה. (לדוגמה: {"advice": "עצה חדשה..."}). ללא שום טקסט נוסף לפני או אחרי עטיפת ה-JSON.

  היומנים מהשבועיים האחרונים:
  ${recentTranscripts}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (typeof parsed === 'object' && parsed !== null) {
            if (parsed.advice) return parsed.advice;
            if (Array.isArray(parsed)) return parsed[0];
        }
        return typeof parsed === 'string' ? parsed : response.text().trim();
    } catch (error: any) {
        console.error("Error generating single shadow quick advice:", error);
        return "זהה רגש אחד חסום היום ותן לו ביטוי בכתיבה של שתי דקות.";
    }
}

export async function generateAdvices(allEntries: { transcript: string; timestamp: number }[], apiKey: string): Promise<{ work: string; family: string; mental: string }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= thirtyDaysAgo)
        .map(e => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`)
        .join('\n\n');

    if (!recentTranscripts) {
        return {
            work: "אין מספיק נתונים לחודש האחרון כדי לייצר עצה בעבודה.",
            family: "אין מספיק נתונים לחודש האחרון כדי לייצר עצה למשפחה.",
            mental: "אין מספיק נתונים לחודש האחרון כדי לייצר עצה לרווחה הנפשית."
        };
    }

    const prompt = `
  אתה יועץ אישי ופסיכולוגי בכיר של "גיא".
  תפקידך לסקור את יומנו מ-30 הימים האחרונים ולספק לו 3 עצות קונקרטיות ופעילות בתחומים הבאים:
  1. עבודה (Work)
  2. משפחה (Family)
  3. רווחה נפשית (Mental Well-being)

  דרישות:
  - על כל עצה להיות **קצרה מאוד, עד 3 שורות לכל היותר**. עצה פרקטית וישירה אליו.
  - פנה למשתמש ישירות בגוף שני ("אתה", למשל: "כדאי לך...").
  - כתוב בעברית קולחת ומעוררת השראה.
  - החזר תשובה בפורמט JSON בלבד (ללא טקסט נוסף):
  {
    "work": "עצה קצרה ואקטיבית לעבודה",
    "family": "עצה קצרה ואקטיבית למשפחה",
    "mental": "עצה קצרה ואקטיבית לרווחה"
  }

  הקשר קבוע לגבי המשפחה:
  ${FIXED_CONTEXT}

  היומנים מהחודש האחרון:
  ${recentTranscripts}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return parseAIResponse(response.text());
    } catch (error: any) {
        console.error("Error generating advices:", error);
        throw error;
    }
}

export async function generateLifeThemesAnalysis(allEntries: { transcript: string; timestamp: number }[], apiKey: string, type: 'weekly' | 'monthly'): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    const timeRangeText = type === 'weekly' ? 'מהשבוע האחרון' : 'מהחודש האחרון';
    const threshold = type === 'weekly' ? 7 : 30;
    const entriesToAnalyze = allEntries.filter(e => e.timestamp >= (Date.now() - threshold * 24 * 60 * 60 * 1000));

    if (entriesToAnalyze.length === 0) return `אין מספיק נתונים ${timeRangeText} לניתוח תמות חיים.`;

    const transcripts = entriesToAnalyze
        .map(e => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`)
        .join('\n\n');


    const prompt = `
  אתה אנליסט דפוסים אישי ומומחה בפסיכולוגיה של "תמות חיים" (Life Themes).
  המשימה שלך: לנתח את המחשבות של גיא ${timeRangeText} ולזהות 2-3 "תמות על" - נושאים מרכזיים שחוזרים על עצמם, גם אם בדרכים שונות.
  בנוסף, השווה את התמות האלו למה שאתה מזהה כ"עבר רחוק יותר" (מתוך כלל החומר) וציין אם יש שינוי, התקדמות או נסיגה.


  דרישות:
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - כתוב בעברית קולחת ומקצועית אך נגישה.
  - התמקד ב"למה" מאחורי הדברים, לא רק ב"מה".
  
  החומר לניתוח:
  ${transcripts}

  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;


    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text() || "לא הצלחתי לייצר ניתוח תמות חיים.";
    } catch (error) {
        console.error("Error generating life themes:", error);
        throw error;
    }
}

export async function analyzeExecutionGap(allEntries: { transcript: string; tasks?: any[]; timestamp: number }[], apiKey: string): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    // Focus on recent actions vs intentions (last 30 days roughly)
    const recentEntries = [...allEntries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);
    if (recentEntries.length === 0) return "אין עדיין נתונים לבדיקת פערי ביצוע.";

    const transcriptsAndTasks = recentEntries
        .map(e => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]\nמחשבות בדיווח: ${e.transcript}\nמשימות שהוגדרו: ${(e.tasks || []).map(t => typeof t === 'string' ? t : t.text).join(', ')}`)
        .join('\n\n');

    const prompt = `
  אתה מומחה לפסיכולוגיה התנהגותית. המשימה שלך היא לבדוק את "פער הביצוע" (Expectation vs. Reality Mapping) של גיא - הפער בין התוכניות המשימות והכוונות שהוא מצהיר עליהן ביומן, לבין מה שהוא עושה בפועל בדיווחים ובמחשבות העוקבות.
  זהה "דחיינות כרונית" או אזורים בהם יש הימנעות רגשית מתמדת למרות כוונות טובות.
  
  דרישות:
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - הבא דוגמה קונקרטית מתוך הנתונים שלו (משימה או כוונה שנמנעה מספר פעמים ואת התירוצים שניתנו).
  - היה ביקורתי (פרקליט השטן) אבל תן הצעה טיפולית.
  - כתוב בעברית בלבד. 2-3 פסקאות קצרות.

  נתונים לניתוח (הצהרות מול דיווח על מה שקרה באמת בימים העוקבים):
  ${transcriptsAndTasks}

  הקשר:
  ${FIXED_CONTEXT}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text() || "אין כרגע פערי ביצוע בולטים.";
    } catch (error) {
        console.error("Error analyzing execution gap:", error);
        return "שגיאה בניתוח פער הביצוע.";
    }
}

export async function generateEmotionalGTDInsight(allEntries: { transcript: string; timestamp: number }[], apiKey: string): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: liteModelName }, { apiVersion: activeApiVersion as any });

    const recentTranscripts = allEntries
        .slice(0, 10) 
        .map(e => e.transcript)
        .join('\n\n');

    const prompt = `
  אתה מומחה לניתוח מעמקים רגשי ותובנות יומיומיות. במקום להתמקד רק ברשימות משימות, אתה עוזר לגיא להבין אילו נושאים "תוקעים" אותו רגשית ואיך לגשת אליהם.
  נתח את מצבו היום והצע לו "תובנה רגשית יומית עיקרית" אחת - ניתוח קצר של מה שהכי מעסיק אותו היום, ואיך הוא יכול לפעול בנושא.

  דרישות חובה:
  - השתמש בבולטים (bullets) ברורים וקצרים.
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - כתוב בעברית בלבד.
  - מבנה התשובה: פתיחה קצרה, ואז 2-3 בולטים של תובנות/פעולות מוצעות.
  
  הקשר אחרון:
  ${recentTranscripts}

  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;


    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text() || "לא הצלחתי לייצר תובנת GTD רגשית.";
    } catch (error) {
        console.error("Error generating emotional GTD insight:", error);
        throw error;
    }
}

export async function generateOperatingManual(allEntries: { transcript: string; timestamp: number }[], apiKey: string): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    const isFirstOfMonth = new Date().getDate() === 1;
    
    // Only send full history on the 1st of the month, otherwise limit to last 30 entries
    const entriesToAnalyze = isFirstOfMonth
        ? [...allEntries].sort((a, b) => b.timestamp - a.timestamp)
        : [...allEntries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);

    if (entriesToAnalyze.length === 0) return "עדיין אין מספיק נתונים כדי לייצר את ספר ההפעלה שלך. המשך לשתף במחשבות!";

    const transcripts = entriesToAnalyze
        .map(e => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`)
        .join('\n\n');

    const prompt = `
  אתה מומחה לניתוח דפוסי התנהגות ופסיכולוגיה קוגניטיבית. המטרה שלך היא לכתוב את "ספר ההפעלה" (Personal Operating Manual) of גיא.
  זהו מסמך פרקטי שמרכז את התובנות העמוקות ביותר על איך גיא "עובד" הכי טוב, מה מניע אותו, ומה עוצר אותו.
  עליך לפעול כ"פרקליט השטן" מול דפוסים מתחמקים או סתירות פנימיות. זהה איפה גיא משקר לעצמו לאורך זמן ומה הסתירות הקבועות בהתנהגותו.

  המשימה שלך: נתח את כל המחשבות והשיחות של גיא וחלץ דפוסים חוזרים בנקודות קצרות וברורות בנושאים הבאים:
  1. תנאים להצלחה ומוטיבציה (מה עוזר לו להיות במיטבו).
  2. טריגרים רגשיים וחסמים (מה מוציא אותו מאיזון - דגש על פערים בין הצהרות למציאות).
  3. סביבת עבודה ותקשורת (איך כדאי לו לגשת למשימות או לאנשים בהתבסס על הצלחות העבר).
  4. המלצות פרקטיות למניעה (מה הוא יכול לעשות כשמתחיל דפוס שלילי).

  דרישות חובה:
  - כתוב בבוליטים (bullets) קצרים, חדים וברורים.
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - כתוב בעברית בלבד.
  - התמקד במידע פרקטי ויישומי לטווח ארוך.
  
  החומר לניתוח:
  ${transcripts}

  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text() || "לא הצלחתי לייצר את ספר ההפעלה כרגע.";
    } catch (error) {
        console.error("Error generating operating manual:", error);
        throw error;
    }
}



export async function generateMajorInsights(
    allEntries: { transcript: string; timestamp: number }[], 
    apiKey: string,
    currentInsights: string[] = []
): Promise<string[]> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

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

    const prompt = `
  אתה מומחה לניתוח פסיכולוגי ואימון אישי עבור "גיא" (Guy).
  המשימה שלך היא לייצר בדיוק 4 תובנות עיקריות, קצרות ומדויקות (עד 3 שורות לכל אחת).
  
  התובנות הנדרשות:
  1. תובנה גלובלית: ניתוח של כל חומר הגלם לאורך כל ההיסטוריה - זהה דפוס עומק או שינוי ארוך טווח.
  2. תובנה שבועית: סיכום המגמות והאירועים מהשבוע האחרון בלבד.
  3. תובנה משמעותית נבחרת: תובנה אחת שהמערכת בוחרת כחשובה ביותר כרגע.
  4. תובנת תת מודע (Subconscious Insight): חשיפת קורלציות חבויות. האם יש נושא שורש רגשי שמנהל אותו מתחת לפני השטח בהתבסס על ההיסטוריה? (למשל: סטרס כלכלי שמתבטא בהפרעות שינה שימים אחרי מתבטא בכעס על נוה).

  דרישות חובה:
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - כתוב בעברית בלבד.
  - כל תובנה חייבת להיות קצרה (3 שורות מקסימום).
  - אל תכתוב כותרות כמו "תובנה גלובלית:", פשוט את הטקסט עצמו.
  - החזר את התשובה בפורמט JSON של מערך מחרוזות אורך 4 בדיוק: ["טקסט 1", "טקסט 2", "טקסט 3", "טקסט 4"]

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
        return parseAIResponse(response.text());
    } catch (error) {
        console.error("Error generating major insights:", error);
        throw error;
    }
}
