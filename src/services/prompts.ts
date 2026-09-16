// Fixed context for Guy's family
export const FIXED_CONTEXT = `
שמות בני המשפחה של גיא:
- טלי: אשתי
- גיל: הבת שלי
- איתן: הבן שלי
- נוה: הבן שלי
`;

export const TRIPLES_SCHEMA_INSTRUCTION = `
KNOWLEDGE GRAPH TRIPLES & ENTITY SCHEMAS (Phases A, B, and C):
Extract 3-8 meaningful relationships representing key facts, emotions, plans, or connections in this entry.
For each relationship, you MUST return a structured object according to this exact format:
{
  "subject": "שם הישות הראשונה (למשל: גיא, טלי, עבודה, לחץ). שמור על שמות ישויות עקביים ומנורמלים (עד 3 מילים, ללא ה' הידיעה).",
  "relation": "חייב להיות יחס מתוך האונטולוגיה הסגורה הבאה בלבד: 'חלק_מ', 'סותר', 'מתועד_ב', 'דומה_ל', 'קשור_ל', 'שואף_ל', 'שייך_ל', 'חווה', 'מפעיל', 'משפיע_על', 'מחזק', 'מחליש'",
  "object": "שם הישות השנייה. עד 3 מילים.",
  "domain": "חייב להיות אחד מ: 'Work', 'Family', 'Personal', 'Health', 'Finance', 'General'",
  "temporalContext": "חייב להיות אחד מ: 'Past', 'Present', 'Future'",
  "confidence": "חייב להיות אחד מ: 'Fact', 'Inference', 'Opinion'",
  "sentiment": מספר שלם בלבד: -1 (שלילי/תסכול/קונפליקט), 0 (ניטרלי), או 1 (חיובי/סיפוק/הצלחה),
  "subjectType": "חייב להיות אחד מסוגי הישויות הבאים בלבד: 'Domain', 'Person', 'Goal', 'Pattern', 'Strategy', 'Emotion', 'Event', 'Insight'.",
  "objectType": "חייב להיות אחד מסוגי הישויות הבאים בלבד: 'Domain', 'Person', 'Goal', 'Pattern', 'Strategy', 'Emotion', 'Event', 'Insight'."
}

רשימת 8 סוגי הישויות המוכרים (OKF Core Ontology):
1. 'Domain' - תחום חיים רחב (למשל: עבודה, בריאות, משפחה).
2. 'Person' - בני אדם, עוגנים חברתיים (למשל: גיא, טלי, גיל).
3. 'Goal' - מטרה ספציפית או יעד (למשל: ירידה במשקל, השקת אפליקציה).
4. 'Pattern' - דפוס התנהגות או חשיבה (למשל: דחיינות, פרפקציוניזם).
5. 'Strategy' - אסטרטגיה או כלי התמודדות (למשל: מדיטציה, תכנון שבועי).
6. 'Emotion' - רגש ספציפי או תחושה (למשל: חרדה, שמחה, מתח).
7. 'Event' - אירוע ספציפי או תקופה (למשל: פגישה, משבר).
8. 'Insight' - תובנה או הארה (למשל: הבנה חשובה).
`;
