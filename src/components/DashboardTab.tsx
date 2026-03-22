import { useState } from 'react';
import { useAppStore } from '../store';
import { cn } from '../App';
import { Brain, Star, TrendingUp, Notebook, Activity, ChevronDown, ChevronUp } from 'lucide-react';
import SpeechButton from './SpeechButton';

const KORCZAK_MATTERS = [
  { id: 'work', label: 'עבודה', keywords: ['עבודה', 'קריירה', 'לקוח', 'פרויקט', 'משימה', 'ביצוע', 'הספק', 'תעסוקה'] },
  { id: 'thinking', label: 'חשיבה', keywords: ['חשיבה', 'מחשבה', 'ניתוח', 'תובנה', 'רעיון', 'הרהור', 'הבנה', 'לימוד'] },
  { id: 'play', label: 'משחקים', keywords: ['משחק', 'תחביב', 'הנאה', 'כיף', 'פנאי', 'יצירה', 'אמנות'] },
  { id: 'reading', label: 'קריאה', keywords: ['קריאה', 'לפרט', 'ספר', 'ידע', 'מאמר', 'כתבה', 'למידה'] },
  { id: 'calm', label: 'שלווה', keywords: ['שלווה', 'רוגע', 'מנוחה', 'שקט', 'נשימה', 'שנ"צ', 'שינה', 'הרפיה', 'מדיטציה'] },
  { id: 'friendship', label: 'חברות', keywords: ['חבר', 'ידיד', 'חברה', 'קשרים', 'בילוי', 'שיחה', 'מפגש', 'זוגיות'] },
  { id: 'community', label: 'אחוות האדם', keywords: ['אדם', 'זולת', 'נתינה', 'תרומה', 'עזרה', 'קהילה', 'התנדבות', 'אמפתיה'] },
  { id: 'laughter', label: 'צחוק ושובבות', keywords: ['צחוק', 'שובבות', 'הומור', 'חיוך', 'בדיחה', 'שמחה', 'קלילות'] },
  { id: 'dreams', label: 'חלומות', keywords: ['חלום', 'שאיפה', 'חזון', 'מטרה', 'עתיד', 'תקווה', 'תוכנית לעתיד'] },
  { id: 'planning', label: 'תכנון', keywords: ['תכנון', 'לוז', 'ניהול זמן', 'סדר', 'ארגון', 'רשימה', 'לוח זמנים'] }
];

