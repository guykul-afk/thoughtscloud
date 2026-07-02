import { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  Send, 
  History as HistoryIcon, 
  ChevronDown, 
  ChevronUp, 
  Brain, 
  Loader2, 
  Trash2, 
  Star, 
  Lightbulb, 
  Briefcase, 
  Home, 
  Heart, 
  Pencil, 
  Quote, 
  Activity 
} from 'lucide-react';
import { useAppStore, type DiaryEntry } from '../store';
import { generateMajorInsights } from '../services/ai';
import SpeechButton from './SpeechButton';
import { cn } from '../App';

interface InsightsTabProps {
  isLiveActive: boolean;
  input: string;
  setInput: (val: string) => void;
  handleSend: () => void;
  isSending: boolean;
  handleToggleVoice: () => void;
  extractedQuotes: DiaryEntry[];
}

export default function InsightsTab({ 
  isLiveActive,
  input,
  setInput,
  handleSend,
  isSending,
  handleToggleVoice,
  extractedQuotes
}: InsightsTabProps) {
  const { 
    majorInsights, setMajorInsights,
    chatMessages, apiKey, entries,
    dailyGtd, quoteInsights, advices,
    updateEntry, removeEntry
  } = useAppStore();
  const [showMajorInsights, setShowMajorInsights] = useState(false);
  const [showAllTimeInsights, setShowAllTimeInsights] = useState(false);
  const [isGeneratingMajor, setIsGeneratingMajor] = useState(false);
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [isAdvicesExpanded, setIsAdvicesExpanded] = useState(false);
  const [isQuotesExpanded, setIsQuotesExpanded] = useState(false);
  const [isQuoteInsightsExpanded, setIsQuoteInsightsExpanded] = useState(false);

  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [editQuoteText, setEditQuoteText] = useState('');

  const handleGenerateMajor = async () => {
    if (!apiKey) return;
    setIsGeneratingMajor(true);
    try {
      const { knowledgeGraph, addTriples } = useAppStore.getState();
      const { insights: majorList, triples } = await generateMajorInsights(entries, apiKey, majorInsights, knowledgeGraph);
      setMajorInsights(majorList);
      if (triples && triples.length > 0) {
        addTriples(triples, Date.now());
      }
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

      {/* Quote Insights */}
      <div className="bg-white/20 backdrop-blur-2xl border border-white/40 rounded-[2.5rem] overflow-hidden shadow-2xl transition-all relative group mt-4">
        <button 
          onClick={() => setIsQuoteInsightsExpanded(!isQuoteInsightsExpanded)}
          className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors relative z-10 text-right"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-400/20 rounded-2xl flex items-center justify-center text-[#0A3B66] shadow-[0_0_20px_rgba(59,130,246,0.3)] group-hover:rotate-12 transition-transform">
              <Quote size={24} />
            </div>
            <div className="text-right">
              <span className="block font-bold text-[#0A3B66] text-lg leading-tight">תובנות מציטוטים</span>
              <span className="block text-xs text-[#0A3B66]/60 font-medium mt-1">תובנות עמוקות שמופקות אחת ליומיים מהציטוטים שלך</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[#0A3B66]/30">
            {isQuoteInsightsExpanded ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
          </div>
        </button>

        {isQuoteInsightsExpanded && (
          <div className="px-7 pb-7 pt-2 relative z-10 animate-in fade-in slide-in-from-top-2 cursor-default pl-2">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-[#2196F3]/20 to-transparent rounded-full -m-10 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
            
            <div className="space-y-4 relative z-10 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {(!quoteInsights?.insights || quoteInsights.insights.length === 0) ? (
                <div className="py-10 flex flex-col items-center text-center space-y-4">
                  <Quote size={40} className="text-[#0A3B66]/20" strokeWidth={1} />
                  <p className="text-sm text-[#0A3B66]/40 italic">התובנות מהציטוטים שלך מתגבשות ברגעים אלו. הקפד לתייג ציטוטים ביומן עם #ציטוט...</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {quoteInsights.insights.map((insight, idx) => (
                    <div key={idx} className="bg-white/10 hover:bg-white/15 p-4 rounded-3xl border border-white/30 transition-all">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-500 flex-shrink-0 mt-0.5">
                          <Quote size={16} />
                        </div>
                        <div className="flex-1 text-right">
                          <p className="text-sm leading-relaxed text-[#0A3B66] font-medium whitespace-pre-wrap break-words">
                            {insight}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {quoteInsights.lastUpdateDate && (
                    <div className="pt-3 border-t border-white/20 mt-3 text-[10px] text-[#0A3B66]/50 text-left font-bold">
                      עדכון אחרון: {new Date(quoteInsights.lastUpdateDate).toLocaleDateString('he-IL')}
                    </div>
                  )}
                </div>
              )}
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
                    {q.topics && q.topics.length > 0 && (
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
