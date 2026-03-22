import { GoogleGenerativeAI } from '@google/generative-ai';

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
    insights: string[];
    topics: string[];
    mood: string;
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

export async function processAudioSession(audioBlob: Blob, apiKey: string): Promise<ProcessedSession> {
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
    "transcript": "The full exact transcript of what was said. If there are multiple speakers (Guy and AI), label them. MUST BE IN HEBREW.",
    "tasks": ["Array of practical tasks or actionable items mentioned in the audio. MUST BE IN HEBREW.", ...],
    "insights": ["Array of psychological or general insights derived from the entry for Guy. MUST BE IN HEBREW.", ...],
    "topics": ["Array of short tags/categories. MUST BE IN HEBREW.", ...],
    "mood": "A short description of Guy's tone or mood. MUST BE IN HEBREW."
  }
  
  CRITICAL: ALL text values in the JSON MUST be written in Hebrew. Use a personal and helpful tone when addressing Guy indirectly.
  
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

export async function processTextSession(textData: string, apiKey: string): Promise<ProcessedSession> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: activeModelName
    }, { apiVersion: activeApiVersion as any });

    const prompt = `
  You are an expert personal assistant and psychological profiler.
  You are assisting "גיא" (Guy).
  I am providing you with a raw text entry from Guy's personal diary.
  
  Please analyze the text and provide exactly the following in clear, valid JSON format (do not include markdown code block syntax around the JSON):
  {
    "transcript": "The full exact text. If there are multiple speakers, label them. MUST BE IN HEBREW.",
    "tasks": ["Array of practical tasks or actionable items mentioned in the text. MUST BE IN HEBREW.", ...],
    "insights": ["Array of psychological or general insights derived from the entry for Guy. MUST BE IN HEBREW.", ...],
    "topics": ["Array of short tags/categories. MUST BE IN HEBREW.", ...],
    "mood": "A short description of Guy's tone or mood. MUST BE IN HEBREW."
  }

  CRITICAL: ALL text values in the JSON MUST be written in Hebrew. Addressing Guy with a supportive and personal tone.

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

    // Filter entries from the last 7 days
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= sevenDaysAgo)
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
  
  CRITICAL: 
  - Address Guy personally by his name "גיא".
  - Provide a concise yet deep analysis.
  - MUST BE IN FLUENT HEBREW.
  - Use a warm, professional, and encouraging tone.

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

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= sevenDaysAgo)
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

export async function generateShadowWorkInsight(allEntries: { transcript: string; timestamp: number }[], apiKey: string): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= (Date.now() - 7 * 24 * 60 * 60 * 1000))
        .map(e => e.transcript)
        .join('\n\n');

    if (!recentTranscripts) return "אין מספיק חומר שבועי לניתוח Shadow Work.";

    const prompt = `
  אתה מאמן המתמחה ב-"Shadow Work" (עבודת צל). המטרה שלך היא לזהות את מה שגיא *לא* אומר, את מה שהוא מדחיק, או את הסתירות הפנימיות בדבריו מהשבוע האחרון.
  חפש רגשות מושתקים, פחדים שלא נאמרו במפורש, או מקומות שבהם הוא "מספר לעצמו סיפור" כדי להימנע מכאב.

  דרישות:
  - פנה לגיא באופן אישי.
  - היה עדין אך נוקב. המטרה היא לעזור לו לצמוח דרך מודעות ל"צל".
  - כתוב בעברית בלבד.
  
  החומר לניתוח:
  ${recentTranscripts}

  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;


    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text() || "לא הצלחתי לייצר תובנת Shadow Work.";
    } catch (error) {
        console.error("Error generating shadow work insight:", error);
        throw error;
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

  המשימה שלך: נתח את כל המחשבות והשיחות של גיא וחלץ דפוסים חוזרים בנקודות קצרות וברורות בנושאים הבאים:
  1. תנאים להצלחה ומוטיבציה (מה עוזר לו להיות במיטבו).
  2. טריגרים רגשיים וחסמים (מה מוציא אותו מאיזון).
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

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= sevenDaysAgo)
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