export default function DashboardTab() {
  const { entries, operatingManual } = useAppStore();
  const [isKorczakExpanded, setIsKorczakExpanded] = useState(false);
  const [isManualExpanded, setIsManualExpanded] = useState(false);

  // 1. Filter entries to last 30 days
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentEntries30Days = entries.filter(e => e.timestamp >= thirtyDaysAgo);

  // Mood mapping for Line Chart
  const getMoodValue = (mood: string) => {
    const m = mood.toLowerCase();
    if (m.includes('שמח') || m.includes('טוב') || m.includes('חיובי') || m.includes('התרגשות') || m.includes('מעולה')) return 3;
    if (m.includes('עצוב') || m.includes('רע') || m.includes('כעס') || m.includes('תסכול') || m.includes('קשה')) return 1;
    return 2; // Neutral/Mixed
  };

  const getMoodColor = (val: number) => {
    if (val === 3) return '#10b981'; // emerald-500
    if (val === 1) return '#f43f5e'; // rose-500
    return '#FFD54F'; // amber-400
  };

  const chartEntries = [...recentEntries30Days]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10)
    .reverse();

  // SVG dimensions
  const width = 340;
  const height = 100;
  const padding = 20;

  // Generate SVG Path for Mood Trend
  const points = chartEntries.map((e, i) => {
    const x = padding + (i * (width - 2 * padding)) / Math.max(chartEntries.length - 1, 1);
    const val = getMoodValue(e.mood);
    const y = height - padding - (val - 1) * (height - 2 * padding) / 2;
    return { x, y, value: val, mood: e.mood, date: new Date(e.timestamp).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }) };
  });

  const pathD = points.length > 1 
    ? `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')
    : '';

  const areaD = points.length > 1
    ? `${pathD} L ${points[points.length-1].x} ${height} L ${points[0].x} ${height} Z`
    : '';

  // 2. Deep Korczak Analysis based on last 30 days text
  const korczakData = KORCZAK_MATTERS.map(matter => {
    let focusScore = 0;
    recentEntries30Days.forEach(e => {
      const fullText = `${e.transcript} ${e.topics.join(' ')} ${(e as any).insights?.join(' ') || ''}`.toLowerCase();
      matter.keywords.forEach(kw => {
        // Count occurrences roughly
        const matches = fullText.match(new RegExp(kw, 'g'));
        if (matches) focusScore += matches.length;
      });
    });
    
    // Determine red/green based on focus score
    // Minimum 1 occurrence to be considered "addressed" (green). 0 is neglected (red).
    const isEmphasized = focusScore > 0;
    
    // Calculate a display percentage (cap at 100). Higher focus = higher bar length.
    // Assuming 5 mentions in 30 days is a solid baseline for 100%
    const barPercentage = Math.min(100, Math.max(15, (focusScore / 5) * 100));

    return { ...matter, focusScore, isEmphasized, barPercentage };
  });

  // Sort logically: Emphasized at top, neglected at bottom, or leave in original Korczak order.
  // We will keep original order but styling will clearly differentiate.

  // 3. Top Topics (Last 30 days) - Bar Chart Data
  const topicsMap: Record<string, number> = {};
  recentEntries30Days.forEach(e => e.topics.forEach(t => { topicsMap[t] = (topicsMap[t] || 0) + 1; }));
  const topTopics = Object.entries(topicsMap).sort((a, b) => b[1] - a[1]).slice(0, 5); // Take top 5 for bar chart
  const maxTopicCount = topTopics.length > 0 ? topTopics[0][1] : 1;

  return (
    <div className="w-full h-full flex flex-col space-y-6 pb-24 overflow-y-auto custom-scrollbar pr-1" dir="rtl">
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

      {/* 2. Mood & Emotional Balance Line Graph */}
      <section className="shrink-0 bg-white/10 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-6 shadow-xl relative overflow-hidden">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-sm font-bold text-white/90 flex items-center gap-2">
            <TrendingUp size={16} className="text-[#FFD54F]" />
            מאזן רגשי ומגמות
          </h3>
        </div>

        <div className="relative h-32 w-full">
          {chartEntries.length < 2 ? (
            <div className="h-full flex items-center justify-center text-white/30 text-xs italic">צריך עוד נתונים לגרף רציף מחודש זה...</div>
          ) : (
            <>
              <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
                <defs>
                  <linearGradient id="moodGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#FFD54F" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#FFD54F" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={areaD} fill="url(#moodGradient)" />
                <path d={pathD} fill="none" stroke="#FFD54F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-[0_0_8px_rgba(255,213,79,0.5)]" />
                
                {points.map((p, i) => (
                  <g key={i} className="group cursor-pointer">
                    <circle cx={p.x} cy={p.y} r="4" fill={getMoodColor(p.value)} className="transition-all group-hover:r-6" />
                  </g>
                ))}
              </svg>
              
              <div className="flex justify-between mt-2 px-2">
                 {points.filter((_, i) => i % 3 === 0 || i === points.length - 1).map((p, i) => (
                   <span key={i} className="text-[8px] text-white/30 font-mono">{p.date}</span>
                 ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* 3. Deep Korczak Analysis (Green/Red) */}
      <section className="shrink-0 bg-white/10 backdrop-blur-xl border border-white/10 rounded-[2.5rem] overflow-hidden shadow-xl transition-all">
        <button 
          onClick={() => setIsKorczakExpanded(!isKorczakExpanded)}
          className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#4A90E2]/20 flex items-center justify-center text-[#4A90E2]">
              <Brain size={22} />
            </div>
            <div className="text-right">
              <span className="block font-bold text-white/90 text-sm">זמן לעשרה עניינים (קורצ'ק)</span>
              <span className="block text-[10px] text-blue-300/40 uppercase mt-0.5">ניתוח דגשים חודשיים</span>
            </div>
          </div>
          <div className="text-white/30">
            {isKorczakExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        </button>

        {isKorczakExpanded && (
          <div className="px-6 pb-8 pt-2 animate-in fade-in slide-in-from-top-2">
            <div className="mb-6 flex items-center justify-center gap-6 text-[10px] uppercase tracking-widest border-b border-white/5 pb-4">
               <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                  <span className="text-emerald-400/80">ניתן דגש או תועד</span>
               </div>
               <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                  <span className="text-rose-500/80">דרוש התייחסות</span>
               </div>
            </div>

            <div className="grid grid-cols-1 gap-y-5">
              {korczakData.map((item) => (
                <div key={item.id} className="space-y-2 group">
                  <div className="flex justify-between items-end px-1">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-[12px] font-bold transition-colors",
                        item.isEmphasized ? "text-emerald-400" : "text-rose-500"
                      )}>
                        {item.label}
                      </span>
                    </div>
                    {item.isEmphasized ? (
                      <span className="text-[9px] font-mono text-emerald-400/50">+{item.focusScore} אזכורים</span>
                    ) : (
                      <span className="text-[9px] font-mono text-rose-500/50">אין תיעוד</span>
                    )}
                  </div>
                  <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className={cn(
                        "h-full rounded-full transition-all duration-1000 ease-out",
                        item.isEmphasized ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.3)]" : "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.3)]"
                      )}
                      style={{ width: item.isEmphasized ? `${item.barPercentage}%` : '5%' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 4. Integrated Operating Manual */}
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
    </div>
  );
}
