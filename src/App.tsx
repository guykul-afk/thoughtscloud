import { useState, useRef, useEffect, useMemo } from 'react';
import {
  User,
  X,
  Cloud,
  Loader2
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useAppStore } from './store';
import {
  queryInsights,
  generateWeeklyBriefing,
  generateCategoricalInsights,
  generateLifeThemesAnalysis,
  generateEmotionalGTDInsight,
  generateMajorInsights,
  generateAdvices,
  generateQuoteInsight,
  processTextSession,
  SUPPORTED_MODELS,
  setActiveModel,
  autoDiscoverModel
} from './services/ai';
import { GeminiLiveService, type LiveChatStatus } from './services/live-ai';
import DashboardTab from './components/DashboardTab';
import HomeTab from './components/HomeTab';
import InsightsTab from './components/InsightsTab';
import HistoryTab from './components/HistoryTab';

const forceCheckAuth = () => { console.log('forceCheckAuth stubbed'); };
const dumpStorage = () => { console.log('dumpStorage stubbed'); };
declare const gapi: any;

// Utility for tailwind classes
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'insights' | 'dashboard' | 'history'>('home');
  const { apiKey, setApiKey, entries, preferredModel, preferredApiVersion, setPreferredModel, loadInitialState, syncStatus, syncError, reprocessAllEntries } = useAppStore();
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [syncUid, setSyncUid] = useState('');
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTestingDb, setIsTestingDb] = useState(false);
  const [dbTestResult, setDbTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [reprocessProgress, setReprocessProgress] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    if (showKeyModal) {
      setSyncUid(localStorage.getItem('firebase_sync_uid') || '');
    }
  }, [showKeyModal]);

  const [isStandalone, setIsStandalone] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Capture console logs for mobile diagnostics
  useEffect(() => {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    
    const addLog = (type: string, args: any[]) => {
      const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
      setLogs(prev => [...prev.slice(-50), `${new Date().toLocaleTimeString()} [${type}] ${msg}`]);
    };

    console.log = (...args) => { addLog('LOG', args); originalLog(...args); };
    console.error = (...args) => { addLog('ERR', args); originalError(...args); };
    console.warn = (...args) => { addLog('WRN', args); originalWarn(...args); };

    console.log("Diagnostic overlay initialized. Version 2.0-REBUILD");
    
    return () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    };
  }, []);

  // Restore preferred model & auto-discover the best available model
  useEffect(() => {
    if (preferredModel && preferredApiVersion) {
      setActiveModel(preferredModel, preferredApiVersion);
    }
    if (apiKey) {
      autoDiscoverModel(apiKey).then(model => {
        if (model) {
          setPreferredModel(model.name, model.version);
        }
      });
    }
  }, [apiKey, preferredModel, preferredApiVersion]);

  // Auto-reprocess catalog V2 (behind the scenes)
  useEffect(() => {
    const hasRun = localStorage.getItem('hasRunV2Reprocess_v2');
    if (!hasRun && apiKey && entries.length > 0) {
      console.log('Running automatic background catalog update...');
      setIsReprocessing(true);
      setReprocessProgress({ current: 0, total: entries.length });
      
      reprocessAllEntries((current, total) => {
        setReprocessProgress({ current, total });
      }).then(() => {
        setIsReprocessing(false);
        setReprocessProgress(null);
        localStorage.setItem('hasRunV2Reprocess_v2', 'true');
        console.log('Background catalog update completed successfully!');
      }).catch(err => {
        console.error('Failed to run background catalog update', err);
        setIsReprocessing(false);
        setReprocessProgress(null);
      });
    }
  }, [apiKey, entries.length]);

  useEffect(() => {
    const checkStandalone = () => {
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
      setIsStandalone(standalone);
    };
    checkStandalone();
    window.addEventListener('resize', checkStandalone);
    return () => window.removeEventListener('resize', checkStandalone);
  }, []);

  // Gemini Live State
  const [isRecording, setIsRecording] = useState(false);
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveChatStatus>('disconnected');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const liveServiceRef = useRef<GeminiLiveService | null>(null);
  const liveSessionTranscriptRef = useRef('');
  const liveSessionLastRoleRef = useRef('');

  // Initialize Firebase State
  useEffect(() => {
    loadInitialState();
  }, []);

  // Generate Weekly Insight when entries change
  useEffect(() => {
    if (!apiKey || entries.length === 0) return;

    const timeoutId = setTimeout(async () => {
      const { weeklyInsight, setWeeklyInsight } = useAppStore.getState();
      try {
        const { knowledgeGraph, addTriples } = useAppStore.getState();
        const result = await generateWeeklyBriefing(entries, apiKey, undefined, knowledgeGraph);
        if (result.insight !== weeklyInsight) {
          setWeeklyInsight(result.insight);
        }
        if (result.triples && result.triples.length > 0) {
          addTriples(result.triples, Date.now());
        }
      } catch (e) {
        console.error("Failed to generate weekly briefing", e);
      }
    }, 5000); // 5 sec debounce for heavy AI call

    return () => clearTimeout(timeoutId);
  }, [entries.length, apiKey]);

  // Generate Categorical Insights when entries change
  const { setCategoricalInsights } = useAppStore();
  useEffect(() => {
    if (!apiKey || entries.length === 0) return;

    const timeoutId = setTimeout(async () => {
      try {
        const { knowledgeGraph, addTriples } = useAppStore.getState();
        const result = await generateCategoricalInsights(entries, apiKey, knowledgeGraph);
        const { work, family, personal, triples } = result;
        setCategoricalInsights({ work, family, personal });
        if (triples && triples.length > 0) {
          addTriples(triples, Date.now());
        }
      } catch (e) {
        console.error("Failed to generate categorical insights", e);
      }
    }, 6000); // Debounce

    return () => clearTimeout(timeoutId);
  }, [entries.length, apiKey]);

  const extractedQuotes = useMemo(() => {
    console.log('--- Extracted Quotes Diagnostic Start ---');
    console.log('Total entries:', entries.length);
    const result = entries.filter(entry => {
      const hasQuoteTopic = (entry.topics || []).some(topic => {
        if (!topic) return false;
        const clean = topic.replace(/[\u200e\u200f\s#]/g, '').toLowerCase();
        const match = clean.includes('ציטוט');
        if (match) {
          console.log(`Matched topic in entry [${entry.id}]:`, topic);
        }
        return match;
      });

      const normalizedTranscript = entry.transcript.replace(/[\u200e\u200f]/g, '');
      const hasQuoteHashtag = 
        /#ציטוט/.test(normalizedTranscript) || 
        /#\s*ציטוט/.test(normalizedTranscript);

      if (hasQuoteHashtag) {
        console.log(`Matched hashtag in entry [${entry.id}]:`, entry.transcript.substring(0, 100));
      }

      const matched = hasQuoteTopic || hasQuoteHashtag;
      console.log(`Entry [${entry.id}] date [${new Date(entry.timestamp).toLocaleDateString('he-IL')}]: matched = ${matched}, topics =`, entry.topics);
      return matched;
    });
    console.log('Matched entries:', result.length);
    console.log('--- Extracted Quotes Diagnostic End ---');
    return result;
  }, [entries]);

  // Advanced Insights Logic (Life Themes, Emotional GTD)
  const {
    lifeThemes, setLifeThemes,
    dailyGtd, setDailyGtd,
    majorInsights, setMajorInsights,
    lastMajorInsightsCount, setLastMajorInsightsCount,
    advices, setAdvices,
    quoteInsights, setQuoteInsights,
    calibratePredictionsAction,
    updateIdentityPersonaAction
  } = useAppStore();

  useEffect(() => {
    if (!apiKey || entries.length === 0) return;

    const runAdvancedAnalysis = async () => {
      const now = new Date();
      const todayStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
      const dayOfWeek = now.getDay(); // 0 is Sunday, 5 is Friday
      const dayOfMonth = now.getDate();

      // 1. Daily Emotional GTD
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const entriesToday = entries.filter(e => e.timestamp >= todayStart);
      const entriesTodayIds = entriesToday.map(e => e.id || '');
      
      const dailyGtdOutdated = !dailyGtd || 
        dailyGtd.lastDate !== todayStr ||
        !dailyGtd.lastEntryIds ||
        dailyGtd.lastEntryIds.length !== entriesTodayIds.length ||
        entriesTodayIds.some(id => !dailyGtd.lastEntryIds!.includes(id));

      if (dailyGtdOutdated && entriesToday.length > 0) {
        try {
          const { knowledgeGraph, addTriples } = useAppStore.getState();
          const { insight, triples } = await generateEmotionalGTDInsight(entries, apiKey, knowledgeGraph);
          setDailyGtd({ insight, lastDate: todayStr, lastEntryIds: entriesTodayIds });
          if (triples && triples.length > 0) {
            addTriples(triples, Date.now());
          }
        } catch (e) {
          console.error("Daily GTD error:", e);
        }
      }

      // 2. Weekly Life Themes (Friday)
      if (dayOfWeek === 1 && lifeThemes?.lastWeeklyDate !== todayStr) {
        try {
          const { knowledgeGraph, addTriples } = useAppStore.getState();
          const { insight: themes, triples: themesTriples } = await generateLifeThemesAnalysis(entries, apiKey, 'weekly', knowledgeGraph);
          setLifeThemes({ ...lifeThemes, weekly: themes, lastWeeklyDate: todayStr });
          if (themesTriples && themesTriples.length > 0) {
            addTriples(themesTriples, Date.now());
          }
        } catch (e) {
          console.error("Weekly analysis error:", e);
        }
      }

      // 3. Monthly Life Themes (1st of month)
      if (dayOfMonth === 1 && lifeThemes?.lastMonthlyDate !== todayStr) {
        try {
          const { knowledgeGraph, addTriples } = useAppStore.getState();
          const { insight: themes, triples: themesTriples } = await generateLifeThemesAnalysis(entries, apiKey, 'monthly', knowledgeGraph);
          setLifeThemes({ ...lifeThemes, monthly: themes, lastMonthlyDate: todayStr });
          if (themesTriples && themesTriples.length > 0) {
            addTriples(themesTriples, Date.now());
          }
        } catch (e) {
          console.error("Monthly analysis error:", e);
        }
      }

      // 5. Major Insights (Triggered if new entries exist since last analysis)
      if (entries.length > 0 && entries.length !== lastMajorInsightsCount) {
          try {
            const { knowledgeGraph, addTriples } = useAppStore.getState();
            const { insights: majorList, triples } = await generateMajorInsights(entries, apiKey, majorInsights, knowledgeGraph);
            setMajorInsights(majorList);
            if (triples && triples.length > 0) {
              addTriples(triples, Date.now());
            }
            setLastMajorInsightsCount(entries.length);
          } catch (e) {
            console.error("Major Insights error:", e);
          }
      }

      // 6. Advices Generator (Triggered if 5 new entries since last generation)
      const currentEntryCount = entries.length;
      const lastAdvicesCount = advices?.lastEntryCount || 0;
      if (currentEntryCount - lastAdvicesCount >= 5 && currentEntryCount > 0) {
        try {
          const { knowledgeGraph, addTriples } = useAppStore.getState();
          const { work, family, mental, triples } = await generateAdvices(entries, apiKey, knowledgeGraph);
          if (triples && triples.length > 0) {
            addTriples(triples, Date.now());
          }
          const history = advices?.history || [];
          setAdvices({
            lastEntryCount: currentEntryCount,
            history: [{
              timestamp: Date.now(),
              work,
              family,
              mental
            }, ...history]
          });
        } catch (e) {
          console.error("Failed to generate advices:", e);
        }
      }
      // 7. Quote Insights (Triggered once every 2 days if quotes exist and initial ones were loaded)
      const lastQuoteUpdate = quoteInsights?.lastUpdateDate ? new Date(quoteInsights.lastUpdateDate) : null;
      const todayDate = new Date();
      const diffDays = lastQuoteUpdate ? (todayDate.getTime() - lastQuoteUpdate.getTime()) / (1000 * 3600 * 24) : Infinity;

      if (quoteInsights?.lastUpdateDate && diffDays >= 2 && extractedQuotes.length > 0) {
        try {
          const { knowledgeGraph, addTriples } = useAppStore.getState();
          const existing = quoteInsights?.insights || [];
          const { insight: newInsight, triples } = await generateQuoteInsight(extractedQuotes, existing, apiKey, knowledgeGraph);
          
          if (triples && triples.length > 0) {
            addTriples(triples, Date.now());
          }
          
          setQuoteInsights({
            insights: [newInsight, ...existing],
            lastUpdateDate: todayStr
          });
        } catch (e) {
          console.error("Failed to generate quote insight:", e);
        }
      }

      // 8. Calibrate Predictions
      try {
        await calibratePredictionsAction();
      } catch (e) {
        console.error("Failed to run prediction calibration:", e);
      }

      // 9. Update Identity Persona
      try {
        await updateIdentityPersonaAction();
      } catch (e) {
        console.error("Failed to update identity persona:", e);
      }
    };

    const timeoutId = setTimeout(runAdvancedAnalysis, 10000);
    return () => clearTimeout(timeoutId);
  }, [entries.length, apiKey, dailyGtd?.lastDate, dailyGtd?.lastEntryIds?.join(','), lifeThemes?.lastWeeklyDate, lifeThemes?.lastMonthlyDate, advices?.lastEntryCount, quoteInsights?.lastUpdateDate, extractedQuotes.length, lastMajorInsightsCount, calibratePredictionsAction, updateIdentityPersonaAction]);

  const handleTestKey = async (keyToTest: string) => {
    if (!keyToTest) return;
    setIsTestingKey(true);
    setTestResult(null);

    let lastError = "";
    let foundWorkableModel = false;

    for (const model of (SUPPORTED_MODELS as any[])) {
      try {
        setTestResult({ success: false, message: `בודק מודל: ${model.name} (${model.version})...` });
        setActiveModel(model.name, model.version);
        // Small test call
        await queryInsights("היי, האם המפתח עובד?", [{ transcript: "בדיקה", timestamp: Date.now() }], keyToTest);
        setTestResult({ success: true, message: `המפתח תקין! (פעיל עם: ${model.name}) ✅` });
        setPreferredModel(model.name, model.version);
        foundWorkableModel = true;
        break;
      } catch (e: any) {
        console.error(`Model ${model.name} failed:`, e);
        lastError = e.message || "שגיאה לא ידועה";
      }
    }

    if (!foundWorkableModel) {
      let errorMsg = lastError;
      if (errorMsg.includes("404") || errorMsg.includes("not found") || errorMsg.includes("no longer available")) {
        errorMsg += "\n\n💡 ייתכן שחשבון הגוגל שלך חסום לבינה מלאכותית או שצריך ליצור פרויקט חדש ב-AI Studio.";
      }
      setTestResult({ success: false, message: `כל הניסיונות נכשלו: ${errorMsg}` });
    }

    setIsTestingKey(false);
  };

  const handleTestDatabase = async () => {
    setIsTestingDb(true);
    setDbTestResult(null);
    try {
      const { FirebaseStorageService } = await import('./services/FirebaseStorageService');
      const uid = await FirebaseStorageService.init();
      const { doc, setDoc, deleteDoc, getDoc } = await import('firebase/firestore');
      const { db } = await import('./services/firebase');
      const testDocRef = doc(db, `users/${uid}/diagnostics`, 'connection_test');
      await setDoc(testDocRef, {
        timestamp: Date.now(),
        status: 'OK',
        testBy: 'Client Diagnostic Button'
      });
      const snap = await getDoc(testDocRef);
      if (!snap.exists() || snap.data()?.status !== 'OK') {
        throw new Error("נכתב מסמך בדיקה אך לא נקרא בחזרה בצורה תקינה.");
      }
      await deleteDoc(testDocRef);
      setDbTestResult({ success: true, message: `חיבור למסד הנתונים תקין! מזהה משתמש: ${uid}` });
    } catch (err: any) {
      console.error("Database connection test failed:", err);
      setDbTestResult({ 
        success: false, 
        message: `שגיאת חיבור: ${err.message || err.code || JSON.stringify(err)}` 
      });
    } finally {
      setIsTestingDb(false);
    }
  };

  const handleReprocessHistory = async () => {
    if (!apiKey) {
      alert("אנא הגדר מפתח API תחילה.");
      return;
    }
    if (entries.length === 0) {
      alert("אין רשומות יומן לעדכון.");
      return;
    }
    const confirmReprocess = window.confirm(`האם אתה בטוח שברצונך לקטלג מחדש ${entries.length} רשומות יומן מהעבר? פעולה זו עשויה לקחת זמן ותפעיל מחדש את ה-AI על כל הרשומות.`);
    if (!confirmReprocess) return;

    setIsReprocessing(true);
    setReprocessProgress({ current: 0, total: entries.length });
    try {
      await reprocessAllEntries((current, total) => {
        setReprocessProgress({ current, total });
      });
      alert("קיטלוג ההיסטוריה מחדש הושלם בהצלחה!");
    } catch (err: any) {
      alert(`שגיאה במהלך קיטלוג מחדש: ${err.message || err}`);
    } finally {
      setIsReprocessing(false);
      setReprocessProgress(null);
    }
  };

  const toggleLiveChat = async (customInstruction?: string) => {
    if (!apiKey) {
      setShowKeyModal(true);
      return;
    }

    if (isLiveActive) {
      liveServiceRef.current?.stop();
      setIsLiveActive(false);
    } else {
      const { weeklyInsight, dailyGtd, lifeThemes, identityPersona } = useAppStore.getState();

      const identityPersonaText = identityPersona ? `
פרופיל זהות נוכחי:
- אמונות יסוד: ${identityPersona.coreBeliefs.join(', ')}
- מטרות פעילות: ${identityPersona.activeGoals.join(', ')}
- נקודות עיוורון/צל: ${identityPersona.psychologicalProfile.blindSpots.join(', ')}
- חוזקות: ${identityPersona.psychologicalProfile.strengths.join(', ')}
` : '';

      const socraticInstruction = `
אתה מאמן סוקרטי מתקדם וחד בשם 'ענן המחשבות'. דבר בעברית בלבד.
תפקידך הוא לא רק להקשיב, אלא לאתגר את גיא (PROACTIVE PROBING). 
אם אתה מזהה סתירה, תירוץ, או "סיפור" שגיא מספר לעצמו כדי להימנע ממאמץ או מכאב - עצור אותו ושאל שאלה נוקבת. פנה אליו ישירות בגוף שני ("אתה").

היה "פרקליט השטן" (Shadow Work Coach): חפש את מה שגיא לא אומר. שאל על הפער בין מה שהוא תכנן לעשות (Execution Gap) לבין מה שהוא מדווח עכשיו.

הקשר קבוע לגבי בני משפחה:
- טלי: אשתי
- גיל: הבת שלי
- איתן: הבן שלי
- נוה: הבן שלי

${identityPersonaText}

הקשר נוכחי:
${weeklyInsight ? `- תובנה שבועית (כולל צד הצל): ${weeklyInsight}` : ''}
${dailyGtd?.insight ? `- GTD רגשי להיום: ${dailyGtd.insight}` : ''}
${lifeThemes?.weekly ? `- תמות חיים מרכזיות מהשבוע האחרון: ${lifeThemes.weekly}` : ''}

הנחיות לאימון אקטיבי:
1. אל תהיה מנומס מדי. אם גיא מתחמק, הצף זאת.
2. שאל שאלות שגורמות לו לעצור ולחשוב (Reflective Probing).
3. חפש דפוסים בין העבר להווה.
4. "תקוף" בעדינות הנחות יסוד מוטעות או אמונות מגבילות.
5. דבר בקצרה כדי לתת לגיא מקום להגיב, אך התערב כשצריך להחזיר את השיחה לעומק.
6. פנה למשתמש תמיד בגוף שני ("אתה") ולא בשמו.
`;

      setIsLiveActive(true);
      liveSessionTranscriptRef.current = '';
      liveSessionLastRoleRef.current = '';

      const service = new GeminiLiveService({
        apiKey,
        systemInstruction: customInstruction || socraticInstruction,
        onStatusChange: async (status) => {
          setLiveStatus(status);
          if (status === 'disconnected') {
            const finalTranscript = liveSessionTranscriptRef.current.trim();
            liveSessionTranscriptRef.current = '';
            liveSessionLastRoleRef.current = '';
            
            if (finalTranscript && apiKey) {
              try {
                const currentOpenThreads = useAppStore.getState().entries.flatMap((e: any) => (e.openThreads || []).map((t: any) => typeof t === 'string' ? t : t.text));
                const result = await processTextSession(finalTranscript, apiKey, currentOpenThreads);
                useAppStore.getState().addEntry(result);
              } catch (e) {
                console.error("Failed to save live session to diary", e);
              }
            }
          }
        },
        onTranscriptUpdate: (text, isUser) => {
          setLiveTranscript(text);
          const role = isUser ? 'user' : 'ai';
          if (liveSessionLastRoleRef.current !== role) {
            liveSessionTranscriptRef.current += `\n${role === 'user' ? 'גיא' : 'ענן המחשבות'}: `;
            liveSessionLastRoleRef.current = role;
          }
          liveSessionTranscriptRef.current += text + (isUser ? '\n' : '');
        },
        onError: (err) => {
          console.error("Gemini Live Error:", err);
          alert(`שגיאת AI: ${err}\n\n💡 ייתכן שצריך לאפשר גישה למיקרופון או לבדוק את הגדרות ה-API.`);
        }
      });
      liveServiceRef.current = service;
      await service.connect();
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !apiKey || isSending) return;
    const userMsg = input;
    setInput('');
    const { addChatMessage } = useAppStore.getState();
    addChatMessage('user', userMsg);
    setIsSending(true);

    try {
      const { entries, weeklyInsight, categoricalInsights, chatMessages, addEntry, knowledgeGraph, identityPersona } = useAppStore.getState();
      const response = await queryInsights(userMsg, entries, apiKey, {
        weeklyInsight: weeklyInsight || undefined,
        categoricalInsights: categoricalInsights || undefined,
        chatHistory: chatMessages || undefined,
        knowledgeGraph: knowledgeGraph || undefined,
        identityPersona: identityPersona || undefined
      });
      addChatMessage('ai', response);
      
      addEntry({
        transcript: `שאלה: ${userMsg}\nתשובה: ${response}`,
        openThreads: [],
        insights: [response],
        triples: [],
        topics: ['מענה לשאלה'],
        mood: 'ניטרלי'
      });
    } catch (e) {
      console.error(e);
      addChatMessage('ai', 'מצטער, הייתה לי שגיאה בניתוח המידע.');
    } finally {
      setIsSending(false);
    }
  };

  const handleToggleVoice = () => {
    const { entries, weeklyInsight, categoricalInsights, chatMessages } = useAppStore.getState();

    const weeklyText = weeklyInsight ? `תובנה שבועית: ${weeklyInsight}` : '';
    const categoricalText = categoricalInsights ? `תובנות לפי קטגוריות: עבודה - ${categoricalInsights.work}, משפחה - ${categoricalInsights.family}, אישי - ${categoricalInsights.personal}` : '';

    const chatSummary = chatMessages.slice(-5).map(m =>
      `${m.role === 'user' ? 'גיא' : 'אתה'}: ${m.content}`
    ).join('\n');

    const recentEntries = entries.slice(0, 15).map(e =>
      `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`
    ).join('\n');

    const customInstruction = `
      התפקיד שלך הוא להפוך את המפגש הקולי לזמן של "תחקיר עומק" ולא רק פריקה. 
      دבר בעברית בלבד. היה אמפתי אך נוקב וחד. פנה למשתמש תמיד בגוף שני ("אתה").

      עקרונות האימון והאתגור:
      1. פרואקטיביות: אל תחכה שגיא ישאל. אם הוא אומר משהו שסותר הצהרת עבר או תובנה קיימת - התערב מיד וציין זאת.
      2. חשיפת ה"צל" (Shadow Work): שאל על הפחדים, על מה שמוסתר בתוך המילים, ועל המקומות שבהם גיא עושה לעצמו הנחות.
      3. ניתוח פער הביצוע (Execution Gap): אם גיא מדבר על משימות, שאל אותו למה משימות קודמות לא בוצעו אם זה המצב בנתונים.
      4. השתמש בטכניקת "למה" (5 Whys) כדי להגיע לשורש של כל הצהרה רגשית.
      5. אל תיתן פתרונות! תן לגיא את הכלים המחשבתיים להבין את עצמו.

      להלן ההקשר המלא מהמערכת:
      ${weeklyText}
      ${categoricalText}

      היסטוריית הצ'אט האחרונה:
      ${chatSummary}

      15 מחשבות אחרונות (חומר גולמי לניתוח סתירות):
      ${recentEntries}

      המטרה: להיות המראה הכי חדה של גיא. תהיה המאמן שלא מוותר לו על האמת שלו.
    `.trim();

    toggleLiveChat(customInstruction);
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-transparent">
      <div className="relative w-full h-full flex flex-col text-white overflow-hidden bg-transparent">
        <div className="absolute top-[30%] left-[-20%] right-[-20%] h-[60%] bg-[#5EB5D6] opacity-40 blur-[100px] rounded-[50%] pointer-events-none" />

        <header className={cn(
          "relative z-20 flex items-center px-6 pb-4 bg-white/5 backdrop-blur-md border-b border-white/10 shrink-0",
          isStandalone ? "pt-[max(env(safe-area-inset-top),20px)]" : "pt-4"
        )}>
          <img 
            src="/logo.jpg" 
            alt="Logo" 
            className="w-8 h-8 rounded-full border border-white/20 ml-3 object-cover shadow-sm transition-transform active:scale-90"
          />
          <h1 
            onDoubleClick={() => setShowDiagnostics(true)}
            className="text-xl font-bold text-white tracking-tight cursor-pointer active:scale-95 transition-transform"
          >
            ענן המחשבות
          </h1>
          <div className="flex-1 overflow-hidden"></div>
          <div className="flex items-center gap-2">
            {syncStatus === 'saving' && (
              <span className="text-[10px] text-white/40 hidden xs:inline">מסתנכרן עם הענן...</span>
            )}
            {syncStatus === 'synced' && (
              <span className="text-[10px] text-emerald-400/80 hidden xs:inline">הנתונים שמורים בענן</span>
            )}
            {syncStatus === 'error' && (
              <span className="text-[10px] text-red-400 hidden xs:inline">שגיאה בסנכרון לענן</span>
            )}
            <button
              onClick={async () => {
                try {
                  await loadInitialState();
                } catch (err) {
                  console.error("Manual sync failed:", err);
                }
              }}
              disabled={syncStatus === 'saving'}
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center transition-all border hover:scale-105 active:scale-95",
                syncStatus === 'synced' && "bg-[#DCFCE7]/20 text-emerald-400 border-emerald-500/20 hover:bg-[#DCFCE7]/30",
                syncStatus === 'saving' && "bg-amber-500/10 text-amber-400 border-amber-500/20 cursor-not-allowed",
                syncStatus === 'error' && "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20"
              )}
              title={
                syncStatus === 'synced' ? "הנתונים מסונכרנים ל-Firebase. לחץ לסנכרון ידני." : 
                syncStatus === 'saving' ? "מסתנכרן מול Firebase..." : 
                "שגיאה בסנכרון. לחץ לסנכרון מחדש."
              }
            >
              {syncStatus === 'saving' ? (
                <Loader2 size={18} className="animate-spin text-amber-400" />
              ) : (
                <Cloud 
                  size={20} 
                  className={cn(
                    syncStatus === 'synced' ? "text-emerald-400" : 
                    syncStatus === 'error' ? "text-red-400" : 
                    "text-white/40"
                  )} 
                />
              )}
            </button>
            <button
              onClick={() => setShowKeyModal(true)}
              className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-[#0D3B66] shadow-md border border-gray-100 hover:bg-gray-50 transition-all"
            >
              <User size={20} />
            </button>
          </div>
        </header>

        {showDiagnostics && (
          <div className="fixed inset-0 z-[100] bg-[#0A192F] text-xs font-mono p-4 flex flex-col overflow-hidden">
             <div className="flex justify-between items-center mb-4 pb-2 border-b border-white/20">
                <h2 className="text-emerald-400 font-bold flex items-center gap-2">
                   לוח בקרה דיאגנוסטי
                </h2>
                <button 
                  onClick={() => setShowDiagnostics(false)}
                  className="px-3 py-1 bg-red-900/50 text-white rounded-lg border border-red-500/30"
                >סגור</button>
             </div>
             
             <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="p-2 bg-white/5 rounded border border-white/10 uppercase">
                  <div className="text-[10px] text-white/40">GAPI</div>
                  <div className={cn("font-bold", typeof (window as any).gapi !== 'undefined' ? "text-emerald-400" : "text-red-400")}>
                    {typeof (window as any).gapi !== 'undefined' ? "LOADED" : "MISSING"}
                  </div>
                </div>
                <div className="p-2 bg-white/5 rounded border border-white/10 uppercase">
                  <div className="text-[10px] text-white/40">GIS</div>
                  <div className={cn("font-bold", typeof (window as any).google !== 'undefined' ? "text-emerald-400" : "text-red-400")}>
                    {typeof (window as any).google !== 'undefined' ? "LOADED" : "MISSING"}
                  </div>
                </div>
                <div className="p-2 bg-white/5 rounded border border-white/10 uppercase">
                  <div className="text-[10px] text-white/40">Standalone</div>
                  <div className="text-white">{isStandalone ? "YES" : "NO"}</div>
                </div>
                <div className="p-2 bg-white/5 rounded border border-white/10 uppercase">
                  <div className="text-[10px] text-white/40">Firebase Sync</div>
                  <div className={cn("font-bold", syncStatus === 'synced' ? "text-emerald-400" : syncStatus === 'saving' ? "text-amber-400" : "text-red-400")}>
                    {syncStatus.toUpperCase()}
                  </div>
                </div>
             </div>

             <div className="flex-1 bg-black/50 rounded-lg p-3 border border-white/10 overflow-auto whitespace-pre-wrap break-all leading-tight">
                {logs.length === 0 ? <div className="text-white/20 italic">No logs captured yet...</div> : logs.map((log, i) => (
                  <div key={i} className={cn("mb-1 pb-1 border-b border-white/5", log.includes('[ERR]') ? "text-red-400" : log.includes('[WRN]') ? "text-amber-300" : "text-white/80")}>
                    {log}
                  </div>
                ))}
             </div>

             <div className="grid grid-cols-2 gap-3 mt-4 pb-[180px]">
                <button 
                  onClick={() => {
                    console.log("Nuclear Reset (Clear Cache) Triggered...");
                    localStorage.clear();
                    window.location.reload();
                  }}
                  className="w-full bg-red-600/20 py-3 rounded-xl border border-red-500/30 text-red-100 font-bold"
                >איפוס מטמון</button>
                <button 
                  onClick={() => {
                    console.log("Manual Sync (Force Scan) Triggered...");
                    forceCheckAuth();
                    dumpStorage();
                  }}
                  className="w-full bg-blue-600/20 py-3 rounded-xl border border-blue-500/30 text-blue-400 font-bold"
                >סנכרון ידני</button>
                <button 
                  onClick={() => {
                    console.log("Fix Device (Reload) Triggered...");
                    window.location.reload();
                  }}
                  className="w-full bg-amber-600/20 py-3 rounded-xl border border-amber-500/30 text-amber-400 font-bold"
                >תיקון חומרה (Reload)</button>
                <button 
                  onClick={async () => {
                    console.log("MIC DOCTOR: Starting hardware check...");
                    try {
                      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
                      await ctx.resume();
                      console.log("MIC DOCTOR: AudioContext Status ->", ctx.state);
                      
                      const timeout = setTimeout(() => {
                        console.error("MIC DOCTOR: getUserMedia HANG/TIMEOUT (5s)");
                        ctx.close();
                      }, 5000);

                      navigator.mediaDevices.getUserMedia({ audio: true })
                        .then((s) => {
                          clearTimeout(timeout);
                          console.log("MIC DOCTOR: getUserMedia SUCCESS. Tracks:", s.getTracks().length);
                          console.log("MIC DOCTOR: Sample Rate ->", ctx.sampleRate);
                          s.getTracks().forEach(t => t.stop());
                          ctx.close();
                        })
                        .catch(err => {
                          clearTimeout(timeout);
                          console.error("MIC DOCTOR: getUserMedia FAIL ->", err.name, err.message);
                          ctx.close();
                        });
                    } catch (e) { 
                      console.error("MIC DOCTOR: Exception ->", e); 
                    }
                  }}
                  className="w-full bg-emerald-600/20 py-3 rounded-xl border border-emerald-500/30 text-emerald-400 font-bold"
                >בדיקת מיקרופון (Doctor)</button>
             </div>
          </div>
        )}

        <main className="relative z-10 w-full flex-1 flex flex-col px-6 overflow-y-auto pb-[180px] pt-4 custom-scrollbar">
          {activeTab === 'home' && (
            <HomeTab 
              isLiveActive={isLiveActive} 
              liveStatus={liveStatus} 
              liveTranscript={liveTranscript}
              isRecording={isRecording}
              setIsRecording={setIsRecording}
              handleToggleVoice={handleToggleVoice}
            />
          )}
          {activeTab === 'insights' && (
            <InsightsTab 
              isLiveActive={isLiveActive} 
              input={input}
              setInput={setInput}
              handleSend={handleSend}
              isSending={isSending}
              handleToggleVoice={handleToggleVoice}
              extractedQuotes={extractedQuotes}
            />
          )}
          {activeTab === 'dashboard' && <DashboardTab />}
          {activeTab === 'history' && <HistoryTab />}
        </main>

        <div className="fixed bottom-0 left-0 right-0 z-[100] flex justify-center px-6 pb-[env(safe-area-inset-bottom,24px)] pointer-events-none">
          <nav className="w-full h-20 bg-[#0D3B66]/80 backdrop-blur-3xl rounded-[2.5rem] flex justify-around items-center px-4 shadow-2xl border border-white/10 pointer-events-auto" dir="rtl">
            <NavItem id="home" label="בית" isActive={activeTab === 'home'} onClick={() => setActiveTab('home')} />
            <NavItem id="insights" label="תובנות" isActive={activeTab === 'insights'} onClick={() => setActiveTab('insights')} />
            <NavItem id="dashboard" label="מבט על" isActive={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
            <NavItem id="history" label="יומן" isActive={activeTab === 'history'} onClick={() => setActiveTab('history')} />
          </nav>
        </div>
        {showKeyModal && (
          <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="bg-white rounded-3xl p-6 text-[#0A3B66] w-full max-w-sm shadow-2xl">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold">הגדרות בינה מלאכותית</h2>
                <button
                  onClick={() => setShowKeyModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={20} />
                </button>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                כדי להשתמש בבינה מלאכותית, אנא הכנס מפתח API של <span className="font-bold text-[#0A3B66]">Gemini 2.0 Flash</span>.
              </p>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4">
                <p className="text-xs text-blue-800 leading-relaxed">
                  💡 <strong>אין לך מפתח?</strong> צור אחד בחינם ב-<a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="underline font-bold">Google AI Studio</a>.
                  <br />
                  וודא שה-Generative Language API <strong>מופעל</strong> בפרויקט שלך.
                </p>
              </div>

               <div className="mb-4">
                <label className="block text-xs font-bold mb-1 text-gray-500">מפתח Gemini API</label>
                <input
                  type="text"
                  placeholder="Gemini API Key..."
                  defaultValue={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setTestResult(null);
                  }}
                  className="w-full bg-white border border-gray-300 rounded-xl py-3 px-4 text-left font-mono text-xs focus:ring-2 focus:ring-[#0A3B66] outline-none shadow-sm"
                  dir="ltr"
                />
              </div>

              <div className="mb-4">
                <label className="block text-xs font-bold mb-1 text-gray-500">מזהה סנכרון (Sync User ID)</label>
                <input
                  type="text"
                  placeholder="מזהה סנכרון ייחודי..."
                  value={syncUid}
                  onChange={(e) => setSyncUid(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-xl py-3 px-4 text-left font-mono text-xs focus:ring-2 focus:ring-[#0A3B66] outline-none shadow-sm"
                  dir="ltr"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  תוכל להעתיק מזהה זה למכשירים אחרים כדי לשתף ולסנכרן את רשומות היומן שלך בענן.
                </p>
              </div>

              {syncError && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-4 text-xs text-red-800 text-right leading-relaxed">
                  ⚠️ <strong>שגיאת סנכרון אחרונה:</strong> {syncError}
                </div>
              )}

              {testResult && (
                <p className={cn(
                  "text-xs mb-4 font-bold text-center animate-in fade-in slide-in-from-top-1",
                  testResult.success ? "text-emerald-600" : "text-red-600"
                )}>
                  {testResult.message}
                </p>
              )}

              {dbTestResult && (
                <p className={cn(
                  "text-xs mb-4 font-bold text-center animate-in fade-in slide-in-from-top-1",
                  dbTestResult.success ? "text-emerald-600" : "text-red-600"
                )}>
                  {dbTestResult.message}
                </p>
              )}

              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => handleTestKey(apiKey)}
                  disabled={isTestingKey || !apiKey}
                  className="flex-1 bg-gray-100 text-[#0A3B66] border border-gray-300 rounded-xl py-2 text-xs font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {isTestingKey ? <Loader2 size={14} className="animate-spin" /> : "בדיקת API Key"}
                </button>
                <button
                  onClick={handleTestDatabase}
                  disabled={isTestingDb}
                  className="flex-1 bg-gray-100 text-[#0A3B66] border border-gray-300 rounded-xl py-2 text-xs font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {isTestingDb ? <Loader2 size={14} className="animate-spin" /> : "בדיקת מסד נתונים"}
                </button>
              </div>

              <div className="mb-4">
                <button
                  onClick={handleReprocessHistory}
                  disabled={isReprocessing || !apiKey || entries.length === 0}
                  className="w-full bg-amber-50 text-amber-800 border border-amber-200 rounded-xl py-3 text-xs font-semibold hover:bg-amber-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {isReprocessing ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>מקטלג מחדש... ({reprocessProgress?.current}/{reprocessProgress?.total})</span>
                    </>
                  ) : (
                    `קיטלוג מחדש של ההיסטוריה (${entries.length} רשומות)`
                  )}
                </button>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    const currentUid = localStorage.getItem('firebase_sync_uid') || '';
                    const targetUid = syncUid.trim();
                    if (targetUid && targetUid !== currentUid) {
                      const { FirebaseStorageService } = await import('./services/FirebaseStorageService');
                      FirebaseStorageService.setCustomUid(targetUid);
                      await loadInitialState();
                    }
                    setShowKeyModal(false);
                  }}
                  className="w-full bg-[#0A3B66] text-white rounded-xl py-3 font-semibold hover:bg-[#082b4a] transition-colors shadow-md"
                >
                  שמור וסגור
                </button>
              </div>
            </div>
          </div>
          )}
        </div>
      </div>
  );
}

function NavItem({ label, isActive, onClick }: { id: string; label: string; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center justify-center transition-all w-14 h-14 rounded-full",
        isActive 
          ? "bg-[#FFD54F] text-[#0D3B66] shadow-[0_4px_15px_rgba(255,213,79,0.4)] scale-110 z-10" 
          : "bg-white/10 text-white/80 hover:bg-white/20"
      )}
    >
      <span className={cn(
        "text-xs font-bold transition-all",
        isActive ? "text-[#0D3B66]" : "text-white/70"
      )}>
        {label}
      </span>
    </button>
  );
}
