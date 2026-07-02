import { getGenAI, activeModelName, activeApiVersion } from './ai-config';
import { FIXED_CONTEXT } from './prompts';
import { 
  getHybridContext, 
  getAnniversaryEntries, 
  getContrastivePairs, 
  detectContradictions 
} from './contextEngine';

export interface ChatMessageContext {
    role: 'user' | 'ai';
    content: string;
}

export async function queryInsights(
    question: string,
    allEntries: any[],
    apiKey: string,
    context?: { 
        weeklyInsight?: string; 
        categoricalInsights?: { work: string; family: string; personal: string };
        chatHistory?: ChatMessageContext[];
        relevantPastEntries?: { transcript: string; timestamp: number }[];
        knowledgeGraph?: { nodes: any[]; edges: any[] };
        identityPersona?: any;
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
        
        // 1. Hybrid Retrieval (semantic similarities + graph neighbors)
        if (context.knowledgeGraph) {
            const hybrid = await getHybridContext(question, allEntries, context.knowledgeGraph, apiKey);
            contextData += `\n${hybrid.contextText}\n`;
            
            // Deterministic Contradictions in Graph
            const contradictions = detectContradictions(context.knowledgeGraph);
            if (contradictions) {
                contextData += `\n[הערת סתירות בגרף]:\n${contradictions}\n`;
            }
        }

        // 2. Anniversary Check
        const anniversary = getAnniversaryEntries(allEntries);
        if (anniversary) {
            contextData += anniversary;
        }

        // 3. Contrastive Context
        const contrastive = getContrastivePairs(allEntries);
        if (contrastive) {
            contextData += contrastive;
        }

        // 4. Identity Persona Injection
        if (context.identityPersona) {
            contextData += `\n[פרופיל זהות של גיא - אמונות יסוד, יעדים ונקודות עיוורון]:
- אמונות יסוד: ${context.identityPersona.coreBeliefs.join(', ')}
- מטרות פעילות: ${context.identityPersona.activeGoals.join(', ')}
- נקודות עיוורון/צל: ${context.identityPersona.psychologicalProfile.blindSpots.join(', ')}
- חוזקות: ${context.identityPersona.psychologicalProfile.strengths.join(', ')}\n`;
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
  You have access to Guy's past transcripts, advanced graph contexts (Anniversary, Contradictory, Contrastive), and his Identity Persona.
  Today is: ${currentDateTime} (Current Date and Time).
  Guy is asking you a question about his past entries or the insights you've provided.
  
  When answering, address him directly in the second person ("אתה"). 
  Be warm, insightful, and supportive.
  Use any provided context (especially contradictions, anniversary events, or persona core beliefs) to challenge him, probe deeper, and give highly contextual answers.
  
  Here is Guy's question:
  "${question}"
  
  ${contextData ? `להלן התובנות הנוכחיות והקשר ההקשרים מגרף הידע:\n${contextData}` : ""}
  
  Please provide a helpful, deep, and insightful answer to Guy's question. 
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
