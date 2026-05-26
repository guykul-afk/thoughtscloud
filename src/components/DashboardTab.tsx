import { useAppStore } from '../store';
import { Brain, Star, Activity, TrendingUp, TrendingDown, Calendar } from 'lucide-react';


/*
// Define list of common Hebrew stop words to exclude them from the keywords extraction
const HEBREW_STOPWORDS = new Set([
  'את', 'של', 'על', 'עם', 'זה', 'כי', 'אני', 'הוא', 'היה', 'הם', 'אנחנו', 'לי', 'לו', 'לה', 'אם', 'או', 'גם',
  'לא', 'כן', 'מה', 'מי', 'כדי', 'כבר', 'שלי', 'שלנו', 'אותי', 'אותו', 'אותה', 'רק', 'כל', 'עוד', 'כמו',
  'אחרי', 'לפני', 'טוב', 'מאוד', 'יותר', 'אבל', 'אפילו', 'אז', 'שוב', 'בגלל', 'בשביל', 'דבר', 'יום', 'בית',
  'זמן', 'משהו', 'פשוט', 'רוצה', 'יכול', 'צריך', 'עושה', 'חשבתי', 'מרגיש', 'מרגישה', 'היום', 'עכשיו',
  'ככה', 'אחר', 'דברים', 'שם', 'פה', 'כמה', 'זאת', 'אלה', 'אלו', 'בין', 'תוך', 'לגבי', 'אשר', 'כך', 'היא',
  'הן', 'היית', 'הייתי', 'היינו', 'היו', 'היה', 'תהיה', 'יהיה', 'שלך', 'שלהם', 'שלהן', 'שלנו',
  'לנו', 'לכם', 'לכן', 'להם', 'להן', 'בי', 'בו', 'בה', 'בנו', 'בכם', 'בכן', 'בהם', 'בהן', 'לי', 'לך', 'לו',
  'לה', 'לנו', 'לכם', 'לכן', 'להם', 'להן', 'אלי', 'אליך', 'אליו', 'אליה', 'אלינו', 'אליכם', 'אליכן', 'אליהם', 'אליהן',
  'כלומר', 'אולי', 'אכן', 'אך', 'אבל', 'ברם', 'רק', 'אלא', 'בייחוד', 'במיוחד', 'למשל', 'כגון', 'הווי אומר',
  'היינו', 'כלומר', 'דהיינו', 'זאת אומרת', 'מפני', 'משום', 'בגלל', 'כיוון', 'הואיל', 'היות', 'מאחר', 'היות ש',
  'מאחר ש', 'היות ו', 'מפני ש', 'משום ש', 'בגלל ש', 'כיוון ש', 'הואיל ו', 'לכן', 'על כן', 'אי לכך',
  'לפיכך', 'עקב כך', 'כתוצאה מכך', 'בעקבות זאת', 'מכאן ש', 'משמע ש', 'זאת ועוד', 'יתרה מזו', 'יתר על כן',
  'בנוסף לכך', 'כמו כן', 'כמו ש', 'כשם ש', 'בדומה ל', 'בניגוד ל', 'להפך', 'אדרבה', 'מאידך', 'מאידך גיסא',
  'מצד אחד', 'מצד שני', 'לעומת זאת', 'אף על פי', 'למרות', 'אף ש', 'למרות ש', 'אף על פי ש', 'עם זאת',
  'בכל זאת', 'איך', 'כיצד', 'מתי', 'איפה', 'היכן', 'לאן', 'מאין', 'מדוע', 'למה', 'כמה', 'מי', 'מה', 'איזה',
  'איזו', 'אילו', 'באיזה', 'באיזו', 'באילו', 'למי', 'למה', 'במה', 'כמה', 'בכמה', 'מתי', 'מאז', 'עד מתי'
]);

function cleanHebrewWord(word: string): string {
  let cleaned = word.trim();
  if (cleaned.length > 3 && cleaned.startsWith('ו')) {
    cleaned = cleaned.substring(1);
  }
  if (cleaned.length > 3 && cleaned.startsWith('ה')) {
    cleaned = cleaned.substring(1);
  }
  return cleaned;
}
*/

