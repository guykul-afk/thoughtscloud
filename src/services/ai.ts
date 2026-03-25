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
    tasks: string[];
    taskUpdates?: { originalText: string; updatedText: string }[];
    insights: string[];
    topics: string[];
    mood: string;
    triples: [string, string, string][];
}

// Optimized Model Selection Logic based on user's confirmed availability
export const SUPPORTED_MODELS = [
    { name: 'gemini-2.5-flash', version: 'v1' },
    { name: 'gemini-2.0-flash', version: 'v1' },
    { name: 'gemini-2.5-pro', version: 'v1' },
    { name: 'gemini-2.0-flash-lite', version: 'v1' }
];

let activeModelName = 'gemini-2.5-flash';
let activeApiVersion = 'v1';

export const setActiveModel = (name: string, version: string = 'v1') => {
    activeModelName = name;
    activeApiVersion = version;
};

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
        return JSON.parse(cleanJson);
    } catch (e) {
        console.error("Failed to parse AI response as JSON:", text);
        throw new Error("התגובה מה-AI לא הייתה בפורמט תקין. נסה שוב.");
    }
};

export async function processAudioSession(audioBlob: Blob, apiKey: string, currentOpenTasks: string[] = []): Promise<ProcessedSession> {
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
    "transcript": "The full exact transcript. MUST BE IN HEBREW.",
    "tasks": ["Array of NEW practical tasks or actionable items. MUST BE IN HEBREW.", ...],
    "taskUpdates": [{"originalText": "existing task text", "updatedText": "new version"}],
    "insights": ["Array of psychological or general insights. MUST BE IN HEBREW.", ...],
    "topics": ["Array of short tags/categories. MUST BE IN HEBREW.", ...],
    "mood": "A short description of tone/mood. MUST BE IN HEBREW.",
    "triples": [["Subject", "Relation", "Object"], ["שינה", "משפיעה על", "עבודה"]]
  }

  CRITICAL RULES FOR TASKS:
  1. INTENT CLASSIFICATION: Only create a task if you identify an ACTIVE VERB and a TIMEFRAME (e.g., "today", "tomorrow", "this week", or implied immediate action). DO NOT create tasks for purely emotional/reflective thoughts (e.g., "I feel sad").
  2. DEDUPLICATION: Compare identified tasks with the "Current Open Tasks" list below. 
     - If a task is already present and unchanged, ignore it.
     - If a task is present but needs updating (e.g., more detail, new deadline), add it to "taskUpdates".
     - If a task is fundamentally new, add it to "tasks".

  KNOWLEDGE GRAPH TRIPLES:
  Extract exactly 3-7 meaningful relationships as [Subject, Relation, Object].
  - Focus on people (family members), work projects, persistent emotions, and causes/effects.
  - Examples: ["טלי", "ביקשה", "להכין ארוחת ערב"], ["פרויקט X", "גורם ל", "לחץ"], ["גיא", "מרגיש", "סיפוק"].
  - Use consistent naming for the same entities.

  Current Open Tasks:
  ${currentOpenTasks.length > 0 ? currentOpenTasks.map(t => `- ${t}`).join('\n') : 'None'}
  
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

