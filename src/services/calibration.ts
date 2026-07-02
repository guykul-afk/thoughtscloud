import { getGenAI, activeModelName, activeApiVersion } from './ai-config';
import type { KnowledgeGraph } from '../store';

export interface CalibratedPrediction {
  id: string;
  status: 'succeeded' | 'failed' | 'pending';
  evaluation: string;
}

export async function calibratePredictions(
  recentEntries: { transcript: string; timestamp: number }[],
  graph: KnowledgeGraph,
  apiKey: string
): Promise<CalibratedPrediction[]> {
  const pendingPredictions = (graph.nodes || []).filter(
    n => n.type === 'Prediction' && n.status !== 'succeeded' && n.status !== 'failed'
  );

  if (pendingPredictions.length === 0 || recentEntries.length === 0) {
    return [];
  }

  const genAI = getGenAI(apiKey);
  const model = genAI.getGenerativeModel({ 
    model: activeModelName,
    generationConfig: { responseMimeType: "application/json" }
  }, { apiVersion: activeApiVersion as any });

  const entriesText = recentEntries
    .slice(0, 10)
    .map(e => `[תאריך: ${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`)
    .join('\n\n');

  const predictionsList = pendingPredictions
    .map(p => `- ID: ${p.id}, תוכן הניבוי/ציפייה: "${p.label}"`)
    .join('\n');

  const prompt = `
אתה מנוע כיול ניבויים (Prediction Calibration Engine) עבור "גיא".
משימתך היא לבדוק האם הציפיות או הניבויים שגיא העריך בעבר התממשו, נכשלו, או שמא הם עדיין תלויים ועומדים (Pending), על בסיס רשומות היומן האחרונות שלו.

הניבויים לבדיקה:
${predictionsList}

רשומות יומן אחרונות כהקשר:
${entriesText}

עבור כל ניבוי ברשימה, קבע:
1. status: 'succeeded' (אם הניבוי התממש במציאות), 'failed' (אם הניבוי הופרך או התגלה כשגוי במציאות), או 'pending' (אם עדיין אין מספיק מידע כדי להכריע).
2. evaluation: הסבר קצר בעברית המנמק את הקביעה (כתוב בגוף שני לגיא, למשל: "צפית שתסיים את הפרויקט בחמישי, אך דיווחת על עיכובים והעברת היעד").

החזר את התשובה בפורמט JSON תקין בלבד:
{
  "calibrations": [
    {
      "id": "מזהה הניבוי המדויק מהרשימה",
      "status": "succeeded / failed / pending",
      "evaluation": "ההסבר שלך בעברית"
    }
  ]
}
`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);
    return parsed.calibrations || [];
  } catch (e) {
    console.error("Failed to calibrate predictions:", e);
    return [];
  }
}
