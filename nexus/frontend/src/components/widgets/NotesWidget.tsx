import { useState, useEffect, useRef, useCallback } from 'react';
import { useNotes } from '../../hooks/useNotes';
import { useWidgetReady } from '../../hooks/useWidgetReady';
import type { QuickNote } from '../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function plainPreview(text: string, maxLen = 80): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '· ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n+/g, ' ')
    .trim();
  return plain.length > maxLen ? `${plain.slice(0, maxLen)}…` : plain;
}

function renderMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.*?)__/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h5 style="margin:.4em 0 .2em;font-size:1em">$1</h5>')
    .replace(/^## (.+)$/gm, '<h4 style="margin:.4em 0 .2em;font-size:1.1em">$1</h4>')
    .replace(/^# (.+)$/gm, '<h3 style="margin:.4em 0 .2em;font-size:1.2em">$1</h3>')
    .replace(/^[-*+] (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

// ─── Shared mini-button styles ─────────────────────────────────────────────

const topBarBtn = (active = false, danger = false): React.CSSProperties => ({
  background: active ? 'rgba(167,139,250,0.12)' : 'none',
  border: active
    ? '1px solid rgba(167,139,250,0.3)'
    : danger
      ? '1px solid rgba(239,68,68,0.4)'
      : '1px solid transparent',
  cursor: 'pointer',
  padding: '2px 7px',
  borderRadius: 5,
  color: active ? 'var(--accent)' : danger ? 'var(--color-danger)' : 'var(--text-faint)',
  fontSize: 9,
  fontFamily: 'var(--font-mono)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.07em',
  transition: 'all 0.13s',
});

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({
  activeTab,
  noteCount: _noteCount,
  onTabChange,
}: {
  activeTab: 'new' | 'notes';
  noteCount: number;
  onTabChange: (t: 'new' | 'notes') => void;
}) {
  return (
    <div style={{ padding: '7px 10px 0', flexShrink: 0 }}>
      <div style={{
        display: 'flex',
        background: 'var(--surface2)',
        borderRadius: 7,
        padding: 2,
        gap: 2,
      }}>
        {(['new', 'notes'] as const).map(tab => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              style={{
                flex: 1,
                padding: '4px 0',
                borderRadius: 5,
                border: 'none',
                cursor: 'pointer',
                background: isActive ? 'var(--surface)' : 'transparent',
                color: isActive ? 'var(--accent)' : 'var(--text-faint)',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                fontWeight: isActive ? 700 : 400,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                transition: 'all 0.18s',
                boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              {tab === 'new' ? '+ New Note' : 'All Notes'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── New Note tab ─────────────────────────────────────────────────────────────

function NewNoteTab({
  onCreate,
  onSaved,
}: {
  onCreate: (title: string, content: string) => Promise<QuickNote | null>;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);


  const isEmpty = !title.trim() && !content.trim();

  const handleSave = useCallback(async () => {
    if (isEmpty || isSaving) return;
    setIsSaving(true);
    setError(false);
    const note = await onCreate(title.trim() || 'Untitled', content);
    if (note) {
      onSaved();
    } else {
      setError(true);
      setIsSaving(false);
    }
  }, [title, content, isEmpty, isSaving, onCreate, onSaved]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Title */}
      <input
        ref={titleRef}
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); contentRef.current?.focus(); } }}
        placeholder="Title"
        style={{
          flexShrink: 0,
          padding: '12px 14px 9px',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid var(--border)',
          outline: 'none',
          color: 'var(--text)',
          fontFamily: 'var(--font-mono)',
          fontSize: 15,
          fontWeight: 700,
          width: '100%',
          boxSizing: 'border-box',
        }}
      />

      {/* Body */}
      <textarea
        ref={contentRef}
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Start writing…"
        className="nexus-scroll"
        style={{
          flex: 1,
          resize: 'none',
          padding: '11px 14px',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--text)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.75,
          width: '100%',
          boxSizing: 'border-box',
        }}
      />

      {/* Footer */}
      <div style={{
        padding: '8px 10px 10px',
        borderTop: '1px solid var(--border)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}>
        {error && (
          <p style={{
            margin: 0, textAlign: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 9,
            color: 'var(--color-danger)',
          }}>
            ✗ Failed to save — try again
          </p>
        )}
        <button
          onClick={handleSave}
          disabled={isEmpty || isSaving}
          style={{
            width: '100%',
            padding: '8px 0',
            borderRadius: 8,
            border: 'none',
            cursor: isEmpty || isSaving ? 'default' : 'pointer',
            background: isEmpty
              ? 'var(--surface2)'
              : 'linear-gradient(135deg, rgba(139,92,246,0.85), rgba(167,139,250,0.9))',
            color: isEmpty ? 'var(--text-faint)' : '#fff',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            opacity: isSaving ? 0.7 : 1,
            transition: 'all 0.15s',
            boxShadow: isEmpty ? 'none' : '0 2px 10px rgba(139,92,246,0.3)',
          }}
        >
          {isSaving ? 'Saving…' : 'Save Note'}
        </button>
      </div>
    </div>
  );
}

// ─── Note card ────────────────────────────────────────────────────────────────

function NoteCard({ note, onClick }: { note: QuickNote; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const preview = note.content ? plainPreview(note.content) : '';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      style={{
        padding: '9px 11px',
        borderRadius: 8,
        cursor: 'pointer',
        border: `1px solid ${hovered ? 'var(--border-hover)' : 'var(--border)'}`,
        background: hovered ? 'var(--surface2)' : 'transparent',
        transition: 'all 0.12s',
        outline: 'none',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
          color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', flex: 1,
        }}>
          {note.title || 'Untitled'}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', flexShrink: 0 }}>
          {relativeTime(note.updatedAt)}
        </span>
      </div>
      {preview && (
        <p style={{
          margin: '3px 0 0', fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--text-muted)', lineHeight: 1.4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {preview}
        </p>
      )}
    </div>
  );
}

// ─── Existing note editor (within Notes tab) ──────────────────────────────────

function NoteEditor({
  note,
  onBack,
  onUpdate,
  onDelete,
}: {
  note: QuickNote;
  onBack: () => void;
  onUpdate: (id: string, title: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Only focus the editor if the user has already interacted with this widget
    // (i.e. something other than the page body / search bar has been clicked).
    // This prevents the note editor from stealing focus from the search bar on load.
    const active = document.activeElement;
    const isDefaultFocus = !active || active === document.body || active.tagName === 'INPUT';
    if (!isDefaultFocus) contentRef.current?.focus();
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(false);
    try {
      await onUpdate(note.id, title, content);
      onBack();
    } catch {
      setSaveError(true);
      setIsSaving(false);
    }
  }, [title, content, note.id, onUpdate, onBack]);

  async function handleDelete() {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    await onDelete(note.id);
    onBack();
  }

  useEffect(() => {
    if (!deleteConfirm) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-delete-btn]')) setDeleteConfirm(false);
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); };
  }, [deleteConfirm]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '6px 10px 5px', flexShrink: 0,
        borderBottom: '1px solid var(--border)',
      }}>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
            color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)',
            borderRadius: 4, transition: 'color 0.12s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
        >
          ← Back
        </button>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
          {saveError && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-danger)' }}>
              ✗ failed
            </span>
          )}
          <button onClick={() => setPreviewMode(p => !p)} style={topBarBtn(previewMode)}>
            {previewMode ? 'Edit' : 'Preview'}
          </button>
          <button
            data-delete-btn
            onClick={handleDelete}
            style={topBarBtn(false, deleteConfirm)}
            onMouseEnter={e => {
              if (!deleteConfirm) (e.currentTarget as HTMLElement).style.color = 'var(--color-danger)';
            }}
            onMouseLeave={e => {
              if (!deleteConfirm) (e.currentTarget as HTMLElement).style.color = 'var(--text-faint)';
            }}
          >
            {deleteConfirm ? 'Confirm?' : 'Delete'}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              ...topBarBtn(true),
              padding: '3px 10px',
              opacity: isSaving ? 0.6 : 1,
              cursor: isSaving ? 'default' : 'pointer',
            }}
          >
            {isSaving ? '…' : 'Save'}
          </button>
        </div>
      </div>

      {previewMode ? (
        <div className="nexus-scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
          <h2 style={{ margin: '0 0 10px', fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {title || 'Untitled'}
          </h2>
          <div
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', lineHeight: 1.7 }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title"
            style={{
              flexShrink: 0, padding: '10px 14px 8px',
              background: 'transparent', border: 'none',
              borderBottom: '1px solid var(--border)',
              outline: 'none', color: 'var(--text)',
              fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700,
              width: '100%', boxSizing: 'border-box',
            }}
          />
          <textarea
            ref={contentRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Start writing…"
            className="nexus-scroll"
            style={{
              flex: 1, resize: 'none', padding: '11px 14px',
              background: 'transparent', border: 'none',
              outline: 'none', color: 'var(--text)',
              fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7,
              width: '100%', boxSizing: 'border-box',
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Notes tab (list + inline editor) ────────────────────────────────────────

function NotesTab({
  notes,
  onUpdate,
  onDelete,
}: {
  notes: QuickNote[];
  onUpdate: (id: string, title: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const editingNote = editingId ? notes.find(n => n.id === editingId) ?? null : null;

  if (editingNote) {
    return (
      <NoteEditor
        key={editingNote.id}
        note={editingNote}
        onBack={() => setEditingId(null)}
        onUpdate={onUpdate}
        onDelete={async id => { await onDelete(id); setEditingId(null); }}
      />
    );
  }

  const filtered = query.trim()
    ? notes.filter(n => {
        const q = query.toLowerCase();
        return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
      })
    : notes;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Search */}
      <div style={{ padding: '6px 8px 4px', flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-faint)', fontSize: 10, pointerEvents: 'none',
          }}>⌕</span>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search notes…"
            style={{
              width: '100%', boxSizing: 'border-box',
              paddingLeft: 20, paddingRight: 7, paddingTop: 4, paddingBottom: 4,
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 6, outline: 'none', color: 'var(--text)',
              fontSize: 10, fontFamily: 'var(--font-mono)', transition: 'border-color 0.12s',
            }}
            onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(167,139,250,0.4)'; }}
            onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
          />
        </div>
      </div>

      {/* List */}
      <div
        className="nexus-scroll"
        style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}
      >
        {filtered.length === 0 ? (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8,
            color: 'var(--text-faint)', fontFamily: 'var(--font-mono)',
          }}>
            <span style={{ fontSize: 24 }}>📝</span>
            <p style={{ fontSize: 11, textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
              {query ? 'No notes match.' : 'No notes yet.\nSwitch to New Note to start writing.'}
            </p>
          </div>
        ) : (
          filtered.map(note => (
            <NoteCard key={note.id} note={note} onClick={() => setEditingId(note.id)} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── NotesWidget ──────────────────────────────────────────────────────────────

export function NotesWidget({ onClose: _onClose }: { onClose: () => void }) {
  const { notes, createNote, updateNote, deleteNote, hasLoaded } = useNotes();
  useWidgetReady('notes', hasLoaded);

  const [activeTab, setActiveTab] = useState<'new' | 'notes'>('new');
  // Key increments on each save to remount NewNoteTab with a blank form
  const [newNoteKey, setNewNoteKey] = useState(0);

  function handleNoteSaved() {
    setNewNoteKey(k => k + 1);
    setActiveTab('notes');
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: 'var(--surface)' }}>
      <TabBar activeTab={activeTab} noteCount={notes.length} onTabChange={setActiveTab} />

      <div style={{ flex: 1, overflow: 'hidden', paddingTop: 8 }}>
        {activeTab === 'new' ? (
          <NewNoteTab key={newNoteKey} onCreate={createNote} onSaved={handleNoteSaved} />
        ) : (
          <NotesTab notes={notes} onUpdate={updateNote} onDelete={deleteNote} />
        )}
      </div>
    </div>
  );
}
