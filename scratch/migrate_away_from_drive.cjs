const fs = require('fs');
const path = require('path');

const appFilePath = path.join('c:', 'Users', 'guyku', 'thought_cloud_local', 'src', 'App.tsx');
let content = fs.readFileSync(appFilePath, 'utf8');

// Normalize line endings to LF
content = content.replace(/\r\n/g, '\n');

// 1. Update useAppStore destructuring in App to include loadInitialState, syncStatus
content = content.replace(
  `  const { apiKey, setApiKey, entries, setEntries, preferredModel, preferredApiVersion, setPreferredModel } = useAppStore();`,
  `  const { apiKey, setApiKey, entries, setEntries, preferredModel, preferredApiVersion, setPreferredModel, loadInitialState, syncStatus } = useAppStore();`
);

// 2. Replace initBoot useEffect (Google Drive script loader) with Firebase initial state loader
const legacyInitBootBlock = `  // Initialize Google Drive API and Viewport Height
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
    
    setAuthChangeCallback((authStatus: boolean) => {
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
  }, [isAuthenticated, entries.length]); // Re-run if entries change to detect if auth is needed`;

content = content.replace(
  legacyInitBootBlock,
  `  // Initialize Firebase State
  useEffect(() => {
    loadInitialState();
  }, []);`
);

// 3. Remove legacy syncToDrive useEffect (auto-saving loop)
const legacySyncToDriveBlock = `  // Sync to drive whenever entries or chatMessages change (with simple debounce)
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
        .catch((err: any) => {
          console.error("Sync error:", err);
          alert("שגיאה בסנכרון מול גוגל דרייב:\\n" + err.message);
        })
        .finally(() => setIsSyncing(false));
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [
    entries,
    isAuthenticated,
    isSyncing,
  ]);`;

content = content.replace(legacySyncToDriveBlock, '');

// 4. Update Header cloud status UI
const legacyCloudButtonBlock = `         <div className="flex items-center gap-2">
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
          </button>`;

const newCloudButtonBlock = `        <div className="flex items-center gap-2">
          {syncStatus === 'saving' && (
            <span className="text-[10px] text-white/40 hidden xs:inline">שומר בענן...</span>
          )}
          {syncStatus === 'synced' && (
            <span className="text-[10px] text-emerald-400/80 hidden xs:inline">הנתונים שמורים בענן</span>
          )}
          {syncStatus === 'error' && (
            <span className="text-[10px] text-red-400 hidden xs:inline">שגיאה בשמירה בענן</span>
          )}
          <div
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center transition-all border",
              syncStatus === 'synced' && "bg-[#DCFCE7]/20 text-emerald-400 border-emerald-500/20",
              syncStatus === 'saving' && "bg-amber-500/10 text-amber-400 border-amber-500/20",
              syncStatus === 'error' && "bg-red-500/10 text-red-400 border-red-500/20"
            )}
            title={
              syncStatus === 'synced' ? "הנתונים מסונכרנים ל-Firebase" : 
              syncStatus === 'saving' ? "שומר שינויים ב-Firebase..." : 
              "שגיאה בסנכרון מול Firebase"
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
          </div>`;

content = content.replace(legacyCloudButtonBlock, newCloudButtonBlock);

// 5. Update Diagnostics UI for Firebase status
const legacyDiagnosticsAuthBlock = `              <div className="p-2 bg-white/5 rounded border border-white/10 uppercase">
                <div className="text-[10px] text-white/40">Auth</div>
                <div className={cn("font-bold", isAuthenticated ? "text-emerald-400" : "text-red-400")}>
                  {isAuthenticated ? "SYNCED" : "NOT SET"}
                </div>
              </div>`;

const newDiagnosticsAuthBlock = `              <div className="p-2 bg-white/5 rounded border border-white/10 uppercase">
                <div className="text-[10px] text-white/40">Firebase Sync</div>
                <div className={cn("font-bold", syncStatus === 'synced' ? "text-emerald-400" : syncStatus === 'saving' ? "text-amber-400" : "text-red-400")}>
                  {syncStatus.toUpperCase()}
                </div>
              </div>`;

content = content.replace(legacyDiagnosticsAuthBlock, newDiagnosticsAuthBlock);

fs.writeFileSync(appFilePath, content, 'utf8');
console.log('App.tsx successfully migrated away from GDrive to Firebase Storage!');
