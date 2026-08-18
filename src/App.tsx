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
  processTextSession,
  SUPPORTED_MODELS,
  setActiveModel,
  autoDiscoverModel
} from './services/ai';
import { GeminiLiveService, type LiveChatStatus } from './services/live-ai';
import HomeTab from './components/HomeTab';
import HistoryTab from './components/HistoryTab';
import { parseQuotesFromTranscript } from './utils/quotes';

const forceCheckAuth = () => { console.log('forceCheckAuth stubbed'); };
const dumpStorage = () => { console.log('dumpStorage stubbed'); };
declare const gapi: any;

// Utility for tailwind classes
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'history'>('home');
  const { apiKey, setApiKey, entries, preferredModel, preferredApiVersion, setPreferredModel, loadInitialState, syncStatus, syncError, addEntry } = useAppStore();
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

  // Background processing is now handled by the server.

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

  // App relies on server-populated insights (read-only consumer)
  const extractedQuotes = useMemo(() => {
    console.log('--- Extracted Quotes Diagnostic Start ---');
    console.log('Total entries:', entries.length);
    const filtered = entries.filter(entry => {
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

      const hasExplicitQuoteWord = normalizedTranscript.toLowerCase().includes('ציטוט') || normalizedTranscript.toLowerCase().includes('לצטט');
      const hasExtractedQuotes = !!(entry as any).quotes && (entry as any).quotes.length > 0;
      
      const hasQuotationMarks = /["'“‘”’״][^"'“‘”’״]{3,200}["'“‘”’״]/.test(normalizedTranscript);
      const hasColonQuote = /(?:ציטוט|הציטוט)\s*:\s*[^\n.]{5,}/i.test(normalizedTranscript);

      if (hasQuoteHashtag) {
        console.log(`Matched hashtag in entry [${entry.id}]:`, entry.transcript.substring(0, 100));
      }

      const matched = hasQuoteTopic || hasQuoteHashtag || hasExplicitQuoteWord || hasExtractedQuotes || hasQuotationMarks || hasColonQuote;
      console.log(`Entry [${entry.id}] date [${new Date(entry.timestamp).toLocaleDateString('he-IL')}]: matched = ${matched}, topics =`, entry.topics);
      return matched;
    });

    const mapped = filtered.map(entry => {
      const quotes = (entry as any).quotes || [];
      if (quotes.length === 0) {
        const parsed = parseQuotesFromTranscript(entry.transcript);
        if (parsed.length > 0) {
          return {
            ...entry,
            quotes: parsed
          };
        }
      }
      return entry;
    });

    console.log('Matched entries:', mapped.length);
    console.log('--- Extracted Quotes Diagnostic End ---');
    return mapped;
  }, [entries]);

  const handleTestKey = async (keyToTest: string) => {
    if (!keyToTest) return;
    setIsTestingKey(true);
    setTestResult(null);

    const errors: string[] = [];
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
        const errMsg = e.message || "שגיאה לא ידועה";
        errors.push(`${model.name}: ${errMsg}`);
        const lowerErr = errMsg.toLowerCase();
        if (lowerErr.includes("api key not valid") || lowerErr.includes("api_key_invalid") || lowerErr.includes("invalid api key") || lowerErr.includes("key is invalid")) {
          errors.push("המפתח עצמו אינו תקין (API Key Invalid).");
          break;
        }
      }
    }

    if (!foundWorkableModel) {
      const detailedErrors = errors.join("\n");
      setTestResult({ 
        success: false, 
        message: `כל הניסיונות נכשלו:\n${detailedErrors}\n\n💡 ייתכן שצריך להפעיל את Generative Language API ב-Google Cloud Console, או ליצור מפתח חדש ב-AI Studio.` 
      });
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
    alert("קיטלוג ההיסטוריה מנוהל כעת על ידי השרת.");
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

הנחיות לאימון אקטיבי (חוק 2 שאלות החידוד):
1. **הגבלת שאלות חמורה:** מותר לך לשאול את גיא לכל היותר 2 שאלות חידוד במהלך שיחה זו.
2. לאחר ששאלת 2 שאלות, או כאשר הבנת את הרציונל במלואו, **אל תשאל שאלות נוספות**. במקום זאת, סכם את התובנה בקצרה (Insight Pill) וציין שההקלטה הושלמה.
3. אל תהיה מנומס מדי. אם גיא מתחמק, הצף זאת.
4. שאל שאלות שגורמות לו לעצור ולחשוב (Reflective Probing).
5. חפש דפוסים בין העבר להווה.
6. דבר בקצרה כדי לתת לגיא מקום להגיב.
7. פנה למשתמש תמיד בגוף שני ("אתה") ולא בשמו.
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
      // AI Insights handled by server
      addChatMessage('ai', "הודעה התקבלה ונשמרה.");
      
      addEntry({
        transcript: `שאלה: ${userMsg}\nתשובה נרשמה`,
        openThreads: [],
        insights: [],
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
          {activeTab === 'history' && <HistoryTab />}
        </main>

        <div className="fixed bottom-0 left-0 right-0 z-[100] flex justify-center px-6 pb-[env(safe-area-inset-bottom,24px)] pointer-events-none">
          <nav className="w-full h-20 bg-[#0D3B66]/80 backdrop-blur-3xl rounded-[2.5rem] flex justify-around items-center px-4 shadow-2xl border border-white/10 pointer-events-auto" dir="rtl">
            <NavItem id="home" label="בית" isActive={activeTab === 'home'} onClick={() => setActiveTab('home')} />
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
                כדי להשתמש בבינה מלאכותית, אנא הכנס מפתח API של <span className="font-bold text-[#0A3B66]">Gemini 3.6 Flash / 3.5 Flash</span>.
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
