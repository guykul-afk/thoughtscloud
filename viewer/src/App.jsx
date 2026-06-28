import React, { useState, useEffect } from 'react';
import FeedView from './FeedView';
import GraphView from './GraphView';
import { BookOpen, Network, Loader2 } from 'lucide-react';
import { getFirebaseUid } from './firebase';

const FIREBASE_UID_FALLBACK = 'K9j4Nx0WK7NKYJs6iDUz35LXFai1';

function App() {
  const [activeTab, setActiveTab] = useState('feed');
  const [authLoading, setAuthLoading] = useState(true);
  const dataSource = 'firebase';
  const uid = FIREBASE_UID_FALLBACK; // Query the target database where the data resides

  const [scrollToEntryId, setScrollToEntryId] = useState(null);

  useEffect(() => {
    getFirebaseUid()
      .then(() => {
        setAuthLoading(false);
      })
      .catch((err) => {
        console.error("Failed to authenticate automatically:", err);
        setAuthLoading(false);
      });
  }, []);

  const handleNavigateToEntry = (entryId) => {
    setActiveTab('feed');
    setScrollToEntryId(entryId);
  };

  const renderView = () => {
    if (authLoading) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '12px' }}>
          <Loader2 className="spin" size={32} style={{ color: 'var(--accent-color)' }} />
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>מתחבר לפיירבייס בצורה מאובטחת...</div>
        </div>
      );
    }
    const props = { dataSource, uid };
    switch (activeTab) {
      case 'feed':
        return <FeedView {...props} scrollToEntryId={scrollToEntryId} onClearScroll={() => setScrollToEntryId(null)} />;
      case 'graph':
        return <GraphView {...props} onNavigateToEntry={handleNavigateToEntry} />;
      default:
        return <FeedView {...props} />;
    }
  };

  const getHeaderTitle = () => {
    switch (activeTab) {
      case 'feed':
        return 'גלילת יומן רשומות';
      case 'graph':
        return 'גרף ידע אינטראקטיבי (Obsidian)';
      default:
        return 'צופה בסיס ידע';
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="logo-container">
          <div className="logo-icon">OKF</div>
          <span className="logo-text">Knowledge Hub</span>
        </div>

        <nav style={{ flexGrow: 1 }}>
          <ul className="nav-links">
            <li>
              <button
                className={`nav-item ${activeTab === 'feed' ? 'active' : ''}`}
                onClick={() => setActiveTab('feed')}
                style={{ background: 'none', border: 'none', width: '100%', textAlign: 'right' }}
              >
                <BookOpen className="nav-icon" style={{ marginLeft: '12px' }} />
                <span>יומן רשומות</span>
              </button>
            </li>
            <li>
              <button
                className={`nav-item ${activeTab === 'graph' ? 'active' : ''}`}
                onClick={() => setActiveTab('graph')}
                style={{ background: 'none', border: 'none', width: '100%', textAlign: 'right' }}
              >
                <Network className="nav-icon" style={{ marginLeft: '12px' }} />
                <span>גרף ידע (Obsidian)</span>
              </button>
            </li>
          </ul>
        </nav>

        {/* Database Status Panel */}
        <div style={{ 
          marginTop: 'auto', 
          padding: '16px', 
          borderTop: '1px solid var(--border-color)',
          fontSize: '0.85rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div style={{ color: 'var(--text-muted)' }}>
            מקור מידע: <span style={{ color: '#3182ce', fontWeight: 600 }}>ענן Firebase</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            מזהה: {uid}
          </div>
        </div>
      </aside>

      {/* Main Content Pane */}
      <main className="main-content">
        <header className="header">
          <h1 className="header-title">{getHeaderTitle()}</h1>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            מצב מקור: <span style={{ color: '#3182ce', fontWeight: 600 }}>מחובר לפיירבייס</span>
          </div>
        </header>
        {renderView()}
      </main>
    </div>
  );
}

export default App;
