const fs = require('fs');
const path = require('path');

const filePath = path.join('c:', 'Users', 'guyku', 'thought_cloud_local', 'src', 'services', 'ai.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Define buildGraphContext helper
const buildGraphContextCode = `
const buildGraphContext = (knowledgeGraph?: { nodes: any[]; edges: any[] }): string => {
    if (!knowledgeGraph || !knowledgeGraph.edges || knowledgeGraph.edges.length === 0) {
        return "";
    }
    const nodesStr = knowledgeGraph.nodes.map(n => \`- \${n.label} (חשיבות: \${n.val ? n.val.toFixed(1) : '1.0'})\`).join('\\n');
    const edgesStr = knowledgeGraph.edges.map(e => \`- [\${e.source}] --(\${e.relation})--> [\${e.target}]\`).join('\\n');
    return \`
להלן מידע מתוך גרף הידע (Knowledge Graph) האישי של גיא:
קשרים קיימים בגרף:
\${edgesStr}

צמתים חשובים בגרף:
\${nodesStr}
\`;
};
`;

// Insert buildGraphContextCode right before export async function processAudioSession
content = content.replace(
  'export async function processAudioSession',
  buildGraphContextCode + '\nexport async function processAudioSession'
);

// 1. generateWeeklyBriefing
const oldWeeklyBriefing = `export async function generateWeeklyBriefing(allEntries: { transcript: string; timestamp: number }[], apiKey: string): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    const now = new Date();
    const currentDateTime = now.toLocaleString('he-IL', { dateStyle: 'full', timeStyle: 'short' });

    // Filter entries from the current week (Sunday-Saturday)
    const weekStart = getStartOfCurrentWeek();
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= weekStart)
        .map((e) => \`[Entry Date: \${new Date(e.timestamp).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })}]: \${e.transcript}\`)
        .join('\\n\\n');

    if (!recentTranscripts) {
        return "אין עדיין מספיק נתונים מהשבוע האחרון כדי לייצר תובנה שבועית.";
    }

    const prompt = \`
  You are an expert personal growth coach and analyst for "גיא" (Guy).
  Today is: \${currentDateTime}.
  I am providing you with all of Guy's diary entries from the past week.
  Please provide a deep, high-level "Weekly Insight" (תובנה שבועית) that summarizes the main themes, emotional patterns, and progress Guy has made.
  
  *CRITICAL SHADOW WORK REQUIREMENT*: Look for contradictions. What is Guy avoiding? What excuses is he making? Point out any cognitive dissonance or "stories" he tells himself to avoid pain or effort. Be direct but constructive (Devil's Advocate approach).

  CRITICAL: 
  - Address the user directly in the second person ("אתה").
  - Provide a concise yet deep analysis.
  - MUST BE IN FLUENT HEBREW.
  - Use a warm, professional, and encouraging tone, but don't hold back on the Shadow Work critique.

  Recent material:
  \${recentTranscripts}

  הקשר קבוע לגבי בני משפחה:
  \${FIXED_CONTEXT}
  \`;


    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text() || "לא הצלחתי לייצר תובנה שבועית כרגע.";
    } catch (error: any) {
        console.error("Error generating weekly briefing:", error);
        throw error;
    }
}`;

const newWeeklyBriefing = `export async function generateWeeklyBriefing(
    allEntries: { transcript: string; timestamp: number }[],
    apiKey: string,
    relevantPastEntries?: { transcript: string; timestamp: number }[],
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ insight: string; triples: [string, string, string][] }> {
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
        .map((e) => \`[Entry Date: \${new Date(e.timestamp).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })}]: \${e.transcript}\`)
        .join('\\n\\n');

    if (!recentTranscripts) {
        return { insight: "אין עדיין מספיק נתונים מהשבוע האחרון כדי לייצר תובנה שבועית.", triples: [] };
    }

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = \`
  You are an expert personal growth coach and analyst for "גיא" (Guy).
  Today is: \${currentDateTime}.
  I am providing you with all of Guy's diary entries from the past week.
  Please provide a deep, high-level "Weekly Insight" (תובנה שבועית) that summarizes the main themes, emotional patterns, and progress Guy has made.
  
  *CRITICAL SHADOW WORK REQUIREMENT*: Look for contradictions. What is Guy avoiding? What excuses is he making? Point out any cognitive dissonance or "stories" he tells himself to avoid pain or effort. Be direct but constructive (Devil's Advocate approach).

  CRITICAL: 
  - Address the user directly in the second person ("אתה").
  - Provide a concise yet deep analysis.
  - MUST BE IN FLUENT HEBREW.
  - Use a warm, professional, and encouraging tone, but don't hold back on the Shadow Work critique.

  Recent material:
  \${recentTranscripts}

  \${graphText}

  In addition, extract 2-4 OKF Knowledge Graph triples representing the core of your insight.
  Return your response ONLY as a valid JSON object matching this structure:
  {
    "insight": "Your deep weekly insight in Hebrew...",
    "triples": [["Subject", "Relation", "Object"]]
  }

  הקשר קבוע לגבי בני משפחה:
  \${FIXED_CONTEXT}
  \`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (typeof parsed === 'string') return { insight: parsed, triples: [] };
        return parsed;
    } catch (error: any) {
        console.error("Error generating weekly briefing:", error);
        throw error;
    }
}`;

content = content.replace(oldWeeklyBriefing, newWeeklyBriefing);

// 2. generateCategoricalInsights
const oldCategorical = `export async function generateCategoricalInsights(allEntries: { transcript: string; timestamp: number }[], apiKey: string): Promise<{ work: string; family: string; personal: string }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: liteModelName }, { apiVersion: activeApiVersion as any });

    const weekStart = getStartOfCurrentWeek();
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= weekStart)
        .map((e) => \`[Entry Date: \${new Date(e.timestamp).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })}]: \${e.transcript}\`)
        .join('\\n\\n');

    if (!recentTranscripts) {
        return {
            work: "אין מספיק נתונים מהשבוע האחרון.",
            family: "אין מספיק נתונים מהשבוע האחרון.",
            personal: "אין מספיק נתונים מהשבוע האחרון."
        };
    }

    const prompt = \`
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
  \${recentTranscripts}

  הקשר קבוע לגבי בני משפחה:
  \${FIXED_CONTEXT}
  \`;


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
}`;

const newCategorical = `export async function generateCategoricalInsights(
    allEntries: { transcript: string; timestamp: number }[],
    apiKey: string,
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ work: string; family: string; personal: string; triples: [string, string, string][] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: liteModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const weekStart = getStartOfCurrentWeek();
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= weekStart)
        .map((e) => \`[Entry Date: \${new Date(e.timestamp).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })}]: \${e.transcript}\`)
        .join('\\n\\n');

    if (!recentTranscripts) {
        return {
            work: "אין מספיק נתונים מהשבוע האחרון.",
            family: "אין מספיק נתונים מהשבוע האחרון.",
            personal: "אין מספיק נתונים מהשבוע האחרון.",
            triples: []
        };
    }

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = \`
  You are an expert personal growth coach and psychological analyst for "גיא" (Guy).
  Analyze his transcripts from the last week and extract exactly 3 key insights in the following categories:
  1. Work (עבודה)
  2. Family (משפחה)
  3. Personal/Psychological (אישי - ניתוח פסיכולוגי)

  \${graphText}

  In addition, extract 2-4 OKF Knowledge Graph triples representing key relations.
  Return the result in clear JSON format:
  {
    "work": "Insight about work, addressing Guy personally",
    "family": "Insight about family, addressing Guy personally",
    "personal": "Deep psychological insight, addressing the user directly",
    "triples": [["Subject", "Relation", "Object"]]
  }

  CRITICAL:
  - Address the user directly in the second person ("אתה").
  - MUST BE IN FLUENT HEBREW.
  - Tone should be warm and professional.

  Transcripts:
  \${recentTranscripts}

  הקשר קבוע לגבי בני משפחה:
  \${FIXED_CONTEXT}
  \`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        return parsed;
    } catch (error: any) {
        console.error("Error generating categorical insights:", error);
        return {
            work: "שגיאה בעיבוד הנתונים.",
            family: "שגיאה בעיבוד הנתונים.",
            personal: "שגיאה בעיבוד הנתונים.",
            triples: []
        };
    }
}`;

content = content.replace(oldCategorical, newCategorical);

// 3. generateShadowQuickAdvices
const oldShadow = `export async function generateShadowQuickAdvices(shadowWorkInsight: string, allEntries: { transcript: string; timestamp: number }[], apiKey: string): Promise<string[]> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= fourteenDaysAgo)
        .map(e => \`[\${new Date(e.timestamp).toLocaleDateString('he-IL')}]: \${e.transcript}\`)
        .join('\\n\\n');

    if (!shadowWorkInsight) {
        return ["אין מספיק נתוני עבודת צללים (Shadow Work) זמינים עדיין כדי לייצר עצות."];
    }

    const prompt = \`
  אתה פסיכולוג ומומחה עבודת צללים של "גיא". 
  לפניך סיכום נקודת העבודה הנוכחית של גיא מתוך ניתוח עבודת הצללים (Shadow Work) שלו:
  "\${shadowWorkInsight}"

  קח בחשבון את הסיכום הזה ואת היומנים מהשבועיים האחרונים, וצור בדיוק 5 עצות קצרות ומהירות להתמודדות מעשית.
  
  דרישות:
  - כל עצה חייבת להיות בין משפט אחד לשניים בלבד.
  - פנה ישירות לגיא בגוף שני ("אתה", "כדאי ש...").
  - התמקד ביישום יומיומי קצר ומיידי שיכול לעזור לו עם הפער שתואר בעבודת הצללים.
  - החזר תשובה בפורמט JSON בלבד. המבנה חייב להיות מערך של 5 מחרוזות. (לדוגמה: ["עצה 1", "עצה 2", "עצה 3", "עצה 4", "עצה 5"]). ללא שום טקסט נוסף לפני או אחרי עטיפת ה-JSON.

  היומנים מהשבועיים האחרונים:
  \${recentTranscripts}
  \`;

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
}`;

const newShadow = `export async function generateShadowQuickAdvices(
    shadowWorkInsight: string,
    allEntries: { transcript: string; timestamp: number }[],
    apiKey: string,
    relevantPastEntries?: { transcript: string; timestamp: number }[],
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ advices: string[]; triples: [string, string, string][] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= fourteenDaysAgo)
        .map(e => \`[\${new Date(e.timestamp).toLocaleDateString('he-IL')}]: \${e.transcript}\`)
        .join('\\n\\n');

    if (!shadowWorkInsight) {
        return { advices: ["אין מספיק נתוני עבודת צללים (Shadow Work) זמינים עדיין כדי לייצר עצות."], triples: [] };
    }

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = \`
  אתה פסיכולוג ומומחה עבודת צללים של "גיא". 
  לפניך סיכום נקודת העבודה הנוכחית של גיא מתוך ניתוח עבודת הצללים (Shadow Work) שלו:
  "\${shadowWorkInsight}"

  קח בחשבון את הסיכום הזה ואת היומנים מהשבועיים האחרונים, וצור בדיוק 5 עצות קצרות ומהירות להתמודדות מעשית.
  
  \${graphText}

  דרישות:
  - כל עצה חייבת להיות בין משפט אחד לשניים בלבד.
  - פנה ישירות לגיא בגוף שני ("אתה", "כדאי ש...").
  - התמקד ביישום יומיומי קצר ומיידי שיכול לעזור לו עם הפער שתואר בעבודת הצללים.
  - החזר תשובה בפורמט JSON בלבד. המבנה חייב להיות אובייקט הכולל "advices" (מערך של 5 מחרוזות) ו-"triples" (מערך של קשרים חדשים לגרף). דוגמה: {"advices": ["עצה 1", ...], "triples": [["S","R","O"]]}. ללא שום טקסט נוסף.

  היומנים מהשבועיים האחרונים:
  \${recentTranscripts}
  \`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (Array.isArray(parsed)) return { advices: parsed, triples: [] };
        return parsed;
    } catch (error: any) {
        console.error("Error generating shadow quick advices:", error);
        return {
            advices: ["שגיאה ביצירת עצות המבוססות על עבודת צללים."],
            triples: []
        };
    }
}`;

content = content.replace(oldShadow, newShadow);

// 4. generateAdvices
const oldAdvices = `export async function generateAdvices(allEntries: { transcript: string; timestamp: number }[], apiKey: string): Promise<{ work: string; family: string; mental: string }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= thirtyDaysAgo)
        .map(e => \`[\${new Date(e.timestamp).toLocaleDateString('he-IL')}]: \${e.transcript}\`)
        .join('\\n\\n');

    if (!recentTranscripts) {
        return {
            work: "אין מספיק נתונים לחודש האחרון כדי לייצר עצה בעבודה.",
            family: "אין מספיק נתונים לחודש האחרון כדי לייצר עצה למשפחה.",
            mental: "אין מספיק נתונים לחודש האחרון כדי לייצר עצה לרווחה הנפשית."
        };
    }

    const prompt = \`
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
  \${FIXED_CONTEXT}

  היומנים מהחודש האחרון:
  \${recentTranscripts}
  \`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return parseAIResponse(response.text());
    } catch (error: any) {
        console.error("Error generating advices:", error);
        throw error;
    }
}`;

const newAdvices = `export async function generateAdvices(
    allEntries: { transcript: string; timestamp: number }[],
    apiKey: string,
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ work: string; family: string; mental: string; triples: [string, string, string][] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentTranscripts = allEntries
        .filter(e => e.timestamp >= thirtyDaysAgo)
        .map(e => \`[\${new Date(e.timestamp).toLocaleDateString('he-IL')}]: \${e.transcript}\`)
        .join('\\n\\n');

    if (!recentTranscripts) {
        return {
            work: "אין מספיק נתונים לחודש האחרון כדי לייצר עצה בעבודה.",
            family: "אין מספיק נתונים לחודש האחרון כדי לייצר עצה למשפחה.",
            mental: "אין מספיק נתונים לחודש האחרון כדי לייצר עצה לרווחה הנפשית.",
            triples: []
        };
    }

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = \`
  אתה יועץ אישי ופסיכולוגי בכיר של "גיא".
  תפקידך לסקור את יומנו מ-30 הימים האחרונים ולספק לו 3 עצות קונקרטיות ופעילות בתחומים הבאים:
  1. עבודה (Work)
  2. משפחה (Family)
  3. רווחה נפשית (Mental Well-being)

  \${graphText}

  דרישות:
  - על כל עצה להיות **קצרה מאוד, עד 3 שורות לכל היותר**. עצה פרקטית וישירה אליו.
  - פנה למשתמש ישירות בגוף שני ("אתה", למשל: "כדאי לך...").
  - כתוב בעברית קולחת ומעוררת השראה.
  - החזר תשובה בפורמט JSON בלבד (ללא טקסט נוסף):
  {
    "work": "עצה קצרה ואקטיבית לעבודה",
    "family": "עצה קצרה ואקטיבית למשפחה",
    "mental": "עצה קצרה ואקטיבית לרווחה",
    "triples": [["S","R","O"]]
  }

  הקשר קבוע לגבי המשפחה:
  \${FIXED_CONTEXT}

  היומנים מהחודש האחרון:
  \${recentTranscripts}
  \`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return parseAIResponse(response.text());
    } catch (error: any) {
        console.error("Error generating advices:", error);
        throw error;
    }
}`;

content = content.replace(oldAdvices, newAdvices);

// 5. generateLifeThemesAnalysis
const oldThemes = `export async function generateLifeThemesAnalysis(allEntries: { transcript: string; timestamp: number }[], apiKey: string, type: 'weekly' | 'monthly'): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    const timeRangeText = type === 'weekly' ? 'מהשבוע האחרון' : 'מהחודש האחרון';
    const threshold = type === 'weekly' ? 7 : 30;
    const entriesToAnalyze = allEntries.filter(e => e.timestamp >= (Date.now() - threshold * 24 * 60 * 60 * 1000));

    if (entriesToAnalyze.length === 0) return \`אין מספיק נתונים \${timeRangeText} לניתוח תמות חיים.\`;

    const transcripts = entriesToAnalyze
        .map(e => \`[\${new Date(e.timestamp).toLocaleDateString('he-IL')}]: \${e.transcript}\`)
        .join('\\n\\n');


    const prompt = \`
  אתה אנליסט דפוסים אישי ומומחה בפסיכולוגיה של "תמות חיים" (Life Themes).
  המשימה שלך: לנתח את המחשבות של גיא \${timeRangeText} ולזהות 2-3 "תמות על" - נושאים מרכזיים שחוזרים על עצמם, גם אם בדרכים שונות.
  בנוסף, השווה את התמות האלו למה שאתה מזהה כ"עבר רחוק יותר" (מתוך כלל החומר) וציין אם יש שינוי, התקדמות או נסיגה.


  דרישות:
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - כתוב בעברית קולחת ומקצועית אך נגישה.
  - התמקד ב"למה" מאחורי הדברים, לא רק ב"מה".
  
  החומר לניתוח:
  \${transcripts}

  הקשר קבוע לגבי בני משפחה:
  \${FIXED_CONTEXT}
  \`;


    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text() || "לא הצלחתי לייצר ניתוח תמות חיים.";
    } catch (error) {
        console.error("Error generating life themes:", error);
        throw error;
    }
}`;

const newThemes = `export async function generateLifeThemesAnalysis(
    allEntries: { transcript: string; timestamp: number }[],
    apiKey: string,
    type: 'weekly' | 'monthly',
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ insight: string; triples: [string, string, string][] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const timeRangeText = type === 'weekly' ? 'מהשבוע האחרון' : 'מהחודש האחרון';
    const threshold = type === 'weekly' ? 7 : 30;
    const entriesToAnalyze = allEntries.filter(e => e.timestamp >= (Date.now() - threshold * 24 * 60 * 60 * 1000));

    if (entriesToAnalyze.length === 0) return { insight: \`אין מספיק נתונים \${timeRangeText} לניתוח תמות חיים.\`, triples: [] };

    const transcripts = entriesToAnalyze
        .map(e => \`[\${new Date(e.timestamp).toLocaleDateString('he-IL')}]: \${e.transcript}\`)
        .join('\\n\\n');

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = \`
  אתה אנליסט דפוסים אישי ומומחה בפסיכולוגיה של "תמות חיים" (Life Themes).
  המשימה שלך: לנתח את המחשבות של גיא \${timeRangeText} ולזהות 2-3 "תמות על" - נושאים מרכזיים שחוזרים על עצמם, גם אם בדרכים שונות.
  בנוסף, השווה את התמות האלו למה שאתה מזהה כ"עבר רחוק יותר" (מתוך כלל החומר) וציין אם יש שינוי, התקדמות או נסיגה.

  \${graphText}

  דרישות:
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - כתוב בעברית קולחת ומקצועית אך נגישה.
  - התמקד ב"למה" מאחורי הדברים, לא רק ב"מה".
  
  In addition, extract OKF Knowledge Graph triples representing the essence of these themes.
  Return your response ONLY as a valid JSON object matching this structure:
  {
    "insight": "Your life themes analysis in Hebrew...",
    "triples": [["Subject", "Relation", "Object"]]
  }

  החומר לניתוח:
  \${transcripts}

  הקשר קבוע לגבי בני משפחה:
  \${FIXED_CONTEXT}
  \`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (typeof parsed === 'string') return { insight: parsed, triples: [] };
        return parsed;
    } catch (error) {
        console.error("Error generating life themes:", error);
        throw error;
    }
}`;

content = content.replace(oldThemes, newThemes);

// 6. analyzeExecutionGap
const oldGap = `export async function analyzeExecutionGap(allEntries: { transcript: string; tasks?: any[]; timestamp: number }[], apiKey: string): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    // Focus on recent actions vs intentions (last 30 days roughly)
    const recentEntries = [...allEntries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);
    if (recentEntries.length === 0) return "אין עדיין נתונים לבדיקת פערי ביצוע.";

    const transcriptsAndTasks = recentEntries
        .map(e => \`[\${new Date(e.timestamp).toLocaleDateString('he-IL')}]\\nמחשבות בדיווח: \${e.transcript}\\nמשימות שהוגדרו: \${(e.tasks || []).map(t => typeof t === 'string' ? t : t.text).join(', ')}\`)
        .join('\\n\\n');

    const prompt = \`
  אתה מומחה לפסיכולוגיה התנהגותית. המשימה שלך היא לבדוק את "פער הביצוע" (Expectation vs. Reality Mapping) של גיא - הפער בין התוכניות המשימות והכוונות שהוא מצהיר עליהן ביומן, לבין מה שהוא עושה בפועל בדיווחים ובמחשבות העוקבות.
  זהה "דחיינות כרונית" או אזורים בהם יש הימנעות רגשית מתמדת למרות כוונות טובות.
  
  דרישות:
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - הבא דוגמה קונקרטית מתוך הנתונים שלו (משימה או כוונה שנמנעה מספר פעמים ואת התירוצים שניתנו).
  - היה ביקורתי (פרקליט השטן) אבל תן הצעה טיפולית.
  - כתוב בעברית בלבד. 2-3 פסקאות קצרות.

  נתונים לניתוח (הצהרות מול דיווח על מה שקרה באמת בימים העוקבים):
  \${transcriptsAndTasks}

  הקשר:
  \${FIXED_CONTEXT}
  \`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text() || "אין כרגע פערי ביצוע בולטים.";
    } catch (error) {
        console.error("Error analyzing execution gap:", error);
        return "שגיאה בניתוח פער הביצוע.";
    }
}`;

const newGap = `export async function analyzeExecutionGap(
    allEntries: { transcript: string; tasks?: any[]; timestamp: number }[],
    apiKey: string,
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ insight: string; triples: [string, string, string][] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    // Focus on recent actions vs intentions (last 30 days roughly)
    const recentEntries = [...allEntries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);
    if (recentEntries.length === 0) return { insight: "אין עדיין נתונים לבדיקת פערי ביצוע.", triples: [] };

    const transcriptsAndTasks = recentEntries
        .map(e => \`[\${new Date(e.timestamp).toLocaleDateString('he-IL')}]\\nמחשבות בדיווח: \${e.transcript}\\nמשימות שהוגדרו: \${(e.tasks || []).map(t => typeof t === 'string' ? t : t.text).join(', ')}\`)
        .join('\\n\\n');

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = \`
  אתה מומחה לפסיכולוגיה התנהגותית. המשימה שלך היא לבדוק את "פער הביצוע" (Expectation vs. Reality Mapping) של גיא - הפער בין התוכניות המשימות והכוונות שהוא מצהיר עליהן ביומן, לבין מה שהוא עושה בפועל בדיווחים ובמחשבות העוקבות.
  זהה "דחיינות כרונית" או אזורים בהם יש הימנעות רגשית מתמדת למרות כוונות טובות.
  
  \${graphText}

  דרישות:
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - הבא דוגמה קונקרטית מתוך הנתונים שלו (משימה או כוונה שנמנעה מספר פעמים ואת התירוצים שניתנו).
  - היה ביקורתי (פרקליט השטן) אבל תן הצעה טיפולית.
  - כתוב בעברית בלבד. 2-3 פסקאות קצרות.

  In addition, extract OKF Knowledge Graph triples for any identified gaps or evasions.
  Return your response ONLY as a valid JSON object matching this structure:
  {
    "insight": "Your execution gap analysis in Hebrew...",
    "triples": [["Subject", "Relation", "Object"]]
  }

  נתונים לניתוח (הצהרות מול דיווח על מה שקרה באמת בימים העוקבים):
  \${transcriptsAndTasks}

  הקשר:
  \${FIXED_CONTEXT}
  \`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (typeof parsed === 'string') return { insight: parsed, triples: [] };
        return parsed;
    } catch (error) {
        console.error("Error analyzing execution gap:", error);
        return { insight: "שגיאה בניתוח פער הביצוע.", triples: [] };
    }
}`;

content = content.replace(oldGap, newGap);

// 7. generateEmotionalGTDInsight
const oldGTD = `export async function generateEmotionalGTDInsight(allEntries: { transcript: string; timestamp: number }[], apiKey: string): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: liteModelName }, { apiVersion: activeApiVersion as any });

    const recentTranscripts = allEntries
        .slice(0, 10) 
        .map(e => e.transcript)
        .join('\\n\\n');

    const prompt = \`
  אתה מומחה לניתוח מעמקים רגשי ותובנות יומיומיות. במקום להתמקד רק ברשימות משימות, אתה עוזר לגיא להבין אילו נושאים "תוקעים" אותו רגשית ואיך לגשת אליהם.
  נתח את מצבו היום והצע לו "תובנה רגשית יומית עיקרית" אחת - ניתוח קצר של מה שהכי מעסיק אותו היום, ואיך הוא יכול לפעול בנושא.

  דרישות חובה:
  - השתמש בבולטים (bullets) ברורים וקצרים.
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - כתוב בעברית בלבד.
  - מבנה התשובה: פתיחה קצרה, ואם 2-3 בולטים של תובנות/פעולות מוצעות.
  
  הקשר אחרון:
  \${recentTranscripts}

  הקשר קבוע לגבי בני משפחה:
  \${FIXED_CONTEXT}
  \`;


    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text() || "לא הצלחתי לייצר תובנת GTD רגשית.";
    } catch (error) {
        console.error("Error generating emotional GTD insight:", error);
        throw error;
    }
}`;

// Note: checking original content of line 718: `  - מבנה התשובה: פתיחה קצרה, ואז 2-3 בולטים של תובנות/פעולות מוצעות.`
// Wait, the regex had `ואם` but in file it was `ואז`. We should use replace with exact text string of original code to be safe.
const oldGTDCode = `export async function generateEmotionalGTDInsight(allEntries: { transcript: string; timestamp: number }[], apiKey: string): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: liteModelName }, { apiVersion: activeApiVersion as any });

    const recentTranscripts = allEntries
        .slice(0, 10) 
        .map(e => e.transcript)
        .join('\\n\\n');

    const prompt = \`
  אתה מומחה לניתוח מעמקים רגשי ותובנות יומיומיות. במקום להתמקד רק ברשימות משימות, אתה עוזר לגיא להבין אילו נושאים "תוקעים" אותו רגשית ואיך לגשת אליהם.
  נתח את מצבו היום והצע לו "תובנה רגשית יומית עיקרית" אחת - ניתוח קצר של מה שהכי מעסיק אותו היום, ואיך הוא יכול לפעול בנושא.

  דרישות חובה:
  - השתמש בבולטים (bullets) ברורים וקצרים.
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - כתוב בעברית בלבד.
  - מבנה התשובה: פתיחה קצרה, ואז 2-3 בולטים של תובנות/פעולות מוצעות.
  
  הקשר אחרון:
  \${recentTranscripts}

  הקשר קבוע לגבי בני משפחה:
  \${FIXED_CONTEXT}
  \`;


    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text() || "לא הצלחתי לייצר תובנת GTD רגשית.";
    } catch (error) {
        console.error("Error generating emotional GTD insight:", error);
        throw error;
    }
}`;

const newGTDCode = `export async function generateEmotionalGTDInsight(
    allEntries: { transcript: string; timestamp: number }[],
    apiKey: string,
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ insight: string; triples: [string, string, string][] }> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: liteModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const recentTranscripts = allEntries
        .slice(0, 10) 
        .map(e => e.transcript)
        .join('\\n\\n');

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = \`
  אתה מומחה לניתוח מעמקים רגשי ותובנות יומיומיות. במקום להתמקד רק ברשימות משימות, אתה עוזר לגיא להבין אילו נושאים "תוקעים" אותו רגשית ואיך לגשת אליהם.
  נתח את מצבו היום, תוך הסתמכות על יומניו האחרונים ועל רשת הידע (Knowledge Graph) שלו, והצע לו "תובנה רגשית יומית עיקרית" אחת - ניתוח קצר של מה שהכי מעסיק אותו היום, ואיך הוא יכול לפעול בנושא.

  \${graphText}

  דרישות חובה:
  - השתמש בבולטים (bullets) ברורים וקצרים.
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - כתוב בעברית בלבד.
  - מבנה התשובה: פתיחה קצרה, ואז 2-3 בולטים של תובנות/פעולות מוצעות.
  
  In addition, extract OKF Knowledge Graph triples representing the emotional block or insight.
  Return your response ONLY as a valid JSON object matching this structure:
  {
    "insight": "Your emotional GTD analysis in Hebrew...",
    "triples": [["Subject", "Relation", "Object"]]
  }

  הקשר אחרון:
  \${recentTranscripts}

  הקשר קבוע לגבי בני משפחה:
  \${FIXED_CONTEXT}
  \`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (typeof parsed === 'string') return { insight: parsed, triples: [] };
        return parsed;
    } catch (error) {
        console.error("Error generating emotional GTD insight:", error);
        throw error;
    }
}`;

content = content.replace(oldGTDCode, newGTDCode);

// 8. generateOperatingManual
const oldManual = `export async function generateOperatingManual(allEntries: { transcript: string; timestamp: number }[], apiKey: string): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: activeModelName }, { apiVersion: activeApiVersion as any });

    const isFirstOfMonth = new Date().getDate() === 1;
    
    // Only send full history on the 1st of the month, otherwise limit to last 30 entries
    const entriesToAnalyze = isFirstOfMonth
        ? [...allEntries].sort((a, b) => b.timestamp - a.timestamp)
        : [...allEntries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);

    if (entriesToAnalyze.length === 0) return "עדיין אין מספיק נתונים כדי לייצר את ספר ההפעלה שלך. המשך לשתף במחשבות!";

    const transcripts = entriesToAnalyze
        .map(e => \`[\${new Date(e.timestamp).toLocaleDateString('he-IL')}]: \${e.transcript}\`)
        .join('\\n\\n');

    const prompt = \`
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
  \${transcripts}

  הקשר קבוע לגבי בני משפחה:
  \${FIXED_CONTEXT}
  \`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text() || "לא הצלחתי לייצר את ספר ההפעלה כרגע.";
    } catch (error) {
        console.error("Error generating operating manual:", error);
        throw error;
    }
}`;

const newManual = `export async function generateOperatingManual(
    allEntries: { transcript: string; timestamp: number }[],
    apiKey: string,
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ insight: string; triples: [string, string, string][] }> {
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
        .map(e => \`[\${new Date(e.timestamp).toLocaleDateString('he-IL')}]: \${e.transcript}\`)
        .join('\\n\\n');

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = \`
  אתה מומחה לניתוח דפוסי התנהגות ופסיכולוגיה קוגניטיבית. המטרה שלך היא לכתוב את "ספר ההפעלה" (Personal Operating Manual) של גיא.
  זהו מסמך פרקטי שמרכז את התובנות העמוקות ביותר על איך גיא "עובד" הכי טוב, מה מניע אותו, ומה עוצר אותו.
  עליך לפעול כ"פרקליט השטן" מול דפוסים מתחמקים או סתירות פנימיות, מתוך סקירת רשת הידע OKF שלו וההיסטוריה שלו.

  המשימה שלך: נתח את כל המחשבות, קשרי הידע והשיחות של גיא וחלץ דפוסים חוזרים בנקודות קצרות וברורות בנושאים הבאים:
  1. תנאים להצלחה ומוטיבציה (מה עוזר לו להיות במיטבו).
  2. טריגרים רגשיים וחסמים (מה מוציא אותו מאיזון - דגש על פערים בין הצהרות למציאות).
  3. סביבת עבודה ותקשורת (איך כדאי לו לגשת למשימות או לאנשים בהתבסס על הצלחות העבר).
  4. המלצות פרקטיות למניעה (מה הוא יכול לעשות כשמתחיל דפוס שלילי).

  \${graphText}

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
  \${transcripts}

  הקשר קבוע לגבי בני משפחה:
  \${FIXED_CONTEXT}
  \`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (typeof parsed === 'string') return { insight: parsed, triples: [] };
        return parsed;
    } catch (error) {
        console.error("Error generating operating manual:", error);
        throw error;
    }
}`;

content = content.replace(oldManual, newManual);

// 9. generateMajorInsights
const oldMajor = `export async function generateMajorInsights(
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
        .map((e) => \`[\${new Date(e.timestamp).toLocaleDateString('he-IL')}]: \${e.transcript}\`)
        .join('\\n\\n');

    const globalTranscripts = globalEntriesSubset
        .map((e) => \`[\${new Date(e.timestamp).toLocaleDateString('he-IL')}]: \${e.transcript}\`)
        .join('\\n\\n');

    const prompt = \`
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
  \${weeklyTranscripts || "אין מספיק נתונים מהשבוע."}

  חומר גלובלי (נציגותי):
  \${globalTranscripts}

  תובנות קיימות (למטרת יציבות):
  \${currentInsights.length > 0 ? currentInsights.join('\\n') : "אין תובנות קודמות."}

  הנחיות יציבות (stability):
  - אם התובנה החדשה שאתה מייצר אינה "חזקה", עמוקה או רלוונטית משמעותית יותר מהתובנה הקיימת באותו המיקום, העדף להחזיר את הטקסט הקיים כמעט כלשונו או עם שינויים מזעריים.
  - עדכן תובנה רק אם יש "בשר" חדש או תובנה עמוקה יותר שנובעת מהחומר החדש.

  הקשר משפחתי:
  \${FIXED_CONTEXT}
  \`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return parseAIResponse(response.text());
    } catch (error) {
        console.error("Error generating major insights:", error);
        throw error;
    }
}`;

const newMajor = `export async function generateMajorInsights(
    allEntries: { transcript: string; timestamp: number }[], 
    apiKey: string,
    currentInsights: string[] = [],
    knowledgeGraph?: { nodes: any[]; edges: any[] }
): Promise<{ insights: string[]; triples: [string, string, string][] }> {
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
        .map((e) => \`[\${new Date(e.timestamp).toLocaleDateString('he-IL')}]: \${e.transcript}\`)
        .join('\\n\\n');

    const globalTranscripts = globalEntriesSubset
        .map((e) => \`[\${new Date(e.timestamp).toLocaleDateString('he-IL')}]: \${e.transcript}\`)
        .join('\\n\\n');

    const graphText = buildGraphContext(knowledgeGraph);

    const prompt = \`
  אתה אנליסט דפוסים אישי ומומחה בפסיכולוגיה קוגניטיבית של "גיא" (Guy).
  המשימה שלך היא לייצר 4 תובנות על מרכזיות, מעמיקות ומשנות תפיסה (בעלות ערך טיפולי/אימוני עמוק).
  
  סוגי התובנות הנדרשים:
  1. תובנת על גלובלית (Global Insight): תמה מרכזית שמנהלת אותו לאחרונה על סמך כלל היומנים והקשרים בגרף הידע.
  2. תובנה מעשית/ביצועית (Execution Insight): זיהוי פערים בין כוונות למציאות והתנהלות סביב משימות.
  3. תובנת מערכות יחסים (Relational Insight): תובנה על קשריו עם בני משפחתו וסביבתו.
  4. תובנת תת מודע (Subconscious Insight): חשיפת קורלציות חבויות. האם יש נושא שורש רגשי שמנהל אותו מתחת לפני השטח בהתבסס על ההיסטוריה וקשרי הידע החדשים?
  
  דרישות חובה:
  - פנה למשתמש ישירות בגוף שני ("אתה").
  - כתוב בעברית בלבד.
  - כל תובנה חייבת להיות קצרה (3 שורות מקסימום).
  - אל תכתוב כותרות כמו "תובנה גלובלית:", פשוט את הטקסט עצמו.
  - החזר את התשובה בפורמט JSON אובייקט עם "insights" (מערך מחרוזות) ו-"triples". דוגמה: {"insights": ["טקסט 1", ...], "triples": [["S","R","O"]]}

  חומר שבועי:
  \${weeklyTranscripts || "אין מספיק נתונים מהשבוע."}

  חומר גלובלי (נציגותי):
  \${globalTranscripts}

  \${graphText}

  תובנות קיימות (למטרת יציבות):
  \${currentInsights.length > 0 ? currentInsights.join('\\n') : "אין תובנות קודמות."}

  הנחיות יציבות (stability):
  - אם התובנה החדשה שאתה מייצר אינה "חזקה", עמוקה או רלוונטית משמעותית יותר מהתובנה הקיימת באותו המיקום, העדף להחזיר את הטקסט הקיים כמעט כלשונו או עם שינויים מזעריים.
  - עדכן תובנה רק אם יש "בשר" חדש או תובנה עמוקה יותר שנובעת מהחומר החדש.

  הקשר משפחתי:
  \${FIXED_CONTEXT}
  \`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (Array.isArray(parsed)) return { insights: parsed, triples: [] };
        return parsed;
    } catch (error) {
        console.error("Error generating major insights:", error);
        throw error;
    }
}`;

content = content.replace(oldMajor, newMajor);

// 10. Append generateBiDailyThreads at the end of the file
const biDailyThreadsCode = `
export async function generateBiDailyThreads(
    allEntries: { id: string; transcript: string; timestamp: number }[],
    knowledgeGraph: { nodes: any[]; edges: any[] },
    apiKey: string
): Promise<{ threads: string[]; triples: [string, string, string][] }> {
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
    const recentEdgesStr = recentEdges.map(e => \`- [\${e.source}] --(\${e.relation})--> [\${e.target}]\`).join('\\n');

    const recentTranscripts = newEntries
        .map(e => \`[Entry Date: \${new Date(e.timestamp).toLocaleString('he-IL')}]: \${e.transcript}\`)
        .join('\\n\\n');

    const prompt = \`
  You are an expert personal growth coach and analyst for "גיא" (Guy).
  Your task is to identify key unresolved thoughts, dilemmas, or active intentions Guy wants to resolve or advance.
  Instead of doing this per-entry, you are scanning the new developments from the last 48 hours.
  
  We are using the OKF (Obsidian Knowledge Folder) structure. Here are the NEW relations/concepts that were added to Guy's Knowledge Graph in the last 48 hours:
  \${recentEdgesStr || 'No new graph relationships.'}
  
  And here are the transcripts of the diary entries from the last 48 hours:
  \${recentTranscripts}
  
  Analyze the new graph relations and the diary transcripts. Extract up to 4 of the MOST IMPORTANT and critical unresolved open threads or dilemmas.
  
  Rules:
  1. Return a maximum of 4 open threads. Only choose the ones that carry significant emotional weight, recurrent conflict, or are key decisions.
  2. Phrase them as a short reflective statement or question in Hebrew (e.g., 'איך לקדם את השיחה מול הבוס?' or 'הרצון למצוא זמן שקט לעצמי').
  3. Avoid simple lists of tasks (e.g., "buy milk"). Focus on the underlying intention or psychological dilemma.
  4. Return the result in clear JSON format containing "threads" (array of strings) and "triples" (new OKF relations). Example: {"threads": ["חוט 1"], "triples": [["S","R","O"]]}
  
  הקשר קבוע לגבי בני משפחה:
  \${FIXED_CONTEXT}
  \`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        if (Array.isArray(parsed)) return { threads: parsed, triples: [] };
        return parsed;
    } catch (error) {
        console.error("Error generating bi-daily threads:", error);
        return { threads: [], triples: [] };
    }
}
`;

content = content + '\n' + biDailyThreadsCode;

fs.writeFileSync(filePath, content, 'utf8');
console.log('Finished updating src/services/ai.ts successfully!');