export default function DashboardTab() {
  const { entries } = useAppStore();

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

  // 4. Top Keywords (Last 30 days) - Pie Chart Data (Only hashtags #)
  const keywordsMap: Record<string, number> = {};
  recentEntries30Days.forEach(e => {
    // Count ONLY topics/tags prefixed with '#'
    (e.topics || []).forEach(t => {
      const trimmed = t.trim();
      if (trimmed.length > 0) {
        const tag = `#${trimmed}`;
        keywordsMap[tag] = (keywordsMap[tag] || 0) + 1;
      }
    });
  });
  const topKeywords = Object.entries(keywordsMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8); // Take top 8 keywords for pie chart

  // Calculate Weekly Average and Trend
  const totalEntries = entries.length;
  let weeklyAverage = 0;
  let trend: 'up' | 'down' | 'static' = 'static';
  
  if (totalEntries > 0) {
    const timestamps = entries.map(e => e.timestamp);
    const minTimestamp = Math.min(...timestamps);
    const timespanMs = Date.now() - minTimestamp;
    const totalWeeks = Math.max(1, timespanMs / (7 * 24 * 60 * 60 * 1000));
    weeklyAverage = totalEntries / totalWeeks;
  }
  
  const lastWeekEntriesCount = entries.filter(
    e => Date.now() - e.timestamp <= 7 * 24 * 60 * 60 * 1000
  ).length;

  const diff = lastWeekEntriesCount - weeklyAverage;
  if (weeklyAverage === 0) {
    trend = 'static';
  } else if (Math.abs(diff) < 0.3) {
    trend = 'static';
  } else if (diff > 0) {
    trend = 'up';
  } else {
    trend = 'down';
  }



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

      {/* 0. Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Metric 1: Total Entries */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-6 shadow-xl relative overflow-hidden flex items-center justify-between">
          <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 blur-2xl -mr-12 -mt-12 pointer-events-none" />
          <div className="flex flex-col space-y-1">
            <span className="text-xs text-white/50">סה"כ כניסות יומן</span>
            <span className="text-3xl font-extrabold text-white font-sans">{totalEntries}</span>
            <span className="text-[10px] text-white/40">מתחילת הפעילות במערכת</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-white/80 shrink-0">
            <Calendar size={22} />
          </div>
        </div>

        {/* Metric 2: Weekly Average & Trend */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-6 shadow-xl relative overflow-hidden flex items-center justify-between">
          <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 blur-2xl -mr-12 -mt-12 pointer-events-none" />
          <div className="flex flex-col space-y-1.5">
            <span className="text-xs text-white/50">ממוצע כניסות שבועי</span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-white font-sans">
                {weeklyAverage.toFixed(1)}
              </span>
              <span className="text-xs text-white/60">כניסות לשבוע</span>
            </div>
            
            {/* Trend Badge */}
            <div className="flex items-center gap-1.5 mt-0.5">
              {trend === 'up' && (
                <div className="flex items-center gap-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-full text-[10px] font-bold">
                  <TrendingUp size={12} className="shrink-0" />
                  <span>עלייה בשבוע האחרון ({lastWeekEntriesCount} כניסות)</span>
                </div>
              )}
              {trend === 'down' && (
                <div className="flex items-center gap-1 bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2.5 py-0.5 rounded-full text-[10px] font-bold">
                  <TrendingDown size={12} className="shrink-0" />
                  <span>ירידה בשבוע האחרון ({lastWeekEntriesCount} כניסות)</span>
                </div>
              )}
              {trend === 'static' && (
                <div className="flex items-center gap-1 bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2.5 py-0.5 rounded-full text-[10px] font-bold">
                  <Activity size={12} className="shrink-0" />
                  <span>פעילות יציבה ({lastWeekEntriesCount} כניסות)</span>
                </div>
              )}
            </div>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-white/80 shrink-0">
            {trend === 'up' ? (
              <div className="text-emerald-400"><TrendingUp size={22} /></div>
            ) : trend === 'down' ? (
              <div className="text-rose-400"><TrendingDown size={22} /></div>
            ) : (
              <div className="text-blue-400"><Activity size={22} /></div>
            )}
          </div>
        </div>
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

      {/* 2. Top Keywords Section - Donut Pie Chart */}
      <section className="shrink-0 bg-white/10 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#4FC3F7]/5 blur-3xl -mr-16 -mt-16 pointer-events-none" />
        
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-sm font-bold text-white/90 flex items-center gap-2">
            <Brain size={16} className="text-[#4FC3F7]" />
            פילוג תגיות מפתח מובילות (#)
          </h3>
          <span className="text-[10px] text-white/40 uppercase tracking-widest leading-none">תדירות</span>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-8 px-2">
          {topKeywords.length === 0 ? (
             <div className="w-full h-40 flex items-center justify-center text-white/30 text-xs italic">אין מספיק תגיות לחישוב פילוג...</div>
          ) : (() => {
            const totalCount = topKeywords.reduce((sum, [, count]) => sum + count, 0);
            const colors = [
              '#4FC3F7', '#81C784', '#BA68C8', '#FF8A65',
              '#4DB6AC', '#7986CB', '#D4E157', '#FFD54F'
            ];
            
            let cumulativePercent = 0;
            const slices = topKeywords.map(([keyword, count], i) => {
              const percent = (count / totalCount) * 100;
              const startPercent = cumulativePercent;
              cumulativePercent += percent;
              return { keyword, count, percent, color: colors[i % colors.length], startPercent };
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
                    <span className="text-[10px] text-white/40 uppercase tracking-tight">סה"כ תגיות</span>
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
                        <span className="text-[10px] font-bold text-white/90 truncate group-hover:text-white" title={slice.keyword}>
                          {slice.keyword}
                        </span>
                        <span className="text-[9px] text-white/40 font-mono">
                          {slice.count} מופעים ({Math.round(slice.percent)}%)
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

    </div>
  );
}
