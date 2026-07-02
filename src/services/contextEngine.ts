import type { DiaryEntry, KnowledgeGraph } from '../store';

/**
 * Helper to calculate Edit Distance (Levenshtein) between narrative signatures
 */
function getEditDistance(a: string[], b: string[]): number {
  if (!a || !b) return Infinity;
  const dp = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
      }
    }
  }
  return dp[a.length][b.length];
}

/**
 * 1. Hybrid Retrieval (5.1.א)
 * Semantic similar top-K cosine similarity + 1st degree neighbor expansion
 */
export async function getHybridContext(
  query: string,
  _entries: DiaryEntry[],
  graph: KnowledgeGraph,
  apiKey: string,
  limitCount = 5
): Promise<{ contextText: string; expandedNodeIds: string[] }> {
  const { FirebaseStorageService } = await import('./FirebaseStorageService');
  const similar = await FirebaseStorageService.getSimilarEntries(query, apiKey, limitCount);

  if (similar.length === 0) {
    return { contextText: "אין רשומות דומות סמנטית שנמצאו.", expandedNodeIds: [] };
  }

  const similarEntryIds = new Set(similar.map(e => e.id));
  const activeNodeIds = new Set<string>();

  (graph.nodes || []).forEach(node => {
    const overlap = (node.occurrence_refs || []).filter(ref => similarEntryIds.has(ref));
    if (overlap.length > 0) {
      activeNodeIds.add(node.id);
    }
  });

  const expandedNodeIds = new Set<string>(activeNodeIds);
  const relationsText: string[] = [];

  (graph.edges || []).forEach(edge => {
    if (activeNodeIds.has(edge.source) || activeNodeIds.has(edge.target)) {
      expandedNodeIds.add(edge.source);
      expandedNodeIds.add(edge.target);
      relationsText.push(`  * ${edge.source} --(${edge.relation})--> ${edge.target} [סנטימנט: ${edge.sentiment || 0}]`);
    }
  });

  let contextText = "=== רשומות קשורות סמנטית ===\n";
  similar.forEach(e => {
    contextText += `[תאריך: ${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}\n\n`;
  });

  if (expandedNodeIds.size > 0) {
    contextText += "=== קשרים וישויות רלוונטיות מגרף הידע ===\n";
    expandedNodeIds.forEach(nodeId => {
      const node = graph.nodes.find(n => n.id === nodeId);
      if (node) {
        contextText += `- ישות: ${node.id} (סוג: ${node.type || 'Other'}, עוצמת ראיות: ${(node.evidence_strength || 1).toFixed(2)})\n`;
      }
    });
    contextText += relationsText.slice(0, 15).join('\n') + '\n';
  }

  return { contextText, expandedNodeIds: Array.from(expandedNodeIds) };
}

/**
 * 2. Bridge Entity Linking (5.1.ב)
 * Finds entries sharing bridge entities (Tension or Motif) even if semantic similarity is low
 */
export function getBridgeEntityLinkedContext(
  entries: DiaryEntry[],
  graph: KnowledgeGraph,
  limitCount = 3
): string {
  const bridgeNodes = (graph.nodes || []).filter(n => n.type === 'Tension' || n.type === 'Motif');
  if (bridgeNodes.length === 0 || entries.length < 2) return "";

  let context = "\n=== קישור ישויות-גשר (Tension / Motif משותף) ===\n";
  let found = false;

  bridgeNodes.slice(0, 3).forEach(node => {
    const refs = node.occurrence_refs || [];
    if (refs.length >= 2) {
      const matchedEntries = entries.filter(e => refs.includes(e.id));
      if (matchedEntries.length >= 2) {
        context += `- ישות גשר פעילה: ${node.id} (${node.type})\n`;
        matchedEntries.slice(0, limitCount).forEach(e => {
          context += `  * [${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript.substring(0, 150)}...\n`;
        });
        found = true;
      }
    }
  });

  return found ? context : "";
}

/**
 * 3. Structural Signature Linking (5.2.ג)
 * Uses Edit Distance to find entries sharing similar narrative structures
 */
