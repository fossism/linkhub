import React, { useState, useEffect } from 'react';
import { decryptAsset, bufferToObjectURL } from '../crypto';
import { 
  Folder, Plus, Search, LogOut, Star, Tag, Link2, 
  Trash2, Eye, ShieldAlert, Sparkles, Loader2, X, 
  FileText, Image, Compass, ExternalLink, RefreshCw
} from 'lucide-react';

export const Dashboard = ({ token, encryptionKey, user, onLogout, apiUrl }) => {
  const [bookmarks, setBookmarks] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedTag, setSelectedTag] = useState(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [semanticSearch, setSemanticSearch] = useState(false);
  
  // UI States
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDesc, setNewCategoryDesc] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Decrypted Asset Cache to prevent redundant downloads
  const [screenshotCache, setScreenshotCache] = useState({});
  const [decryptedViewer, setDecryptedViewer] = useState(null); // { bookmark, assetType, objectUrl, loading }

  // Load Bookmarks & Categories
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Build query string
        const params = new URLSearchParams();
        if (selectedCategory) params.append('categoryId', selectedCategory);
        if (selectedTag) params.append('tagId', selectedTag);
        if (showFavoritesOnly) params.append('isFavorite', 'true');
        if (searchQuery) {
          params.append('q', searchQuery);
          if (semanticSearch) params.append('semantic', 'true');
        }

        const headers = { 'Authorization': `Bearer ${token}` };
        
        const [bookmarksRes, categoriesRes, tagsRes] = await Promise.all([
          fetch(`${apiUrl}/api/bookmarks?${params.toString()}`, { headers }),
          fetch(`${apiUrl}/api/categories`, { headers }),
          fetch(`${apiUrl}/api/tags`, { headers })
        ]);

        if (bookmarksRes.ok && categoriesRes.ok && tagsRes.ok) {
          const bData = await bookmarksRes.json();
          const cData = await categoriesRes.json();
          const tData = await tagsRes.json();
          
          setBookmarks(bData);
          setCategories(cData);
          setTags(tData);
        }
      } catch (err) {
        console.error('Error fetching data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedCategory, selectedTag, showFavoritesOnly, refreshTrigger, token, apiUrl]);

  // Handle Search execution on submit/debounced
  const triggerSearch = (e) => {
    if (e) e.preventDefault();
    setRefreshTrigger(prev => prev + 1);
  };

  // Ingest Link Handler
  const handleAddLink = async (e) => {
    e.preventDefault();
    if (!newUrl) return;
    setSubmitting(true);

    try {
      const res = await fetch(`${apiUrl}/api/bookmarks/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Encryption-Key': encryptionKey
        },
        body: JSON.stringify({ url: newUrl })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to ingest link.');

      setNewUrl('');
      setShowAddModal(false);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Add Category Handler
  const handleCreateCategory = async (e) => {
    e.preventDefault();
    if (!newCategoryName) return;

    try {
      const res = await fetch(`${apiUrl}/api/categories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: newCategoryName, description: newCategoryDesc })
      });

      if (res.ok) {
        setNewCategoryName('');
        setNewCategoryDesc('');
        setShowCategoryModal(false);
        setRefreshTrigger(prev => prev + 1);
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to create category.');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Delete Bookmark
  const handleDeleteBookmark = async (id) => {
    if (!confirm('Are you sure you want to delete this bookmark and all encrypted S3 backups?')) return;
    try {
      const res = await fetch(`${apiUrl}/api/bookmarks/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setRefreshTrigger(prev => prev + 1);
        // Clear caches
        if (screenshotCache[id]) {
          URL.revokeObjectURL(screenshotCache[id]);
          const newCache = { ...screenshotCache };
          delete newCache[id];
          setScreenshotCache(newCache);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Favorite Toggle
  const handleToggleFavorite = async (id) => {
    try {
      const res = await fetch(`${apiUrl}/api/bookmarks/${id}/favorite`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setRefreshTrigger(prev => prev + 1);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Async Decrypt and view screenshots or reader mode
  const handleViewAsset = async (bookmark, type) => {
    setDecryptedViewer({ bookmark, assetType: type, objectUrl: null, loading: true });

    try {
      const res = await fetch(`${apiUrl}/api/bookmarks/${bookmark.id}/assets/${type}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Asset download failed.');
      
      const { encryptedData, initializationVector } = await res.json();
      
      const decrypted = await decryptAsset(encryptedData, encryptionKey, initializationVector);
      
      let mime = 'application/octet-stream';
      if (type === 'screenshot') mime = 'image/png';
      if (type === 'pdf') mime = 'application/pdf';
      if (type === 'html_dump') mime = 'text/html';

      const url = bufferToObjectURL(decrypted, mime);
      setDecryptedViewer(prev => ({ ...prev, objectUrl: url, loading: false }));
    } catch (err) {
      console.error('Decryption failed:', err);
      alert('Decryption failed. Please verify your local key config.');
      setDecryptedViewer(null);
    }
  };

  // Render text inside decrypted dump
  const [readerContent, setReaderContent] = useState('');
  useEffect(() => {
    if (decryptedViewer && decryptedViewer.assetType === 'html_dump' && decryptedViewer.objectUrl) {
      fetch(decryptedViewer.objectUrl)
        .then(res => res.text())
        .then(html => {
          // Quick JSDOM-like parse in browser to render readable text beautifully
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          
          // Strip styles, links and scripts
          const scripts = doc.querySelectorAll('script, style, link, nav, header, footer');
          scripts.forEach(s => s.remove());
          
          setReaderContent(doc.body.innerHTML || 'No text content available.');
        });
    } else {
      setReaderContent('');
    }
  }, [decryptedViewer]);

  // Load thumbnail on demand when card renders
  const Thumbnail = ({ bookmark }) => {
    const [imgUrl, setImgUrl] = useState(null);
    const [loadingImg, setLoadingImg] = useState(false);

    useEffect(() => {
      // If bookmark has screenshot asset, fetch and decrypt it
      if (bookmark.assets && bookmark.assets.includes('screenshot')) {
        if (screenshotCache[bookmark.id]) {
          setImgUrl(screenshotCache[bookmark.id]);
          return;
        }

        const loadThumbnail = async () => {
          setLoadingImg(true);
          try {
            const res = await fetch(`${apiUrl}/api/bookmarks/${bookmark.id}/assets/screenshot`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
              const { encryptedData, initializationVector } = await res.json();
              const decrypted = await decryptAsset(encryptedData, encryptionKey, initializationVector);
              const url = bufferToObjectURL(decrypted, 'image/png');
              
              setScreenshotCache(prev => ({ ...prev, [bookmark.id]: url }));
              setImgUrl(url);
            }
          } catch (err) {
            console.error('Thumbnail decryption failed', err);
          } finally {
            setLoadingImg(false);
          }
        };

        loadThumbnail();
      }
    }, [bookmark, token, apiUrl]);

    if (loadingImg) {
      return (
        <div className="w-full h-36 bg-slate-900/60 border-b border-white/5 flex items-center justify-center">
          <Loader2 className="h-6 w-6 text-accentBlue animate-spin" />
        </div>
      );
    }

    if (imgUrl) {
      return (
        <img 
          src={imgUrl} 
          alt={bookmark.title} 
          className="w-full h-36 object-cover object-top border-b border-white/5 hover:scale-[1.02] transition-all duration-300"
        />
      );
    }

    return (
      <div className="w-full h-36 bg-gradient-to-br from-slate-900 to-slate-950 border-b border-white/5 flex flex-col items-center justify-center text-slate-600 gap-1.5">
        <Link2 className="h-8 w-8" />
        <span className="text-[10px] font-mono tracking-widest uppercase">No Screen Capture</span>
      </div>
    );
  };

  const getCleanDomain = (urlStr) => {
    try {
      return new URL(urlStr).hostname.replace('www.', '');
    } catch (e) {
      return 'link';
    }
  };

  return (
    <div className="min-h-screen flex bg-darkBg text-slate-100 relative">
      
      {/* SIDEBAR NAVIGATION */}
      <aside className="w-64 glass-panel border-r border-white/5 flex flex-col z-20">
        {/* Profile Card */}
        <div className="p-5 border-b border-white/5 flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-accentBlue to-accentIndigo flex items-center justify-center font-bold text-darkBg text-sm">
              {user.email[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate text-white">{user.email}</p>
              <p className="text-[10px] text-neonCyan font-mono truncate">Lockbox Encrypted</p>
            </div>
          </div>
        </div>

        {/* Categories Menu */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3 text-slateText px-2">
              <span className="text-[10px] font-bold uppercase tracking-wider">Folders</span>
              <button 
                onClick={() => setShowCategoryModal(true)}
                className="p-1 hover:bg-white/5 hover:text-white rounded transition"
                title="Create Category"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            
            <nav className="space-y-1">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition font-medium ${!selectedCategory ? 'bg-white/5 text-accentBlue shadow-inner' : 'text-slateText hover:bg-white/5 hover:text-white'}`}
              >
                <Compass className="h-4 w-4" />
                <span>All Links</span>
              </button>
              
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition font-medium ${selectedCategory === cat.id ? 'bg-white/5 text-accentBlue shadow-inner' : 'text-slateText hover:bg-white/5 hover:text-white'}`}
                >
                  <div className="flex items-center gap-3 truncate">
                    <Folder className="h-4 w-4 shrink-0 text-accentIndigo" />
                    <span className="truncate">{cat.name}</span>
                  </div>
                  {cat.bookmark_count > 0 && (
                    <span className="text-[10px] font-semibold bg-white/5 px-2 py-0.5 rounded-full text-slateText">
                      {cat.bookmark_count}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Tags Menu */}
          {tags.length > 0 && (
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slateText px-2 mb-3">Tags</span>
              <div className="flex flex-wrap gap-1.5 px-1">
                {tags.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTag(selectedTag === t.id ? null : t.id)}
                    className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition ${selectedTag === t.id ? 'bg-accentBlue/10 border-accentBlue text-accentBlue' : 'border-white/5 bg-slate-900/40 text-slateText hover:border-white/10 hover:text-white'}`}
                  >
                    #{t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Footer Logout */}
        <div className="p-4 border-t border-white/5">
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/5 hover:bg-red-950/20 hover:border-red-500/30 hover:text-red-400 text-slateText transition text-xs font-semibold"
          >
            <LogOut className="h-4 w-4" />
            <span>Lock & Exit</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTAINER */}
      <main className="flex-1 flex flex-col min-w-0 z-10 overflow-y-auto">
        
        {/* HEADER */}
        <header className="glass-panel border-b border-white/5 p-4 sticky top-0 z-20 flex items-center justify-between gap-4">
          
          {/* Search Bar */}
          <form onSubmit={triggerSearch} className="flex-1 max-w-lg flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
                <Search className="h-4 w-4" />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={semanticSearch ? "AI Semantic Search (e.g. \"frontend ui frameworks\")..." : "Filter by title, domain, or summary..."}
                className="cyber-input w-full pl-9 pr-4 py-2 rounded-xl text-white placeholder-slate-500 text-sm"
              />
            </div>
            
            {/* Semantic Mode Toggle */}
            <button
              type="button"
              onClick={() => setSemanticSearch(!semanticSearch)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition ${semanticSearch ? 'bg-cyan-950/30 border-cyan-500/50 text-accentBlue shadow-neonCyan' : 'bg-slate-900/40 border-white/5 text-slateText hover:border-white/10 hover:text-white'}`}
              title="Search by concept rather than exact words"
            >
              <Sparkles className={`h-3.5 w-3.5 ${semanticSearch ? 'animate-pulse' : ''}`} />
              <span>Semantic</span>
            </button>
          </form>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
              className={`p-2 rounded-xl border transition ${showFavoritesOnly ? 'bg-yellow-500/10 border-yellow-500/50 text-yellow-400' : 'bg-slate-900/40 border-white/5 text-slateText hover:border-white/10 hover:text-white'}`}
              title="Favorites Only"
            >
              <Star className="h-4.5 w-4.5 fill-current" />
            </button>
            
            <button
              onClick={() => setRefreshTrigger(prev => prev + 1)}
              className="p-2 rounded-xl border bg-slate-900/40 border-white/5 text-slateText hover:border-white/10 hover:text-white transition"
              title="Refresh Items"
            >
              <RefreshCw className="h-4.5 w-4.5" />
            </button>

            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-accentBlue to-accentIndigo text-darkBg font-bold rounded-xl text-xs shadow-neonCyan hover:opacity-90 active:scale-95 transition"
            >
              <Plus className="h-4 w-4" />
              <span>Add Link</span>
            </button>
          </div>
        </header>

        {/* BOOKMARKS LISTING */}
        <div className="p-6 flex-1 max-w-7xl w-full mx-auto">
          {loading ? (
            <div className="h-96 flex flex-col items-center justify-center gap-3 text-slateText">
              <Loader2 className="h-10 w-10 text-accentBlue animate-spin" />
              <p className="text-sm font-medium">Querying local secure vector index...</p>
            </div>
          ) : bookmarks.length === 0 ? (
            <div className="h-96 border border-dashed border-white/5 rounded-2xl flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto my-12 bg-slate-950/20">
              <Compass className="h-12 w-12 text-slate-700 mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">No bookmarks found</h3>
              <p className="text-sm text-slateText leading-relaxed">
                Add your first link or adjust your search filters to start archiving secure vector-categorized bookmarks.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {bookmarks.map(b => (
                <div 
                  key={b.id} 
                  className="glass-panel rounded-2xl overflow-hidden flex flex-col shadow-lg border border-white/5 hover:border-cyan-500/20 glass-panel-hover"
                >
                  {/* Thumbnail / Screen capture */}
                  <Thumbnail bookmark={b} />

                  {/* Bookmark Body */}
                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div>
                      {/* Meta header */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold text-accentBlue font-mono uppercase tracking-wider truncate max-w-[150px]">
                          {getCleanDomain(b.url)}
                        </span>
                        {b.distance !== undefined && (
                          <span className="text-[9px] font-mono bg-cyan-950/40 text-cyan-400 border border-cyan-800/30 px-1.5 py-0.5 rounded">
                            {(1 - parseFloat(b.distance)).toFixed(2)} Similarity
                          </span>
                        )}
                        {b.category_name && !b.distance && (
                          <span className="text-[9px] font-semibold bg-slate-900 border border-white/5 text-slateText px-2 py-0.5 rounded-lg">
                            {b.category_name}
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <h4 className="text-sm font-bold text-white mb-1.5 leading-snug line-clamp-2 hover:text-accentBlue transition">
                        <a href={b.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                          {b.title}
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                        </a>
                      </h4>

                      {/* Summary */}
                      <p className="text-xs text-slateText leading-relaxed mb-3 line-clamp-3">
                        {b.summary}
                      </p>
                    </div>

                    {/* Footer Actions */}
                    <div>
                      {/* Tags chips */}
                      {b.tags && b.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-4">
                          {b.tags.map(t => (
                            <span key={t.id} className="text-[9px] font-medium bg-white/5 text-slate-400 px-1.5 py-0.5 rounded">
                              #{t.name}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Divider */}
                      <div className="border-t border-white/5 pt-3 flex items-center justify-between">
                        <span className="text-[10px] text-slate-500">
                          {new Date(b.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                        
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleToggleFavorite(b.id)}
                            className={`p-1.5 rounded-lg hover:bg-white/5 transition ${b.is_favorite ? 'text-yellow-400' : 'text-slate-500 hover:text-white'}`}
                            title="Toggle Favorite"
                          >
                            <Star className="h-4 w-4 fill-current" />
                          </button>
                          
                          {/* Viewer Trigger */}
                          {b.assets && b.assets.length > 0 && (
                            <button
                              onClick={() => handleViewAsset(b, b.assets.includes('screenshot') ? 'screenshot' : b.assets[0])}
                              className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-accentBlue transition"
                              title="View Decrypted Archives"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          )}

                          <button
                            onClick={() => handleDeleteBookmark(b.id)}
                            className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-red-400 transition"
                            title="Delete Bookmark"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* --- MODAL: INGEST NEW LINK --- */}
      {showAddModal && (
        <div className="fixed inset-0 bg-darkBg/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="glass-panel w-full max-w-lg rounded-2xl shadow-glass border border-white/5 overflow-hidden animate-slide-in">
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Link2 className="h-5 w-5 text-accentBlue" />
                <span>Ingest Link</span>
              </h3>
              <button 
                onClick={() => setShowAddModal(false)}
                className="p-1.5 hover:bg-white/5 rounded-lg transition"
              >
                <X className="h-5 w-5 text-slateText" />
              </button>
            </div>
            <form onSubmit={handleAddLink} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slateText mb-2">
                  Destination URL
                </label>
                <input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://example.com/some/article"
                  className="cyber-input w-full px-4 py-3 rounded-xl text-white placeholder-slate-500 text-sm"
                  required
                  autoFocus
                />
              </div>

              <div className="p-3 bg-cyan-950/20 border border-cyan-800/30 rounded-xl flex gap-3 text-xs text-slateText">
                <ShieldAlert className="h-5 w-5 text-accentBlue shrink-0" />
                <p className="leading-relaxed">
                  The link will be processed on the server (scraped dynamically and summarized). Assets are symmetrically encrypted with your derived master key before being saved to MinIO.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-white/5 text-slateText hover:text-white transition text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-1.5 px-5 py-2.5 bg-gradient-to-r from-accentBlue to-accentIndigo text-darkBg font-bold rounded-xl text-xs shadow-neonCyan disabled:opacity-50"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <span>Begin Ingestion</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL: CREATE CUSTOM CATEGORY --- */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-darkBg/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="glass-panel w-full max-w-md rounded-2xl border border-white/5 animate-slide-in">
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Folder className="h-5 w-5 text-accentIndigo" />
                <span>New Folder</span>
              </h3>
              <button onClick={() => setShowCategoryModal(false)} className="p-1.5 hover:bg-white/5 rounded-lg transition">
                <X className="h-5 w-5 text-slateText" />
              </button>
            </div>
            <form onSubmit={handleCreateCategory} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slateText mb-2">Folder Name</label>
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="e.g. Cooking Recipes"
                  className="cyber-input w-full px-4 py-3 rounded-xl text-white placeholder-slate-500 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slateText mb-2">Description</label>
                <textarea
                  value={newCategoryDesc}
                  onChange={(e) => setNewCategoryDesc(e.target.value)}
                  placeholder="Optional brief notes..."
                  className="cyber-input w-full px-4 py-3 rounded-xl text-white placeholder-slate-500 text-sm h-20"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCategoryModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-white/5 text-slateText hover:text-white transition text-xs font-semibold"
                >
                  Cancel
                </button>
                <button type="submit" className="px-5 py-2.5 bg-gradient-to-r from-accentBlue to-accentIndigo text-darkBg font-bold rounded-xl text-xs">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- DECRYPTED ARCHIVE VIEWER MODAL --- */}
      {decryptedViewer && (
        <div className="fixed inset-0 bg-darkBg/90 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="glass-panel w-full max-w-5xl h-[85vh] rounded-2xl border border-white/10 flex flex-col overflow-hidden animate-slide-in shadow-2xl">
            
            {/* Header / Tabs */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-slate-950/40">
              <div className="flex items-center gap-2 truncate pr-4">
                <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse-glow"></span>
                <h3 className="text-sm font-bold text-white truncate max-w-md">
                  {decryptedViewer.bookmark.title}
                </h3>
              </div>

              {/* Asset Type Select Tabs */}
              <div className="flex items-center gap-1.5 bg-slate-900/60 p-1 rounded-xl border border-white/5">
                {decryptedViewer.bookmark.assets.map(asset => (
                  <button
                    key={asset}
                    onClick={() => handleViewAsset(decryptedViewer.bookmark, asset)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${decryptedViewer.assetType === asset ? 'bg-accentBlue text-darkBg' : 'text-slateText hover:text-white'}`}
                  >
                    {asset === 'screenshot' && <Image className="h-3.5 w-3.5" />}
                    {asset === 'html_dump' && <FileText className="h-3.5 w-3.5" />}
                    {asset === 'pdf' && <FileText className="h-3.5 w-3.5" />}
                    <span className="capitalize">{asset === 'html_dump' ? 'Reader' : asset}</span>
                  </button>
                ))}
              </div>

              <button 
                onClick={() => {
                  if (decryptedViewer.objectUrl) URL.revokeObjectURL(decryptedViewer.objectUrl);
                  setDecryptedViewer(null);
                }} 
                className="p-1.5 hover:bg-white/5 rounded-lg transition"
              >
                <X className="h-5 w-5 text-slateText" />
              </button>
            </div>

            {/* Viewer Screen */}
            <div className="flex-1 overflow-auto bg-slate-950/20 relative">
              {decryptedViewer.loading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slateText">
                  <Loader2 className="h-10 w-10 text-accentBlue animate-spin" />
                  <p className="text-xs font-semibold font-mono">Decrypting file with local browser keys...</p>
                </div>
              ) : (
                <div className="w-full h-full p-6 flex justify-center">
                  
                  {/* Screenshot Render */}
                  {decryptedViewer.assetType === 'screenshot' && (
                    <img 
                      src={decryptedViewer.objectUrl} 
                      alt="Decrypted archive screenshot" 
                      className="max-w-full h-auto object-contain rounded border border-white/5"
                    />
                  )}

                  {/* PDF Render */}
                  {decryptedViewer.assetType === 'pdf' && (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-center">
                      <FileText className="h-16 w-16 text-accentBlue animate-pulse-glow" />
                      <h4 className="text-lg font-bold text-white">Encrypted PDF Archive</h4>
                      <p className="text-sm text-slateText max-w-sm">
                        This document layout has been successfully decrypted in browser. Click below to download the PDF binary file securely.
                      </p>
                      <a
                        href={decryptedViewer.objectUrl}
                        download={`${decryptedViewer.bookmark.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`}
                        className="px-6 py-3 rounded-xl bg-gradient-to-r from-accentBlue to-accentIndigo text-darkBg font-bold text-sm shadow-neonCyan transition active:scale-95"
                      >
                        Download Decrypted PDF
                      </a>
                    </div>
                  )}

                  {/* Reader HTML Dump Render */}
                  {decryptedViewer.assetType === 'html_dump' && (
                    <div className="max-w-3xl w-full mx-auto bg-slate-900/40 border border-white/5 p-8 rounded-2xl overflow-y-auto leading-relaxed text-slate-300 font-serif text-lg selection:bg-cyan-500/20 selection:text-white shadow-inner">
                      <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-6">
                        <span className="text-xs font-sans text-slate-500">Source: {decryptedViewer.bookmark.url}</span>
                        <a 
                          href={decryptedViewer.objectUrl} 
                          download="readable_source.html"
                          className="text-xs font-sans text-accentBlue hover:underline flex items-center gap-1"
                        >
                          Export HTML
                        </a>
                      </div>
                      <div 
                        className="prose prose-invert prose-cyan max-w-none prose-headings:font-sans prose-headings:text-white prose-a:text-accentBlue prose-strong:text-white"
                        dangerouslySetInnerHTML={{ __html: readerContent }} 
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Dashboard;
