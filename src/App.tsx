import { useState, useRef, useEffect } from 'react';
import {
  Mic,
  Send,
  User,
  History as HistoryIcon,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Brain,
  Notebook,
  Volume2,
  VolumeX,
  Loader2,
  Trash2,
  Square,
  X,
  Star,
  Cloud,
  Activity
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useAppStore } from './store';
import {
  queryInsights,
  generateWeeklyBriefing,
  generateCategoricalInsights,
  generateLifeThemesAnalysis,
  generateShadowWorkInsight,
  generateEmotionalGTDInsight,
  generateOperatingManual,
  generateKorczakAnalysis,
  processAudioSession,
  processTextSession,
  SUPPORTED_MODELS,
  setActiveModel
} from './services/ai';
import { GeminiLiveService, type LiveChatStatus } from './services/live-ai';
import { synthesizeSpeech } from './services/tts';
import { loadGapi, loadGis, handleAuthClick, handleSignoutClick, setAuthChangeCallback, uploadStateToDrive, downloadStateFromDrive, forceCheckAuth, dumpStorage } from './services/drive';
import VoicePulse from './components/VoicePulse';
import KorczakInsight from './components/KorczakInsight';
import DashboardTab from './components/DashboardTab';
import SpeechButton from './components/SpeechButton';

// Utility for tailwind classes
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}



