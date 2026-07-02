/**
 * HITO Journal - Main Application
 */
(function () {
  'use strict';

  // ---- State ----
  let github = null;
  let anthropic = null;
  let rulesCache = null; // RULES.md の内容（整形プロンプト用にキャッシュ）
  let entries = new Map(); // dateStr -> { meta, body, path, sha }
  let currentView = 'dashboard';
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
    editorTitle: $('#editor-title'),
    editorTags: $('#editor-tags'),
    editorMood: $('#editor-mood'),
    editorTextarea: $('#editor-textarea'),
    editorPreview: $('#editor-preview'),
    editorFormat: $('#btn-editor-format'),
    editorTitleChips: $('#title-chips'),
    draftBanner: $('#draft-banner'),
    formatBar: $('#format-bar'),
    retryRow: $('#retry-row'),
    retryInstruction: $('#retry-instruction'),
    dictRow: $('#dict-row'),
    dictWrong: $('#dict-wrong'),
    dictRight: $('#dict-right'),
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
      if (config.anthropicKey) anthropic = new AnthropicClient(config.anthropicKey, config.model);
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

      renderDashboard();
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

  // ---- Dashboard ----

  function renderDashboard() {
    renderDashStats();
    renderDashHeatmap();
    renderDashTopTags();
    renderDashRecent();
  }

  function renderDashStats() {
    const total = entries.size;
    const now = new Date();
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let thisMonth = 0;
    for (const dateStr of entries.keys()) {
      if (dateStr.startsWith(thisMonthKey)) thisMonth++;
    }

    // Calculate streak
    const streak = calcStreak();

    $('#dash-stats').innerHTML = `
      <div class="dash-stat-card">
        <div class="dash-stat-value">${total}</div>
        <div class="dash-stat-label">総エントリ数</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-value">${thisMonth}</div>
        <div class="dash-stat-label">今月の記録</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-value">${streak}</div>
        <div class="dash-stat-label">連続日数</div>
      </div>
    `;
  }

  function calcStreak() {
    const sorted = [...entries.keys()].sort().reverse();
    if (sorted.length === 0) return 0;

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Start from today or yesterday
    let check = new Date(today);
    if (!entries.has(formatDateStr(check))) {
      check.setDate(check.getDate() - 1);
      if (!entries.has(formatDateStr(check))) return 0;
    }

    while (entries.has(formatDateStr(check))) {
      streak++;
      check.setDate(check.getDate() - 1);
    }
    return streak;
  }

  function renderDashHeatmap() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

    const el = $('#dash-heatmap');
    let html = '<div class="heatmap-grid">';
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${monthKey}-${String(d).padStart(2, '0')}`;
      const has = entries.has(ds);
      const isToday = ds === formatDateStr(now);
      let cls = 'heatmap-cell';
      if (has) cls += ' filled';
      if (isToday) cls += ' today';
      html += `<div class="${cls}" title="${ds}">${d}</div>`;
    }
    html += '</div>';

    // Rate
    let count = 0;
    for (const k of entries.keys()) {
      if (k.startsWith(monthKey)) count++;
    }
    const todayDate = now.getDate();
    const rate = todayDate > 0 ? Math.round((count / todayDate) * 100) : 0;
    html += `<div class="heatmap-rate">${rate}% の日に記録</div>`;

    el.innerHTML = html;
  }

  function renderDashTopTags() {
    const tagCount = new Map();
    for (const [, e] of entries) {
      for (const t of (e.meta.tags || [])) {
        tagCount.set(t, (tagCount.get(t) || 0) + 1);
      }
    }
    const top = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const el = $('#dash-top-tags');
    if (top.length === 0) {
      el.innerHTML = '<div class="dash-empty">タグがまだありません</div>';
      return;
    }
    const maxCount = top[0][1];
    el.innerHTML = top.map(([tag, count]) => {
      const pct = Math.round((count / maxCount) * 100);
      return `<div class="dash-tag-row">
        <span class="dash-tag-name">${escHtml(tag)}</span>
        <div class="dash-tag-bar-track"><div class="dash-tag-bar-fill" style="width:${pct}%"></div></div>
        <span class="dash-tag-count">${count}</span>
      </div>`;
    }).join('');
  }

  function renderDashRecent() {
    const recent = [...entries.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 3);
    const el = $('#dash-recent');
    if (recent.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="emoji">📝</div><p>まだ日記がありません</p></div>';
      return;
    }
    el.innerHTML = recent.map(([ds, e]) => entryCardHtml(ds, e)).join('');
  }

  // ---- Calendar ----

  function renderCalendar() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    dom.calendarTitle.textContent = `${year}年${month + 1}月`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7;
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

  // ---- 音声入力UX（v2.9）: 原文保護・下書き自動保存・タイトル候補 ----

  let formatState = { rawBackup: null, formattedText: null, showingOriginal: false, lastResult: null };

  function resetFormatUx() {
    formatState = { rawBackup: null, formattedText: null, showingOriginal: false, lastResult: null };
    dom.formatBar.style.display = 'none';
    dom.retryRow.style.display = 'none';
    dom.dictRow.style.display = 'none';
    dom.editorTitleChips.style.display = 'none';
    dom.editorTitleChips.innerHTML = '';
    $('#btn-toggle-original').textContent = '原文を表示';
  }

  const DRAFT_PREFIX = 'hito-journal-draft-';
  let draftTimer = null;

  function saveDraft() {
    if (!editorState.dateStr) return;
    const data = {
      text: dom.editorTextarea.value,
      title: dom.editorTitle.value,
      tags: dom.editorTags.value,
      mood: dom.editorMood.value,
      ts: Date.now(),
    };
    try { localStorage.setItem(DRAFT_PREFIX + editorState.dateStr, JSON.stringify(data)); } catch (_) {}
  }

  function scheduleDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 1500);
  }

  function loadDraft(dateStr) {
    try {
      const raw = localStorage.getItem(DRAFT_PREFIX + dateStr);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function clearDraft(dateStr) {
    try { localStorage.removeItem(DRAFT_PREFIX + dateStr); } catch (_) {}
  }

  function applyDraft(draft) {
    dom.editorTextarea.value = draft.text || '';
    if (draft.title) dom.editorTitle.value = draft.title;
    if (draft.tags) dom.editorTags.value = draft.tags;
    if (draft.mood) dom.editorMood.value = draft.mood;
  }

  function renderTitleChips(result) {
    const candidates = [result.title, ...(result.title_alts || [])].filter(Boolean);
    if (candidates.length < 2) {
      dom.editorTitleChips.style.display = 'none';
      dom.editorTitleChips.innerHTML = '';
      return;
    }
    dom.editorTitleChips.innerHTML = candidates.map(t =>
      `<button type="button" class="tag-chip title-chip" data-title="${escHtml(t)}">${escHtml(t)}</button>`
    ).join('');
    dom.editorTitleChips.style.display = 'flex';
  }

  function openEditor(dateStr, isNew = false) {
    editorState = { dateStr, isNew };
    dom.editorDateDisplay.textContent = Markdown.formatDate(dateStr);

    const entry = entries.get(dateStr);
    if (entry) {
      dom.editorTitle.value = entry.meta.title || '';
      dom.editorTags.value = (entry.meta.tags || []).join(', ');
      dom.editorMood.value = entry.meta.mood || '';
      dom.editorTextarea.value = entry.body;
    } else {
      dom.editorTitle.value = '';
      dom.editorTags.value = '';
      dom.editorMood.value = '';
      dom.editorTextarea.value = Markdown.defaultTemplate(dateStr);
    }

    // Show edit mode
    $$('.editor-tab').forEach(t => t.classList.remove('active'));
    $('.editor-tab[data-mode="edit"]').classList.add('active');
    dom.editorTextarea.style.display = 'block';
    dom.editorPreview.style.display = 'none';

    resetFormatUx();

    // 未保存の下書きがあれば復元を提案（音声入力の消失防止）
    const draft = loadDraft(dateStr);
    if (draft && draft.text && draft.text.trim() && draft.text !== dom.editorTextarea.value) {
      dom.draftBanner.style.display = 'flex';
    } else {
      dom.draftBanner.style.display = 'none';
    }

    dom.editorModal.style.display = 'flex';
    dom.editorTextarea.focus();
  }

  function closeEditor(skipDraftSave) {
    // 保存せずに閉じても書きかけが消えないよう、閉じる瞬間に下書き保存
    if (!skipDraftSave) saveDraft();
    dom.editorModal.style.display = 'none';
  }

  // ---- AI整形（音声入力 → 日記フォーマット）----

  async function getRules() {
    if (rulesCache !== null) return rulesCache;
    try {
      // RULES.md はリポルート（basePath=entries の外）なので直接パス指定
      const res = await github.fetchFile('RULES.md');
      rulesCache = res ? res.content : '';
    } catch (_) {
      rulesCache = '';
    }
    if (!rulesCache) {
      // 辞書なし整形は質が落ちるので、無言で進めず必ず知らせる
      showToast('RULES.md（整形ルール・辞書）を取得できませんでした。辞書なしで整形します', 'error');
    }
    return rulesCache;
  }

  /** 過去エントリの既存タグを使用頻度順で返す（タグの表記揺れ防止用） */
  function collectTagVocabulary(limit = 30) {
    const tagCount = new Map();
    for (const [, e] of entries) {
      for (const t of (e.meta.tags || [])) {
        tagCount.set(t, (tagCount.get(t) || 0) + 1);
      }
    }
    return [...tagCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag]) => tag);
  }

  async function formatWithAI() {
    if (!anthropic) {
      showToast('設定でAnthropic API Keyを入れると整形できます', 'error');
      openSettings();
      return;
    }
    // テンプレ空見出しは整形の妨げになるので送信前に除去（防御的・プロンプト指示の保険）
    const rawWithTemplate = dom.editorTextarea.value;
    const raw = Markdown.stripEmptyTemplateHeadings(rawWithTemplate);
    if (!raw) {
      showToast('整形するテキストがありません', 'error');
      return;
    }

    dom.editorFormat.disabled = true;
    showLoading('AIが日記に整形中...');
    const originalText = dom.editorTextarea.value; // 原文を保護（切替・再整形用）
    try {
      const rules = await getRules();
      const result = await anthropic.formatEntry(raw, editorState.dateStr, rules, collectTagVocabulary());

      // 本文が空で返ったら原文（音声入力）を消さない
      if (result.body) {
        formatState.rawBackup = originalText;
        formatState.formattedText = result.body;
        formatState.showingOriginal = false;
        formatState.lastResult = result;
        dom.editorTextarea.value = result.body;
        dom.formatBar.style.display = 'flex';
        $('#btn-toggle-original').textContent = '原文を表示';
        renderTitleChips(result);
      }
      if (result.title && !dom.editorTitle.value.trim()) dom.editorTitle.value = result.title;
      if (result.tags.length && !dom.editorTags.value.trim()) dom.editorTags.value = result.tags.join(', ');
      if (result.mood && !dom.editorMood.value) dom.editorMood.value = result.mood;

      hideLoading();
      scheduleDraftSave();
      showToast('整形しました', 'success');
    } catch (err) {
      // 失敗時は textarea に触らない＝口述した原文はそのまま残る
      hideLoading();
      showToast(`整形エラー: ${err.message}`, 'error');
    } finally {
      dom.editorFormat.disabled = false;
    }
  }

  /** 原文⇔整形結果の切り替え（それぞれの編集内容は保持する） */
  function toggleOriginal() {
    if (formatState.rawBackup === null) return;
    const btn = $('#btn-toggle-original');
    if (formatState.showingOriginal) {
      formatState.rawBackup = dom.editorTextarea.value;
      dom.editorTextarea.value = formatState.formattedText || '';
      formatState.showingOriginal = false;
      btn.textContent = '原文を表示';
    } else {
      formatState.formattedText = dom.editorTextarea.value;
      dom.editorTextarea.value = formatState.rawBackup || '';
      formatState.showingOriginal = true;
      btn.textContent = '整形結果に戻す';
    }
  }

  /** 原文をベースに、追加指示つきでもう一度整形する */
  async function retryFormat() {
    if (!anthropic) {
      showToast('設定でAnthropic API Keyを入れると整形できます', 'error');
      return;
    }
    const source = formatState.rawBackup !== null ? formatState.rawBackup : dom.editorTextarea.value;
    const raw = Markdown.stripEmptyTemplateHeadings(source);
    if (!raw) {
      showToast('整形するテキストがありません', 'error');
      return;
    }
    const instruction = dom.retryInstruction.value.trim();

    dom.editorFormat.disabled = true;
    showLoading('AIが整形し直しています...');
    try {
      const rules = await getRules();
      const result = await anthropic.formatEntry(raw, editorState.dateStr, rules, collectTagVocabulary(), instruction);
      if (result.body) {
        formatState.formattedText = result.body;
        formatState.showingOriginal = false;
        formatState.lastResult = result;
        dom.editorTextarea.value = result.body;
        $('#btn-toggle-original').textContent = '原文を表示';
        renderTitleChips(result);
      }
      if (result.mood && !dom.editorMood.value) dom.editorMood.value = result.mood;
      hideLoading();
      dom.retryRow.style.display = 'none';
      scheduleDraftSave();
      showToast('整形し直しました', 'success');
    } catch (err) {
      hideLoading();
      showToast(`整形エラー: ${err.message}`, 'error');
    } finally {
      dom.editorFormat.disabled = false;
    }
  }

  /** 誤変換ペアを Private リポの RULES.md 末尾（アプリ追加分セクション）へ追記する */
  async function addDictEntry() {
    const wrong = dom.dictWrong.value.trim();
    const right = dom.dictRight.value.trim();
    if (!wrong || !right) {
      showToast('「誤」と「正」を両方入れてください', 'error');
      return;
    }

    showLoading('辞書に追加中...');
    try {
      const res = await github.fetchFile('RULES.md'); // 最新sha取得
      if (!res) throw new Error('RULES.md を取得できません');
      const marker = '## アプリからの辞書追加分';
      let content = res.content.trimEnd();
      if (!content.includes(marker)) {
        content += `\n\n${marker}\n\n（アプリの「＋辞書」から追記。定期的に本体辞書へ統合する）`;
      }
      content += `\n- ${wrong} → ${right}\n`;
      await github.saveFile('RULES.md', content, `RULES: アプリから辞書追加（${wrong}→${right}）`);
      rulesCache = null; // 次回整形から反映
      dom.dictWrong.value = '';
      dom.dictRight.value = '';
      dom.dictRow.style.display = 'none';
      hideLoading();
      showToast(`辞書に追加しました: ${wrong} → ${right}`, 'success');
    } catch (err) {
      hideLoading();
      showToast(`辞書追加エラー: ${err.message}`, 'error');
    }
  }

  async function saveEntry() {
    const { dateStr } = editorState;
    const body = dom.editorTextarea.value;
    const tags = dom.editorTags.value
      .split(/[,、]/)
      .map(t => t.trim())
      .filter(Boolean);
    const mood = dom.editorMood.value;

    const title = dom.editorTitle.value.trim();

    const meta = { date: dateStr };
    if (title) meta.title = title;
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

      clearDraft(dateStr);
      closeEditor(true);
      renderDashboard();
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
    $('#settings-anthropic-key').value = config.anthropicKey || '';
    $('#settings-model').value = config.model || 'claude-sonnet-4-6';
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
        // カレンダータブは常に今日の月へスナップ（旧📅ボタンの機能を継承）
        if (tab.dataset.view === 'calendar') {
          calendarDate = new Date();
          renderCalendar();
        }
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
    for (const container of [dom.entryList, dom.tagResults, dom.searchResults, $('#dash-recent')]) {
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
    $('#btn-editor-back').addEventListener('click', () => closeEditor());
    $('#btn-editor-save').addEventListener('click', saveEntry);
    dom.editorFormat.addEventListener('click', formatWithAI);

    // 音声入力UX（v2.9）
    $('#btn-toggle-original').addEventListener('click', toggleOriginal);
    $('#btn-retry-format').addEventListener('click', () => {
      const visible = dom.retryRow.style.display !== 'none';
      dom.retryRow.style.display = visible ? 'none' : 'flex';
      if (!visible) dom.retryInstruction.focus();
    });
    $('#btn-retry-run').addEventListener('click', retryFormat);
    $('#btn-dict-add').addEventListener('click', () => {
      const visible = dom.dictRow.style.display !== 'none';
      dom.dictRow.style.display = visible ? 'none' : 'flex';
      if (!visible) dom.dictWrong.focus();
    });
    $('#btn-dict-save').addEventListener('click', addDictEntry);
    dom.editorTitleChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.title-chip');
      if (!chip) return;
      dom.editorTitle.value = chip.dataset.title;
      scheduleDraftSave();
    });
    $('#btn-draft-restore').addEventListener('click', () => {
      const draft = loadDraft(editorState.dateStr);
      if (draft) applyDraft(draft);
      dom.draftBanner.style.display = 'none';
      showToast('下書きを復元しました', 'success');
    });
    $('#btn-draft-discard').addEventListener('click', () => {
      clearDraft(editorState.dateStr);
      dom.draftBanner.style.display = 'none';
    });
    // 下書き自動保存（1.5秒デバウンス・音声入力の消失防止）
    dom.editorTextarea.addEventListener('input', scheduleDraftSave);
    dom.editorTitle.addEventListener('input', scheduleDraftSave);
    dom.editorTags.addEventListener('input', scheduleDraftSave);
    dom.editorMood.addEventListener('change', scheduleDraftSave);
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
      const anthropicKey = $('#settings-anthropic-key').value.trim();
      const model = $('#settings-model').value;

      showLoading('接続を確認中...');
      try {
        const client = new GitHubClient(token, repo, path);
        await client.testConnection();
        saveConfig({ token, repo, path, anthropicKey, model });
        github = client;
        anthropic = anthropicKey ? new AnthropicClient(anthropicKey, model) : null;
        rulesCache = null;
        closeSettings();
        await loadEntries();
      } catch (err) {
        hideLoading();
        showToast(err.message, 'error');
      }
    });
    $('#btn-clear-cache').addEventListener('click', () => {
      entries.clear();
      renderDashboard();
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
