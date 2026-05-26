import { useState, useRef, useEffect, useMemo } from 'react';
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
  Loader2,
  Trash2,
  Square,
  X,
  Star,
  Cloud,
  Check,
  Sparkles,
  Activity,
  Lightbulb,
  Briefcase,
  Home,
  Heart,
  Pencil,
  Quote,
  Compass
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useAppStore } from './store';
import {
  queryInsights,
  generateWeeklyBriefing,
  generateCategoricalInsights,
  generateLifeThemesAnalysis,
  analyzeExecutionGap,
  generateEmotionalGTDInsight,
  generateOperatingManual,

  generateMajorInsights,
  generateAdvices,
  generateShadowQuickAdvices,
  generateSingleShadowQuickAdvice,
  processAudioSession,
  processTextSession,
  SUPPORTED_MODELS,
  setActiveModel,
  autoDiscoverModel
} from './services/ai';
import { GeminiLiveService, type LiveChatStatus } from './services/live-ai';
import { loadGapi, loadGis, handleAuthClick, handleSignoutClick, setAuthChangeCallback, uploadStateToDrive, downloadStateFromDrive, forceCheckAuth, dumpStorage } from './services/drive';
import VoicePulse from './components/VoicePulse';
import DashboardTab from './components/DashboardTab';
import SpeechButton from './components/SpeechButton';

// Utility for tailwind classes
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}