export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'actions' | 'insights' | 'dashboard' | 'history'>('home');
  const { apiKey, setApiKey, entries, setEntries } = useAppStore();
  const [showKeyModal, setShowKeyModal] = useState(!apiKey);
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
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

  // Initialize Google Drive API and Viewport Height
  useEffect(() => {
    const initBoot = async () => {
      console.log("TRACE: App.tsx -> Booting GAPI/GIS Sequence...");
      try {
        // Race condition protection for script loading
        const timeout = setTimeout(() => {
          console.warn("TRACE: GAPI/GIS Boot Timeout - Proceeding anyway");
          loadGapi(); // Try one last time
          loadGis();
        }, 5000);

        await Promise.all([loadGapi(), loadGis()]);
        clearTimeout(timeout);
        console.log("TRACE: App.tsx -> GAPI/GIS Init CALLED");
      } catch (e) {
        console.error("TRACE: Boot Error:", e);
      }
    };
    
    initBoot();
    
    setAuthChangeCallback((authStatus) => {
      console.log("TRACE: App.tsx -> Auth Callback Received:", authStatus);
      setIsAuthenticated(authStatus);
      if (authStatus) {
        syncFromDrive();
      }
    });

    // Check for existing token every 5 seconds (fallback for PWA context shifts)
    const interval = setInterval(() => {
      if (typeof gapi !== 'undefined' && gapi.client) {
         const token = gapi.client.getToken();
         if (token && !isAuthenticated) {
            console.log("TRACE: App.tsx -> Token recovered via interval fallback.");
            setIsAuthenticated(true);
            syncFromDrive();
         }
      }
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [isAuthenticated, entries.length]); // Re-run if entries change to detect if auth is needed

  const { setGdriveConnected } = useAppStore();

  useEffect(() => {
    console.log("TRACE: App.tsx -> isAuthenticated CHANGED:", isAuthenticated);
  }, [isAuthenticated]);

  const handleAuth = () => {
    console.log("TRACE: App.tsx -> handleAuth triggered");
    setGdriveConnected(true);
    handleAuthClick();
  };

  const handleSignout = () => {
    setGdriveConnected(false);
    handleSignoutClick();
  };

  const syncFromDrive = async () => {
    setIsSyncing(true);
    try {
      const state = await downloadStateFromDrive();
      if (state) {
        if (state.entries && Array.isArray(state.entries)) {
          setEntries(state.entries);
        }
        if (state.chatMessages && Array.isArray(state.chatMessages)) {
          useAppStore.getState().setChatMessages(state.chatMessages);
        }
        if (state.weeklyInsight) {
          useAppStore.getState().setWeeklyInsight(state.weeklyInsight);
        }
        if (state.categoricalInsights) {
          useAppStore.getState().setCategoricalInsights(state.categoricalInsights);
        }
        if (state.dailyGtd) {
          useAppStore.getState().setDailyGtd(state.dailyGtd);
        }
        if (state.lifeThemes) {
          useAppStore.getState().setLifeThemes(state.lifeThemes);
        }
        if (state.shadowWork) {
          useAppStore.getState().setShadowWork(state.shadowWork);
        }
        if (state.operatingManual) {
          useAppStore.getState().setOperatingManual(state.operatingManual);
        }
        if (state.korczakAnalysis) {
          useAppStore.getState().setKorczakAnalysis(state.korczakAnalysis);
        }
      }
    } catch (e) {
      console.error("Failed to sync from drive", e);
    } finally {
      setIsSyncing(false);
    }
  };

  // Sync to drive whenever entries or chatMessages change (with simple debounce)
  useEffect(() => {
    if (!isAuthenticated || isRecording) return; // DON'T SYNC WHILE RECORDING
    const chatLen = useAppStore.getState().chatMessages.length;
    if (entries.length === 0 && chatLen === 0) return;

    const timeoutId = setTimeout(() => {
      const currentMessages = useAppStore.getState().chatMessages;
      setIsSyncing(true);
      const currentState = useAppStore.getState();
      uploadStateToDrive({
        entries,
        chatMessages: currentMessages,
        weeklyInsight: currentState.weeklyInsight,
        categoricalInsights: currentState.categoricalInsights,
        dailyGtd: currentState.dailyGtd,
        lifeThemes: currentState.lifeThemes,
        shadowWork: currentState.shadowWork,
        operatingManual: currentState.operatingManual,
        korczakAnalysis: currentState.korczakAnalysis
      })
        .catch((err) => {
          console.error("Sync error:", err);
          alert("שגיאה בסנכרון מול גוגל דרייב:\n" + err.message);
        })
        .finally(() => setIsSyncing(false));
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [
    entries,
    isAuthenticated,
    useAppStore.getState().chatMessages.length,
    useAppStore.getState().weeklyInsight,
    useAppStore.getState().categoricalInsights,
    useAppStore.getState().dailyGtd,
    useAppStore.getState().lifeThemes,
    useAppStore.getState().shadowWork,
    useAppStore.getState().operatingManual,
    useAppStore.getState().korczakAnalysis
  ]);

  // Generate Weekly Insight when entries change
  useEffect(() => {
    if (!apiKey || entries.length === 0) return;

    const timeoutId = setTimeout(async () => {
      const { weeklyInsight, setWeeklyInsight } = useAppStore.getState();
      // If we already have one and just added one entry, maybe don't re-run every time?
      // User said "updates based on new entries", so let's run it.
      try {
        const briefing = await generateWeeklyBriefing(entries, apiKey);
        if (briefing !== weeklyInsight) {
          setWeeklyInsight(briefing);
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
        const insights = await generateCategoricalInsights(entries, apiKey);
        setCategoricalInsights(insights);
      } catch (e) {
        console.error("Failed to generate categorical insights", e);
      }
    }, 6000); // Debounce

    return () => clearTimeout(timeoutId);
  }, [entries.length, apiKey]);

  // Advanced Insights Logic (Life Themes, Shadow Work, Emotional GTD)
  const {
    lifeThemes, setLifeThemes,
    shadowWork, setShadowWork,
    dailyGtd, setDailyGtd,
    operatingManual, setOperatingManual,
    korczakAnalysis, setKorczakAnalysis
  } = useAppStore();

  useEffect(() => {
    if (!apiKey || entries.length === 0) return;

    const runAdvancedAnalysis = async () => {
      const now = new Date();
      const todayStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
      const dayOfWeek = now.getDay(); // 0 is Sunday, 5 is Friday
      const dayOfMonth = now.getDate();

      // 1. Daily Emotional GTD
      if (dailyGtd?.lastDate !== todayStr) {
        try {
          const insight = await generateEmotionalGTDInsight(entries, apiKey);
          setDailyGtd({ insight, lastDate: todayStr });
        } catch (e) {
          console.error("Daily GTD error:", e);
        }
      }

      // 2. Personal Operating Manual (Update every 3 days or if it doesn't exist)
      // Check if it's been more than 3 days
      const lastManualDate = operatingManual?.lastDate ? new Date(operatingManual.lastDate) : new Date(0);
      const diffDays = Math.floor((now.getTime() - lastManualDate.getTime()) / (1000 * 3600 * 24));

      if (!operatingManual || diffDays >= 3) {
        try {
          const manual = await generateOperatingManual(entries, apiKey);
          setOperatingManual({ insight: manual, lastDate: todayStr });
        } catch (e) {
          console.error("Operating Manual error:", e);
        }
      }

      // 2. Weekly Life Themes & Shadow Work (Friday)
      if (dayOfWeek === 5 && (lifeThemes?.lastWeeklyDate !== todayStr || shadowWork?.lastDate !== todayStr)) {
        try {
          const themes = await generateLifeThemesAnalysis(entries, apiKey, 'weekly');
          const shadow = await generateShadowWorkInsight(entries, apiKey);
          setLifeThemes({ ...lifeThemes, weekly: themes, lastWeeklyDate: todayStr });
          setShadowWork({ insight: shadow, lastDate: todayStr });
        } catch (e) {
          console.error("Weekly analysis error:", e);
        }
      }

      // 3. Monthly Life Themes (1st of month)
      if (dayOfMonth === 1 && lifeThemes?.lastMonthlyDate !== todayStr) {
        try {
          const themes = await generateLifeThemesAnalysis(entries, apiKey, 'monthly');
          setLifeThemes({ ...lifeThemes, monthly: themes, lastMonthlyDate: todayStr });
        } catch (e) {
          console.error("Monthly analysis error:", e);
        }
      }

      // 4. Korczak Weekly Time Audit (Every 7 days)
      const lastKorczakDate = korczakAnalysis?.lastDate ? new Date(korczakAnalysis.lastDate) : new Date(0);
      const korczakDiffDays = Math.floor((now.getTime() - lastKorczakDate.getTime()) / (1000 * 3600 * 24));

      if (!korczakAnalysis || korczakDiffDays >= 7) {
        try {
          const insight = await generateKorczakAnalysis(entries, apiKey);
          setKorczakAnalysis({ insight, lastDate: todayStr });
        } catch (e) {
          console.error("Korczak analysis error:", e);
        }
      }
    };

    const timeoutId = setTimeout(runAdvancedAnalysis, 10000);
    return () => clearTimeout(timeoutId);
  }, [entries.length, apiKey, dailyGtd?.lastDate, lifeThemes?.lastWeeklyDate, lifeThemes?.lastMonthlyDate, shadowWork?.lastDate, operatingManual?.lastDate, korczakAnalysis?.lastDate]);



  const handleTestKey = async (keyToTest: string) => {
    if (!keyToTest) return;
    setIsTestingKey(true);
    setTestResult(null);

    let lastError = "";
    let foundWorkableModel = false;

    // Try each model until one works
    for (const model of (SUPPORTED_MODELS as any[])) {
      try {
        setTestResult({ success: false, message: `בודק מודל: ${model.name} (${model.version})...` });
        setActiveModel(model.name, model.version);
        // Small test call
        await queryInsights("היי, האם המפתח עובד?", [{ transcript: "בדיקה", timestamp: Date.now() }], keyToTest);
        setTestResult({ success: true, message: `המפתח תקין! (פעיל עם: ${model.name}) ✅` });
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

  const toggleLiveChat = async (customInstruction?: string) => {
    if (!apiKey) {
      setShowKeyModal(true);
      return;
    }

    if (isLiveActive) {
      liveServiceRef.current?.stop();
      setIsLiveActive(false);
    } else {
      const { weeklyInsight, dailyGtd, shadowWork, lifeThemes } = useAppStore.getState();

      const socraticInstruction = `
אתה מאמן סוקרטי מתקדם בשם 'ענן המחשבות'. דבר בעברית בלבד.
תפקידך לעזור למשתמש לחקור את מחשבותיו דרך שאלות פתוחות, הקשבה פעילה ושיקוף.

הקשר קבוע לגבי בני משפחה:
- טלי: אשתי
- גיל: הבת שלי
- איתן: הבן שלי
- נוה: הבן שלי

הקשר נוכחי:
${weeklyInsight ? `- תובנה שבועית: ${weeklyInsight}` : ''}

${dailyGtd?.insight ? `- GTD רגשי להיום: ${dailyGtd.insight}` : ''}
${shadowWork?.insight ? `- נקודת עבודה (Shadow Work): ${shadowWork.insight}` : ''}
${lifeThemes?.weekly ? `- תמות חיים מרכזיות מהשבוע האחרון: ${lifeThemes.weekly}` : ''}

הנחיות לאימון סוקרטי:
1. שאל שאלה אחת בכל פעם.
2. אל תיתן עצות ישירות, אלא כוון את המשתמש למצוא את התשובות בעצמו.
3. השתמש בטכניקות של שיקוף (Reflective Listening).
4. אם יש סתירה בין מה שהמשתמש אומר עכשיו לבין התובנות הקודמות, ציין זאת בעדינות כשאלה למחשבה.
5. השתמש במידע מההקשר הנוכחי כדי להעמיק את השיחה ולשאול שאלות רלוונטיות לתמות החיים או ל-Shadow Work שלו.
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
                // Background process the conversation as a diary entry
                const result = await processTextSession(finalTranscript, apiKey);
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
          liveSessionTranscriptRef.current += text + (isUser ? '\n' : ''); // model streams chunks, user streams sentences
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
      const { entries, weeklyInsight, categoricalInsights, chatMessages } = useAppStore.getState();
      const response = await queryInsights(userMsg, entries, apiKey, {
        weeklyInsight: weeklyInsight || undefined,
        categoricalInsights: categoricalInsights || undefined,
        chatHistory: chatMessages || undefined
      });
      addChatMessage('ai', response);
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
    const { korczakAnalysis } = useAppStore.getState();
    const korczakText = korczakAnalysis?.insight ? `ניתוח לפי עשרת העניינים של קורצ'אק: ${korczakAnalysis.insight}` : '';

    // Recent chat history summary
    const chatSummary = chatMessages.slice(-5).map(m =>
      `${m.role === 'user' ? 'גיא' : 'אתה'}: ${m.content}`
    ).join('\n');

    // Recent entries summary - increase to 15 for "full access" feel
    const recentEntries = entries.slice(0, 15).map(e =>
      `[${new Date(e.timestamp).toLocaleDateString('he-IL')}]: ${e.transcript}`
    ).join('\n');

    const customInstruction = `
      אתה מלווה אישי ומאמן סוקרטי מתקדם בשם 'ענן המחשבות'. הגישה שלך היא לא לתת פתרונות, אלא לעזור לגיא למצוא אותם בעצמו.
      דבר בעברית בלבד. היה אמפתי, מקשיב עמוק, ומעודד.

      עקרונות האימון הסוקרטי שלך:
      1. שאל שאלה אחת בלבד בכל פעם.
      2. התמקד בשאלות עוצמתיות: שאלות הבהרה, ערעור על הנחות יסוד, ודרישת ראיות מהמשתמש למחשבות שלו.
      3. אל תיתן עצות ישירות או פתרונות מוכנים מראש. תן לגיא להגיע למסקנה לבד.
      4. השתמש בטכניקת "השתקפות": חזור על מה שגיא אמר במילים שלך כדי לוודא הבנה לפני שתשאל שאלה עמוקה יותר.

      להלן ההקשר של התובנות הנוכחיות:
      ${weeklyText}
      ${categoricalText}
      ${korczakText}

      להלן היסטוריית השיחה האחרונה בצאט (כטקסט):
      ${chatSummary}

      להלן 15 המחשבות האחרונות שגיא הקליט (החומר הגולמי):
      ${recentEntries}

      המטרה שלך: לנהל שיחה עמוקה ופתוחה ("Gemini Live"). יש לך גישה לכל המידע הגולמי, התובנות והניתוחים. אל תסכם - תאתגר את גיא, תשאל שאלות קשות ומעוררות מחשבה, ותעזור לו לחבר בין נקודות שונות בחיים שלו.
    `.trim();

    toggleLiveChat(customInstruction);
  };



  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-transparent">
      <div className="relative w-full h-full flex flex-col text-white overflow-hidden bg-transparent">
        {/* 3D Background has been removed for mobile stability */}

        {/* Background aesthetic line */}
        <div className="absolute top-[30%] left-[-20%] right-[-20%] h-[60%] bg-[#5EB5D6] opacity-40 blur-[100px] rounded-[50%] pointer-events-none" />

        {/* Top Bar - Responsive to environment */}
        <header className={cn(
          "relative z-20 flex items-center px-6 pb-4 bg-white/5 backdrop-blur-md border-b border-white/10 shrink-0",
          isStandalone ? "pt-[max(env(safe-area-inset-top),20px)]" : "pt-4"
        )}>
        <h1 
          onDoubleClick={() => setShowDiagnostics(true)}
          className="text-xl font-bold text-white tracking-tight cursor-pointer active:scale-95 transition-transform"
        >
          ענן המחשבות
        </h1>
        <div className="flex-1 overflow-hidden">
           {/* Debug info if needed, or just space */}
        </div>
        <div className="flex items-center gap-2">
           {!isAuthenticated && (
             <span className="text-[10px] text-white/40 hidden xs:inline">שומר בדרייב</span>
           )}
          <button
            onClick={isAuthenticated ? handleSignout : handleAuth}
            disabled={isSyncing}
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-sm border",
              isAuthenticated
                ? "bg-[#DCFCE7] text-emerald-600 border-emerald-100"
                : "bg-white/10 text-white/60 border-white/10",
              isSyncing && "opacity-50 cursor-not-allowed"
            )}
            title={isAuthenticated ? "מחובר ל-Drive (התנתק)" : "התחבר לשמירה ב-Drive"}
          >
            {isSyncing ? <Loader2 size={18} className="animate-spin" /> : <Cloud size={20} className={cn(isAuthenticated ? "text-emerald-600" : "text-white/40")} />}
          </button>
          <button
            onClick={() => setShowKeyModal(true)}
            className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-[#0D3B66] shadow-md border border-gray-100 hover:bg-gray-50 transition-all"
          >
            <User size={20} />
          </button>
        </div>
      </header>

      {/* Diagnostics Panel - Nuclear Rebuild Mode */}
      {showDiagnostics && (
        <div className="fixed inset-0 z-[100] bg-[#0A192F] text-xs font-mono p-4 flex flex-col overflow-hidden">
           <div className="flex justify-between items-center mb-4 pb-2 border-b border-white/20">
              <h2 className="text-emerald-400 font-bold flex items-center gap-2">
                 <Activity size={14} /> לוח בקרה דיאגנוסטי
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
                <div className="text-[10px] text-white/40">Auth</div>
                <div className={cn("font-bold", isAuthenticated ? "text-emerald-400" : "text-red-400")}>
                  {isAuthenticated ? "SYNCED" : "NOT SET"}
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

      {/* Main Content Area */}
      <main className="relative z-10 w-full flex-1 flex flex-col items-center px-6 overflow-y-auto pb-[200px] pt-4 custom-scrollbar">
        {activeTab === 'home' && (
          <HomeTab 
            isLiveActive={isLiveActive} 
            liveStatus={liveStatus} 
            liveTranscript={liveTranscript}
            isRecording={isRecording}
            setIsRecording={setIsRecording}
          />
        )}
        {activeTab === 'actions' && <ActionsTab />}
        {activeTab === 'insights' && (
          <InsightsTab 
            isLiveActive={isLiveActive} 
            input={input}
            setInput={setInput}
            handleSend={handleSend}
            isSending={isSending}
            handleToggleVoice={handleToggleVoice}
          />
        )}
        {activeTab === 'dashboard' && <DashboardTab />}
        {activeTab === 'history' && <HistoryTab />}
      </main>



      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-[100] flex justify-center px-6 pb-[env(safe-area-inset-bottom,24px)] pointer-events-none">
        <nav className="w-full h-20 bg-[#0D3B66]/80 backdrop-blur-3xl rounded-[2.5rem] flex justify-around items-center px-4 shadow-2xl border border-white/10 pointer-events-auto" dir="rtl">
          <NavItem id="home" label="בית" isActive={activeTab === 'home'} onClick={() => setActiveTab('home')} />
          <NavItem id="actions" label="פעולות" isActive={activeTab === 'actions'} onClick={() => setActiveTab('actions')} />
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

            <input
              type="text"
              placeholder="Gemini API Key..."
              defaultValue={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTestResult(null);
              }}
              className="w-full bg-white border border-gray-300 rounded-xl py-3 px-4 mb-2 text-left font-mono text-xs focus:ring-2 focus:ring-[#0A3B66] outline-none shadow-sm"
              dir="ltr"
            />

            {testResult && (
              <p className={cn(
                "text-xs mb-4 font-bold text-center animate-in fade-in slide-in-from-top-1",
                testResult.success ? "text-emerald-600" : "text-red-600"
              )}>
                {testResult.message}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => handleTestKey(apiKey)}
                disabled={isTestingKey || !apiKey}
                className="flex-1 bg-gray-100 text-[#0A3B66] border border-gray-300 rounded-xl py-3 font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isTestingKey ? <Loader2 size={16} className="animate-spin" /> : "בדיקת תקינות"}
              </button>
              <button
                onClick={() => setShowKeyModal(false)}
                className="flex-[1.5] bg-[#0A3B66] text-white rounded-xl py-3 font-semibold hover:bg-[#082b4a] transition-colors shadow-md"
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

function HomeTab({ 
  isLiveActive, liveStatus, liveTranscript, isRecording, setIsRecording
}: { 
  isLiveActive: boolean; 
  liveStatus: LiveChatStatus; 
  liveTranscript: string;
  isRecording: boolean;
  setIsRecording: (val: boolean) => void;
}) {
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [isProcessingText, setIsProcessingText] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const { apiKey, addEntry } = useAppStore();
  const [recordingTime, setRecordingTime] = useState(0);
  const timerIntervalRef = useRef<number | null>(null);

  const startRecording = async () => {
    console.log("TRACE: startRecording (STAGE 1: Intent Received)");
    try {
      if (isRecording) {
        console.warn("TRACE: startRecording aborted - already recording.");
        return;
      }
      setIsRecording(true); // Set UI state first for responsiveness
      console.log("TRACE: startRecording (STAGE 2: UI State Set)");
      const getUserMediaWithTimeout = (constraints: MediaStreamConstraints, timeoutMs = 4000): Promise<MediaStream> => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Timeout: Mic request hanging")), timeoutMs);
          navigator.mediaDevices.getUserMedia(constraints)
            .then(stream => { clearTimeout(timer); resolve(stream); })
            .catch(err => { clearTimeout(timer); reject(err); });
        });
      };

      console.log("TRACE: startRecording -> requesting getUserMedia...");
      const stream = await getUserMediaWithTimeout({ audio: true });
      console.log("TRACE: startRecording -> getUserMedia OK (Stream Active)");
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
        ? 'audio/webm' 
        : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
      
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const actualMimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: actualMimeType });
        
        console.log("Recording stopped. Blob size:", audioBlob.size, "Type:", actualMimeType);

        // ALWAYS release the hardware tracks to prevent OS lockups
        if (mediaRecorderRef.current?.stream) {
          mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }

        if (!apiKey) {
          alert("שגיאה במפתח ה-API: המפתח חסר (אנא ודא שהגדרת מפתח Gemini).");
          return;
        }

        if (audioChunksRef.current.length === 0 || audioBlob.size < 100) {
          alert("שגיאה: כמות המידע שהוקלטה קטנה מדי. ייתכן והמיקרופון נחסם.");
          return;
        }

        setIsProcessingAudio(true);
        try {
          const result = await processAudioSession(audioBlob, apiKey);
          addEntry(result);
        } catch (e: any) {
          console.error("Recording process error:", e);
          alert("שגיאה בתמלול וניתוח ההקלטה (" + e.name + "): " + (e.message || JSON.stringify(e)));
        } finally {
          setIsProcessingAudio(false);
        }
      };

      recorder.onerror = (e) => {
        console.error("Recorder fired onerror:", e);
        setIsRecording(false);
        if (mediaRecorderRef.current?.stream) {
          mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }
      };

      // Set state and start timer BEFORE start() to ensure UI reflects intent immediately
      // But wrap start() in a try-catch to rollback if hardware fails
      setRecordingTime(0);
      setIsRecording(true);
      
      try {
        console.log("TRACE: startRecording (STAGE 4: Hardware Start Request)");
        recorder.start(1000); // Using 1000ms timeslice as it's often more stable on Safari
        console.log("TRACE: startRecording (STAGE 5: Hardware OK - Timer Starting)");
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = window.setInterval(() => {
          setRecordingTime(prev => prev + 1);
        }, 1000);
      } catch (startErr: any) {
        setIsRecording(false);
        console.error("Hardware start failed:", startErr);
        throw startErr;
      }
    } catch (e: any) {
      console.error("Start recording error:", e);
      if (e.message?.includes("Timeout")) {
         alert("המיקרופון לא מגיב. תופעה זו מוכרת לאחר מעבר חלונות בטלפונים מסוימים. אנא סגור לחלוטין את האפליקציה (החלק אותה למעלה) ופתח מחדש.");
      } else {
         alert("שגיאה בגישה למיקרופון (" + e.name + "): " + (e.message || "יש לאפשר הרשאות מיקרופון בהגדרות המכשיר."));
      }
    }
  };

  const stopRecording = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const cancelRecording = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        // Clear chunks and stop without triggering the onstop processing
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
    }
    if (mediaRecorderRef.current?.stream) {
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    setIsRecording(false);
    setRecordingTime(0);
  };

  const handleSendText = async () => {
    if (!textInput.trim() || !apiKey) return;
    setIsProcessingText(true);
    try {
      const result = await processTextSession(textInput, apiKey);
      addEntry(result);
      setTextInput('');
      setShowTextInput(false);
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessingText(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-start text-center w-full h-full pt-10 pb-[100px] space-y-12">
      <div className="relative w-64 h-64 flex items-center justify-center">
        {/* Glow effect */}
        <div className={cn(
          "absolute inset-0 bg-[#FFD54F] opacity-20 blur-[80px] rounded-full transition-all duration-1000",
          (isRecording || isLiveActive) ? "scale-150 opacity-40 animate-pulse" : "scale-100"
        )} />
        
        {/* Right Button: Text Input (Notebook) */}
        {!isLiveActive && !isRecording && (
          <button 
            onClick={() => setShowTextInput(!showTextInput)}
            className={cn(
              "absolute right-[-40px] w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all border border-white/20 active:scale-90 bg-gradient-to-tr from-[#FFA000] to-[#FFD54F] text-[#4A2C0A]",
              showTextInput && "ring-4 ring-white/30"
            )}
          >
            <Notebook size={28} strokeWidth={2} />
          </button>
        )}



        {/* Main Mic Button - Click to Toggle for Reliability */}
        <button 
          onClick={() => isRecording ? stopRecording() : startRecording()}
          className={cn(
            "relative z-10 w-[180px] h-[180px] bg-gradient-to-t from-[#FFA000] to-[#FFD54F] rounded-full flex items-center justify-center text-white shadow-[0_15px_45px_rgba(255,160,0,0.5)] transition-all",
            isRecording ? "scale-95 brightness-110 shadow-inner ring-8 ring-white/20" : "hover:scale-105 shadow-[0_12px_40px_rgba(255,160,0,0.4)]"
          )}
        >
          {isRecording ? <Square size={70} fill="white" className="rounded-xl animate-pulse" /> : <Mic size={90} strokeWidth={2.5} />}
          {isRecording && (
            <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 bg-white text-[#0D3B66] px-4 py-1.5 rounded-full font-bold shadow-lg animate-bounce">
              סיים
            </div>
          )}
        </button>
      </div>

      {/* Text Input Area */}
      {showTextInput && !isLiveActive && !isRecording && (
        <div className="w-full max-w-md bg-white/10 backdrop-blur-xl rounded-2xl p-4 border border-white/20 shadow-2xl animate-in fade-in slide-in-from-bottom-4 transition-all" dir="rtl">
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="מה עובר עליך? כתוב כאן..."
            className="w-full h-32 bg-transparent text-white placeholder-white/50 border-none outline-none resize-none text-lg leading-relaxed"
            autoFocus
          />
          <div className="flex justify-between items-center mt-2">
            <button 
              onClick={() => setShowTextInput(false)}
              className="text-white/60 hover:text-white text-sm"
            >
              ביטול
            </button>
            <button 
              onClick={handleSendText}
              disabled={isProcessingText || !textInput.trim()}
              className="bg-[#FFD54F] text-[#0D3B66] px-6 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-[#FFE082] transition-all disabled:opacity-50"
            >
              {isProcessingText ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              שמור
            </button>
          </div>
        </div>
      )}

      {(isRecording || isLiveActive) && (
        <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 w-full scale-50">
          <VoicePulse status={isLiveActive ? (liveStatus === 'speaking' ? 'speaking' : 'listening') : 'listening'} />
        </div>
      )}

      <div className="space-y-4">
        {isLiveActive ? (
          <div className="bg-white/10 backdrop-blur-md rounded-[2.5rem] p-5 max-w-xs mx-auto border border-white/10 shadow-xl">
            <p className="text-sm italic text-white/90 leading-relaxed">{liveTranscript || "מקשיב לך..."}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <h2 className="text-3xl font-medium text-[#89CFF0] opacity-80 tracking-tight">
              {isProcessingAudio ? "מנתח הקלטה..." : (isRecording ? "מקשיב..." : "לחץ להקלטה")}
            </h2>
            {isProcessingAudio && (
               <div className="mt-4 flex flex-col items-center gap-2">
                 <Loader2 size={40} className="animate-spin text-[#FFD54F]" />
                 <p className="text-white/40 text-sm italic">זה עשוי לקחת כמה שניות בלבד...</p>
               </div>
            )}
            {isRecording && (
              <>
                <div className="text-2xl font-mono mt-3 text-[#FFD54F] drop-shadow-[0_0_8px_rgba(255,213,79,0.8)]">
                  {Math.floor(recordingTime / 60).toString().padStart(2, '0')}:
                  {(recordingTime % 60).toString().padStart(2, '0')}
                </div>
                <button 
                  onClick={cancelRecording}
                  className="mt-4 text-white/40 hover:text-white/60 text-sm flex items-center gap-2"
                >
                  <X size={14} /> ביטול הקלטה
                </button>
              </>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

function ActionsTab() {
  const { entries, toggleTaskImportance, removeTask } = useAppStore();
  
  // Flatten all tasks from all entries
  const allTasks = entries.flatMap(e => 
    e.tasks.map(t => {
      const text = typeof t === 'string' ? t : t.text;
      const isImportant = typeof t === 'string' ? false : t.isImportant;
      return { entryId: e.id, text, isImportant };
    })
  );

  const importantTasks = allTasks.filter(t => t.isImportant);
  const otherTasks = allTasks.filter(t => !t.isImportant);

  const renderTask = (item: any, idx: number) => (
    <div key={`${item.entryId}-${item.text}-${idx}`} className="bg-white/10 backdrop-blur-xl rounded-[2rem] p-5 flex items-center justify-between border border-white/10 shadow-lg group hover:bg-white/15 transition-all">
      <div className="flex items-center gap-4 flex-1">
        <button 
          onClick={() => toggleTaskImportance(item.entryId, item.text)}
          className={cn(
            "w-10 h-10 rounded-2xl flex items-center justify-center transition-all border",
            item.isImportant 
              ? "bg-[#FFD54F]/20 text-[#FFD54F] border-[#FFD54F]/30" 
              : "bg-white/5 text-white/20 border-white/5 hover:text-white/40"
          )}
        >
          <Star size={18} fill={item.isImportant ? "currentColor" : "none"} />
        </button>
        <span className={cn(
          "text-sm font-medium leading-relaxed",
          item.isImportant ? "text-white" : "text-white/70"
        )}>
          {item.text}
        </span>
      </div>
      <button 
        onClick={() => removeTask(item.entryId, item.text)}
        className="w-10 h-10 rounded-2xl flex items-center justify-center text-white/20 hover:text-emerald-400 hover:bg-emerald-400/10 transition-all ml-2"
        title="סמן כבוצע"
      >
        <CheckCircle2 size={20} />
      </button>
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col space-y-6 pb-4 overflow-y-visible">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-xl font-bold flex items-center gap-3 text-white/90">
          <div className="w-10 h-10 rounded-2xl bg-emerald-400/20 flex items-center justify-center text-emerald-400">
            <CheckCircle2 size={22} />
          </div>
          פעולות לביצוע
        </h2>
      </div>

      {allTasks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-white/5 rounded-[3rem] border border-dashed border-white/10">
          <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center text-white/10 mb-4">
            <Notebook size={40} strokeWidth={1} />
          </div>
          <p className="text-white/40 font-medium">אין משימות פתוחות כרגע.</p>
          <p className="text-white/20 text-xs mt-1 italic">דבר איתי והתובנות יהפכו למשימות!</p>
        </div>
      ) : (
        <div className="flex-1 space-y-8 pr-1">
          {/* Important Tasks */}
          {importantTasks.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-[10px] font-bold text-[#FFD54F] uppercase tracking-[0.2em] px-4 flex items-center gap-2">
                <Star size={10} fill="currentColor" />
                פעולות חשובות
              </h3>
              <div className="space-y-3">
                {importantTasks.map(renderTask)}
              </div>
            </div>
          )}

          {/* Other Tasks */}
          {otherTasks.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] px-4 flex items-center gap-2">
                <HistoryIcon size={10} />
                שאר הפעולות
              </h3>
              <div className="space-y-3">
                {otherTasks.map(renderTask)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InsightsTab({ 
  isLiveActive,
  input,
  setInput,
  handleSend,
  isSending,
  handleToggleVoice
}: { 
  isLiveActive: boolean;
  input: string;
  setInput: (val: string) => void;
  handleSend: () => void;
  isSending: boolean;
  handleToggleVoice: () => void;
}) {
  const { 
    weeklyInsight, categoricalInsights, 
    lifeThemes, shadowWork, dailyGtd,
    chatMessages, apiKey, entries 
  } = useAppStore();
  const [showWeekly, setShowWeekly] = useState(false);
  const [showDailyGtd, setShowDailyGtd] = useState(false);
  const [showAllTimeInsights, setShowAllTimeInsights] = useState(false);
  const [isReading, setIsReading] = useState(false);

  // Stop speech if navigating away
  useEffect(() => {
    return () => {
      if ((window as any).audioWeekly) {
         (window as any).audioWeekly.pause();
         (window as any).audioWeekly = null;
      }
      window.speechSynthesis.cancel(); // Added this line
    };
  }, []);

  // Using apiKey from the outer scope

  const handleReadWeekly = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (isReading) {
      if ((window as any).audioWeekly) {
         (window as any).audioWeekly.pause();
         (window as any).audioWeekly = null;
      }
      window.speechSynthesis.cancel();
      setIsReading(false);
      return;
    }

    if (!apiKey) {
      alert("אנא הגדר מפתח API כדי להשתמש בהקראה.");
      return;
    }

    const textToRead = [
      "סיכום ותובנות שבועיות.",
      categoricalInsights?.work ? `בעבודה: ${categoricalInsights.work}` : '',
      categoricalInsights?.family ? `במשפחה: ${categoricalInsights.family}` : '',
      categoricalInsights?.personal ? `בפן האישי: ${categoricalInsights.personal}` : '',
      weeklyInsight ? `תובנה שבועית: ${weeklyInsight}` : '',
      shadowWork?.insight ? `ניתוח הצל: ${shadowWork.insight}` : '',
      lifeThemes?.weekly ? `תמות חיים: ${lifeThemes.weekly}` : ''
    ].filter(Boolean).join(' ');

    try {
      setIsReading(true);
      const audioUrl = await synthesizeSpeech(textToRead, apiKey);
      const audio = new Audio(audioUrl);
      (window as any).audioWeekly = audio;
      
      audio.onended = () => {
        setIsReading(false);
        (window as any).audioWeekly = null;
      };
      
      audio.onerror = () => {
        setIsReading(false);
        (window as any).audioWeekly = null;
      };

      await audio.play();
    } catch (error: any) {
      console.error("Cloud TTS Error (Weekly):", error);
      
      // Attempt browser fallback
      try {
        console.log("Attempting browser TTS fallback for weekly insights...");
        const utterance = new SpeechSynthesisUtterance(textToRead);
        utterance.lang = 'he-IL';
        
        // Try to find a Hebrew voice
        const voices = window.speechSynthesis.getVoices();
        const hebrewVoice = voices.find(v => v.lang.startsWith('he')) || voices[0];
        if (hebrewVoice) utterance.voice = hebrewVoice;
        
        utterance.onend = () => setIsReading(false);
        utterance.onerror = () => setIsReading(false);
        
        window.speechSynthesis.speak(utterance);
      } catch (fallbackError) {
        console.error("Browser TTS Fallback Error (Weekly):", fallbackError);
        setIsReading(false);
        alert(`שגיאת הקראה: ${error.message}\n\nנא לוודא ש-Cloud Text-to-Speech API מופעל בחשבון ה-Google Cloud שלך.`);
      }
    }
  };


  useEffect(() => {
    // History scroll logic moved to App level
  }, [chatMessages.length]);

  return (
    <div className="w-full h-full flex flex-col space-y-4 pb-4 overflow-y-visible">
      {/* Main AI Question Input (Relocated from Home) */}
      <div className="w-full px-2 pt-2">
        <div className="bg-black/20 backdrop-blur-xl rounded-[2rem] border border-white/10 p-2 flex gap-2 items-center shadow-lg">
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={isLiveActive}
            placeholder={isLiveActive ? "הצאט הקולי פעיל..." : "שאל אותי על הכל (היסטוריה, תמות, דפוסים)..."}
            className="flex-1 bg-white/5 rounded-2xl px-5 py-3.5 outline-none focus:ring-2 focus:ring-[#FFD54F]/30 transition-all text-sm placeholder:text-white/20 shadow-inner border border-white/5 disabled:opacity-50"
          />
          <button 
            onClick={() => handleToggleVoice()}
            className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-lg active:scale-95 group",
              isLiveActive ? "bg-red-500 text-white animate-pulse" : "bg-white/10 text-white/60 hover:bg-white/20"
            )}
            title={isLiveActive ? "עצור שיחה קולית" : "התחל שיחה קולית"}
          >
            <Mic size={20} />
          </button>
          {!isLiveActive && (
            <button 
              onClick={handleSend}
              disabled={!input.trim() || isSending}
              className="w-12 h-12 bg-[#FFD54F] text-[#0D3B66] rounded-2xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg disabled:opacity-50 disabled:scale-100 group"
            >
              {isSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={20} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />}
            </button>
          )}
        </div>
      </div>

      {!isLiveActive && (
        <div className="flex justify-start px-2">
          <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/5 text-[10px] text-white/40 uppercase tracking-widest font-bold">
            <Brain size={12} />
            ניתוח חכם מופעל
          </div>
        </div>
      )}

      {/* Korczak Time Audit - Collapsible */}
      <KorczakInsight />

      {/* Daily Emotional Insight - Collapsible */}
      {dailyGtd && (
        <div className="bg-gradient-to-r from-[#FFD54F]/20 to-[#FFA000]/10 backdrop-blur-xl border border-[#FFD54F]/30 rounded-[2rem] overflow-hidden shadow-lg transition-all">
          <div 
            role="button"
            tabIndex={0}
            onClick={() => setShowDailyGtd(!showDailyGtd)}
            onKeyDown={(e) => e.key === 'Enter' && setShowDailyGtd(!showDailyGtd)}
            className="w-full p-5 flex items-center justify-between hover:bg-white/5 transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#FFD54F] rounded-2xl flex items-center justify-center text-[#0D3B66] group-hover:scale-110 transition-transform">
                <CheckCircle2 size={20} />
              </div>
              <div className="text-right">
                <span className="block font-bold text-white/90 text-sm">תובנה רגשית יומית עיקרית</span>
                <span className="block text-[10px] text-[#FFD54F]/60 uppercase tracking-widest mt-0.5">מיקוד ודיוק רגשי</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <SpeechButton 
                text={dailyGtd.insight || ''} 
                className="w-8 h-8 bg-white/5 hover:bg-white/10 text-white/40" 
                onClick={(e) => e.stopPropagation()} 
              />
              <div className="text-white/30">
                {showDailyGtd ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </div>
            </div>
          </div>
          
          {showDailyGtd && (
            <div className="p-5 pt-0 animate-in fade-in slide-in-from-top-2">
              <div className="bg-white/5 rounded-2xl p-4 border border-white/5 max-h-[300px] overflow-y-auto custom-scrollbar">
                <div className="text-sm text-white/90 leading-relaxed space-y-2">
                  {dailyGtd.insight?.split('\n').map((line, i) => (
                    <p key={i} className={line.trim().startsWith('*') || line.trim().startsWith('-') ? "pr-4 relative before:content-['•'] before:absolute before:right-0 before:text-[#FFD54F]" : ""}>
                      {line.replace(/^(\*|-)\s*/, '')}
                    </p>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-white/5 flex justify-end">
                  <SpeechButton text={dailyGtd.insight || ''} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Weekly & Categorical Insights (Collapsible) */}
      <div className="bg-white/10 backdrop-blur-xl border border-white/10 rounded-[2rem] overflow-hidden shadow-xl transition-all">
        <div 
          role="button"
          tabIndex={0}
          onClick={() => setShowWeekly(!showWeekly)}
          onKeyDown={(e) => e.key === 'Enter' && setShowWeekly(!showWeekly)}
          className="w-full p-5 flex items-center justify-between hover:bg-white/5 transition-colors group cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#FFD54F]/20 flex items-center justify-center text-[#FFD54F] group-hover:scale-110 transition-transform">
              <Brain size={20} />
            </div>
            <div className="text-right">
              <span className="block font-bold text-white/90 text-sm">סיכום ותובנות שבועיות</span>
              <span className="block text-[10px] text-white/40 uppercase tracking-widest mt-0.5">ניתוח חכם של השבוע שלך</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleReadWeekly}
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center transition-all",
                isReading ? "bg-[#FFD54F] text-[#0D3B66] animate-pulse" : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white"
              )}
            >
              {isReading ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <div className="text-white/30">
              {showWeekly ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </div>
          </div>
        </div>
        
        {showWeekly && (
          <div className="p-5 pt-0 space-y-4 animate-in fade-in slide-in-from-top-2 max-h-[500px] overflow-y-auto custom-scrollbar">
            {categoricalInsights ? (
              <div className="grid gap-2">
                <InsightCard title="עבודה" content={categoricalInsights.work} icon={<div className="w-2.5 h-2.5 bg-[#FFB300] rounded-full shadow-[0_0_8px_#FFB300]" />} />
                <InsightCard title="משפחה" content={categoricalInsights.family} icon={<div className="w-2.5 h-2.5 bg-[#FF8F00] rounded-full shadow-[0_0_8px_#FF8F00]" />} />
                <InsightCard title="אישי" content={categoricalInsights.personal} icon={<div className="w-2.5 h-2.5 bg-[#FDD835] rounded-full shadow-[0_0_8px_#FDD835]" />} />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-white/50 italic py-4 justify-center">
                <Loader2 size={14} className="animate-spin" />
                מנתח את האירועים האחרונים...
              </div>
            )}
            
            {weeklyInsight && (
              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[10px] font-bold text-[#FFD54F] uppercase tracking-[0.2em] flex items-center gap-2">
                    <Star size={12} />
                    תובנה שבועית
                  </h4>
                  <SpeechButton text={weeklyInsight} className="w-6 h-6" />
                </div>
                <div className="bg-white/5 rounded-2xl p-4 border border-white/5 italic">
                  <p className="text-sm leading-relaxed text-white/80">{weeklyInsight}</p>
                </div>
              </div>
            )}

            {/* Deep Analysis Section (Shadow Work & Life Themes) */}
            {(shadowWork || lifeThemes) && (
              <div className="pt-4 border-t border-white/10 space-y-4">
                <h4 className="text-[10px] font-bold text-emerald-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                  <Brain size={12} />
                  ניתוח עומק (Advanced)
                </h4>
                
                {shadowWork?.insight && (
                  <div className="bg-indigo-500/10 rounded-2xl p-4 border border-indigo-500/20 group relative">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-bold text-indigo-400 uppercase">Shadow Work</span>
                      <SpeechButton text={shadowWork.insight} className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6" />
                    </div>
                    <p className="text-xs leading-relaxed text-white/80 italic">{shadowWork.insight}</p>
                  </div>
                )}

                {lifeThemes?.weekly && (
                  <div className="bg-amber-500/10 rounded-2xl p-4 border border-amber-500/20 group relative">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-bold text-amber-400 uppercase">תמות חיים שבועיות</span>
                      <SpeechButton text={lifeThemes.weekly} className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6" />
                    </div>
                    <p className="text-xs leading-relaxed text-white/80">{lifeThemes.weekly}</p>
                  </div>
                )}

                {lifeThemes?.monthly && (
                  <div className="bg-purple-500/10 rounded-2xl p-4 border border-purple-500/20 group relative">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-bold text-purple-400 uppercase">ניתוח חודשי ארוך טווח</span>
                      <SpeechButton text={lifeThemes.monthly} className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6" />
                    </div>
                    <p className="text-xs leading-relaxed text-white/80">{lifeThemes.monthly}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* All Time Insights History (Collapsible) */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/5 rounded-[2rem] overflow-hidden shadow-lg transition-all mt-4">
        <div 
          role="button"
          tabIndex={0}
          onClick={() => setShowAllTimeInsights(!showAllTimeInsights)}
          onKeyDown={(e) => e.key === 'Enter' && setShowAllTimeInsights(!showAllTimeInsights)}
          className="w-full p-5 flex items-center justify-between hover:bg-white/10 transition-colors group cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-400/20 flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
              <HistoryIcon size={20} />
            </div>
            <div className="text-right">
              <span className="block font-bold text-white/90 text-sm">היסטוריית תובנות (כל הזמנים)</span>
              <span className="block text-[10px] text-white/40 uppercase tracking-widest mt-0.5">כל התובנות שנאספו אי פעם</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-white/30">
            {showAllTimeInsights ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        </div>
        
        {showAllTimeInsights && (
          <div className="p-5 pt-0 space-y-4 animate-in fade-in slide-in-from-top-2 max-h-[400px] overflow-y-auto custom-scrollbar">
            {entries.filter(e => e.insights && e.insights.length > 0).length === 0 ? (
               <div className="text-center py-6 text-white/40 text-sm italic">
                 עדיין אין היסטוריית תובנות. ההיסטוריה תתמלא עם הזמן.
               </div>
            ) : (
               <div className="space-y-4">
                 {entries.filter(e => e.insights && e.insights.length > 0).map(entry => (
                   <div key={entry.id} className="bg-white/5 rounded-2xl p-4 border border-white/5 group relative">
                     <div className="flex items-center justify-between mb-2">
                       <span className="text-[10px] text-white/40 font-mono">
                         {new Date(entry.timestamp).toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' })}
                       </span>
                       <SpeechButton text={entry.insights.join(' ')} className="w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity" />
                     </div>
                     <div className="text-sm leading-relaxed text-white/80 space-y-1">
                       {entry.insights.map((insight: string, idx: number) => (
                         <div key={idx}>
                           {insight.split('\n').filter((l: string) => l.trim()).map((line: string, i: number) => (
                             <p key={i} className={line.trim().startsWith('*') || line.trim().startsWith('-') ? "pr-4 relative before:content-['•'] before:absolute before:right-0 before:text-blue-400" : ""}>
                               {line.replace(/^(\*|-)\s*/, '')}
                             </p>
                           ))}
                         </div>
                       ))}
                     </div>
                   </div>
                 ))}
               </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

function InsightCard({ title, content, icon }: { title: string; content: string; icon: React.ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isExpanded && cardRef.current) {
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [isExpanded]);
  
  return (
    <div 
      ref={cardRef}
      onClick={() => setIsExpanded(!isExpanded)}
      className={cn(
        "bg-white/5 rounded-2xl p-4 border border-white/5 cursor-pointer transition-all hover:bg-white/10",
        isExpanded ? "scale-[1.02] shadow-lg ring-1 ring-[#FFD54F]/30" : "scale-100"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center min-w-[1.25rem]">
            {icon}
          </div>
          <h4 className="text-sm font-bold text-white/60">{title}</h4>
        </div>
        <div className="flex items-center gap-2">
          <SpeechButton text={content} className="w-6 h-6" />
          <div className="text-white/30">
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>
      </div>
      {isExpanded && (
        <p className="text-sm leading-relaxed text-white/90 mt-3 animate-in fade-in slide-in-from-top-2">
          {content}
        </p>
      )}
    </div>
  );
}

function HistoryTab() {
  const { entries, clearEntries } = useAppStore();

  return (
    <div className="w-full flex flex-col space-y-6 pb-10 overflow-y-visible">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <HistoryIcon className="text-blue-300" />
          יומן מחשבות
        </h2>
        {entries.length > 0 && (
          <button 
            onClick={() => confirm('בטוח שברצונך למחוק הכל?') && clearEntries()}
            className="text-white/40 hover:text-red-400 p-2 transition-colors"
          >
            <Trash2 size={18} />
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="bg-white/10 backdrop-blur-md rounded-3xl p-8 text-center border border-white/10">
          <p className="text-white/60">היומן שלך ריק. התחל להקליט מחשבות!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <div key={entry.id} className="bg-white/10 backdrop-blur-md rounded-3xl p-5 border border-white/10 space-y-3 group relative overflow-hidden">
               <div className="absolute top-0 left-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                 <SpeechButton text={entry.transcript} className="bg-white/10 w-8 h-8" />
               </div>
              <div className="flex justify-between items-start">
                <span className="text-xs font-bold text-white/50">
                  {new Date(entry.timestamp).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
                <span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                  {entry.mood}
                </span>
              </div>
              <p className="text-white/90 leading-relaxed text-sm">
                {entry.transcript}
              </p>
              {entry.topics.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {entry.topics.map((t, i) => (
                    <span key={i} className="bg-blue-400/20 text-blue-200 text-[10px] px-2 py-0.5 rounded-full border border-blue-400/30">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
