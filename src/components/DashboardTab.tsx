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


      {/* 1. Top Topics Section - Donut Pie Chart */}
      <section className="shrink-0 bg-white/10 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#FFD54F]/5 blur-3xl -mr-16 -mt-16 pointer-events-none" />
        
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-sm font-bold text-white/90 flex items-center gap-2">
            <Star size={16} className="text-[#FFD54F]" />
            פילוג נושאים מובילים
          </h3>
          <span className="text-[10px] text-white/40 uppercase tracking-widest leading-none">אחוזים</span>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-8 px-2">
          {topTopics.length === 0 ? (
             <div className="w-full h-40 flex items-center justify-center text-white/30 text-xs italic">אין נושאים מתועדים בחודש האחרון...</div>
          ) : (() => {
            const totalCount = topTopics.reduce((sum, [, count]) => sum + count, 0);
            const colors = [
              '#FFD54F', '#4FC3F7', '#81C784', '#BA68C8', 
              '#FF8A65', '#4DB6AC', '#7986CB', '#D4E157'
            ];
            
            let cumulativePercent = 0;
            const slices = topTopics.map(([topic, count], i) => {
              const percent = (count / totalCount) * 100;
              const startPercent = cumulativePercent;
              cumulativePercent += percent;
              return { topic, count, percent, color: colors[i % colors.length], startPercent };
            });

            return (
              <>
                {/* SVG Donut Chart */}
                <div className="relative w-40 h-40 flex-shrink-0 animate-in zoom-in duration-700">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90 transform origin-center drop-shadow-lg">
                    {slices.map((slice, i) => {
                      const radius = 40;
                      const circumference = 2 * Math.PI * radius;
                      const offset = circumference - (slice.percent / 100) * circumference;
                      const rotation = (slice.startPercent / 100) * 360;
                      
                      return (
                        <circle
                          key={i}
                          cx="50"
                          cy="50"
                          r={radius}
                          fill="transparent"
                          stroke={slice.color}
                          strokeWidth="12"
                          strokeDasharray={circumference}
                          strokeDashoffset={offset}
                          transform={`rotate(${rotation} 50 50)`}
                          strokeLinecap={slice.percent > 2 ? "round" : "butt"}
                          className="transition-all duration-1000 ease-out hover:opacity-80 cursor-pointer"
                        />
                      );
                    })}
                  </svg>
                  {/* Center Content */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-[10px] text-white/40 uppercase tracking-tight">סה"כ</span>
                    <span className="text-xl font-bold text-white leading-none">{totalCount}</span>
                  </div>
                </div>

                {/* Legend List */}
                <div className="flex-1 w-full grid grid-cols-2 gap-x-4 gap-y-3 mt-4 md:mt-0">
                  {slices.map((slice, i) => (
                    <div key={i} className="flex items-center gap-2 group transition-all">
                      <div 
                        className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" 
                        style={{ backgroundColor: slice.color }} 
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-bold text-white/90 truncate group-hover:text-white" title={slice.topic}>
                          {slice.topic}
                        </span>
                        <span className="text-[9px] text-white/40 font-mono">
                          {Math.round(slice.percent)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
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
