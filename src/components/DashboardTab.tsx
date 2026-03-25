import { useState } from 'react';
import { useAppStore } from '../store';
import { cn } from '../App';
import { Brain, Star, Notebook, Activity, ChevronDown, ChevronUp } from 'lucide-react';
import KorczakInsight from './KorczakInsight';
import SpeechButton from './SpeechButton';



export default function DashboardTab() {
  const { entries, operatingManual, shadowWork } = useAppStore();
  const [isManualExpanded, setIsManualExpanded] = useState(false);
  const [isGapExpanded, setIsGapExpanded] = useState(false);

  // 1. Filter entries to last 30 days
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentEntries30Days = entries.filter(e => e.timestamp >= thirtyDaysAgo);



  // 3. Top Topics (Last 30 days) - Bar Chart Data
  const topicsMap: Record<string, number> = {};
  recentEntries30Days.forEach(e => (e.topics || []).forEach(t => { 
    let normalized = t.trim();
    if (normalized === 'ניהול זמן' || normalized === 'ניהול משימות') {
      normalized = 'ניהול זמן ומשימות';
    } else if (normalized === 'ניהול פרויקטים' || normalized === 'פרויקטים') {
      normalized = 'ניהול פרויקטים';
    }
    topicsMap[normalized] = (topicsMap[normalized] || 0) + 1; 
  }));
  const topTopics = Object.entries(topicsMap).sort((a, b) => b[1] - a[1]).slice(0, 8); // Take top 8 for bar chart
  const maxTopicCount = topTopics.length > 0 ? topTopics[0][1] : 1;


  return (
    <div className="w-full flex flex-col space-y-6 pb-24" dir="rtl">
      <div className="flex items-center justify-between px-2 pt-2">
        <h2 className="text-xl font-bold flex items-center gap-3 text-white/90">
          <div className="w-10 h-10 rounded-2xl bg-[#FFD54F]/20 flex items-center justify-center text-[#FFD54F]">
            <Activity size={22} />
          </div>
          מבט על
        </h2>
        <span className="text-[10px] text-white/40 border border-white/10 px-2 py-1 rounded-full bg-white/5">
          30 ימים אחרונים
        </span>
      </div>


      {/* 1. Top Topics Section - Vertical Bar Chart */}
      <section className="shrink-0 bg-white/10 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-6 shadow-xl">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-sm font-bold text-white/90 flex items-center gap-2">
            <Star size={16} className="text-[#FFD54F]" />
            נושאים מובילים
          </h3>
          <span className="text-[10px] text-white/40 uppercase tracking-widest leading-none">תדירות</span>
        </div>

        <div className="relative h-40 w-full flex items-end justify-between gap-2 px-2 mt-2">
          {topTopics.length === 0 ? (
             <div className="w-full h-full flex items-center justify-center text-white/30 text-xs italic">אין נושאים מתועדים בחודש האחרון...</div>
          ) : (
            topTopics.map(([topic, count]) => {
              const heightPercent = `${(count / maxTopicCount) * 100}%`;
              return (
                <div key={topic} className="flex flex-col items-center justify-end h-full w-full group relative">
                  {/* Tooltip on hover/active */}
                  <div className="absolute -top-8 bg-black/60 backdrop-blur-md px-2 py-1 rounded-lg text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap pointer-events-none">
                    {count} תיעודים
                  </div>
                  
                  {/* The Bar */}
                  <div className="w-full max-w-[40px] bg-white/5 rounded-t-xl relative overflow-hidden group-hover:bg-white/10 transition-colors duration-300" style={{ height: '100%' }}>
                    <div 
                      className="absolute bottom-0 w-full bg-gradient-to-t from-[#FFD54F]/80 to-[#FFD54F] rounded-t-xl transition-all duration-1000 ease-out"
                      style={{ height: heightPercent }}
                    >
                      <div className="absolute top-0 w-full h-1 bg-white/40 rounded-t-xl"></div>
                    </div>
                  </div>
                  
                  {/* Topic Label */}
                  <span className="text-[9px] font-bold text-white/70 mt-2 text-center w-full truncate px-1 group-hover:text-white transition-colors" title={topic}>
                    {topic}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>



      {/* 2. Korczak Insights Section */}
      <section className="shrink-0 bg-white/10 backdrop-blur-xl border border-white/10 rounded-[2.5rem] shadow-xl overflow-hidden transition-all">
        <KorczakInsight />
      </section>

      {/* 3. Operating Manual Section */}
      <section className="shrink-0 bg-[#0D3B66]/40 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl transition-all relative group">
        <div className="absolute top-0 right-0 w-40 h-40 bg-[#FFD54F]/5 blur-3xl -mr-20 -mt-20 pointer-events-none" />
        
        <button 
          onClick={() => setIsManualExpanded(!isManualExpanded)}
          className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors relative z-10"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#FFD54F]/20 flex items-center justify-center text-[#FFD54F]">
              <Notebook size={22} />
            </div>
            <div className="text-right">
              <span className="block font-bold text-white text-sm">ספר ההפעלה שלי</span>
              <span className="block text-[10px] text-white/20 uppercase mt-0.5 tracking-widest">מבוסס חודש אחרון</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-white/30">
            {operatingManual?.insight && <SpeechButton text={operatingManual.insight} />}
            {isManualExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        </button>

        {isManualExpanded && (
          <div className="px-7 pb-7 pt-2 relative z-10 animate-in fade-in slide-in-from-top-2">
            {!operatingManual?.insight ? (
              <div className="py-10 flex flex-col items-center text-center space-y-4">
                <Brain size={40} className="text-white/10" strokeWidth={1} />
                <p className="text-sm text-white/40 italic">הדפוסים שלך מתגבשים ברגעים אלו...</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="text-sm text-white/80 leading-relaxed max-h-[400px] overflow-y-auto pr-2 custom-scrollbar space-y-4">
                  {operatingManual.insight.split('\n').filter(l => l.trim()).map((line, i) => {
                    const isHeader = /^\d+\./.test(line.trim());
                    if (isHeader) return <h4 key={i} className="text-md font-bold text-[#FFD54F] mt-4">{line}</h4>;
                    return (
                      <p key={i} className={cn(
                        "opacity-80",
                        line.trim().startsWith('*') || line.trim().startsWith('-') ? "pr-4 relative before:content-['•'] before:absolute before:right-0 before:text-[#FFD54F]/60" : ""
                      )}>
                        {line.replace(/^(\*|-)\s*/, '')}
                      </p>
                    );
                  })}
                </div>
                <div className="pt-4 border-t border-white/10 flex items-center justify-between">
                  <span className="text-[9px] text-white/20 uppercase tracking-[0.3em]">נכתב ע"י בינה מלאכותית</span>
                  <span className="text-[10px] text-white/40 font-mono">
                    עדכון אחרון: {new Date(operatingManual.lastDate!).toLocaleDateString('he-IL')}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 4. Execution Gap / Critical Review Section */}
      <section className="shrink-0 bg-white/10 backdrop-blur-xl border border-white/10 rounded-[2.5rem] overflow-hidden shadow-xl transition-all relative group">
        <button 
          onClick={() => setIsGapExpanded(!isGapExpanded)}
          className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors relative z-10 text-right"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-red-400/20 flex items-center justify-center text-red-400">
              <Activity size={22} />
            </div>
            <div className="text-right">
              <span className="block font-bold text-white text-sm">פער הביצוע (Shadow Work)</span>
              <span className="block text-[10px] text-white/20 uppercase mt-0.5 tracking-widest">משימות מול מציאות</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-white/30">
            {shadowWork?.insight && <SpeechButton text={shadowWork.insight} />}
            {isGapExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        </button>

        {isGapExpanded && (
          <div className="px-7 pb-7 pt-2 relative z-10 animate-in fade-in slide-in-from-top-2">
            {!shadowWork?.insight ? (
              <div className="py-6 flex flex-col items-center text-center space-y-4">
                <Activity size={32} className="text-white/10 animate-pulse" />
                <p className="text-xs text-white/40 italic">ה-AI מנתח פערים בין התוכניות שלך לביצוע בפועל...</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-sm text-white/80 leading-relaxed max-h-[300px] overflow-y-auto pr-2 custom-scrollbar space-y-3">
                  {shadowWork.insight.split('\n').filter(l => l.trim()).map((line, i) => (
                    <p key={i} className={cn(
                      "opacity-80 pb-2 border-b border-white/5 last:border-0",
                      line.trim().startsWith('*') || line.trim().startsWith('-') ? "pr-4 relative before:content-['•'] before:absolute before:right-0 before:text-red-400/60" : ""
                    )}>
                      {line.replace(/^(\*|-)\s*/, '')}
                    </p>
                  ))}
                </div>
                <div className="pt-2 border-t border-white/10 flex items-center justify-between">
                  <span className="text-[9px] text-white/20 uppercase tracking-[0.3em]">ניתוח ביקורתי (Shadow Review)</span>
                  <span className="text-[10px] text-white/40 font-mono">
                    עדכון אחרון: {new Date(shadowWork.lastDate!).toLocaleDateString('he-IL')}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
