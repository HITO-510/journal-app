/**
 * HITO Journal - Main Application
 */
(function () {
  'use strict';

  // ---- State ----
  let github = null;
  let entries = new Map(); // dateStr -> { meta, body, path, sha }
  let currentView = 'calendar';
  let calendarDate = new Date(); // current month being displayed
  let activeTag = null;

  // ---- DOM refs ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    setupScreen: $('#setup-screen'),
    app: $('#app'),
    setupForm: $('#setup-form'),
    loading: $('#loading'),
    loadingText: $('#loading-text'),
    toast: $('#toast'),
    // Calendar
    calendarTitle: $('#calendar-title'),
    calendarGrid: $('#calendar-grid'),
    // List
    entryList: $('#entry-list'),
    // Tags
    tagCloud: $('#tag-cloud'),
    tagResults: $('#tag-results'),
    // Search
    searchBar: $('#search-bar'),
    searchInput: $('#search-input'),
    searchResults: $('#search-results'),
    // Editor
    editorModal: $('#editor-modal'),
    editorDateDisplay: $('#editor-date-display'),
    editorTags: $('#editor-tags'),
    editorMood: $('#editor-mood'),
    editorTextarea: $('#editor-textarea'),
    editorPreview: $('#editor-preview'),
    // Viewer
    viewerModal: $('#viewer-modal'),
    viewerDateDisplay: $('#viewer-date-display'),
    viewerTags: $('#viewer-tags'),
    viewerBody: $('#viewer-body'),
    // Settings
    settingsModal: $('#settings-modal'),
  };

  // ---- Initialization ----

  async function init() {
    const config = loadConfig();
    if (config) {
      github = new GitHubClient(config.token, config.repo, config.path);
      showApp();
      await loadEntries();
    } else {
      showSetup();
    }
    bindEvents();
  }

  // ---- Config (localStorage) ----

  function loadConfig() {
    const raw = localStorage.getItem('hito-journal-config');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function saveConfig(config) {
    localStorage.setItem('hito-journal-config', JSON.stringify(config));
  }

  // ---- UI Helpers ----

  function showSetup() {
    dom.setupScreen.style.display = 'flex';
    dom.app.style.display = 'none';
  }

  function showApp() {
    dom.setupScreen.style.display = 'none';
    dom.app.style.display = 'flex';
  }

  function showLoading(text = '読み込み中...') {
    dom.loadingText.textContent = text;
    dom.loading.style.display = 'flex';
  }

  function hideLoading() {
    dom.loading.style.display = 'none';
  }

  function showToast(msg, type = '') {
    dom.toast.textContent = msg;
    dom.toast.className = 'toast' + (type ? ` ${type}` : '');
    dom.toast.style.display = 'block';
    clearTimeout(dom.toast._timer);
    dom.toast._timer = setTimeout(() => {
      dom.toast.style.display = 'none';
    }, 3000);
  }

  function switchView(name) {
    currentView = name;
    $$('.view').forEach(v => v.classList.remove('active'));
    $$('.tab').forEach(t => t.classList.remove('active'));
    const viewEl = $(`#view-${name}`);
    if (viewEl) viewEl.classList.add('active');
    const tabEl = $(`.tab[data-view="${name}"]`);
    if (tabEl) tabEl.classList.add('active');
  }

  // ---- Data Loading ----

  async function loadEntries() {
    showLoading('日記を読み込み中...');
    try {
      const files = await github.fetchTree();
      entries.clear();

      // Fetch all files in parallel (batched)
      const batchSize = 10;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(f => github.fetchFile(f.path).then(res => ({ file: f, res })))
        );
        for (const { file, res } of results) {
          if (!res) continue;
          const dateStr = github.extractDate(file.path);
          if (!dateStr) continue;
          const parsed = Markdown.parse(res.content);
          if (!parsed.meta.date) parsed.meta.date = dateStr;
          entries.set(dateStr, {
            meta: parsed.meta,
            body: parsed.body,
            path: file.path,
            sha: res.sha,
            raw: res.content,
          });
        }
      }

      renderCalendar();
      renderList();
      renderTags();
      hideLoading();
    } catch (err) {
      hideLoading();
      showToast(`読み込みエラー: ${err.message}`, 'error');
      console.error(err);
    }
  }

  // ---- Calendar ----

  function renderCalendar() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    dom.calendarTitle.textContent = `${year}年${month + 1}月`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const today = new Date();
    const todayStr = formatDateStr(today);

    let html = '';

    // Previous month's trailing days
    const prevLast = new Date(year, month, 0).getDate();
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = prevLast - i;
      const prevMonth = month === 0 ? 12 : month;
      const prevYear = month === 0 ? year - 1 : year;
      const ds = formatDateStr(new Date(prevYear, prevMonth - 1, d));
      const hasEntry = entries.has(ds);
      html += `<div class="calendar-day other-month${hasEntry ? ' has-entry' : ''}" data-date="${ds}">${d}</div>`;
    }

    // Current month
    for (let d = 1; d <= totalDays; d++) {
      const ds = formatDateStr(new Date(year, month, d));
      const isToday = ds === todayStr;
      const hasEntry = entries.has(ds);
      let cls = 'calendar-day';
      if (isToday) cls += ' today';
      if (hasEntry) cls += ' has-entry';
      html += `<div class="${cls}" data-date="${ds}">${d}</div>`;
    }

    // Next month's leading days
    const remaining = 42 - (startOffset + totalDays);
    for (let d = 1; d <= remaining; d++) {
      const nextMonth = month + 1;
      const nextYear = nextMonth > 11 ? year + 1 : year;
      const ds = formatDateStr(new Date(nextYear, nextMonth % 12, d));
      const hasEntry = entries.has(ds);
      html += `<div class="calendar-day other-month${hasEntry ? ' has-entry' : ''}" data-date="${ds}">${d}</div>`;
    }

    dom.calendarGrid.innerHTML = html;
  }

  // ---- List View ----

  function renderList() {
    const sorted = [...entries.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    if (sorted.length === 0) {
      dom.entryList.innerHTML = `
        <div class="empty-state">
          <div class="emoji">📝</div>
          <p>まだ日記がありません。<br>右下のボタンから書き始めましょう！</p>
        </div>`;
      return;
    }
    dom.entryList.innerHTML = sorted.map(([dateStr, entry]) => entryCardHtml(dateStr, entry)).join('');
  }

  function entryCardHtml(dateStr, entry) {
    const title = Markdown.extractTitle(entry.meta, entry.body);
    const excerpt = Markdown.extractExcerpt(entry.body);
    const tags = (entry.meta.tags || []);
    const tagsHtml = tags.map(t => `<span class="tag-badge">${escHtml(t)}</span>`).join('');
    return `
      <div class="entry-card" data-date="${dateStr}">
        <div class="entry-card-date">${Markdown.formatDate(dateStr)}</div>
        <div class="entry-card-title">${escHtml(title)}</div>
        <div class="entry-card-excerpt">${escHtml(excerpt)}</div>
        ${tagsHtml ? `<div class="entry-card-tags">${tagsHtml}</div>` : ''}
      </div>`;
  }

  // ---- Tag View ----

  function renderTags() {
    const tagCount = new Map();
    for (const [, entry] of entries) {
      const tags = entry.meta.tags || [];
      for (const t of tags) {
        tagCount.set(t, (tagCount.get(t) || 0) + 1);
      }
    }
    const sorted = [...tagCount.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
      dom.tagCloud.innerHTML = '<div class="empty-state"><p>タグ付きの日記がまだありません</p></div>';
      dom.tagResults.innerHTML = '';
      return;
    }
    dom.tagCloud.innerHTML = sorted.map(([tag, count]) =>
      `<button class="tag-chip${activeTag === tag ? ' active' : ''}" data-tag="${escHtml(tag)}">${escHtml(tag)}<span class="tag-count">${count}</span></button>`
    ).join('');

    if (activeTag) {
      renderTagResults(activeTag);
    } else {
      dom.tagResults.innerHTML = '';
    }
  }

  function renderTagResults(tag) {
    const matched = [...entries.entries()]
      .filter(([, e]) => (e.meta.tags || []).includes(tag))
      .sort((a, b) => b[0].localeCompare(a[0]));
    dom.tagResults.innerHTML = matched.map(([ds, e]) => entryCardHtml(ds, e)).join('');
  }

  // ---- Search ----

  function performSearch(query) {
    if (!query.trim()) {
      dom.searchResults.innerHTML = '';
      return;
    }
    const q = query.toLowerCase();
    const matched = [...entries.entries()]
      .filter(([dateStr, e]) => {
        const text = `${dateStr} ${e.body} ${(e.meta.tags || []).join(' ')} ${e.meta.title || ''}`.toLowerCase();
        return text.includes(q);
      })
      .sort((a, b) => b[0].localeCompare(a[0]));

    if (matched.length === 0) {
      dom.searchResults.innerHTML = `<div class="empty-state"><p>「${escHtml(query)}」に一致する日記が見つかりません</p></div>`;
    } else {
      dom.searchResults.innerHTML = matched.map(([ds, e]) => entryCardHtml(ds, e)).join('');
    }
  }

  // ---- Editor ----

  let editorState = { dateStr: '', isNew: false };

  function openEditor(dateStr, isNew = false) {
    editorState = { dateStr, isNew };
    dom.editorDateDisplay.textContent = Markdown.formatDate(dateStr);

    const entry = entries.get(dateStr);
    if (entry) {
      dom.editorTags.value = (entry.meta.tags || []).join(', ');
      dom.editorMood.value = entry.meta.mood || '';
      dom.editorTextarea.value = entry.body;
    } else {
      dom.editorTags.value = '';
      dom.editorMood.value = '';
      dom.editorTextarea.value = Markdown.defaultTemplate(dateStr);
    }

    // Show edit mode
    $$('.editor-tab').forEach(t => t.classList.remove('active'));
    $('.editor-tab[data-mode="edit"]').classList.add('active');
    dom.editorTextarea.style.display = 'block';
    dom.editorPreview.style.display = 'none';

    dom.editorModal.style.display = 'flex';
    dom.editorTextarea.focus();
  }

  function closeEditor() {
    dom.editorModal.style.display = 'none';
  }

  async function saveEntry() {
    const { dateStr } = editorState;
    const body = dom.editorTextarea.value;
    const tags = dom.editorTags.value
      .split(/[,、]/)
      .map(t => t.trim())
      .filter(Boolean);
    const mood = dom.editorMood.value;

    const meta = { date: dateStr };
    if (tags.length) meta.tags = tags;
    if (mood) meta.mood = mood;

    const content = Markdown.serialize(meta, body);
    const filePath = github.buildEntryPath(dateStr);

    showLoading('保存中...');
    try {
      await github.saveFile(filePath, content, `journal: ${dateStr}`);

      // Update local cache
      entries.set(dateStr, {
        meta,
        body,
        path: filePath,
        sha: github.cache.get(filePath)?.sha,
        raw: content,
      });

      closeEditor();
      renderCalendar();
      renderList();
      renderTags();
      hideLoading();
      showToast('保存しました', 'success');
    } catch (err) {
      hideLoading();
      showToast(`保存エラー: ${err.message}`, 'error');
    }
  }

  // ---- Viewer ----

  let viewerDateStr = '';

  function openViewer(dateStr) {
    const entry = entries.get(dateStr);
    if (!entry) return;
    viewerDateStr = dateStr;

    dom.viewerDateDisplay.textContent = Markdown.formatDate(dateStr);

    const tags = entry.meta.tags || [];
    dom.viewerTags.innerHTML = tags.map(t => `<span class="tag-badge">${escHtml(t)}</span>`).join('');

    // Show mood if available
    const moodEmoji = { great: '😊', good: '🙂', neutral: '😐', bad: '😞', terrible: '😢' };
    const moodStr = entry.meta.mood && moodEmoji[entry.meta.mood]
      ? `<span class="tag-badge">${moodEmoji[entry.meta.mood]}</span>` : '';
    if (moodStr) dom.viewerTags.innerHTML += moodStr;

    dom.viewerBody.innerHTML = Markdown.toHtml(entry.body);
    dom.viewerModal.style.display = 'flex';
  }

  function closeViewer() {
    dom.viewerModal.style.display = 'none';
  }

  // ---- Settings ----

  function openSettings() {
    const config = loadConfig() || {};
    $('#settings-token').value = config.token || '';
    $('#settings-repo').value = config.repo || '';
    $('#settings-path').value = config.path || 'entries';
    dom.settingsModal.style.display = 'flex';
  }

  function closeSettings() {
    dom.settingsModal.style.display = 'none';
  }

  // ---- Event Binding ----

  function bindEvents() {
    // Setup form
    dom.setupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = $('#setup-token').value.trim();
      const repo = $('#setup-repo').value.trim();
      const path = $('#setup-path').value.trim() || 'entries';

      showLoading('接続を確認中...');
      try {
        const client = new GitHubClient(token, repo, path);
        await client.testConnection();
        saveConfig({ token, repo, path });
        github = client;
        showApp();
        await loadEntries();
      } catch (err) {
        hideLoading();
        showToast(err.message, 'error');
      }
    });

    // Navigation tabs
    $$('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        switchView(tab.dataset.view);
      });
    });

    // Calendar navigation
    $('#btn-prev-month').addEventListener('click', () => {
      calendarDate.setMonth(calendarDate.getMonth() - 1);
      renderCalendar();
    });
    $('#btn-next-month').addEventListener('click', () => {
      calendarDate.setMonth(calendarDate.getMonth() + 1);
      renderCalendar();
    });
    $('#btn-today').addEventListener('click', () => {
      calendarDate = new Date();
      switchView('calendar');
      renderCalendar();
    });

    // Calendar day click
    dom.calendarGrid.addEventListener('click', (e) => {
      const dayEl = e.target.closest('.calendar-day');
      if (!dayEl) return;
      const dateStr = dayEl.dataset.date;
      if (entries.has(dateStr)) {
        openViewer(dateStr);
      } else {
        openEditor(dateStr, true);
      }
    });

    // Entry card click (list, tags, search)
    for (const container of [dom.entryList, dom.tagResults, dom.searchResults]) {
      container.addEventListener('click', (e) => {
        const card = e.target.closest('.entry-card');
        if (!card) return;
        openViewer(card.dataset.date);
      });
    }

    // Tag chip click
    dom.tagCloud.addEventListener('click', (e) => {
      const chip = e.target.closest('.tag-chip');
      if (!chip) return;
      const tag = chip.dataset.tag;
      activeTag = (activeTag === tag) ? null : tag;
      renderTags();
    });

    // Search
    $('#btn-search').addEventListener('click', () => {
      const visible = dom.searchBar.style.display !== 'none';
      if (visible) {
        dom.searchBar.style.display = 'none';
        switchView(currentView === 'search' ? 'calendar' : currentView);
      } else {
        dom.searchBar.style.display = 'flex';
        dom.searchInput.focus();
      }
    });
    $('#btn-search-close').addEventListener('click', () => {
      dom.searchBar.style.display = 'none';
      dom.searchInput.value = '';
      switchView('calendar');
    });
    dom.searchInput.addEventListener('input', (e) => {
      switchView('search');
      $(`#view-search`).classList.add('active');
      performSearch(e.target.value);
    });

    // New entry FAB
    $('#btn-new-entry').addEventListener('click', () => {
      const today = formatDateStr(new Date());
      openEditor(today, !entries.has(today));
    });

    // Editor
    $('#btn-editor-back').addEventListener('click', closeEditor);
    $('#btn-editor-save').addEventListener('click', saveEntry);
    $$('.editor-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.editor-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        if (tab.dataset.mode === 'edit') {
          dom.editorTextarea.style.display = 'block';
          dom.editorPreview.style.display = 'none';
        } else {
          dom.editorTextarea.style.display = 'none';
          dom.editorPreview.style.display = 'block';
          dom.editorPreview.innerHTML = Markdown.toHtml(dom.editorTextarea.value);
        }
      });
    });

    // Viewer
    $('#btn-viewer-back').addEventListener('click', closeViewer);
    $('#btn-viewer-edit').addEventListener('click', () => {
      closeViewer();
      openEditor(viewerDateStr);
    });

    // Settings
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-settings-back').addEventListener('click', closeSettings);
    $('#settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = $('#settings-token').value.trim();
      const repo = $('#settings-repo').value.trim();
      const path = $('#settings-path').value.trim() || 'entries';

      showLoading('接続を確認中...');
      try {
        const client = new GitHubClient(token, repo, path);
        await client.testConnection();
        saveConfig({ token, repo, path });
        github = client;
        closeSettings();
        await loadEntries();
      } catch (err) {
        hideLoading();
        showToast(err.message, 'error');
      }
    });
    $('#btn-clear-cache').addEventListener('click', () => {
      entries.clear();
      renderCalendar();
      renderList();
      renderTags();
      showToast('キャッシュをクリアしました');
    });

    // Menu (reload)
    $('#btn-menu').addEventListener('click', async () => {
      await loadEntries();
      showToast('再読み込みしました', 'success');
    });
  }

  // ---- Utilities ----

  function formatDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- Start ----
  document.addEventListener('DOMContentLoaded', init);
})();
