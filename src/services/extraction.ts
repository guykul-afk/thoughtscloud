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
    narrative_signature?: string[]; // Emotional narrative signature (edit distance sequence)
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

    const prompt = `
  You are an expert personal assistant and psychological profiler.
  You are assisting "גיא" (Guy).
  I am providing you with an audio recording of Guy's personal diary entry.
  
  Please analyze the audio and provide exactly the following in clear, valid JSON format (do not include markdown code block syntax around the JSON):
  {
    "transcript": "The full exact transcript. MUST BE IN HEBREW. If the audio is silent, output 'NO_SPEECH_DETECTED'. Do NOT hallucinate.",
    "openThreads": ["Array of unresolved thoughts/dilemmas. Phrase as Hebrew questions.", ...],
    "insights": ["Array of psychological insights. Hebrew.", ...],
    "topics": ["Array of tags/categories. Hebrew.", ...],
    "mood": "Short description of mood. Hebrew.",
    "sentiment": Overall entry sentiment: -1 (negative), 0 (neutral), or 1 (positive),
    "narrative_signature": ["Sequence of emotional stages representing the narrative arc. Choose ONLY from: 'enthusiasm', 'investment', 'disappointment', 'retreat', 'acceptance', 'joy', 'fear', 'resistance', 'breakthrough', 'exhaustion', 'stagnation', 'clarity'"],
    "triples": [
      {
        "subject": "Entity A",
        "relation": "Relation A",
        "object": "Entity B",
        "domain": "Work/Family/Personal/Health/Finance/General",
        "temporalContext": "Past/Present/Future",
        "confidence": "Fact/Inference/Opinion",
        "sentiment": 1/0/-1,
        "subjectType": "MVP Entity type",
        "objectType": "MVP Entity type"
      }
    ],
    "quotes": [
      {
        "text": "The exact quote text. Extract this if the user mentions a quote, cites a source/book, uses the word 'ציטוט' (e.g., 'הנה ציטוט...', 'אני רוצה לצטט...'), or mentions a saying/statement in quotation marks or spoken as a direct quote.",
        "source": "The source/author/origin of the quote if mentioned (e.g., 'אלברט איינשטיין', 'בודהה', 'הספר שקראתי'), or null if not mentioned.",
        "contexts": ["Array of related themes/topics for the quote in Hebrew."]
      }
    ]
  }

  CRITICAL HALUCINATION PREVENTION:
  If the audio is silent, return empty arrays and set mood to "N/A".

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
        model: activeModelName,
        generationConfig: { responseMimeType: "application/json" }
    }, { apiVersion: activeApiVersion as any });

    const prompt = `
  You are an expert personal assistant and psychological profiler assisting "גיא" (Guy).
  Analyze the raw text entry from Guy's diary.
  
  Raw Text Entry to analyze:
  """
  ${textData}
  """
  
  Provide exactly the following in clear, valid JSON format:
  {
    "openThreads": ["Array of unresolved thoughts/dilemmas. Phrase as Hebrew questions.", ...],
    "insights": ["Array of psychological insights. Hebrew.", ...],
    "topics": ["Array of tags/categories. Hebrew.", ...],
    "mood": "Short description of mood. Hebrew.",
    "sentiment": Overall entry sentiment: -1 (negative), 0 (neutral), or 1 (positive),
    "narrative_signature": ["Sequence of emotional stages representing the narrative arc. Choose ONLY from: 'enthusiasm', 'investment', 'disappointment', 'retreat', 'acceptance', 'joy', 'fear', 'resistance', 'breakthrough', 'exhaustion', 'stagnation', 'clarity'"],
    "triples": [
      {
        "subject": "Entity A",
        "relation": "Relation A",
        "object": "Entity B",
        "domain": "Work/Family/Personal/Health/Finance/General",
        "temporalContext": "Past/Present/Future",
        "confidence": "Fact/Inference/Opinion",
        "sentiment": 1/0/-1,
        "subjectType": "MVP Entity type",
        "objectType": "MVP Entity type"
      }
    ],
    "quotes": [
      {
        "text": "The exact quote text. Extract this if the text contains a quote (either explicitly using the word 'ציטוט', citing a source/book, containing text in quotation marks, or when direct speech/wise saying is written).",
        "source": "The source/author/origin of the quote if mentioned (e.g., 'אלברט איינשטיין', 'שייקספיר', 'הספר שקראתי'), or null if not mentioned.",
        "contexts": ["Array of related themes/topics for the quote in Hebrew."]
      }
    ]
  }

  CRITICAL HALUCINATION PREVENTION:
  If too short/meaningless, return empty arrays and set mood to "N/A".

  ${TRIPLES_SCHEMA_INSTRUCTION}

  Current Open Threads:
  ${currentOpenThreads.length > 0 ? currentOpenThreads.map(t => `- ${t}`).join('\n') : 'None'}

  CRITICAL: ALL text values MUST be in Hebrew.
  
  הקשר קבוע לגבי בני משפחה:
  ${FIXED_CONTEXT}
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = parseAIResponse(response.text());
        parsed.transcript = textData;
        return parsed;

    } catch (error: any) {
        console.error("Error processing text with Gemini:", error);
        throw error;
    }
}
