import { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  Send, 
  History as HistoryIcon, 
  ChevronDown, 
  ChevronUp, 
  Brain, 
  Loader2
} from 'lucide-react';
import { useAppStore, type DiaryEntry } from '../store';
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
    chatMessages, entries
  } = useAppStore();
  const [showAllTimeInsights, setShowAllTimeInsights] = useState(true); // Open by default now that it's the main content
  const [isChatExpanded, setIsChatExpanded] = useState(false);

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

