import { useState } from 'react';
import { History as HistoryIcon, Pencil, Trash2 } from 'lucide-react';
import { useAppStore } from '../store';
import SpeechButton from './SpeechButton';

export default function HistoryTab() {
  const { entries, removeEntry, updateEntry, loadInitialState, syncStatus } = useAppStore();
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
        <button
          onClick={() => loadInitialState(true)}
          disabled={syncStatus === 'saving'}
          className="bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white border border-white/15 px-3.5 py-2 rounded-2xl text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
        >
          {syncStatus === 'saving' ? 'מסתנכרן...' : 'משוך את כל הרשומות 🔄'}
        </button>
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
              {entry.topics && entry.topics.length > 0 && (
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
