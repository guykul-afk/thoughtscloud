import { getGenAI, activeModelName, activeApiVersion } from './ai-config';

export interface IdentityPersona {
  coreBeliefs: string[];
  activeGoals: string[];
  psychologicalProfile: {
    strengths: string[];
    focusAreas: string[];
    blindSpots: string[];
  };
  lastUpdated: number;
}

export async function generateUpdatedPersona(
  currentPersona: IdentityPersona | null,
  newEntries: { transcript: string; timestamp: number }[],
  apiKey: string
): Promise<IdentityPersona> {
  const genAI = getGenAI(apiKey);
  const model = genAI.getGenerativeModel({ 
    model: activeModelName,
    generationConfig: { responseMimeType: "application/json" }
  }, { apiVersion: activeApiVersion as any });

  const currentPersonaText = currentPersona 
    ? JSON.stringify(currentPersona, null, 2)
    : "אין עדיין פרופיל זהות קיים. יש לייצר פרופיל ראשוני.";

  const entriesText = newEntries
    .slice(0, 15)
    .map(e => `[רשומה מתאריך: ${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`)
    .join('\n\n');

  const prompt = `
You are a senior psychological profiler and development coach for "גיא" (Guy).
Your goal is to incrementally maintain and update Guy's "Identity Persona" (פרופיל זהות חי) based on his recent diary entries.

Here is Guy's current Identity Persona:
${currentPersonaText}

Here are Guy's recent diary entries:
${entriesText}

Please refine, update, or initialize Guy's Identity Persona. Look for changes in his beliefs, new active goals he mentions, or changes in his strengths, focus areas, and blind spots (Shadow elements).
Keep the persona clean, accurate, and deeply representative of Guy's psychological journey.

Return your response ONLY as a valid JSON object matching this exact TypeScript structure:
{
  "coreBeliefs": ["אמונת יסוד 1...", "אמונת יסוד 2..."],
  "activeGoals": ["מטרה פעילה 1...", "מטרה פעילה 2..."],
  "psychologicalProfile": {
    "strengths": ["חוזקה 1...", "חוזקה 2..."],
    "focusAreas": ["נושא למיקוד 1...", "נושא למיקוד 2..."],
    "blindSpots": ["נקודת עיוורון/צל 1...", "נקודת עיוורון/צל 2..."]
  }
}
`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);
    return {
      coreBeliefs: parsed.coreBeliefs || [],
      activeGoals: parsed.activeGoals || [],
      psychologicalProfile: {
        strengths: parsed.psychologicalProfile?.strengths || [],
        focusAreas: parsed.psychologicalProfile?.focusAreas || [],
        blindSpots: parsed.psychologicalProfile?.blindSpots || []
      },
      lastUpdated: Date.now()
    };
  } catch (e) {
    console.error("Failed to update identity persona:", e);
    return currentPersona || {
      coreBeliefs: [],
      activeGoals: [],
      psychologicalProfile: { strengths: [], focusAreas: [], blindSpots: [] },
      lastUpdated: Date.now()
    };
  }
}
