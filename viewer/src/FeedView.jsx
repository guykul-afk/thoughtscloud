import React, { useEffect, useState, useMemo } from 'react';
import { Calendar, Tag, RefreshCw, Search } from 'lucide-react';
import { fetchFirebaseEntries } from './firebase';

export default function FeedView({ dataSource, uid, scrollToEntryId, onClearScroll }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!loading && scrollToEntryId && entries.length > 0) {
      const element = document.getElementById(`entry-${scrollToEntryId}`);
      if (element) {
        setTimeout(() => {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.style.boxShadow = '0 0 0 3px var(--accent-color)';
          element.style.borderColor = 'var(--accent-color)';
          setTimeout(() => {
            element.style.boxShadow = '';
            element.style.borderColor = '';
          }, 3000);
          if (onClearScroll) onClearScroll();
        }, 300);
      }
    }
  }, [loading, scrollToEntryId, entries]);

  const fetchEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!uid) {
        throw new Error('חיבור לפיירבייס לא אותחל עדיין. אנא המתן...');
      }
      const data = await fetchFirebaseEntries(uid);
      setEntries(data);
    } catch (err) {
      setError(err.message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (uid) {
      fetchEntries();
    }
  }, [uid]);

  // Client-side filtering by name, mood, hashtag, or keyword
  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const query = searchQuery.toLowerCase().trim();
    
    return entries.filter(entry => {
      // 1. Text search in content
      const contentMatch = (entry.content || '').toLowerCase().includes(query);
      
      // 2. Search in topics (tags)
      const topicsMatch = entry.frontmatter.topics && 
        entry.frontmatter.topics.some(topic => topic.toLowerCase().includes(query));
        
      // 3. Search in mood
      const moodMatch = entry.frontmatter.mood && 
        entry.frontmatter.mood.toLowerCase().includes(query);
        
      // 4. Search in triples (subject, relation, object - matching names or concepts)
      const triplesMatch = entry.frontmatter.triples && 
        entry.frontmatter.triples.some(t => {
          const s = (t.subject || t.s || '').toLowerCase();
          const o = (t.object || t.o || '').toLowerCase();
          const r = (t.relation || t.r || '').toLowerCase();
          return s.includes(query) || o.includes(query) || r.includes(query);
        });
        
      return contentMatch || topicsMatch || moodMatch || triplesMatch;
    });
  }, [entries, searchQuery]);

  return (
    <div className="view-container">
      <div className="feed-layout">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>
            רשומות מיומן הידע בפיירבייס ({filteredEntries.length})
          </h2>
          <button 
            onClick={fetchEntries}
            style={{ 
              background: 'none', 
              border: '1px solid var(--border-color)', 
              borderRadius: 'var(--radius-sm)', 
              padding: '6px 12px', 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.9rem',
              color: 'var(--text-secondary)'
            }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            רענן
          </button>
        </div>

        {/* Real-time search/filter input at the top of the feed */}
        <div style={{ position: 'relative', marginBottom: '20px' }}>
          <input
            type="text"
            placeholder="חפש לפי שם, רגש, מילה או # נושא..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 42px 12px 16px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              fontFamily: 'var(--font-sans)',
              fontSize: '1rem',
              outline: 'none',
              boxShadow: 'var(--shadow-sm)',
              boxSizing: 'border-box',
              textAlign: 'right'
            }}
          />
          <Search size={18} style={{ position: 'absolute', right: '14px', top: '14px', color: 'var(--text-muted)' }} />
        </div>

        {loading && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>טוען רשומות...</div>}
        {error && (
          <div style={{ 
            textAlign: 'center', 
            padding: '24px', 
            color: '#c53030', 
            backgroundColor: '#fff5f5', 
            borderRadius: 'var(--radius-md)',
            border: '1px solid #fed7d7'
          }}>
            {error}
          </div>
        )}
        
        {!loading && !error && filteredEntries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            לא נמצאו רשומות יומן המתאימות לסינון זה.
          </div>
        )}

        {!loading && !error && filteredEntries.map((entry) => (
          <div className="feed-card" id={`entry-${entry.id}`} key={entry.id} style={{ transition: 'all 0.5s ease' }}>
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={18} style={{ color: 'var(--accent-color)' }} />
                <span className="card-date">{entry.frontmatter.date}</span>
              </div>
              <div className="card-topics">
                {entry.frontmatter.topics && entry.frontmatter.topics.map((topic, i) => (
                  <span className="topic-badge" key={i}>
                    <Tag size={10} style={{ marginLeft: '4px' }} />
                    {topic}
                  </span>
                ))}
              </div>
            </div>
            <div className="card-body">
              {entry.content}
            </div>
            {entry.frontmatter.open_threads && entry.frontmatter.open_threads.length > 0 && (
              <div className="card-threads">
                <div className="threads-title">נושאים פתוחים / משימות:</div>
                <ul className="threads-list">
                  {entry.frontmatter.open_threads.map((thread, i) => (
                    <li key={i}>- {thread}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