export function getStructuralSignatureContext(
  currentEntry: DiaryEntry,
  allEntries: DiaryEntry[],
  threshold = 2
): string {
  const currentSig = currentEntry.narrative_signature;
  if (!currentSig || currentSig.length === 0) return "";

  let context = "\n=== הקשרה מבנית (חתימה נרטיבית דומה) ===\n";
  let found = false;

  allEntries.forEach(entry => {
    if (entry.id === currentEntry.id || !entry.narrative_signature) return;
    const distance = getEditDistance(currentSig, entry.narrative_signature);
    if (distance <= threshold) {
      context += `- חתימה דומה מצאה דפוס דומה ברשומה מתאריך [${new Date(entry.timestamp).toLocaleDateString('he-IL')}]:\n`;
      context += `  * חתימה: ${entry.narrative_signature.join(' -> ')}\n`;
      context += `  * תוכן: ${entry.transcript.substring(0, 200)}...\n`;
      found = true;
    }
  });

  return found ? context : "";
}

/**
 * 4. Contrastive Context (5.2.ד)
 */
export function getContrastivePairs(entries: DiaryEntry[]): string {
  if (entries.length < 2) return "";

  let contrastiveText = "";
  for (let i = 0; i < Math.min(entries.length, 5); i++) {
    const entryA = entries[i];
    const sentimentA = entryA.sentiment ?? 0;

    for (let j = i + 1; j < Math.min(entries.length, 30); j++) {
      const entryB = entries[j];
      const sentimentB = entryB.sentiment ?? 0;

      if ((sentimentA > 0 && sentimentB < 0) || (sentimentA < 0 && sentimentB > 0)) {
        const sharedTopics = (entryA.topics || []).filter(t => (entryB.topics || []).includes(t));
        if (sharedTopics.length > 0) {
          contrastiveText += `\n=== הקשרה קונטרסטיבית (נושא דומה, סנטימנט הפוך) ===
נושא משותף: ${sharedTopics.join(', ')}
- כניסה א' [${new Date(entryA.timestamp).toLocaleDateString('he-IL')} - סנטימנט: ${sentimentA}]: ${entryA.transcript}
- כניסה ב' [${new Date(entryB.timestamp).toLocaleDateString('he-IL')} - סנטימנט: ${sentimentB}]: ${entryB.transcript}\n`;
          return contrastiveText;
        }
      }
    }
  }

  return "";
}

/**
 * 5. Echo Detection (5.2.ה)
 */
export function detectEchoes(newEntry: DiaryEntry, graph: KnowledgeGraph): string {
  const pendingPredictions = (graph.nodes || []).filter(
    n => n.type === 'Prediction' && n.status === 'pending'
  );

  if (pendingPredictions.length === 0) return "";

  let context = "\n=== הקשרת הד (Echo Detection - ניבויים פתוחים שעשויים להתקשר) ===\n";
  let hasEcho = false;

  pendingPredictions.forEach(pred => {
    const cleanLabel = pred.label.toLowerCase();
    if (newEntry.transcript.toLowerCase().includes(cleanLabel)) {
      context += `- ניבוי פתוח: "${pred.label}" (נוצר בחיבור לרשומה ${pred.occurrence_refs?.[0] || 'בעבר'})\n`;
      hasEcho = true;
    }
  });

  return hasEcho ? context : "";
}

/**
 * 6. Anniversary Retrieval (5.2.ו)
 */
export function getAnniversaryEntries(entries: DiaryEntry[]): string {
  const now = new Date();
  const targetMonth = now.getMonth();
  const targetDay = now.getDate();

  const anniversaryList = entries.filter(e => {
    const d = new Date(e.timestamp);
    return d.getMonth() === targetMonth && d.getDate() === targetDay && d.getFullYear() !== now.getFullYear();
  });

  if (anniversaryList.length === 0) return "";

  let context = "\n=== יום נקודתי (Anniversary) - מה נכתב ביום זה בשנים עברו ===\n";
  anniversaryList.forEach(e => {
    context += `[תאריך: ${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}\n\n`;
  });
  return context;
}

