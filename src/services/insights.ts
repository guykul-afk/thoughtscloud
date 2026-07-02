import { getGenAI, activeModelName, activeApiVersion, liteModelName } from './ai-config';
import { FIXED_CONTEXT, TRIPLES_SCHEMA_INSTRUCTION } from './prompts';
import type { OKFTriple } from './extraction';
import { normalizeTriples, parseAIResponse, buildGraphContext } from './extraction';
import { getStartOfCurrentWeek } from '../utils/dateUtils';

export async function getOrGenerateEpisodicSummary(
    allEntries: any[],
    apiKey: string,
    periodKey: string
): Promise<any> {
    const { FirebaseStorageService } = await import('./FirebaseStorageService');
    let episodicSummary = await FirebaseStorageService.loadEpisodicSummary(periodKey);

    const weekStart = getStartOfCurrentWeek();
    const recentEntries = allEntries.filter(e => e.timestamp >= weekStart);
    const recentIds = recentEntries.map(e => e.id || '');

    const isOutdated = !episodicSummary || 
        !episodicSummary.derived_from ||
        recentIds.length !== episodicSummary.derived_from.length ||
        recentIds.some(id => !episodicSummary.derived_from.includes(id));

    if (isOutdated && recentEntries.length > 0) {
        console.log(`[Map] Generating/updating episodic summary for period ${periodKey}...`);
        const genAI = getGenAI(apiKey);
        const model = genAI.getGenerativeModel({ 
            model: liteModelName,
            generationConfig: { responseMimeType: "application/json" }
        }, { apiVersion: activeApiVersion as any });
        
        const transcriptsText = recentEntries.map(e => `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`).join('\n');
        
        const mapPrompt = `
Analyze the following personal diary entries from this week and generate a concise episodic summary.
Include main topics, key events, and general emotional state.

Transcripts:
${transcriptsText}

Return only a valid JSON response:
{
  "summary": "הסיכום שלך בעברית...",
  "mood": "מצב רוח כללי..."
}
`;
        try {
            const result = await model.generateContent(mapPrompt);
            const parsed = parseAIResponse(result.response.text());
            episodicSummary = {
                summary: parsed.summary || 'אין סיכום',
                mood: parsed.mood || 'ניטרלי',
                derived_from: recentIds
            };
            await FirebaseStorageService.saveEpisodicSummary(periodKey, episodicSummary);
        } catch (e) {
            console.error("Failed to generate episodic summary in Map step:", e);
            episodicSummary = {
                summary: "עיבוד נכשל. שימוש ברשומות גולמיות.",
                derived_from: recentIds
            };
        }
    }
    return episodicSummary;
}

export async function generateWeeklyBriefing(
    allEntries: any[],
    apiKey: string,
    _relevantPastEntries?: any[],
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ insight: string; triples: OKFTriple[] }> {
    const { getWeekPeriodKey } = await import('../utils/dateUtils');
    const periodKey = getWeekPeriodKey(Date.now());

    const weekStart = getStartOfCurrentWeek();
    const recentEntries = allEntries.filter(e => e.timestamp >= weekStart);

    if (recentEntries.length === 0) {
        return { insight: "אין עדיין מספיק נתונים מהשבוע האחרון כדי לייצר תובנה שבועית.", triples: [] };
    }

    const episodicSummary = await getOrGenerateEpisodicSummary(allEntries, apiKey, periodKey);

    // --- REDUCE STEP ---
    console.log(`[Reduce] Generating weekly briefing for period ${periodKey} from episodic summary...`);
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = `
  You are an expert personal growth coach and analyst for "גיא" (Guy).
  Please provide a deep, high-level "Weekly Insight" (תובנה שבועית) based on his weekly episodic summary and knowledge graph context.
  
  *CRITICAL SHADOW WORK REQUIREMENT*: Look for contradictions. Point out any cognitive dissonance or "stories" Guy tells himself. Be direct but constructive.

  CRITICAL: 
  - Address the user directly in the second person ("אתה").
  - MUST BE IN FLUENT HEBREW.

  Weekly Episodic Summary:
  ${episodicSummary.summary}
  (Derived from entries: ${episodicSummary.derived_from.join(', ')})

  ${graphText}

  ${TRIPLES_SCHEMA_INSTRUCTION}
  Return your response ONLY as a JSON object:
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
        "subjectType": "MVP Entity type",
        "objectType": "MVP Entity type"
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
    allEntries: any[],
    apiKey: string,
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ work: string; family: string; personal: string; triples: OKFTriple[] }> {
    const { getWeekPeriodKey } = await import('../utils/dateUtils');
    const periodKey = getWeekPeriodKey(Date.now());

    const weekStart = getStartOfCurrentWeek();
    const recentEntries = allEntries.filter(e => e.timestamp >= weekStart);

    if (recentEntries.length === 0) {
        return {
            work: "אין מספיק נתונים מהשבוע האחרון.",
            family: "אין מספיק נתונים מהשבוע האחרון.",
            personal: "אין מספיק נתונים מהשבוע האחרון.",
            triples: []
        };
    }

    const episodicSummary = await getOrGenerateEpisodicSummary(allEntries, apiKey, periodKey);

    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: liteModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = `
  You are an expert personal growth coach and psychological analyst for "גיא" (Guy).
  Analyze his weekly episodic summary and knowledge graph context to extract exactly 3 key insights.
  
  Weekly Episodic Summary:
  ${episodicSummary ? episodicSummary.summary : recentEntries.map(e => e.transcript).join('\n')}

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
        "subjectType": "MVP Entity type",
        "objectType": "MVP Entity type"
      }
    ]
  }

  CRITICAL:
  - Address the user directly in the second person ("אתה").
  - MUST BE IN FLUENT HEBREW.
  - Tone should be warm and professional.

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
