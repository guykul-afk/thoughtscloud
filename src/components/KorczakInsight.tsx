import React, { useState } from 'react';
import { ChevronDown, ChevronUp, History, Loader2, Sparkles } from 'lucide-react';
import { useAppStore } from '../store';
import { generateKorczakAnalysis } from '../services/ai';
import SpeechButton from './SpeechButton';

// Shared SpeechButton imported above

const KORCZAK_TEXT = `
קח לך זמן לעבודה – זה המחיר להצלחתך
קח לך זמן לחשיבה – זה מחיר הכוח שלך
קח לך זמן למשחקים – זה סוד הנעורים שלך
קח לך זמן לקריאה – זה בסיס הידע שלך
קח לך זמן לשלווה – זה מסייע לך לשטוף את האבק מעיניך
קח לך זמן לחברות ולידידים – זהו מעיין האושר שלך
קח לך זמן לאחוות האדם – זה יבטיח לך את התרומות לזולתך
קח לך זמן לצחוק ולשובבות – זה יקל עליך את מעמסת החיים
קח לך זמן לחלומות – זה ימשוך את נפשך אלי הכוכבים
קח לך זמן לתכנון
ואז תהיה לך אפשרות לבצע את כל האחרים.
`;

export default function KorczakInsight() {
    const { korczakAnalysis, entries, apiKey, setKorczakAnalysis } = useAppStore();
    const [isExpanded, setIsExpanded] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const handleRefresh = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!apiKey || isRefreshing) return;
        setIsRefreshing(true);
        try {
            const insight = await generateKorczakAnalysis(entries, apiKey);
            setKorczakAnalysis({ insight, lastDate: new Date().toLocaleDateString('en-CA') });
        } catch (error) {
            console.error("Korczak Refresh Error:", error);
        } finally {
            setIsRefreshing(false);
        }
    };

    if (!korczakAnalysis?.insight && entries.length === 0) return null;

    return (
        <div className="bg-gradient-to-br from-[#4A90E2]/20 to-[#0D3B66]/40 backdrop-blur-xl border border-white/10 rounded-[2rem] overflow-hidden shadow-xl transition-all">
            <div 
                role="button"
                tabIndex={0}
                onClick={() => setIsExpanded(!isExpanded)}
                onKeyDown={(e) => e.key === 'Enter' && setIsExpanded(!isExpanded)}
                className="w-full p-5 flex items-center justify-between hover:bg-white/5 transition-colors group cursor-pointer"
            >
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#4A90E2] rounded-2xl flex items-center justify-center text-white group-hover:scale-110 transition-transform shadow-lg">
                        <Sparkles size={20} />
                    </div>
                    <div className="text-right">
                        <span className="block font-bold text-white/90 text-sm">זמן לעשרה עניינים</span>
                        <span className="block text-[10px] text-blue-300/60 uppercase tracking-widest mt-0.5">ניתוח לפי יאנוש קורצ'ק</span>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={handleRefresh}
                        disabled={isRefreshing || !apiKey}
                        className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/30 hover:text-white transition-all"
                    >
                        {isRefreshing ? <Loader2 size={16} className="animate-spin" /> : <History size={16} />}
                    </button>
                    <div className="text-white/30">
                        {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                </div>
            </div>

            {isExpanded && (
                <div className="p-5 pt-0 animate-in fade-in slide-in-from-top-2">
                    <div className="max-h-[400px] overflow-y-auto custom-scrollbar space-y-4 pr-1">
                        {/* The Original Text Section */}
                        <div className="bg-white/5 rounded-2xl p-4 border border-white/10 italic">
                            <div className="text-[11px] text-white/70 leading-relaxed text-center space-y-1">
                                {KORCZAK_TEXT.trim().split('\n').map((line, i) => (
                                    <p key={i}>{line}</p>
                                ))}
                            </div>
                            <div className="mt-2 flex justify-center">
                                <SpeechButton text={KORCZAK_TEXT} className="w-6 h-6" />
                            </div>
                        </div>

                        <div className="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-4">
                            {korczakAnalysis?.insight ? (
                                <>
                                    <div className="text-sm text-white/90 leading-relaxed space-y-3">
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-1.5 h-1.5 bg-[#4A90E2] rounded-full" />
                                            <h4 className="text-[10px] font-bold text-[#4A90E2] uppercase tracking-[0.2em]">ניתוח התנהלות שבועי ועצות לשיפור</h4>
                                        </div>
                                        {korczakAnalysis.insight.split('\n').map((line, i) => {
                                            const trimmed = line.trim();
                                            if (!trimmed) return null;
                                            const isBullet = trimmed.startsWith('*') || trimmed.startsWith('-') || /^\d+\./.test(trimmed);
                                            return (
                                                <p key={i} className={isBullet ? "pr-4 relative before:content-['•'] before:absolute before:right-0 before:text-[#4A90E2]" : ""}>
                                                    {trimmed.replace(/^(\*|-|\d+\.)\s*/, '')}
                                                </p>
                                            );
                                        })}
                                    </div>
                                    <div className="mt-3 pt-3 border-t border-white/5 flex justify-between items-center">
                                        <span className="text-[10px] text-white/20 uppercase tracking-widest">
                                            עדכון אחרון: {korczakAnalysis.lastDate ? new Date(korczakAnalysis.lastDate).toLocaleDateString('he-IL') : 'מעולם לא'}
                                        </span>
                                        <SpeechButton text={korczakAnalysis.insight} />
                                    </div>
                                </>
                            ) : (
                                <div className="py-8 flex flex-col items-center justify-center text-center space-y-3">
                                    <History size={32} className="text-white/10" />
                                    <p className="text-xs text-white/40 italic">לחץ על כפתור הרענון כדי לבצע ניתוח ראשון לפי עשרת העניינים של קורצ'ק.</p>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    <div className="mt-4 p-4 bg-white/5 rounded-2xl border border-white/5">
                        <p className="text-[10px] text-white/40 leading-relaxed italic text-center">
                            "קח לך זמן לתכנון – ואז תהיה לך אפשרות לבצע את כל האחרים."
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
