import React, { useEffect, useState, useRef, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Info, Search, Filter, Hash, Heart } from 'lucide-react';
import { fetchFirebaseGraph, fetchFirebaseEntries } from './firebase';
import { forceCollide } from 'd3-force';

export default function GraphView({ dataSource, uid, onNavigateToEntry }) {
  const [rawGraphData, setRawGraphData] = useState({ nodes: [], links: [] });
  const [entries, setEntries] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTopics, setSelectedTopics] = useState([]);
  const [selectedMoods, setSelectedMoods] = useState([]);
  const [minWeight, setMinWeight] = useState(1);
  const [visibleTypes, setVisibleTypes] = useState(['Concept', 'Person', 'Topic', 'Emotion']);

  const containerRef = useRef(null);
  const fgRef = useRef();
  const [dimensions, setDimensions] = useState({ width: 600, height: 600 });

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!uid) {
        throw new Error('אנא הגדר מזהה משתמש (UID) כדי להתחבר לפיירבייס.');
      }
      const [graphData, entriesData] = await Promise.all([
        fetchFirebaseGraph(uid),
        fetchFirebaseEntries(uid)
      ]);
      
      setRawGraphData(graphData);
      setEntries(entriesData);
    } catch (err) {
      setError(err.message);
      setRawGraphData({ nodes: [], links: [] });
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [dataSource, uid]);

  // Handle resizing of the graph canvas
  useEffect(() => {
    if (containerRef.current) {
      setDimensions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight
      });
      
      const handleResize = () => {
        if (containerRef.current) {
          setDimensions({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight
          });
        }
      };
      
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, [loading]);

  // Extract unique topics and moods for filter options
  const uniqueTopics = useMemo(() => {
    const topics = new Set();
    entries.forEach(e => {
      if (e.frontmatter.topics) {
        e.frontmatter.topics.forEach(t => topics.add(t));
      }
    });
    return Array.from(topics);
  }, [entries]);

  const uniqueMoods = useMemo(() => {
    const moods = new Set();
    entries.forEach(e => {
      if (e.frontmatter.mood) moods.add(e.frontmatter.mood);
    });
    return Array.from(moods);
  }, [entries]);

  // Dynamic helper to identify node types
  const getNodeType = (node) => {
    const type = (node.type || '').toLowerCase();
    if (type === 'person' || type === 'people' || type === 'name' || node.id.match(/^[A-Z][a-z]+ [A-Z][a-z]+$/)) return 'Person';
    if (type === 'emotion' || type === 'mood' || type === 'feeling') return 'Emotion';
    if (type === 'topic' || type === 'hashtag') return 'Topic';
    
    // Check if node is listed in entry topics or moods
    if (uniqueTopics.some(t => t.toLowerCase() === node.id.toLowerCase())) return 'Topic';
    if (uniqueMoods.some(m => m.toLowerCase() === node.id.toLowerCase())) return 'Emotion';
    
    return 'Concept';
  };

  // Map concepts to their associated entry topics, moods, and entries list
  const conceptMetadataMap = useMemo(() => {
    const map = {};
    
    rawGraphData.nodes.forEach(node => {
      map[node.id.toLowerCase()] = {
        topics: new Set(),
        moods: new Set(),
        entries: []
      };
    });

    entries.forEach(entry => {
      const entryText = (entry.content || '').toLowerCase();
      const entryTopics = entry.frontmatter.topics || [];
      const entryMood = entry.frontmatter.mood || 'ניטרלי';

      rawGraphData.nodes.forEach(node => {
        const nodeIdLower = node.id.toLowerCase();
        const nodeNameLower = node.name.toLowerCase();
        
        const isMentioned = entryText.includes(nodeNameLower) || 
                            entryText.includes(nodeIdLower);

        if (isMentioned) {
          entryTopics.forEach(t => map[nodeIdLower]?.topics.add(t));
          map[nodeIdLower]?.moods.add(entryMood);
          if (!map[nodeIdLower]?.entries.some(e => e.id === entry.id)) {
            map[nodeIdLower]?.entries.push({ id: entry.id, date: entry.frontmatter.date });
          }
        }
      });
    });

    return map;
  }, [rawGraphData.nodes, entries]);

  // Apply filters to graph data
  const filteredGraphData = useMemo(() => {
    // 1. Filter nodes
    const filteredNodes = rawGraphData.nodes.filter(node => {
      const type = getNodeType(node);
      
      // Node Type Filter
      if (!visibleTypes.includes(type)) return false;

      const nodeIdLower = node.id.toLowerCase();
      const metadata = conceptMetadataMap[nodeIdLower] || { topics: new Set(), moods: new Set() };

      // Free Search Filter (name or content)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesSearch = node.name.toLowerCase().includes(query) || 
                              (node.content && node.content.toLowerCase().includes(query));
        if (!matchesSearch) return false;
      }

      // Weight Filter
      if (node.weight < minWeight) return false;

      // Topics Filter
      if (selectedTopics.length > 0) {
        const hasMatchingTopic = selectedTopics.some(t => metadata.topics.has(t));
        if (!hasMatchingTopic) return false;
      }

      // Moods Filter
      if (selectedMoods.length > 0) {
        const hasMatchingMood = selectedMoods.some(m => metadata.moods.has(m));
        if (!hasMatchingMood) return false;
      }

      return true;
    });

    const activeNodeIds = new Set(filteredNodes.map(n => n.id));

    // 2. Filter links (keep only links between active nodes)
    const filteredLinks = rawGraphData.links.filter(link => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      return activeNodeIds.has(sourceId) && activeNodeIds.has(targetId);
    });

    return {
      nodes: filteredNodes,
      links: filteredLinks
    };
  }, [rawGraphData, searchQuery, selectedTopics, selectedMoods, minWeight, visibleTypes, conceptMetadataMap]);

  // Helper to calculate node radius based on weight with high variance
  const getNodeRadius = (node) => {
    const isGuy = node.id === 'גיא' || node.name === 'גיא' || node.id === 'guy';
    if (isGuy) return 5;
    const weight = node.weight || 1;
    // Steeper linear growth for high visual variance (weight 1 -> r=4, weight 10 -> r=40)
    return Math.max(4, weight * 4);
  };

  // Setup force simulation with collision detection
  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force('charge').strength(-120);
      fgRef.current.d3Force('link').distance(65);
      // Dynamic collision detection to match the new size variance
      fgRef.current.d3Force('collision', forceCollide(node => getNodeRadius(node) + 12));
    }
  }, [filteredGraphData]);

  const handleNodeClick = (node) => {
    const nodeIdLower = node.id.toLowerCase();
    const meta = conceptMetadataMap[nodeIdLower] || { topics: new Set(), moods: new Set(), entries: [] };
    
    setSelectedNode({
      ...node,
      type: getNodeType(node),
      associatedTopics: Array.from(meta.topics),
      associatedMoods: Array.from(meta.moods),
      associatedEntries: meta.entries || []
    });
  };

  const toggleTopic = (topic) => {
    setSelectedTopics(prev => 
      prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic]
    );
  };

  const toggleMood = (mood) => {
    setSelectedMoods(prev => 
      prev.includes(mood) ? prev.filter(m => m !== mood) : [...prev, mood]
    );
  };

  const toggleTypeVisibility = (type) => {
    setVisibleTypes(prev => 
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  // Node Color scheme helper
  const getNodeColor = (node, isSelected) => {
    if (isSelected) return '#ff6b6b';
    const type = getNodeType(node);
    switch (type) {
      case 'Person': return '#48bb78';  // Green
      case 'Topic': return '#9f7aea';   // Purple
      case 'Emotion': return '#ed64a6'; // Pink
      default: return '#3182ce';        // Blue (Concept)
    }
  };

  return (
    <div className="graph-container">
      {/* Sidebar Controls & Inspector */}
      <div className="graph-sidebar">
        {/* Filters Panel */}
        <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              <Filter size={16} />
              סינון גרף הידע
            </h3>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedTopics([]);
                setSelectedMoods([]);
                setMinWeight(1);
                setVisibleTypes(['Concept', 'Person', 'Topic', 'Emotion']);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-color)',
                fontSize: '0.8rem',
                cursor: 'pointer',
                fontWeight: 500,
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)'
              }}
            >
              אפס סינונים
            </button>
          </div>

          {/* Search bar */}
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="חפש מושג בגרף..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 32px 8px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                fontFamily: 'var(--font-sans)',
                fontSize: '0.85rem',
                outline: 'none'
              }}
            />
            <Search size={14} style={{ position: 'absolute', right: '10px', top: '10px', color: 'var(--text-muted)' }} />
          </div>

          {/* Type filters */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>הצג סוגי מידע:</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {[
                { type: 'Concept', label: 'מושגים', color: '#3182ce' },
                { type: 'Person', label: 'שמות/אנשים', color: '#48bb78' },
                { type: 'Topic', label: 'נושאים/תגיות', color: '#9f7aea' },
                { type: 'Emotion', label: 'רגשות', color: '#ed64a6' }
              ].map(item => {
                const checked = visibleTypes.includes(item.type);
                return (
                  <button
                    key={item.type}
                    onClick={() => toggleTypeVisibility(item.type)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '5px 8px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid',
                      borderColor: checked ? item.color : 'var(--border-color)',
                      background: checked ? `${item.color}15` : 'transparent',
                      color: checked ? item.color : 'var(--text-secondary)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      fontWeight: checked ? 600 : 400,
                      textAlign: 'right'
                    }}
                  >
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: item.color }} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Weight Filter Slider */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
              <span>חשיבות מושג מינימלית:</span>
              <strong>{minWeight.toFixed(1)}</strong>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="0.1"
              value={minWeight}
              onChange={(e) => setMinWeight(parseFloat(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          {/* Topics Filter List */}
          {uniqueTopics.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
                <span>#</span>
                נושאים (Topics):
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '90px', overflowY: 'auto' }}>
                {uniqueTopics.map((topic, i) => {
                  const isSelected = selectedTopics.includes(topic);
                  return (
                    <button
                      key={i}
                      onClick={() => toggleTopic(topic)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '12px',
                        border: '1px solid',
                        borderColor: isSelected ? 'var(--accent-color)' : 'var(--border-color)',
                        backgroundColor: isSelected ? 'var(--accent-light)' : 'transparent',
                        color: isSelected ? 'var(--accent-color)' : 'var(--text-secondary)',
                        fontSize: '0.7rem',
                        cursor: 'pointer',
                        fontWeight: isSelected ? 600 : 400
                      }}
                    >
                      {topic}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Moods Filter List */}
          {uniqueMoods.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
                <span>♥</span>
                רגשות (Moods):
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {uniqueMoods.map((mood, i) => {
                  const isSelected = selectedMoods.includes(mood);
                  return (
                    <button
                      key={i}
                      onClick={() => toggleMood(mood)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '12px',
                        border: '1px solid',
                        borderColor: isSelected ? '#b83280' : 'var(--border-color)',
                        backgroundColor: isSelected ? '#fbb6ce' : 'transparent',
                        color: isSelected ? '#97266d' : 'var(--text-secondary)',
                        fontSize: '0.7rem',
                        cursor: 'pointer',
                        fontWeight: isSelected ? 600 : 400
                      }}
                    >
                      {mood}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Selected Node Details */}
        {selectedNode ? (
          <div className="concept-details">
            <div className="concept-header">
              <span className="concept-badge" style={{ backgroundColor: getNodeColor(selectedNode, false), color: '#ffffff' }}>
                {selectedNode.type}
              </span>
              <h3 className="concept-title">{selectedNode.name}</h3>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                חשיבות/משקל: {selectedNode.weight}
              </div>
            </div>
            
            <div className="concept-body" style={{ maxHeight: '140px', overflowY: 'auto', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              {selectedNode.content ? (
                selectedNode.content
              ) : (
                <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>רשומה ריקה או לא נוצרה עדיין</span>
              )}
            </div>

            {/* Link to related journal entries */}
            {selectedNode.associatedEntries && selectedNode.associatedEntries.length > 0 && (
              <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
                <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>רשומות יומן קשורות:</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '100px', overflowY: 'auto' }}>
                  {selectedNode.associatedEntries.map((e, i) => (
                    <button
                      key={i}
                      onClick={() => onNavigateToEntry && onNavigateToEntry(e.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-color)',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        textAlign: 'right',
                        padding: 0,
                        fontWeight: 500,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        width: 'fit-content'
                      }}
                    >
                      <span>📄</span>
                      <span style={{ textDecoration: 'underline' }}>כניסת יומן מתאריך: {e.date}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Display matched metadata from indexing */}
            {selectedNode.associatedTopics && selectedNode.associatedTopics.length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>נושאים מקושרים:</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {selectedNode.associatedTopics.map((t, i) => (
                    <span key={i} className="topic-badge" style={{ fontSize: '0.65rem' }}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Outgoing relationships list */}
            <div>
              <h4 style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '4px', color: 'var(--text-secondary)' }}>קשרים בגרף:</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '80px', overflowY: 'auto' }}>
                {filteredGraphData.links
                  .filter(link => {
                    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                    return sourceId === selectedNode.id;
                  })
                  .map((link, i) => {
                    const targetName = typeof link.target === 'object' ? link.target.id : link.target;
                    return (
                      <div key={i} style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        ← <strong>{link.label}</strong> את <span style={{ color: 'var(--accent-color)', fontWeight: 500 }}>[[{targetName}]]</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        ) : (
          <div className="graph-instructions">
            <Info size={28} style={{ color: 'var(--text-muted)', marginBottom: '10px' }} />
            <p style={{ fontSize: '0.8rem' }}>לחץ על צומת (Node) בגרף כדי לראות את המושגים, הקשרים והתוכן שלו.</p>
          </div>
        )}
      </div>

      {/* Main graph canvas */}
      <div className="graph-canvas-wrapper" ref={containerRef}>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', fontSize: '0.9rem', color: 'var(--text-muted)' }}>טוען גרף ידע...</div>}
        {error && (
          <div style={{ 
            color: '#c53030', 
            padding: '20px',
            backgroundColor: '#fff5f5',
            borderRadius: 'var(--radius-md)',
            border: '1px solid #fed7d7',
            margin: '20px',
            fontSize: '0.85rem'
          }}>
            שגיאה בטעינת הגרף: {error}
          </div>
        )}
        
        {!loading && !error && (
          <ForceGraph2D
            ref={fgRef}
            graphData={filteredGraphData}
            width={dimensions.width}
            height={dimensions.height}
            nodeLabel="name"
            nodeColor={node => getNodeColor(node, selectedNode && node.id === selectedNode.id)}
            nodeVal={node => getNodeRadius(node)}
            onNodeClick={handleNodeClick}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            linkWidth={1.5}
            linkColor={() => 'rgba(203, 213, 224, 0.7)'}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const label = node.name;
              const r = getNodeRadius(node);
              const isSelected = selectedNode && node.id === selectedNode.id;
              
              // 1. Draw node circle
              ctx.beginPath();
              ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
              ctx.fillStyle = getNodeColor(node, isSelected);
              ctx.fill();
              
              // Border ring
              ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.9)';
              ctx.lineWidth = isSelected ? 2 / globalScale : 1 / globalScale;
              ctx.stroke();

              // Shadow effect for premium feel
              ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
              ctx.shadowBlur = 4;
              ctx.shadowOffsetX = 0;
              ctx.shadowOffsetY = 2;
              
              // 2. Draw text label if zoomed in enough or if it is the selected node
              if (globalScale > 1.2 || isSelected || (node.weight && node.weight > 3)) {
                const fontSize = 10 / globalScale;
                ctx.font = `${fontSize}px var(--font-sans)`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                // Measure text
                const textWidth = ctx.measureText(label).width;
                const padX = 4 / globalScale;
                const padY = 2 / globalScale;
                const textY = node.y + r + 8 / globalScale;
                
                // Text background pill
                ctx.beginPath();
                ctx.roundRect(
                  node.x - textWidth/2 - padX, 
                  textY - fontSize/2 - padY, 
                  textWidth + padX*2, 
                  fontSize + padY*2, 
                  4 / globalScale
                );
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(226, 232, 240, 0.9)';
                ctx.lineWidth = 0.5 / globalScale;
                ctx.stroke();
                
                // Draw text
                ctx.fillStyle = '#2d3748';
                ctx.fillText(label, node.x, textY);
              }
              
              // Reset shadow
              ctx.shadowColor = 'transparent';
            }}
          />
        )}
      </div>
    </div>
  );
}