export async function processTextSession(textData: string, apiKey: string, currentOpenTasks: string[] = []): Promise<ProcessedSession> {
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
    "transcript": "The full exact text. MUST BE IN HEBREW.",
    "tasks": ["Array of NEW practical tasks or actionable items. MUST BE IN HEBREW.", ...],
    "taskUpdates": [{"originalText": "existing task text", "updatedText": "new version"}],
    "insights": ["Array of psychological or general insights. MUST BE IN HEBREW.", ...],
    "topics": ["Array of short tags/categories. MUST BE IN HEBREW.", ...],
    "mood": "A short description of tone/mood. MUST BE IN HEBREW.",
    "triples": [["Subject", "Relation", "Object"], ["שינה", "משפיעה על", "עבודה"]]
  }

  CRITICAL RULES FOR TASKS:
  1. INTENT CLASSIFICATION: Only create a task if you identify an ACTIVE VERB and a TIMEFRAME (e.g., "today", "tomorrow", "this week", or implied immediate action). DO NOT create tasks for purely emotional/reflective thoughts (e.g., "I feel sad").
  2. DEDUPLICATION: Compare identified tasks with the "Current Open Tasks" list below. 
     - If a task is already present and unchanged, ignore it.
     - If a task is present but needs updating (e.g., more detail, new deadline), add it to "taskUpdates".
     - If a task is fundamentally new, add it to "tasks".

  KNOWLEDGE GRAPH TRIPLES:
  Extract exactly 3-7 meaningful relationships as [Subject, Relation, Object].
  - Focus on people (family members), work projects, persistent emotions, and causes/effects.
  - Examples: ["טלי", "ביקשה", "להכין ארוחת ערב"], ["פרויקט X", "גורם ל", "לחץ"], ["גיא", "מרגיש", "סיפוק"].
  - Use consistent naming for the same entities.

  Current Open Tasks:
  ${currentOpenTasks.length > 0 ? currentOpenTasks.map(t => `- ${t}`).join('\n') : 'None'}

  CRITICAL: ALL text values MUST be in Hebrew. Supporting and personal tone.

  Here is the text:
  ${textData}

  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;


    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return parseAIResponse(response.text());

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
        korczakAnalysis?: string;
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
        if (context.korczakAnalysis) {
            contextData += `\n[ניתוח לפי "זמן לעשרה עניינים" של קורצ'ק]: ${context.korczakAnalysis}\n`;
        }
        if (context.chatHistory && context.chatHistory.length > 0) {
            contextData += `\n[היסטוריית שיחה אחרונה]:\n`;
            contextData += context.chatHistory.slice(-10).map(m => 
                `${m.role === 'user' ? 'גיא שאל' : 'אתה ענית'}: ${m.content}`
            ).join('\n');
            contextData += `\n`;
        }
    }

    const prompt = `
  You are an expert personal assistant for "גיא" (Guy).
  You have access to Guy's past diary transcripts and potentially some generated weekly/categorical insights.
  Today is: ${currentDateTime} (Current Date and Time).
  Guy is asking you a question about his past entries or the insights you've provided.
  
  When answering, address Guy personally by his name "גיא" occasionally. 
  Be warm, insightful, and supportive.

  Here is Guy's question:
  "${question}"
  
  ${contextData ? `להלן התובנות הנוכחיות שלך כהקשר נוסף:\n${contextData}` : ""}
  
 

  Here are all of Guy's past transcripts with their recorded dates:
  ${allEntries.map((e) => `[Entry Date: ${new Date(e.timestamp).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })}]: ${e.transcript}`).join('\n\n')}
  
 

  Please provide a helpful, deep, and insightful answer to Guy's question based on the transcripts and context provided above. 
  CRITICAL: Answer MUST be in fluent Hebrew. If the answer is not in the material, state that gently in Hebrew, addressing Guy by name.

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
  - Address Guy personally by his name "גיא".
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
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

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
    "personal": "Deep psychological insight, addressing Guy personally"
  }

  CRITICAL:
  - Address Guy personally by his name "גיא".
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
  - פנה לגיא בשמו באופן אישי וחם.
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
  - פנה לגיא אישית בשמו "גיא".
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
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    const recentTranscripts = allEntries
        .slice(0, 10) 
        .map(e => e.transcript)
        .join('\n\n');

    const prompt = `
  אתה מומחה לניתוח מעמקים רגשי ותובנות יומיומיות. במקום להתמקד רק ברשימות משימות, אתה עוזר לגיא להבין אילו נושאים "תוקעים" אותו רגשית ואיך לגשת אליהם.
  נתח את מצבו היום והצע לו "תובנה רגשית יומית עיקרית" אחת - ניתוח קצר של מה שהכי מעסיק אותו היום, ואיך הוא יכול לפעול בנושא.

  דרישות חובה:
  - השתמש בבולטים (bullets) ברורים וקצרים.
  - פנה לגיא אישית בשמו.
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

    // Use a larger set of entries for long-term pattern analysis (up to 50)
    const entriesToAnalyze = [...allEntries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);

    if (entriesToAnalyze.length === 0) return "עדיין אין מספיק נתונים כדי לייצר את ספר ההפעלה שלך. המשך לשתף במחשבות!";

    const transcripts = entriesToAnalyze
        .map(e => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`)
        .join('\n\n');

    const prompt = `
  אתה מומחה לניתוח דפוסי התנהגות ופסיכולוגיה קוגניטיבית. המטרה שלך היא לכתוב את "ספר ההפעלה" (Personal Operating Manual) של גיא.
  זהו מסמך פרקטי שמרכז את התובנות העמוקות ביותר על איך גיא "עובד" הכי טוב, מה מניע אותו, ומה עוצר אותו.
  עליך לפעול כ"פרקליט השטן" מול דפוסים מתחמקים או סתירות פנימיות. זהה איפה גיא משקר לעצמו לאורך זמן ומה הסתירות הקבועות בהתנהגותו.

  המשימה שלך: נתח את כל המחשבות והשיחות של גיא וחלץ דפוסים חוזרים בנקודות קצרות וברורות בנושאים הבאים:
  1. תנאים להצלחה ומוטיבציה (מה עוזר לו להיות במיטבו).
  2. טריגרים רגשיים וחסמים (מה מוציא אותו מאיזון - דגש על פערים בין הצהרות למציאות).
  3. סביבת עבודה ותקשורת (איך כדאי לו לגשת למשימות או לאנשים בהתבסס על הצלחות העבר).
  4. המלצות פרקטיות למניעה (מה הוא יכול לעשות כשמתחיל דפוס שלילי).

  דרישות חובה:
  - כתוב בבוליטים (bullets) קצרים, חדים וברורים.
  - פנה לגיא אישית בשמו.
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
const KORCZAK_TEN_MATTERS = `
קח לך זמן לעבודה – זה המחיר להצלחתך
קח לך זמן לחשיבה – זה מחיר הכוח שלך
קח לך זמן למשחקים – זה סוד הנעורים שלך
קח לך זמן לקריאה – זה בסיס הידע שלך
קח לך זמן לשלווה – זה מסייע לך לשטוף את האבק מעיניך
קח לך זמן לחברות ולידידים – זהו מעיין האושר שלך
קח לך זמן לאחוות האדם – זה יבטיח לך את התרומות לזולתך
קח לך זמן לצחוק ולשובבות – זה יקל עליך את מעמסת החיים
קח לך זמן לחלומות – זה ימשוך את נפשך אלי הכוכבים
קח לך זמן לתכנון
ואז תהיה לך אפשרות לבצע את כל האחרים.
`;

export async function generateKorczakAnalysis(allEntries: { transcript: string; timestamp: number }[], apiKey: string): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    const weekStart = getStartOfCurrentWeek();
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= weekStart)
        .map(e => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`)
        .join('\n\n');

    if (!recentTranscripts) return "אין מספיק נתונים מהשבוע האחרון לביצוע ניתוח לפי 'זמן לעשרה עניינים'.";

    const prompt = `
  אתה מומחה לניהול זמן וצמיחה אישית, המשתמש בטקסט "זמן לעשרה עניינים" של יאנוש קורצ'ק כמודל להערכת איכות החיים והזמן של גיא.
  
  הנה הטקסט של קורצ'ק:
  ${KORCZAK_TEN_MATTERS}

  המשימה שלך:
  1. נתח את התיעודים של גיא מהשבוע האחרון.
  2. הערך איך הוא עמד בכל אחד מ-10 הסעיפים של קורצ'ק.
  3. ספק לגיא משוב מעמיק, אישי וחם (בעברית) על חלוקת הזמן שלו.
  4. זהה איפה הוא מצליח ואיפה חסר לו זמן (למשל, אולי הוא משקיע המון בעבודה אך מזניח את ה"שלווה" או את ה"חלומות").
  5. הצע לו 2-3 פעולות פרקטיות וקטנות לשבוע הבא כדי לאזן את חלוקת הזמן שלו לפי המודל.

  דרישות:
  - פנה לגיא אישית בשמו.
  - כתוב בעברית קולחת ומעוררת השראה.
  - השתמש בבולטים ברורים.
  
  החומר לניתוח מהשבוע האחרון:
  ${recentTranscripts}

  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text() || "לא הצלחתי לייצר ניתוח לפי קורצ'ק.";
    } catch (error) {
        console.error("Error generating Korczak analysis:", error);
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
    const globalEntriesSubset = sortedEntries.slice(0, 50);

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
  - פנה לגיא אישית בשמו.
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
