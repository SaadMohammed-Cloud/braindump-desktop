const { ipcRenderer } = require('electron');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

const AUTOSAVE_DELAY_MS = 2000;
const RECENT_NOTES_LIMIT = 5;

const textarea = document.getElementById('note-textarea');
const saveBtn = document.getElementById('save-btn');
const newNoteBtn = document.getElementById('new-note-btn');
const saveStatusEl = document.getElementById('save-status');
const saveStatusText = document.getElementById('save-status-text');
const recentList = document.getElementById('recent-list');
const editBanner = document.getElementById('edit-banner');
const editBannerText = document.getElementById('edit-banner-text');
const minimizeBtn = document.getElementById('minimize-btn');
const closeBtn = document.getElementById('close-btn');
const bubble = document.getElementById('bubble');
const bubbleInner = document.getElementById('bubble-inner');

let currentNoteId = null;
let isEditingExisting = false;
let autoSaveTimer = null;
let notesCache = [];

// ---------- status pill ----------

function setStatus(state, text) {
  saveStatusEl.classList.remove('active', 'saving');
  if (state === 'saving') saveStatusEl.classList.add('active', 'saving');
  else if (state === 'saved') saveStatusEl.classList.add('active');
  saveStatusText.textContent = text;
}

// ---------- edit mode ----------

function updateEditBanner() {
  const note = isEditingExisting && currentNoteId
    ? notesCache.find((n) => n.id === currentNoteId)
    : null;
  if (note) {
    editBanner.classList.add('visible');
    editBannerText.textContent = `Editing "${note.title || 'Untitled'}"`;
    textarea.classList.add('editing');
  } else {
    editBanner.classList.remove('visible');
    textarea.classList.remove('editing');
  }
}

function enterEditMode(note) {
  currentNoteId = note.id;
  isEditingExisting = true;
  textarea.value = note.body || '';
  textarea.focus();
  setStatus('idle', 'Idle');
  updateEditBanner();
  renderRecentNotes();
}

function startNewNote() {
  currentNoteId = null;
  isEditingExisting = false;
  textarea.value = '';
  textarea.focus();
  setStatus('idle', 'Idle');
  updateEditBanner();
  renderRecentNotes();
}

async function flushPendingSave() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    await saveNote();
  }
}

// ---------- saving ----------

function deriveTitle(body) {
  const firstLine = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) || '';
  return firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine || 'Untitled';
}

async function saveNote({ resetAfter = false } = {}) {
  const body = textarea.value.trim();
  if (!body) return;

  setStatus('saving', 'Saving…');

  const payload = {
    title: deriveTitle(body),
    body,
    tags: [],
    date: new Date().toISOString().slice(0, 10),
    user_id: config.USER_ID,
  };

  try {
    let row;
    if (currentNoteId) {
      const { data, error } = await supabase
        .from('notes')
        .update(payload)
        .eq('id', currentNoteId)
        .select()
        .single();
      if (error) throw error;
      row = data;
    } else {
      const { data, error } = await supabase
        .from('notes')
        .insert({ ...payload, created_at: new Date().toISOString() })
        .select()
        .single();
      if (error) throw error;
      row = data;
    }

    currentNoteId = row.id;
    upsertNoteInCache(row, { animate: true });
    updateEditBanner();
    setStatus('saved', 'Saved');

    if (resetAfter) {
      textarea.value = '';
      currentNoteId = null;
      isEditingExisting = false;
      updateEditBanner();
      renderRecentNotes();
      setTimeout(() => setStatus('idle', 'Idle'), 1500);
    }
  } catch (err) {
    console.error('[Braindump] Failed to save note:', err);
    setStatus('error', 'Save failed');
  }
}

textarea.addEventListener('input', () => {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => saveNote(), AUTOSAVE_DELAY_MS);
});

saveBtn.addEventListener('click', () => {
  clearTimeout(autoSaveTimer);
  saveNote({ resetAfter: true });
});

newNoteBtn.addEventListener('click', async () => {
  await flushPendingSave();
  startNewNote();
});

// ---------- recent notes list ----------

function formatWhen(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderRecentNotes(justAddedId) {
  recentList.innerHTML = '';

  if (!notesCache.length) {
    const empty = document.createElement('div');
    empty.id = 'recent-empty';
    empty.textContent = 'No notes yet. Start typing above.';
    recentList.appendChild(empty);
    return;
  }

  for (const note of notesCache) {
    const item = document.createElement('div');
    item.className = 'note-item'
      + (note.id === justAddedId ? ' new-note' : '')
      + (isEditingExisting && note.id === currentNoteId ? ' editing' : '');
    item.dataset.id = note.id;

    const text = document.createElement('div');
    text.className = 'note-text';
    text.textContent = (note.body || '').replace(/\n/g, ' ');

    const meta = document.createElement('div');
    meta.className = 'note-meta';
    meta.textContent = formatWhen(note.created_at);

    item.appendChild(text);
    item.appendChild(meta);
    recentList.appendChild(item);
  }
}

recentList.addEventListener('click', async (event) => {
  const item = event.target.closest('.note-item');
  if (!item || !item.dataset.id) return;

  const id = item.dataset.id;
  if (currentNoteId != null && String(currentNoteId) === id) return;

  const note = notesCache.find((n) => String(n.id) === id);
  if (!note) return;

  await flushPendingSave();
  enterEditMode(note);
});

function upsertNoteInCache(note, { animate = false } = {}) {
  const existingIndex = notesCache.findIndex((n) => n.id === note.id);
  if (existingIndex !== -1) {
    notesCache[existingIndex] = note;
  } else {
    notesCache.unshift(note);
  }
  notesCache.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  notesCache = notesCache.slice(0, RECENT_NOTES_LIMIT);
  renderRecentNotes(animate ? note.id : null);
}

async function loadRecentNotes() {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('user_id', config.USER_ID)
    .order('created_at', { ascending: false })
    .limit(RECENT_NOTES_LIMIT);

  if (error) {
    console.error('[Braindump] Failed to load recent notes:', error);
    return;
  }

  notesCache = data || [];
  renderRecentNotes();
}

// ---------- realtime sync with the web app ----------

function subscribeToRealtimeNotes() {
  supabase
    .channel('braindump-desktop-notes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notes', filter: `user_id=eq.${config.USER_ID}` },
      (payload) => upsertNoteInCache(payload.new, { animate: true })
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'notes', filter: `user_id=eq.${config.USER_ID}` },
      (payload) => upsertNoteInCache(payload.new)
    )
    .subscribe();
}

// ---------- window chrome ----------

minimizeBtn.addEventListener('click', () => {
  document.body.classList.add('bubble-mode');
  ipcRenderer.send('window:minimize-to-bubble');
});

bubbleInner.addEventListener('click', () => {
  document.body.classList.remove('bubble-mode');
  ipcRenderer.send('window:restore-from-bubble');
});

closeBtn.addEventListener('click', () => {
  ipcRenderer.send('window:hide');
});

// ---------- init ----------

setStatus('idle', 'Idle');
loadRecentNotes();
subscribeToRealtimeNotes();