export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'actions' | 'insights' | 'dashboard' | 'history'>('home');
  const { apiKey, setApiKey, entries, setEntries, preferredModel, preferredApiVersion, setPreferredModel } = useAppStore();
  const [showKeyModal, setShowKeyModal] = useState(false);
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
          // Merge local entries with downloaded entries by unique ID
          const localEntries = useAppStore.getState().entries || [];
          const mergedEntries = [...localEntries];
          state.entries.forEach((driveEntry: any) => {
            if (!mergedEntries.some(e => e.id === driveEntry.id)) {
              mergedEntries.push(driveEntry);
            }
          });
          // Sort by timestamp descending (newest first) to maintain chronological order
          mergedEntries.sort((a, b) => b.timestamp - a.timestamp);
          setEntries(mergedEntries);
        }
        if (state.chatMessages && Array.isArray(state.chatMessages)) {
          // Merge local chat messages with downloaded chat messages by content & timestamp
          const localMessages = useAppStore.getState().chatMessages || [];
          const mergedMsgs = [...localMessages];
          state.chatMessages.forEach((driveMsg: any) => {
            if (!mergedMsgs.some(m => m.timestamp === driveMsg.timestamp && m.content === driveMsg.content)) {
              mergedMsgs.push(driveMsg);
            }
          });
          // Sort by timestamp ascending (chronological flow)
          mergedMsgs.sort((a, b) => a.timestamp - b.timestamp);
          useAppStore.getState().setChatMessages(mergedMsgs);
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

        if (state.advices) {
          useAppStore.getState().setAdvices(state.advices);
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
    if (!isAuthenticated || isRecording || isSyncing) return; // DON'T SYNC WHILE RECORDING OR DOWNLOADING
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

        advices: currentState.advices
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
    isSyncing,
    useAppStore.getState().chatMessages.length,
    useAppStore.getState().weeklyInsight,
    useAppStore.getState().categoricalInsights,
    useAppStore.getState().dailyGtd,
    useAppStore.getState().lifeThemes,
    useAppStore.getState().shadowWork,
    useAppStore.getState().operatingManual,

    useAppStore.getState().advices
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
    majorInsights, setMajorInsights,
    lastMajorInsightsCount, setLastMajorInsightsCount,
    advices, setAdvices,
    shadowQuickAdvices, setShadowQuickAdvices
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

      // 2. Personal Operating Manual (Update on Thursdays)
      if (dayOfWeek === 4 && operatingManual?.lastDate !== todayStr) {
        try {
          const manual = await generateOperatingManual(entries, apiKey);
          setOperatingManual({ insight: manual, lastDate: todayStr });
        } catch (e) {
          console.error("Operating Manual error:", e);
        }
      }

      // 2. Weekly Life Themes (Friday) & Execution Gap Analysis
      if (dayOfWeek === 1 && (lifeThemes?.lastWeeklyDate !== todayStr || shadowWork?.lastDate !== todayStr)) {
        try {
          const themes = await generateLifeThemesAnalysis(entries, apiKey, 'weekly');
          const gapReport = await analyzeExecutionGap(entries, apiKey);
          setLifeThemes({ ...lifeThemes, weekly: themes, lastWeeklyDate: todayStr });
          // We reuse shadowWork state slot for the "Execution Gap" as it's part of the Shadow Work / Critical series
          setShadowWork({ insight: gapReport, lastDate: todayStr });
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



      // 5. Major Insights (Triggered if new entries exist since last analysis)
      if (entries.length > 0 && entries.length !== lastMajorInsightsCount) {
          try {
            const insights = await generateMajorInsights(entries, apiKey, majorInsights);
            setMajorInsights(insights);
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
          const generatedAdvices = await generateAdvices(entries, apiKey);
          const history = advices?.history || [];
          setAdvices({
            lastEntryCount: currentEntryCount,
            history: [{
              timestamp: Date.now(),
              work: generatedAdvices.work,
              family: generatedAdvices.family,
              mental: generatedAdvices.mental
            }, ...history]
          });
        } catch (e) {
          console.error("Failed to generate advices:", e);
        }
      }
      // 7. Shadow Quick Advices (Triggered if 5 new entries since last generation)
      const lastShadowAdvicesCount = shadowQuickAdvices?.lastEntryCount || 0;
      
      if (currentEntryCount - lastShadowAdvicesCount >= 5 && currentEntryCount > 0 && shadowWork?.insight) {
        try {
          const generatedShadowAdvices = await generateShadowQuickAdvices(shadowWork.insight, entries, apiKey);
          setShadowQuickAdvices({
            lastEntryCount: currentEntryCount,
            advices: generatedShadowAdvices.slice(0, 5),
            oldestIndex: 0,
            lastUpdateDate: todayStr
          });
        } catch (e) {
          console.error("Failed to generate shadow quick advices:", e);
        }
      } else if (shadowWork?.insight && apiKey) {
        // 8. Daily update for Shadow Quick Advices (change the oldest advice daily)
        const currentAdvices = shadowQuickAdvices?.advices || [
          "קח אוויר לפני שאתה מתפרץ בפגישות שמרגישות לחוצות.", 
          "זכור לבצע פאוזה ולא להגיב מיד לטריגרים שקשורים לסמכות.",
          "הקדש 5 דקות בסוף היום לרפלקציה על הפעולות שדחית.",
          "שים לב מתי אתה משתמש במילה 'צריך' והחלף אותה ב'בוחר'.",
          "זהה רגש אחד חסום היום ותן לו ביטוי בכתיבה של שתי דקות."
        ];
        
        const lastUpdateDate = shadowQuickAdvices?.lastUpdateDate;
        const oldestIndex = shadowQuickAdvices?.oldestIndex ?? 0;
        
        if (!lastUpdateDate || lastUpdateDate !== todayStr) {
          try {
            let updatedAdvices = [...currentAdvices];
            while (updatedAdvices.length < 5) {
              updatedAdvices.push("נשום עמוק והתבונן בתגובה שלך.");
            }
            if (updatedAdvices.length > 5) {
              updatedAdvices = updatedAdvices.slice(0, 5);
            }
            
            const newAdvice = await generateSingleShadowQuickAdvice(
              shadowWork.insight,
              entries,
              updatedAdvices,
              apiKey
            );
            
            updatedAdvices[oldestIndex] = newAdvice;
            
            setShadowQuickAdvices({
              lastEntryCount: shadowQuickAdvices?.lastEntryCount ?? currentEntryCount,
              advices: updatedAdvices,
              oldestIndex: (oldestIndex + 1) % 5,
              lastUpdateDate: todayStr
            });
          } catch (e) {
            console.error("Failed to perform daily shadow advice rotation:", e);
          }
        }
      }
    };

    const timeoutId = setTimeout(runAdvancedAnalysis, 10000);
    return () => clearTimeout(timeoutId);
  }, [entries.length, apiKey, dailyGtd?.lastDate, lifeThemes?.lastWeeklyDate, lifeThemes?.lastMonthlyDate, shadowWork?.lastDate, operatingManual?.lastDate, advices?.lastEntryCount, shadowQuickAdvices?.lastEntryCount, shadowQuickAdvices?.lastUpdateDate, shadowQuickAdvices?.oldestIndex, shadowWork?.insight, lastMajorInsightsCount]);



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
אתה מאמן סוקרטי מתקדם וחד בשם 'ענן המחשבות'. דבר בעברית בלבד.
תפקידך הוא לא רק להקשיב, אלא לאתגר את גיא (PROACTIVE PROBING). 
אם אתה מזהה סתירה, תירוץ, או "סיפור" שגיא מספר לעצמו כדי להימנע ממאמץ או מכאב - עצור אותו ושאל שאלה נוקבת. פנה אליו ישירות בגוף שני ("אתה").

היה "פרקליט השטן" (Shadow Work Coach): חפש את מה שגיא לא אומר. שאל על הפער בין מה שהוא תכנן לעשות (Execution Gap) לבין מה שהוא מדווח עכשיו.

הקשר קבוע לגבי בני משפחה:
- טלי: אשתי
- גיל: הבת שלי
- איתן: הבן שלי
- נוה: הבן שלי

הקשר נוכחי:
${weeklyInsight ? `- תובנה שבועית (כולל צד הצל): ${weeklyInsight}` : ''}
${dailyGtd?.insight ? `- GTD רגשי להיום: ${dailyGtd.insight}` : ''}
${shadowWork?.insight ? `- נקודת עבודה (Shadow Work): ${shadowWork.insight}` : ''}
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
                // Background process the conversation as a diary entry
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
      const { entries, weeklyInsight, categoricalInsights, chatMessages, addEntry } = useAppStore.getState();
      const response = await queryInsights(userMsg, entries, apiKey, {
        weeklyInsight: weeklyInsight || undefined,
        categoricalInsights: categoricalInsights || undefined,
        chatHistory: chatMessages || undefined
      });
      addChatMessage('ai', response);
      
      // Save Q&A as raw material (DiaryEntry)
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

    // Recent chat history summary
    const chatSummary = chatMessages.slice(-5).map(m =>
      `${m.role === 'user' ? 'גיא' : 'אתה'}: ${m.content}`
    ).join('\n');

    // Recent entries summary - increase to 15 for "full access" feel
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
        {/* 3D Background has been removed for mobile stability */}

        {/* Background aesthetic line */}
        <div className="absolute top-[30%] left-[-20%] right-[-20%] h-[60%] bg-[#5EB5D6] opacity-40 blur-[100px] rounded-[50%] pointer-events-none" />

        {/* Top Bar - Responsive to environment */}
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
        {activeTab === 'actions' && (
          <OpenThreadsTab 
            setActiveTab={setActiveTab}
            setInput={setInput}
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
          />
        )}
        {activeTab === 'dashboard' && <DashboardTab />}
        {activeTab === 'history' && <HistoryTab />}
      </main>



      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-[100] flex justify-center px-6 pb-[env(safe-area-inset-bottom,24px)] pointer-events-none">
        <nav className="w-full h-20 bg-[#0D3B66]/80 backdrop-blur-3xl rounded-[2.5rem] flex justify-around items-center px-4 shadow-2xl border border-white/10 pointer-events-auto" dir="rtl">
          <NavItem id="home" label="בית" isActive={activeTab === 'home'} onClick={() => setActiveTab('home')} />
          <NavItem id="actions" label="חוטים" isActive={activeTab === 'actions'} onClick={() => setActiveTab('actions')} />
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
  isLiveActive, liveStatus, liveTranscript, isRecording, setIsRecording, handleToggleVoice
}: { 
  isLiveActive: boolean; 
  liveStatus: LiveChatStatus; 
  liveTranscript: string;
  isRecording: boolean;
  setIsRecording: (val: boolean) => void;
  handleToggleVoice: (instruction?: string) => void;
}) {
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [isProcessingText, setIsProcessingText] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const { apiKey, addEntry, entries } = useAppStore();
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
          const currentOpenThreads = entries.flatMap((e: any) => (e.openThreads || []).map((t: any) => typeof t === 'string' ? t : t.text));
          const result = await processAudioSession(audioBlob, apiKey, currentOpenThreads);
          if (result.transcript === 'NO_SPEECH_DETECTED') {
            alert("לא זוהה דיבור ברור בהקלטה, הרשומה בוטלה ולא נשמרה ביומן.");
          } else {
            addEntry(result);
          }
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
      const currentOpenThreads = entries.flatMap((e: any) => (e.openThreads || []).map((t: any) => typeof t === 'string' ? t : t.text));
      const result = await processTextSession(textInput, apiKey, currentOpenThreads);
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
              "absolute right-[-40px] w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all border border-white/20 active:scale-90 bg-gradient-to-tr from-[#FFA000] to-[#FFC107] text-[#0A3B66]",
              showTextInput && "ring-4 ring-white/30"
            )}
          >
            <Notebook size={28} strokeWidth={2} />
          </button>
        )}



        {/* Main Mic Button - Click to Toggle for Reliability */}
        <div className="relative group">
          <button 
            onClick={() => isRecording ? stopRecording() : startRecording()}
            disabled={isLiveActive}
            className={cn(
              "relative z-10 w-[180px] h-[180px] bg-gradient-to-t from-[#FFA000] to-[#FFC107] rounded-full flex items-center justify-center text-white shadow-[0_15px_45px_rgba(255,160,0,0.5)] transition-all",
              isRecording ? "scale-95 brightness-110 shadow-inner ring-8 ring-white/20" : "hover:scale-105 shadow-[0_12px_40px_rgba(255,160,0,0.4)]",
              isLiveActive && "opacity-20 grayscale cursor-not-allowed"
            )}
          >
            {isRecording ? <Square size={70} fill="white" className="rounded-xl animate-pulse" /> : <Mic size={90} strokeWidth={2.5} />}
            {isRecording && (
              <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 bg-white text-[#0D3B66] px-4 py-1.5 rounded-full font-bold shadow-lg animate-bounce">
                סיים
              </div>
            )}
          </button>

          {/* Left Button: LIVE (Small but visible) */}
          {!isRecording && (
            <button 
              onClick={() => handleToggleVoice()}
              className={cn(
                "absolute left-[-50px] top-1/2 -translate-y-1/2 w-16 h-16 rounded-full flex flex-col items-center justify-center shadow-lg transition-all border border-white/20 active:scale-90",
                isLiveActive 
                  ? "bg-red-500 text-white ring-4 ring-red-500/30 animate-pulse" 
                  : "bg-white/20 backdrop-blur-md text-white hover:bg-white/30"
              )}
            >
              <div className="w-6 h-6 rounded-full border-2 border-current animate-pulse flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-current" />
              </div>
              <span className="text-[10px] font-bold mt-1 uppercase">LIVE</span>
            </button>
          )}
        </div>
      </div>

      {/* Text Input Area */}
      {showTextInput && !isLiveActive && !isRecording && (
        <div className="w-full max-w-md bg-white/20 backdrop-blur-2xl rounded-2xl p-4 border border-white/40 shadow-2xl animate-in fade-in slide-in-from-bottom-4 transition-all" dir="rtl">
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
              className="bg-[#FFC107] text-[#0A3B66] px-6 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-[#FFE082] transition-all disabled:opacity-50"
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

function OpenThreadsTab({ 
  setActiveTab, 
  setInput 
}: { 
  setActiveTab: (tab: 'home' | 'actions' | 'insights' | 'dashboard' | 'history') => void;
  setInput: (val: string) => void;
}) {
  const { entries, toggleThreadResolution, removeThread } = useAppStore();
  
  // Flatten all open threads from all entries
  const allThreads = entries.flatMap(e => 
    (e.openThreads || []).map(t => ({
      entryId: e.id,
      text: t.text,
      isResolved: t.isResolved
    }))
  );

  const activeThreads = allThreads.filter(t => !t.isResolved);
  const resolvedThreads = allThreads.filter(t => t.isResolved);

  const handleReflect = (text: string) => {
    setInput(`היי, ביומן שלי עלה החוט הבא: "${text}". תוכל לעזור לי להרהר בזה ולשאול אותי שאלות סוקרטיות כדי לקדם או לפתור אותו?`);
    setActiveTab('insights');
  };

  const renderThread = (item: any, idx: number, isResolvedList: boolean) => (
    <div 
      key={`${item.entryId}-${item.text}-${idx}`} 
      className={cn(
        "backdrop-blur-3xl rounded-[2rem] p-5 flex flex-col sm:flex-row sm:items-center justify-between border shadow-2xl group transition-all gap-4",
        isResolvedList 
          ? "bg-white/5 border-white/5 opacity-55 hover:opacity-80"
          : "bg-[#0D3B66]/40 border-white/10 hover:bg-[#0D3B66]/50 hover:border-white/20"
      )}
    >
      <div className="flex items-start gap-4 flex-1">
        <div className={cn(
          "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border",
          isResolvedList
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : "bg-white/5 text-white/40 border-white/5"
        )}>
          {isResolvedList ? <Check size={18} /> : <Compass size={18} className="animate-pulse" />}
        </div>
        <div className="flex flex-col space-y-1">
          <span className={cn(
            "text-sm font-medium leading-relaxed text-right",
            isResolvedList ? "text-white/50 line-through" : "text-white"
          )}>
            {item.text}
          </span>
        </div>
      </div>
      
      <div className="flex items-center justify-end gap-2 shrink-0">
        {!isResolvedList && (
          <button
            onClick={() => handleReflect(item.text)}
            className="px-4 py-2 rounded-2xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-white/70 hover:text-white flex items-center gap-1.5 border border-white/5 transition-all active:scale-95"
            title="הרהר בחוט זה עם ה-AI"
          >
            <Sparkles size={14} className="text-[#FFD54F]" />
            <span>הרהר</span>
          </button>
        )}
        
        <button 
          onClick={() => toggleThreadResolution(item.entryId, item.text)}
          className={cn(
            "px-4 py-2 rounded-2xl text-xs font-bold flex items-center gap-1.5 transition-all border active:scale-95",
            isResolvedList
              ? "bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/20"
              : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20"
          )}
        >
          <CheckCircle2 size={14} />
          <span>{isResolvedList ? "פתח מחדש" : "קצה נסגר"}</span>
        </button>

        <button 
          onClick={() => {
            if (window.confirm(`האם למחוק לחלוטין את החוט הבא: "${item.text}"?`)) {
              removeThread(item.entryId, item.text);
            }
          }}
          className="w-10 h-10 rounded-2xl bg-red-500/10 hover:bg-red-500/20 text-red-400 flex items-center justify-center border border-red-500/10 transition-all opacity-0 group-hover:opacity-100 active:scale-95"
          title="מחק חוט"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="w-full flex flex-col space-y-6 pb-24" dir="rtl">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-xl font-bold flex items-center gap-3 text-white/90">
          <div className="w-10 h-10 rounded-2xl bg-[#FFD54F]/20 flex items-center justify-center text-[#FFD54F] ml-2">
            <Compass size={22} />
          </div>
          חוטים במחשבה
        </h2>
      </div>

      {allThreads.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-white/5 rounded-[3rem] border border-dashed border-white/10">
          <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center text-white/10 mb-4">
            <Compass size={40} strokeWidth={1} />
          </div>
          <p className="text-white/40 font-medium">אין חוטים פתוחים כרגע.</p>
          <p className="text-white/20 text-xs mt-1">הם ייווצרו אוטומטית כשתשתף דילמות או כוונות בהקלטות היומן שלך.</p>
        </div>
      ) : (
        <div className="flex-1 space-y-8 pr-1">
          {activeThreads.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-[10px] font-bold text-[#FFD54F] uppercase tracking-[0.2em] px-4">חוטים פעילים</h3>
              <div className="space-y-3">
                {activeThreads.map((t, i) => renderThread(t, i, false))}
              </div>
            </div>
          )}

          {resolvedThreads.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-[10px] font-bold text-emerald-400 uppercase tracking-[0.2em] px-4">קצוות שנסגרו</h3>
              <div className="space-y-3">
                {resolvedThreads.map((t, i) => renderThread(t, i, true))}
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
    majorInsights, setMajorInsights,
    chatMessages, apiKey, entries,
    dailyGtd, shadowQuickAdvices,
    operatingManual, shadowWork, advices,
    updateEntry, removeEntry
  } = useAppStore();
  const [showMajorInsights, setShowMajorInsights] = useState(false);
  const [showAllTimeInsights, setShowAllTimeInsights] = useState(false);
  const [isGeneratingMajor, setIsGeneratingMajor] = useState(false);
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [isManualExpanded, setIsManualExpanded] = useState(false);
  const [isGapExpanded, setIsGapExpanded] = useState(false);
  const [isAdvicesExpanded, setIsAdvicesExpanded] = useState(false);
  const [isQuotesExpanded, setIsQuotesExpanded] = useState(false);

  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [editQuoteText, setEditQuoteText] = useState('');

  const extractedQuotes = useMemo(() => {
    console.log('--- Extracted Quotes Diagnostic Start ---');
    console.log('Total entries:', entries.length);
    const result = entries.filter(entry => {
      // 1. Check if any topic contains "ציטוט" (which renders as #ציטוטים or similar in UI)
      const hasQuoteTopic = (entry.topics || []).some(topic => {
        if (!topic) return false;
        const clean = topic.replace(/[\u200e\u200f\s#]/g, '').toLowerCase();
        const match = clean.includes('ציטוט');
        if (match) {
          console.log(`Matched topic in entry [${entry.id}]:`, topic);
        }
        return match;
      });

      // 2. Check if transcript contains the hashtag #ציטוט or #ציטוטים (ignoring RTL/LTR marks and spacing)
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


  const handleGenerateMajor = async () => {
    if (!apiKey) return;
    setIsGeneratingMajor(true);
    try {
      const insights = await generateMajorInsights(entries, apiKey, majorInsights);
      setMajorInsights(insights);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingMajor(false);
    }
  };

  useEffect(() => {
    if (majorInsights.length === 0 && entries.length > 0 && apiKey) {
      handleGenerateMajor();
    }
  }, [entries.length, apiKey]);

  // Stop speech if navigating away
  useEffect(() => {
    return () => {
      if ((window as any).audioWeekly) {
         (window as any).audioWeekly.pause();
         (window as any).audioWeekly = null;
      }
      window.speechSynthesis.cancel();
    };
  }, []);

//

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isChatExpanded) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages.length, isChatExpanded]);

  return (
    <div className="w-full flex flex-col space-y-4 pb-12">
      {/* Visual Diagnostic Block */}
      <div id="diagnostic-quotes-data" style={{ display: 'none' }} data-total-entries={entries.length} data-extracted={extractedQuotes.length}>
        {JSON.stringify(entries.map(e => ({ id: e.id, timestamp: e.timestamp, topics: e.topics, transcript: e.transcript.substring(0, 100) })))}
      </div>
      {/* Main AI Question Input (Now at Top) */}
      <div className="w-full px-2 pt-2 sticky top-0 z-10 bg-gradient-to-b from-[#89CFF0]/80 to-transparent pb-4">
        <div className="bg-white/30 backdrop-blur-2xl rounded-[2rem] border border-white/40 p-2 flex gap-2 items-center shadow-xl">
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={isLiveActive}
            placeholder={isLiveActive ? "הצאט הקולי פעיל..." : "שאל אותי על הכל..."}
            className="flex-1 bg-white/20 rounded-2xl px-5 py-3.5 outline-none focus:ring-2 focus:ring-[#FFC107]/50 transition-all text-sm placeholder:text-[#0A3B66]/60 shadow-inner border border-white/20 disabled:opacity-50 text-[#0A3B66] font-medium"
          />
          <button 
            onClick={() => handleToggleVoice()}
            className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-lg active:scale-95",
              isLiveActive ? "bg-red-500 text-white animate-pulse" : "bg-white/40 text-[#0A3B66] hover:bg-white/60"
            )}
            title="שיחה קולית"
          >
            <Mic size={20} />
          </button>
          <button 
            onClick={() => setIsChatExpanded(!isChatExpanded)}
            className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-lg active:scale-95",
              isChatExpanded ? "bg-[#FFC107] text-[#0A3B66]" : "bg-white/40 text-[#0A3B66] hover:bg-white/60"
            )}
            title={isChatExpanded ? "סגור היסטוריה" : "הצג היסטוריה"}
          >
            <HistoryIcon size={20} />
          </button>
          {!isLiveActive && (
            <button 
              onClick={handleSend}
              disabled={!input.trim() || isSending}
              className="w-12 h-12 bg-[#FFC107] text-[#0A3B66] rounded-2xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg disabled:opacity-50"
            >
              {isSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={20} />}
            </button>
          )}
        </div>
      </div>

      {/* Expandable Chat History (Now below Input) */}
      {isChatExpanded && (
        <div className="flex-1 min-h-[400px] max-h-[70vh] overflow-y-auto px-2 space-y-4 custom-scrollbar bg-white/5 rounded-[2rem] border border-white/5 mx-2 p-4 animate-in slide-in-from-top-4 duration-300">
          {chatMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-white/20 p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                <Brain size={32} />
              </div>
              <p className="text-sm">עדיין לא שלחת שאלות. שאל אותי כל דבר על המחשבות והתובנות שלך.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {chatMessages.map((msg, idx) => (
                <div 
                  key={idx} 
                  className={cn(
                    "flex flex-col max-w-[85%] animate-in fade-in slide-in-from-bottom-2",
                    msg.role === 'user' ? "mr-auto text-right" : "ml-auto text-left"
                  )}
                >
                  <div className={cn(
                    "px-4 py-3 rounded-[1.5rem] text-sm leading-relaxed shadow-sm",
                    msg.role === 'user' 
                      ? "bg-[#FFD54F] text-[#0D3B66] rounded-tr-none" 
                      : "bg-white/10 text-white/90 border border-white/5 rounded-tl-none"
                  )}>
                    {msg.content}
                  </div>
                  <span className="text-[9px] text-white/30 mt-1 px-1">
                    {new Date(msg.timestamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>
      )}

      {/* Shadow Quick Advices */}
      <div className="bg-white/20 backdrop-blur-2xl border border-white/40 rounded-[2.5rem] overflow-hidden shadow-2xl transition-all relative group mt-4">
        <button 
          onClick={() => setIsAdvicesExpanded(!isAdvicesExpanded)}
          className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors relative z-10 text-right"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-[#FFD54F] rounded-2xl flex items-center justify-center text-[#0A3B66] shadow-[0_0_20px_rgba(255,213,79,0.4)] group-hover:rotate-12 transition-transform">
              <Sparkles size={24} />
            </div>
            <div className="text-right">
              <span className="block font-bold text-[#0A3B66] text-lg leading-tight">עצות מהירות</span>
              <span className="block text-xs text-[#0A3B66]/60 font-medium mt-1">ישומיות יומיומיות מתוך עבודת הצללים</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[#0A3B66]/30">
            {isAdvicesExpanded ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
          </div>
        </button>

        {isAdvicesExpanded && (
          <div className="px-7 pb-7 pt-2 relative z-10 animate-in fade-in slide-in-from-top-2 cursor-default pl-2">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-[#FFC107]/20 to-transparent rounded-full -m-10 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
            
            <div className="space-y-3 relative z-10">
              {(() => {
                const advicesList = shadowQuickAdvices?.advices || [
                  "קח אוויר לפני שאתה מתפרץ בפגישות שמרגישות לחוצות.", 
                  "זכור לבצע פאוזה ולא להגיב מיד לטריגרים שקשורים לסמכות.",
                  "הקדש 5 דקות בסוף היום לרפלקציה על הפעולות שדחית.",
                  "שים לב מתי אתה משתמש במילה 'צריך' והחלף אותה ב'בוחר'.",
                  "זהה רגש אחד חסום היום ותן לו ביטוי בכתיבה של שתי דקות."
                ];
                
                const nextToReplaceIndex = shadowQuickAdvices?.oldestIndex ?? 0;
                const recentlyUpdatedIndex = (nextToReplaceIndex - 1 + 5) % 5;
                const hasUpdateToday = !!shadowQuickAdvices?.lastUpdateDate;
                
                return (
                  <div className="space-y-3">
                    {advicesList.map((advice, idx) => {
                      const isNewest = hasUpdateToday && idx === recentlyUpdatedIndex;
                      const isOldest = idx === nextToReplaceIndex;
                      
                      return (
                        <div key={idx} className={cn(
                          "flex gap-3 items-start p-3 rounded-2xl transition-all duration-300",
                          isNewest 
                            ? "bg-amber-400/10 border border-amber-400/30 shadow-md scale-[1.01]" 
                            : "hover:bg-white/5 border border-transparent"
                        )}>
                          <div className={cn(
                            "w-2 h-2 rounded-full mt-2 transition-all duration-300 flex-shrink-0",
                            isNewest 
                              ? "bg-[#FFC107] scale-125 shadow-[0_0_10px_rgba(255,193,7,0.8)] animate-pulse" 
                              : "bg-[#0A3B66]/30"
                          )}></div>
                          <div className="flex-1 text-right">
                            <p className={cn(
                              "text-sm leading-relaxed",
                              isNewest ? "text-[#0A3B66] font-bold" : "text-[#0A3B66]/90 font-medium"
                            )}>
                              {advice}
                            </p>
                            <div className="flex justify-start gap-2 mt-1">
                              {isNewest && (
                                <span className="inline-block text-[9px] text-amber-700 font-bold bg-amber-200/50 px-2 py-0.5 rounded-full">
                                  עודכן היום (העצה הכי חדשה)
                                </span>
                              )}
                              {isOldest && !isNewest && (
                                <span className="inline-block text-[9px] text-[#0A3B66]/40 font-semibold bg-[#0A3B66]/5 px-2 py-0.5 rounded-full">
                                  העצה הוותיקה ביותר (תוחלף מחר)
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex justify-between items-center pt-3 border-t border-white/20 mt-3 text-[10px] text-[#0A3B66]/50">
                      <span className="font-medium">5 עצות פעילות במקביל (עצה אחת ותיקה מתחלפת בכל יום)</span>
                      <span className="font-mono bg-white/30 px-2 py-0.5 rounded-full font-bold">
                        {new Date().toLocaleDateString('he-IL', { weekday: 'long' })}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* 3 Major Insights - Unified Section */}
      <div className="bg-white/20 backdrop-blur-2xl border border-white/40 rounded-[2.5rem] overflow-hidden shadow-2xl transition-all">
        <div 
          onClick={() => setShowMajorInsights(!showMajorInsights)}
          className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors group cursor-pointer"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-[#FFC107] rounded-2xl flex items-center justify-center text-[#0A3B66] shadow-[0_0_20px_rgba(255,213,79,0.4)] group-hover:rotate-12 transition-transform">
              <Star size={24} />
            </div>
            <div className="text-right">
              <span className="block font-bold text-[#0A3B66] text-lg leading-tight">תובנות עיקריות</span>
              <span className="block text-xs text-[#0A3B66]/60 uppercase tracking-widest mt-1">יומי, גלובלי, שבועי, משמעותי ותת-מודע</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
             {isGeneratingMajor ? (
               <Loader2 size={20} className="animate-spin text-[#0A3B66]" />
             ) : (
               <button 
                 onClick={(e) => { e.stopPropagation(); handleGenerateMajor(); }}
                 className="p-2 text-[#0A3B66]/40 hover:text-[#FFC107] transition-colors"
               >
                 <Activity size={18} />
               </button>
             )}
            <div className="text-[#0A3B66]/30">
              {showMajorInsights ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
            </div>
          </div>
        </div>

        {showMajorInsights && (
          <div className="p-6 pt-0 space-y-4 animate-in fade-in slide-in-from-top-2 cursor-default">
            {/* Daily GTD Insight - Always first */}
            {dailyGtd?.insight && (
              <div className="bg-[#FFC107]/20 rounded-3xl p-5 border border-[#FFC107]/30 group relative hover:bg-[#FFC107]/30 transition-all">
                <div className="flex justify-between items-start mb-2 sticky top-0 bg-[#FFC107]/10 backdrop-blur-md z-10 p-2 mx-[-8px] rounded-xl border border-[#FFC107]/20 shadow-sm">
                  <span className="text-[10px] font-bold text-[#0A3B66]/80 uppercase tracking-tighter flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#FFC107] animate-pulse"></span>
                    תובנה יומית
                  </span>
                  <SpeechButton text={dailyGtd.insight} className="w-8 h-8 opacity-40 group-hover:opacity-100 text-[#0A3B66]" />
                </div>
                <p className="text-sm leading-relaxed text-[#0A3B66] whitespace-pre-wrap break-words font-medium">
                  {dailyGtd.insight}
                </p>
              </div>
            )}
            {majorInsights.length > 0 ? (
              majorInsights.map((insight, idx) => (
                <div key={idx} className="bg-white/40 rounded-3xl p-5 border border-white/20 group relative hover:bg-white/60 transition-all">
                  <div className="flex justify-between items-start mb-2 sticky top-0 bg-white/20 backdrop-blur-md z-10 p-2 mx-[-8px] rounded-xl border border-white/10 shadow-sm">
                    <span className="text-[10px] font-bold text-[#0A3B66]/60 uppercase tracking-tighter">
                      {idx === 0 ? "תובנה גלובלית" : idx === 1 ? "תובנה שבועית" : idx === 2 ? "תובנה נבחרת" : "תת מודע"}
                    </span>
                    <SpeechButton text={insight} className="w-8 h-8 opacity-40 group-hover:opacity-100 text-[#0A3B66]" />
                  </div>
                  <p className="text-sm leading-relaxed text-[#0A3B66] whitespace-pre-wrap break-words font-medium">
                    {insight}
                  </p>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-white/40 italic text-sm">
                מעבד תובנות חדשות...
              </div>
            )}
          </div>
        )}
      </div>


      {/* Operating Manual Section */}
      <div className="bg-white/20 backdrop-blur-2xl border border-white/40 rounded-[2.5rem] overflow-hidden shadow-2xl transition-all relative group mt-4">
        <button 
          onClick={() => setIsManualExpanded(!isManualExpanded)}
          className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors relative z-10 text-right"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-[#FFC107] rounded-2xl flex items-center justify-center text-[#0A3B66] shadow-[0_0_20px_rgba(255,213,79,0.4)] group-hover:rotate-12 transition-transform">
              <Notebook size={24} />
            </div>
            <div className="text-right">
              <span className="block font-bold text-[#0A3B66] text-lg leading-tight">ספר ההפעלה שלי</span>
              <span className="block text-xs text-[#0A3B66]/60 uppercase tracking-widest mt-1">מבוסס חודש אחרון</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[#0A3B66]/30">
            {operatingManual?.insight && <SpeechButton text={operatingManual.insight} className="text-[#0A3B66] opacity-40 hover:opacity-100" />}
            {isManualExpanded ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
          </div>
        </button>

        {isManualExpanded && (
          <div className="px-7 pb-7 pt-2 relative z-10 animate-in fade-in slide-in-from-top-2 cursor-default">
            {!operatingManual?.insight ? (
              <div className="py-10 flex flex-col items-center text-center space-y-4">
                <Brain size={40} className="text-[#0A3B66]/20" strokeWidth={1} />
                <p className="text-sm text-[#0A3B66]/40 italic">הדפוסים שלך מתגבשים ברגעים אלו...</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="text-sm text-[#0A3B66] leading-relaxed max-h-[400px] overflow-y-auto pr-2 custom-scrollbar space-y-4 font-medium">
                  {operatingManual.insight.split('\n').filter(l => l.trim()).map((line, i) => {
                    const isHeader = /^\d+\./.test(line.trim());
                    if (isHeader) return <h4 key={i} className="text-md font-bold text-[#0A3B66] mt-4">{line}</h4>;
                    return (
                      <p key={i} className={cn(
                        line.trim().startsWith('*') || line.trim().startsWith('-') ? "pr-4 relative before:content-['•'] before:absolute before:right-0 before:text-[#FFC107]" : ""
                      )}>
                        {line.replace(/^(\*|-)\s*/, '')}
                      </p>
                    );
                  })}
                </div>
                <div className="pt-4 border-t border-white/20 flex items-center justify-between">
                  <span className="text-[9px] text-[#0A3B66]/40 uppercase tracking-[0.3em] font-bold">נכתב ע"י בינה מלאכותית</span>
                  <span className="text-[10px] text-[#0A3B66]/50 font-mono font-bold">
                    עדכון אחרון: {new Date(operatingManual.lastDate!).toLocaleDateString('he-IL')}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Execution Gap / Critical Review Section */}
      <div className="bg-white/20 backdrop-blur-2xl border border-white/40 rounded-[2.5rem] overflow-hidden shadow-2xl transition-all relative group mt-4">
        <button 
          onClick={() => setIsGapExpanded(!isGapExpanded)}
          className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors relative z-10 text-right"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-red-400/20 rounded-2xl flex items-center justify-center text-red-500 shadow-[0_0_20px_rgba(248,113,113,0.3)] group-hover:rotate-12 transition-transform">
              <Activity size={24} />
            </div>
            <div className="text-right">
              <span className="block font-bold text-[#0A3B66] text-lg leading-tight">קצת ביקורת לא תזיק</span>
              <span className="block text-xs text-[#0A3B66]/60 uppercase tracking-widest mt-1">משימות מול מציאות</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[#0A3B66]/30">
            {shadowWork?.insight && <SpeechButton text={shadowWork.insight} className="text-[#0A3B66] opacity-40 hover:opacity-100" />}
            {isGapExpanded ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
          </div>
        </button>

        {isGapExpanded && (
          <div className="px-7 pb-7 pt-2 relative z-10 animate-in fade-in slide-in-from-top-2 cursor-default">
            {!shadowWork?.insight ? (
              <div className="py-6 flex flex-col items-center text-center space-y-4">
                <Activity size={32} className="text-[#0A3B66]/20 animate-pulse" />
                <p className="text-sm text-[#0A3B66]/40 italic">ה-AI מנתח פערים בין התוכניות שלך לביצוע בפועל...</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-sm text-[#0A3B66] leading-relaxed max-h-[300px] overflow-y-auto pr-2 custom-scrollbar space-y-3 font-medium">
                  {shadowWork.insight.split('\n').filter(l => l.trim()).map((line, i) => (
                    <p key={i} className={cn(
                      "pb-2 border-b border-white/20 last:border-0",
                      line.trim().startsWith('*') || line.trim().startsWith('-') ? "pr-4 relative before:content-['•'] before:absolute before:right-0 before:text-red-400" : ""
                    )}>
                      {line.replace(/^(\*|-)\s*/, '')}
                    </p>
                  ))}
                </div>
                <div className="pt-4 border-t border-white/20 flex items-center justify-between">
                  <span className="text-[9px] text-[#0A3B66]/40 uppercase tracking-[0.3em] font-bold">ניתוח ביקורתי (Shadow Review)</span>
                  <span className="text-[10px] text-[#0A3B66]/50 font-mono font-bold">
                    עדכון אחרון: {new Date(shadowWork.lastDate!).toLocaleDateString('he-IL')}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI Advices Section */}
      <div className="bg-white/20 backdrop-blur-2xl border border-white/40 rounded-[2.5rem] overflow-hidden shadow-2xl transition-all relative group mt-4">
        <button 
          onClick={() => setIsAdvicesExpanded(!isAdvicesExpanded)}
          className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors relative z-10 text-right"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-400/20 rounded-2xl flex items-center justify-center text-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.3)] group-hover:rotate-12 transition-transform">
              <Lightbulb size={24} />
            </div>
            <div className="text-right">
              <span className="block font-bold text-[#0A3B66] text-lg leading-tight">העצות שלי מה-AI</span>
              <span className="block text-xs text-[#0A3B66]/60 uppercase tracking-widest mt-1">עבודה, משפחה, רווחה נפשית</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[#0A3B66]/30">
            {isAdvicesExpanded ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
          </div>
        </button>

        {isAdvicesExpanded && (
          <div className="px-7 pb-7 pt-2 relative z-10 animate-in fade-in slide-in-from-top-2 cursor-default">
            {(!advices?.history || advices.history.length === 0) ? (
              <div className="py-6 flex flex-col items-center text-center space-y-4">
                <Lightbulb size={32} className="text-[#0A3B66]/20 animate-pulse" />
                <p className="text-sm text-[#0A3B66]/40 italic">ה-AI אוסף נתונים ומכין עצות רלוונטיות עבורך...</p>
              </div>
            ) : (
              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {advices.history.map((adv, idx) => (
                  <div key={idx} className="bg-white/40 rounded-3xl p-5 border border-white/20 space-y-4 shadow-sm hover:bg-white/60 transition-all">
                    <div className="flex items-center justify-between border-b border-white/30 pb-3 mb-3">
                      <span className="text-[10px] text-[#0A3B66]/50 font-mono font-bold">
                        {new Date(adv.timestamp).toLocaleDateString('he-IL')}
                      </span>
                      {idx === 0 && <span className="text-[9px] bg-[#FFC107]/20 text-[#0A3B66] px-2 py-0.5 rounded-full font-bold tracking-widest border border-[#FFC107]/30">העדכני ביותר</span>}
                    </div>

                    <div className="flex items-start gap-3">
                       <Briefcase size={18} className="text-[#0A3B66] mt-0.5 shrink-0 opacity-70" />
                       <div>
                          <span className="block text-xs font-bold text-[#0A3B66] mb-1">עבודה</span>
                          <p className="text-sm text-[#0A3B66] leading-relaxed font-medium">{adv.work}</p>
                       </div>
                    </div>

                    <div className="flex items-start gap-3">
                       <Home size={18} className="text-[#0A3B66] mt-0.5 shrink-0 opacity-70" />
                       <div>
                          <span className="block text-xs font-bold text-[#0A3B66] mb-1">משפחה</span>
                          <p className="text-sm text-[#0A3B66] leading-relaxed font-medium">{adv.family}</p>
                       </div>
                    </div>

                    <div className="flex items-start gap-3">
                       <Heart size={18} className="text-[#0A3B66] mt-0.5 shrink-0 opacity-70" />
                       <div>
                          <span className="block text-xs font-bold text-[#0A3B66] mb-1">רווחה נפשית</span>
                          <p className="text-sm text-[#0A3B66] leading-relaxed font-medium">{adv.mental}</p>
                       </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quotes Section */}
      <div className="bg-white/20 backdrop-blur-2xl border border-white/40 rounded-[2.5rem] overflow-hidden shadow-2xl transition-all relative group mt-4">
        <button 
          onClick={() => setIsQuotesExpanded(!isQuotesExpanded)}
          className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors relative z-10 text-right"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-violet-400/20 rounded-2xl flex items-center justify-center text-violet-500 shadow-[0_0_20px_rgba(139,92,246,0.3)] group-hover:rotate-12 transition-transform">
              <Quote size={24} />
            </div>
            <div className="text-right">
              <span className="block font-bold text-[#0A3B66] text-lg leading-tight">ציטוטים</span>
              <span className="block text-xs text-[#0A3B66]/60 uppercase tracking-widest mt-1">פניני חכמה והשראה מתוך כניסות היומן שלך</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[#0A3B66]/30">
            {isQuotesExpanded ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
          </div>
        </button>

        {isQuotesExpanded && (
          <div className="px-7 pb-7 pt-2 relative z-10 animate-in fade-in slide-in-from-top-2 cursor-default">
            {extractedQuotes.length === 0 ? (
              <div className="py-8 flex flex-col items-center text-center space-y-3">
                <Quote size={32} className="text-[#0A3B66]/20 rotate-180" strokeWidth={1.5} />
                <p className="text-sm text-[#0A3B66]/50 italic font-medium">אין עדיין ציטוטים ביומן שלך.</p>
                <p className="text-xs text-[#0A3B66]/40 max-w-xs leading-relaxed">
                  ה-AI יסווג באופן אוטומטי כניסות המכילות ציטוטים או תובנות מיוחדות תחת <span className="font-bold text-violet-500">ציטוטים</span>, או שתוכל להוסיף את ההאשטאג <span className="font-bold text-violet-500">#ציטוט</span>.
                </p>
              </div>
            ) : (
              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar animate-in fade-in duration-300">
                {extractedQuotes.map((q) => (
                  <div key={q.id} className="bg-white/40 rounded-3xl p-5 border border-white/20 space-y-3 shadow-sm hover:bg-white/60 transition-all relative group/item">
                    <div className="flex items-center justify-between border-b border-white/30 pb-2 mb-2">
                      <span className="text-[10px] text-[#0A3B66]/50 font-mono font-bold">
                        {new Date(q.timestamp).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                      <div className="flex items-center gap-2">
                        <SpeechButton text={q.transcript} className="bg-white/10 hover:bg-white/20 w-8 h-8 text-[#0A3B66] hover:text-[#0A3B66] transition-all rounded-xl" />
                        <span className="bg-[#0D3B66]/10 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-[#0A3B66]/90">
                          {q.mood}
                        </span>
                        <button 
                          onClick={() => {
                            setEditingQuoteId(q.id);
                            setEditQuoteText(q.transcript);
                          }}
                          className="p-1.5 text-[#0A3B66]/40 hover:text-violet-600 hover:bg-violet-500/10 rounded-lg transition-all active:scale-95"
                          title="ערוך כניסה"
                        >
                          <Pencil size={14} />
                        </button>
                        <button 
                          onClick={() => window.confirm('האם למחוק כניסה זו?') && removeEntry(q.id)}
                          className="p-1.5 text-[#0A3B66]/40 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all active:scale-95"
                          title="מחק כניסה"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    {editingQuoteId === q.id ? (
                      <div className="w-full mt-2">
                        <textarea 
                          value={editQuoteText}
                          onChange={(e) => setEditQuoteText(e.target.value)}
                          className="w-full bg-white/25 text-[#0A3B66] placeholder-[#0A3B66]/50 border border-white/30 outline-none resize-none rounded-xl p-3 text-sm leading-relaxed"
                          rows={4}
                          dir="rtl"
                        />
                        <div className="flex justify-end gap-2 mt-2">
                          <button 
                            onClick={() => setEditingQuoteId(null)} 
                            className="text-[#0A3B66]/60 hover:text-[#0A3B66] text-xs px-3 py-1.5 transition-colors"
                          >
                            ביטול
                          </button>
                          <button 
                            onClick={() => {
                              updateEntry(q.id, editQuoteText);
                              setEditingQuoteId(null);
                            }} 
                            className="bg-violet-600/80 hover:bg-violet-600 text-white text-xs px-4 py-1.5 rounded-lg transition-colors font-medium shadow-sm"
                          >
                            שמור שינויים
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <Quote size={18} className="text-violet-500 shrink-0 opacity-40 rotate-180 mt-1" />
                        <p className="text-sm text-[#0A3B66] leading-relaxed font-semibold italic whitespace-pre-wrap">
                          {q.transcript}
                        </p>
                      </div>
                    )}
                    {q.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-[#0A3B66]/10">
                        {q.topics.map((t, i) => {
                          const isQuoteTag = t.trim().includes('ציטוט') || t.trim().includes('ציטוטים') || t.trim().includes('#ציטוט') || t.trim().includes('#ציטוטים');
                          return (
                            <span 
                              key={i} 
                              className={cn(
                                "text-[10px] px-2 py-0.5 rounded-full border transition-all",
                                isQuoteTag 
                                  ? "bg-violet-500/20 text-violet-700 border-violet-500/30 font-bold shadow-[0_0_8px_rgba(139,92,246,0.2)]" 
                                  : "bg-[#0D3B66]/5 text-[#0D3B66]/70 border-[#0D3B66]/10"
                              )}
                            >
                              #{t}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Insights History */}
      <div className="bg-white/20 backdrop-blur-2xl border border-white/40 rounded-[2rem] overflow-hidden shadow-2xl mt-4">
        <div 
          onClick={() => setShowAllTimeInsights(!showAllTimeInsights)}
          className="w-full p-5 flex items-center justify-between hover:bg-white/10 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-400/20 flex items-center justify-center text-blue-400">
              <HistoryIcon size={20} />
            </div>
            <span className="font-bold text-white/90 text-sm">היסטוריית תובנות</span>
          </div>
          <div className="text-white/30">
            {showAllTimeInsights ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        </div>
        {showAllTimeInsights && (
          <div className="p-5 pt-0 space-y-4">
            {entries.filter(e => e.insights && e.insights.length > 0).map(entry => (
              <div key={entry.id} className="bg-white/40 rounded-2xl p-4 border border-white/20 shadow-sm transition-all hover:bg-white/60">
                <div className="text-[10px] text-[#0A3B66]/50 mb-2 font-bold uppercase tracking-tight">
                  {new Date(entry.timestamp).toLocaleDateString('he-IL')}
                </div>
                <div className="text-sm text-[#0A3B66] font-medium leading-relaxed">
                  {entry.insights.join(' ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

//

function HistoryTab() {
  const { entries, removeEntry, updateEntry } = useAppStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editTopics, setEditTopics] = useState<string[]>([]);
  const [newTagVal, setNewTagVal] = useState('');

  return (
    <div className="w-full flex flex-col space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2 text-[#0A3B66]">
          <div className="w-10 h-10 rounded-2xl bg-[#FFC107]/20 flex items-center justify-center text-[#FFC107] shadow-sm">
            <HistoryIcon size={20} />
          </div>
          יומן מחשבות
        </h2>
      </div>

      {entries.length === 0 ? (
        <div className="bg-white/10 backdrop-blur-md rounded-3xl p-8 text-center border border-white/10">
          <p className="text-white/60">היומן שלך ריק. התחל להקליט מחשבות!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <div key={entry.id} className="bg-white/10 backdrop-blur-md rounded-3xl p-5 border border-white/10 space-y-3 group relative overflow-hidden">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-white/50">
                  {new Date(entry.timestamp).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
                <div className="flex items-center gap-2 z-10">
                  <SpeechButton text={entry.transcript} className="bg-white/10 hover:bg-white/20 w-8 h-8 text-white/80 hover:text-white transition-all rounded-xl" />
                  <span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-white/90">
                    {entry.mood}
                  </span>
                  <button 
                    onClick={() => {
                      setEditingId(entry.id);
                      setEditText(entry.transcript);
                      setEditTopics(entry.topics || []);
                      setNewTagVal('');
                    }}
                    className="p-1.5 text-white/40 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-all active:scale-95"
                    title="ערוך כניסה"
                  >
                    <Pencil size={14} />
                  </button>
                  <button 
                    onClick={() => window.confirm('האם למחוק כניסה זו?') && removeEntry(entry.id)}
                    className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all active:scale-95"
                    title="מחק כניסה"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {editingId === entry.id ? (
                <div className="w-full mt-2 space-y-3">
                  <textarea 
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="w-full bg-white/20 text-white placeholder-white/50 border border-white/20 outline-none resize-none rounded-xl p-3 text-sm leading-relaxed"
                    rows={4}
                    dir="rtl"
                  />
                  
                  {/* Tag Editor UI */}
                  <div className="bg-white/5 rounded-2xl p-3.5 border border-white/10 space-y-3">
                    <label className="text-xs font-bold text-white/70 block">ניהול תגיות (#)</label>
                    
                    {/* Active tag chips */}
                    <div className="flex flex-wrap gap-1.5 min-h-[24px] items-center">
                      {editTopics.length === 0 ? (
                        <span className="text-xs text-white/30 italic">אין תגיות עדיין...</span>
                      ) : (
                        editTopics.map((topic, index) => (
                          <span 
                            key={index} 
                            onClick={() => setEditTopics(editTopics.filter((_, idx) => idx !== index))}
                            className="bg-blue-400/20 text-blue-200 text-[10px] pl-2 pr-1.5 py-0.5 rounded-full border border-blue-400/30 flex items-center gap-1 group/tag cursor-pointer hover:bg-red-500/20 hover:text-red-200 hover:border-red-500/30 transition-all select-none"
                            title="לחץ להסרה"
                          >
                            #{topic}
                            <span className="text-[9px] text-white/40 group-hover/tag:text-red-400">×</span>
                          </span>
                        ))
                      )}
                    </div>
                    
                    {/* Input field to add tags */}
                    <div className="flex items-center gap-2">
                      <input 
                        type="text" 
                        value={newTagVal}
                        onChange={(e) => setNewTagVal(e.target.value)}
                        placeholder="הקלד תגית חדשה ולחץ אנטר..." 
                        className="bg-white/10 text-white placeholder-white/40 text-xs px-3 py-2 rounded-xl border border-white/10 outline-none flex-grow"
                        dir="rtl"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = newTagVal.trim().replace(/^#/g, '');
                            if (val && !editTopics.includes(val)) {
                              setEditTopics([...editTopics, val]);
                              setNewTagVal('');
                            }
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const val = newTagVal.trim().replace(/^#/g, '');
                          if (val && !editTopics.includes(val)) {
                            setEditTopics([...editTopics, val]);
                            setNewTagVal('');
                          }
                        }}
                        className="bg-white/10 hover:bg-white/20 text-white text-xs px-3.5 py-2 rounded-xl border border-white/10 transition-colors font-medium active:scale-95"
                      >
                        הוסף
                      </button>
                    </div>
                    <p className="text-[9px] text-white/30 leading-normal">
                      * תגיות אלו מעדכנות את הגרפים ומאפשרות חיפוש וסינון מתקדם. תגיות המוקלדות בטקסט (לדוגמה #עבודה) יתווספו אוטומטית בעת השמירה!
                    </p>
                  </div>

                  <div className="flex justify-end gap-2 mt-2">
                    <button 
                      onClick={() => setEditingId(null)} 
                      className="text-white/60 hover:text-white text-xs px-3 py-1.5 transition-colors"
                    >
                      ביטול
                    </button>
                    <button 
                      onClick={() => {
                        updateEntry(entry.id, editText, editTopics);
                        setEditingId(null);
                      }} 
                      className="bg-emerald-500/80 hover:bg-emerald-500 text-white text-xs px-4 py-1.5 rounded-lg transition-colors font-medium shadow-sm active:scale-95"
                    >
                      שמור שינויים
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-white/90 leading-relaxed text-sm whitespace-pre-wrap">
                  {entry.transcript}
                </p>
              )}
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
