// ── Helpers ──────────────────────────────────────────────────────────────────

// crypto.randomUUID() requires a secure context (HTTPS) — fall back to v4 via getRandomValues.
function randomUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
function fmtDuration(ms) {
  if (!ms) return '';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

// ── API ───────────────────────────────────────────────────────────────────────

const BASE = '/api/v1';
const blobCache = new Map();

async function apiFetch(path, opts = {}) {
  const res = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(body || res.statusText), { status: res.status });
  }
  return res;
}

const api = {
  sessions: () => apiFetch('/sessions').then(r => r.json()),
  createSession: body =>
    apiFetch('/sessions', { method: 'POST', body: JSON.stringify(body) }).then(r => r.json()),
  deleteSession: id =>
    apiFetch(`/sessions/${id}`, { method: 'DELETE' }),
  entries:  id => apiFetch(`/sessions/${id}/entries`).then(r => r.json()),
  patch: (id, data) =>
    apiFetch(`/entries/${id}`, { method: 'PATCH', body: JSON.stringify(data) }).then(r => r.json()),
  blob: async (id, type = 'media') => {
    const key = `${id}:${type}`;
    if (blobCache.has(key)) return blobCache.get(key);
    const r = await apiFetch(`/entries/${id}/${type}`);
    const url = URL.createObjectURL(await r.blob());
    blobCache.set(key, url);
    return url;
  },
};

// ── State ─────────────────────────────────────────────────────────────────────

let currentSessionId = null;

// ── Sessions panel ────────────────────────────────────────────────────────────

function renderSessions(sessions) {
  const panel = document.getElementById('sessions-list');
  panel.innerHTML = '';

  if (!sessions.length) {
    panel.innerHTML = '<div class="hint">Нет встреч</div>';
    return;
  }

  [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach(s => {
      const item = document.createElement('div');
      item.className = 'session-item' + (s.id === currentSessionId ? ' active' : '');
      item.dataset.id = s.id;

      const main = document.createElement('div');
      main.className = 'session-main';

      const title = document.createElement('div');
      title.className = 'session-title';
      title.textContent = s.title || 'Без названия';

      const date = document.createElement('div');
      date.className = 'session-date';
      date.textContent = fmtDate(s.updatedAt);

      main.append(title, date);

      const del = document.createElement('button');
      del.className = 'session-delete';
      del.title = 'Удалить встречу';
      del.textContent = '×';
      del.addEventListener('click', e => {
        e.stopPropagation();
        deleteSession(s);
      });

      item.append(main, del);
      item.addEventListener('click', () => openSession(s.id));
      panel.appendChild(item);
    });
}

// ── Entry rendering ───────────────────────────────────────────────────────────

const ICONS = { AUDIO: '🎙', TEXT: '✏️', PHOTO: '📷', VIDEO: '🎬', FILE: '📎' };

function renderEntry(entry) {
  const card = document.createElement('div');
  card.className = 'entry-card';

  // ── Source ──
  const source = document.createElement('div');
  source.className = 'entry-source' + (entry.isSourceCollapsed ? ' collapsed' : '');

  const hdr = document.createElement('div');
  hdr.className = 'entry-header';

  const icon = document.createElement('span');
  icon.className = 'entry-icon';
  icon.textContent = ICONS[entry.type] || '?';

  const time = document.createElement('span');
  time.className = 'entry-time';
  time.textContent = fmtTime(entry.createdAt);

  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'collapse-btn';
  collapseBtn.title = 'Свернуть / развернуть источник';
  collapseBtn.textContent = entry.isSourceCollapsed ? '▼' : '▲';
  collapseBtn.addEventListener('click', async () => {
    const next = !entry.isSourceCollapsed;
    entry.isSourceCollapsed = next;
    source.classList.toggle('collapsed', next);
    collapseBtn.textContent = next ? '▼' : '▲';
    api.patch(entry.id, { isSourceCollapsed: next, updatedAt: Date.now() }).catch(() => {});
  });

  hdr.append(icon, time, collapseBtn);

  const content = document.createElement('div');
  content.className = 'entry-content';

  source.append(hdr, content);
  card.appendChild(source);

  // ── Divider ──
  const divider = document.createElement('div');
  divider.className = 'entry-divider';
  card.appendChild(divider);

  // ── Note (processing layer) ──
  const noteWrap = document.createElement('div');
  noteWrap.className = 'entry-note';

  const noteTA = document.createElement('textarea');
  noteTA.placeholder = 'Комментарий…';
  noteTA.value = entry.note || '';
  noteTA.rows = 2;

  let saveTimer = null;
  noteTA.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api.patch(entry.id, { note: noteTA.value, updatedAt: Date.now() }).catch(() => {});
    }, 1000);
  });

  noteWrap.appendChild(noteTA);
  card.appendChild(noteWrap);

  // populate source content (async for media)
  fillSource(entry, content);

  return card;
}

