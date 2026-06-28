import React, { useState } from 'react';
import { Send, Bot, User } from 'lucide-react';
import { fetchFirebaseEntries, fetchFirebaseGraph } from './firebase';

export default function AskView({ dataSource, uid }) {
  const [messages, setMessages] = useState([
    { role: 'bot', text: 'שלום! שאל אותי שאלות על בסיס הידע, המושגים והיומנים שלך. למשל: "ai" או "work".' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userQuestion = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userQuestion }]);
    setLoading(true);

    try {
      if (!uid) {
        throw new Error('מזהה משתמש (UID) לא נטען. אנא המתן לחיבור לפיירבייס.');
      }
      
      // Fetch all data for client-side keyword matching
      const entries = await fetchFirebaseEntries(uid);
      const graph = await fetchFirebaseGraph(uid);
      
      const query = userQuestion.toLowerCase();
      const matches = [];
      
      graph.nodes.forEach(c => {
        if (c.name.toLowerCase().includes(query) || (c.content && c.content.toLowerCase().includes(query))) {
          matches.push({ type: 'מושג בגרף', name: c.name, snippet: (c.content || '').substring(0, 150) + '...' });
        }
      });
      
      entries.forEach(e => {
        if (e.content && e.content.toLowerCase().includes(query)) {
          matches.push({ type: 'רשומת יומן', name: e.frontmatter.date, snippet: e.content.substring(0, 150) + '...' });
        }
      });

      let reply = `חיפשתי בפיירבייס שלך אחר "${userQuestion}".\n\n`;
      if (matches.length > 0) {
        reply += `מצאתי את האזכורים הבאים:\n\n`;
        matches.forEach(m => {
          reply += `- **${m.type} (${m.name})**: ${m.snippet}\n\n`;
        });
        reply += `\n*שים לב: חיפוש זה מתבסס כרגע על התאמת מילים מקומית בבסיס הידע.*`;
      } else {
        reply += `לא מצאתי תוצאות מתאימות ביומן או בגרף המושגים למילה הזו בפיירבייס. נסה לשאול על נושא אחר כמו 'ai' או 'work'.`;
      }
      
      setMessages(prev => [...prev, { role: 'bot', text: reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'bot', text: `שגיאה: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="view-container">
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '20px' }}>
        שאלות ותשובות מול פיירבייס
      </h2>
      <div className="chat-layout">
        <div className="chat-history">
          {messages.map((msg, index) => (
            <div className={`chat-message ${msg.role}`} key={index}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', fontSize: '0.8rem', fontWeight: 600 }}>
                {msg.role === 'bot' ? (
                  <>
                    <Bot size={14} />
                    <span>עוזר ידע</span>
                  </>
                ) : (
                  <>
                    <User size={14} />
                    <span>אתה</span>
                  </>
                )}
              </div>
              <div>{msg.text}</div>
            </div>
          ))}
          {loading && (
            <div className="chat-message bot" style={{ opacity: 0.7 }}>
              מחפש במידע בפיירבייס...
            </div>
          )}
        </div>
        <form className="chat-input-area" onSubmit={handleSubmit}>
          <input
            className="chat-input"
            type="text"
            placeholder="שאל משהו..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button className="chat-submit" type="submit" disabled={loading}>
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
