import { getGenAI, activeModelName, activeApiVersion } from './ai-config';
import { FIXED_CONTEXT, TRIPLES_SCHEMA_INSTRUCTION } from './prompts';

export interface OKFTriple {
    subject: string;
    relation: string;
    object: string;
    domain?: 'Work' | 'Family' | 'Personal' | 'Health' | 'Finance' | 'General';
    temporalContext?: 'Past' | 'Present' | 'Future';
    confidence?: 'Fact' | 'Inference' | 'Opinion';
    sentiment?: number; // -1, 0, 1
    subjectType?: string;
    objectType?: string;
}

export interface ProcessedSession {
    transcript: string;
    openThreads: string[];
    insights: string[];
    topics: string[];
    mood: string;
    sentiment?: number; // Overall entry sentiment
    narrative_signature?: string[]; // Emotional narrative signature
    triples: OKFTriple[];
    quotes?: {
        text: string;
        source?: string;
        contexts?: string[];
    }[];
}

// Helper to convert Blob to base64
export const blobToBase64 = (blob: Blob): Promise<string> => {
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

// Helper to sanitize and parse JSON from AI response
export const parseAIResponse = (text: string): any => {
    try {
        const cleanJson = text
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
        
        try {
            return JSON.parse(cleanJson);
        } catch (e) {
            // fallback: extract using regex
            const match = cleanJson.match(/\{[\s\S]*\}/);
            if (match) {
                return JSON.parse(match[0]);
            }
            throw e;
        }
    } catch (e) {
        console.error("Failed to parse JSON response from AI:", text);
        return {}; // fallback to empty object to prevent crashing callers with TypeError
    }
};

export function normalizeTriples(triples: any[]): OKFTriple[] {
    if (!Array.isArray(triples)) return [];
    return triples.map((t) => {
        if (Array.isArray(t)) {
            return {
                subject: String(t[0] || '').trim(),
                relation: String(t[1] || '').trim(),
                object: String(t[2] || '').trim()
            };
        }
        return {
            subject: String(t.subject || t.s || '').trim(),
            relation: String(t.relation || t.r || '').trim(),
            object: String(t.object || t.o || '').trim(),
            domain: t.domain || 'General',
            temporalContext: t.temporalContext || 'Present',
            confidence: t.confidence || 'Fact',
            sentiment: typeof t.sentiment === 'number' ? t.sentiment : 0,
            subjectType: t.subjectType || 'Other',
            objectType: t.objectType || 'Other'
        };
    });
}

export function buildGraphContext(graph?: { nodes: any[]; edges: any[] }): string {
    if (!graph || !graph.nodes || graph.nodes.length === 0) return "";
    let text = "Current Knowledge Graph Context (existing entities and relations):\n";
    
    // List nodes
    text += "Entities:\n";
    graph.nodes.forEach(n => {
        text += `- ${n.id} (${n.type || 'Other'}, evidence strength: ${(n.evidence_strength || 1).toFixed(2)})\n`;
        if (n.essence) text += `  * Essence: ${n.essence}\n`;
        if (n.core_conflict) text += `  * Core Conflict: ${n.core_conflict}\n`;
    });
    
    // List relations
    text += "\nRelations:\n";
    (graph.edges || []).slice(0, 30).forEach(e => {
        text += `- ${e.source} --(${e.relation})--> ${e.target}\n`;
    });
    
    return text;
}

export async function processAudioSession(audioBlob: Blob, apiKey: string, currentOpenThreads: string[] = []): Promise<ProcessedSession> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const base64Audio = await blobToBase64(audioBlob);
    const cleanMimeType = (audioBlob.type || 'audio/webm').split(';')[0];

    const prompt = `
  You are an expert personal assistant.
  You are assisting "גיא" (Guy).
  I am providing you with an audio recording of Guy's personal diary entry.
  
  Please transcribe the audio and provide exactly the following in clear, valid JSON format (do not include markdown code block syntax around the JSON):
  {
    "transcript": "The full exact transcript. MUST BE IN HEBREW. If the audio is silent, output 'NO_SPEECH_DETECTED'."
  }
  `;

    try {
        const result = await model.generateContent([
            {
                inlineData: {
                    data: base64Audio,
                    mimeType: cleanMimeType,
                }
            },
            { text: prompt }
        ]);

        const rawResponse = result.response.text();
        console.log("Raw API Response:", rawResponse);

        const parsed = parseAIResponse(rawResponse);
        
        return {
            transcript: parsed.transcript || "NO_SPEECH_DETECTED",
            openThreads: [],
            insights: [],
            topics: [],
            mood: 'ניטרלי',
            triples: []
        };
    } catch (e) {
        console.error("AI Error:", e);
        throw e;
    }
}