/**
 * 7. Lexicon Drift Check (5.2.ז)
 * Checks words that shifted in meaning or sentiment context across time
 */
export function getLexiconDriftContext(entries: DiaryEntry[]): string {
  if (entries.length < 10) return "";
  const keyWords = ['עבודה', 'בית', 'זמן', 'לחץ', 'חופש', 'משפחה'];
  let driftContext = "";

  keyWords.forEach(word => {
    const mentions = entries.filter(e => e.transcript.includes(word));
    if (mentions.length >= 4) {
      const recentSentiment = mentions[0].sentiment ?? 0;
      const oldSentiment = mentions[mentions.length - 1].sentiment ?? 0;
      if (Math.abs(recentSentiment - oldSentiment) >= 1) {
        driftContext += `- המילה "${word}" מראה שינוי הקשר רגשי: בעבר סנטימנט היה ${oldSentiment}, כעת הוא ${recentSentiment}.\n`;
      }
    }
  });

  return driftContext ? `\n=== המילון האישי (Lexicon Drift - שינוי משמעות רגשית) ===\n${driftContext}` : "";
}

/**
 * 8. Shared Absence Check (5.2.ח)
 * Compares periods to spot shared silence (topics or entities that vanished)
 */
export function getSharedAbsenceContext(entries: DiaryEntry[]): string {
  if (entries.length < 10) return "";
  const recentTopics = new Set(entries.slice(0, 5).flatMap(e => e.topics || []));
  const pastTopics = new Set(entries.slice(5, 15).flatMap(e => e.topics || []));
  
  const vanished = Array.from(pastTopics).filter(topic => !recentTopics.has(topic));
  if (vanished.length > 0) {
    return `\n=== היעדר משותף (Shared Absence - נושאים שנעלמו לאחרונה) ===
- נושאים שהיו פעילים בעבר ונעלמו לאחרונה מהיומן: ${vanished.slice(0, 3).join(', ')}\n`;
  }
  return "";
}

/**
 * Prediction Calibration report generator (6.3)
 */
export function getCalibrationReport(graph: KnowledgeGraph): {
  score: number;
  total: number;
  succeeded: number;
  failed: number;
  reportText: string;
} {
  const predictions = (graph.nodes || []).filter(n => n.type === 'Prediction');
  const succeeded = predictions.filter(n => n.status === 'succeeded').length;
  const failed = predictions.filter(n => n.status === 'failed').length;
  const total = succeeded + failed;

  const score = total > 0 ? (succeeded / total) * 100 : 100;
  
  let reportText = `דוח כיול ניבויים: מתוך ${predictions.length} ניבויים שחולצו, ${total} הוכרעו.\n`;
  reportText += `- התממשו בהצלחה: ${succeeded}\n- נכשלו: ${failed}\n- דיוק הניבויים הכללי שלך: ${score.toFixed(0)}%\n`;

  return { score, total, succeeded, failed, reportText };
}

/**
 * Deterministic contradiction finder (6.2)
 */
export function detectContradictions(graph: KnowledgeGraph): string {
  if (!graph || !graph.edges) return "";

  let context = "";
  const edgeGroups: { [key: string]: typeof graph.edges } = {};

  graph.edges.forEach(edge => {
    const key = `${edge.source}-${edge.relation}-${edge.target}`;
    if (!edgeGroups[key]) edgeGroups[key] = [];
    edgeGroups[key].push(edge);
  });

  for (const key in edgeGroups) {
    const group = edgeGroups[key];
    if (group.length >= 2) {
      const sentA = group[0].sentiment ?? 0;
      const sentB = group[group.length - 1].sentiment ?? 0;

      if ((sentA > 0 && sentB < 0) || (sentA < 0 && sentB > 0)) {
        const [source, relation, target] = key.split('-');
        context += `\n⚠️ סתירה מובנית זוהתה ביחס: ${source} --(${relation})--> ${target} (סנטימנטים סותרים: ${sentA} מול ${sentB})\n`;
      }
    }
  }

  return context;
}