function fillSource(entry, el) {
  switch (entry.type) {
    case 'TEXT': {
      const p = document.createElement('p');
      p.className = 'text-content';
      p.textContent = entry.textContent || '';
      el.appendChild(p);
      break;
    }
    case 'AUDIO': {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'none';
      el.appendChild(audio);

      if (entry.transcription) {
        const t = document.createElement('p');
        t.className = 'transcription';
        t.textContent = `«${entry.transcription}»`;
        el.appendChild(t);
      }
      if (entry.durationMs) {
        const d = document.createElement('span');
        d.className = 'meta';
        d.textContent = fmtDuration(entry.durationMs);
        el.appendChild(d);
      }
      if (entry.hasMedia) {
        api.blob(entry.id).then(url => { audio.src = url; }).catch(() => {});
      }
      break;
    }
    case 'PHOTO': {
      const img = document.createElement('img');
      img.className = 'media-img';
      img.alt = 'Фото';
      el.appendChild(img);
      if (entry.hasMedia) {
        api.blob(entry.id).then(url => { img.src = url; }).catch(() => {});
      }
      break;
    }
    case 'VIDEO': {
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'none';
      el.appendChild(video);
      if (entry.hasMedia) {
        api.blob(entry.id).then(url => { video.src = url; }).catch(() => {});
      }
      if (entry.thumbnailPath) {
        api.blob(entry.id, 'thumbnail').then(url => { video.poster = url; }).catch(() => {});
      }
      if (entry.durationMs) {
        const d = document.createElement('span');
        d.className = 'meta';
        d.textContent = fmtDuration(entry.durationMs);
        el.appendChild(d);
      }
      break;
    }
    case 'FILE': {
      const wrap = document.createElement('div');
      wrap.className = 'file-wrap';

      const link = document.createElement('a');
      link.className = 'file-link';
      link.textContent = entry.originalName || 'Файл';
      link.title = fmtSize(entry.fileSizeBytes);

      const size = document.createElement('span');
      size.className = 'meta';
      size.textContent = fmtSize(entry.fileSizeBytes);

      if (entry.hasMedia) {
        api.blob(entry.id).then(url => {
          link.href = url;
          link.download = entry.originalName || 'file';
        }).catch(() => {});
      }

      wrap.append(link, size);
      el.appendChild(wrap);
      break;
    }
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

function setStatus(msg, isError = false) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = isError ? 'err' : 'ok';
  setTimeout(() => { el.textContent = ''; el.className = ''; }, 3000);
}

async function loadSessions() {
  try {
    const sessions = await api.sessions();
    renderSessions(sessions);
    return sessions;
  } catch (e) {
    setStatus(`Ошибка ${e.status ?? ''}: ${e.message}`, true);
    return [];
  }
}

async function createSession() {
  const title = prompt('Название встречи:', '')?.trim();
  if (!title) return;
  const now = Date.now();
  const id = randomUUID();
  try {
    await api.createSession({ id, title, createdAt: now, updatedAt: now });
    await loadSessions();
    openSession(id);
    setStatus('Встреча создана ✓');
  } catch (e) {
    setStatus(`Ошибка ${e.status ?? ''}: ${e.message}`, true);
  }
}

async function deleteSession(s) {
  if (!confirm(`Удалить встречу «${s.title || 'Без названия'}»?`)) return;
  try {
    await api.deleteSession(s.id);
    if (currentSessionId === s.id) {
      currentSessionId = null;
      document.getElementById('feed').innerHTML = '<div class="hint">Выберите встречу</div>';
    }
    await loadSessions();
    setStatus('Встреча удалена ✓');
  } catch (e) {
    setStatus(`Ошибка ${e.status ?? ''}: ${e.message}`, true);
  }
}

async function openSession(id) {
  currentSessionId = id;

  document.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });

  const feed = document.getElementById('feed');
  feed.innerHTML = '<div class="hint">Загрузка…</div>';

  try {
    const entries = await api.entries(id);
    feed.innerHTML = '';

    if (!entries.length) {
      feed.innerHTML = '<div class="hint">Нет записей</div>';
      return;
    }

    [...entries]
      .sort((a, b) => a.createdAt - b.createdAt)
      .forEach(e => feed.appendChild(renderEntry(e)));
  } catch (e) {
    feed.innerHTML = `<div class="hint err">Ошибка: ${e.message}</div>`;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.getElementById('new-session-btn').addEventListener('click', createSession);

loadSessions();