export async function processTextSession(transcript: string, apiKey: string, currentOpenThreads: string[] = []): Promise<ProcessedSession> {
    if (!apiKey) {
        return {
            transcript: transcript,
            openThreads: [],
            insights: [],
            topics: [],
            mood: 'ניטרלי',
            triples: []
        };
    }

    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const prompt = `
    אתה מערכת הניתוח והתובנות של "ענן המחשבות" עבור גיא (Guy).
    להלן תמלול של רשומת יומן (או דיאלוג רפלקטיבי עם שאלות חידוד ותשובות):
    
    ${FIXED_CONTEXT}
    
    """
    ${transcript}
    """
    
    ${TRIPLES_SCHEMA_INSTRUCTION}
    
    עליך לנתח את הטקסט ולהחזיר מבנה JSON תקני לחלוטין (ללא markdown מסביב) לפי הסכמה הבאה:
    {
      "mood": "תיאור קצר ומדויק של מצב הרוח והטון הפסיכולוגי של גיא (בעברית, 2-5 מילים, למשל: 'ממוקד, מודע לעצמו ופתוח לביקורת')",
      "sentiment": מספר שלם: -1 (שלילי/תסכול/עומס), 0 (ניטרלי/שקול), או 1 (חיובי/בהירות/סיפוק),
      "topics": ["רשימה של 2-5 נושאים/תגיות עיקריים בעברית"],
      "insights": [
        "תובנה פסיכולוגית או אסטרטגית עמוקה אחת עד שתיים שמסכמת מה למדנו על גיא, מניעיו, חסמיו או תוכניותיו"
      ],
      "narrative_signature": ["2-4 תגיות באנגלית מתוך: enthusiasm, clarity, stagnation, tension, resistance, investment, reflection, vulnerability"],
      "triples": [
        // 3-8 קשרים לגרף הידע לפי הסכמה לעיל
      ]
    }
    `;

    try {
        const result = await model.generateContent([{ text: prompt }]);
        const parsed = parseAIResponse(result.response.text());
        
        return {
            transcript: transcript,
            openThreads: [],
            insights: Array.isArray(parsed.insights) ? parsed.insights : [],
            topics: Array.isArray(parsed.topics) ? parsed.topics : [],
            mood: parsed.mood || 'ניטרלי',
            sentiment: typeof parsed.sentiment === 'number' ? parsed.sentiment : 0,
            narrative_signature: Array.isArray(parsed.narrative_signature) ? parsed.narrative_signature : [],
            triples: normalizeTriples(parsed.triples || [])
        };
    } catch (e) {
        console.error("AI Error in processTextSession:", e);
        return {
            transcript: transcript,
            openThreads: [],
            insights: [],
            topics: [],
            mood: 'ניטרלי',
            triples: []
        };
    }
}

export async function generateClarifyingQuestion(sessionTranscript: string, apiKey: string): Promise<string> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const prompt = `
    אתה "ענן המחשבות", מערכת אפיסטמית ברוח מתודולוגיית RIKMA. מטרתך לחלץ ידע סמוי, רציונל וגבולות גזרה ממחשבותיו של גיא, באפס חיכוך.
    
    להלן התמלול המצטבר של הסשן הנוכחי:
    """
    \${sessionTranscript}
    """
    
    כללי חקירה סוקרטית (The Single-Question Rule):
    1. המטרה היא לחשוף את הידע הסמוי: מה ההקשר החסר? למה גיא חושב כך? מתי הכלל הזה תקף (תנאי סף/Boundary Conditions)?
    2. שאל שאלת חידוד אחת בלבד - קצרה, נוקבת וישירה (עד 15-20 מילים). ללא נימוסים או הקדמות.
    3. התמקד בלחלץ את ה"למה" או לערער על סתירות (Merge Conflicts של המיינד), ואל תשאל על פרטים טכניים שניתן להסיק לבד.
    4. אם הטקסט כבר מכיל רציונל עמוק, בהיר ומספק, ואין פער לוגי להשלים - חובה עליך להחזיר בדיוק את המילה "DONE".
    
    החזר את התשובה בפורמט JSON בלבד (ללא markdown סביבו):
    {
      "question": "השאלה כאן, או המילה DONE"
    }
    `;

    try {
        const result = await model.generateContent([{ text: prompt }]);
        const parsed = parseAIResponse(result.response.text());
        return parsed.question || "DONE";
    } catch (e) {
        console.error("AI Error in generateClarifyingQuestion:", e);
        return "DONE"; // Fail safely
    }
}
