import { useState } from 'react';
import { useNotes } from '../../hooks/useNotes';
import type { QuickNote } from '../../types';

export function MobileNotesCard() {
  const { notes, createNote, updateNote } = useNotes();
  const [editing, setEditing] = useState<QuickNote | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');

  function openNote(note: QuickNote) {
    setEditing(note);
    setDraftTitle(note.title);
    setDraftContent(note.content);
  }

  async function saveEdit() {
    if (!editing) return;
    await updateNote(editing.id, draftTitle, draftContent);
    setEditing(null);
  }

  async function newNote() {
    const n = await createNote('New Note', '');
    if (n) openNote(n);
  }

  // Full-screen editor overlay
  if (editing) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 16, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setEditing(null)} style={{
            background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8,
            padding: '8px 12px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13,
          }}>← Back</button>
          <button onClick={saveEdit} style={{
            background: 'var(--accent)', border: 'none', borderRadius: 8,
            padding: '8px 14px', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            marginLeft: 'auto',
          }}>Save</button>
        </div>
        <input value={draftTitle} onChange={e => setDraftTitle(e.target.value)}
          placeholder="Title"
          style={{
            background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)',
            padding: '8px 0', fontSize: 20, fontWeight: 700, color: 'var(--text)',
            outline: 'none', fontFamily: 'inherit',
          }} />
        <textarea value={draftContent} onChange={e => setDraftContent(e.target.value)}
          placeholder="Write something…"
          style={{
            flex: 1, background: 'transparent', border: 'none', resize: 'none',
            fontSize: 15, color: 'var(--text)', lineHeight: 1.6, outline: 'none',
            fontFamily: 'inherit',
          }} />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '20px 20px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
          Notes
        </div>
        <button onClick={newNote} style={{
          background: 'var(--accent)', border: 'none', borderRadius: 8,
          width: 32, height: 32, fontSize: 18, cursor: 'pointer', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>+</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {notes.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 14, paddingTop: 8 }}>
            No notes yet. Tap + to create one.
          </div>
        )}
        {notes.map(n => (
          <button key={n.id} onClick={() => openNote(n)} style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '12px 14px', textAlign: 'left', cursor: 'pointer',
            width: '100%',
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {n.title || 'Untitled'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {n.content || 'Empty note'}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
