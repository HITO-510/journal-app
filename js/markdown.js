/**
 * Markdown utilities for HITO Journal
 * - YAML frontmatter parsing/serialization
 * - Simple Markdown → HTML conversion
 * - Legacy format (no frontmatter) support
 */

const Markdown = {
  /**
   * Parse a journal entry string into { meta, body }.
   * Handles both frontmatter and legacy (H1 title) formats.
   */
  parse(text) {
    if (!text) return { meta: {}, body: '' };

    // Try YAML frontmatter
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (fmMatch) {
      const meta = this.parseFrontmatter(fmMatch[1]);
      return { meta, body: fmMatch[2].trim() };
    }

    // Legacy: # YYYY-MM-DD（曜日）タイトル
    const h1Match = text.match(/^# (.+)\n([\s\S]*)$/);
    if (h1Match) {
      const title = h1Match[1];
      const dateMatch = title.match(/(\d{4}-\d{2}-\d{2})/);
      const meta = {};
      if (dateMatch) meta.date = dateMatch[1];
      meta.title = title;
      return { meta, body: h1Match[2].trim() };
    }

    return { meta: {}, body: text.trim() };
  },

  /**
   * Serialize { meta, body } back to a Markdown string with frontmatter.
   */
  serialize(meta, body) {
    const lines = ['---'];
    if (meta.date) lines.push(`date: ${meta.date}`);
    if (meta.title) lines.push(`title: "${meta.title.replace(/"/g, '\\"')}"`);
    if (meta.tags && meta.tags.length > 0) {
      lines.push(`tags: [${meta.tags.join(', ')}]`);
    }
    if (meta.mood) lines.push(`mood: ${meta.mood}`);
    lines.push('---');
    lines.push('');
    lines.push(body);
    return lines.join('\n');
  },

  /**
   * Parse simple YAML frontmatter (key: value).
   */
  parseFrontmatter(yaml) {
    const meta = {};
    for (const line of yaml.split('\n')) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (!match) continue;
      const [, key, rawVal] = match;
      let val = rawVal.trim();

      // Array: [a, b, c]
      if (val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      }
      // Quoted string
      else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }

      meta[key] = val;
    }
    return meta;
  },

  /**
   * Convert Markdown to HTML (simple subset).
   */
  toHtml(md) {
    if (!md) return '';

    let html = md;

    // Escape HTML
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Code blocks (``` ... ```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Blockquote
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    // Merge adjacent blockquotes
    html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

    // Horizontal rule
    html = html.replace(/^---$/gm, '<hr>');

    // Bold and italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Unordered list
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Paragraphs: wrap remaining text lines
    html = html.replace(/^(?!<[hulpbo]|$)(.+)$/gm, '<p>$1</p>');

    // Clean up extra newlines
    html = html.replace(/\n{2,}/g, '\n');

    return html;
  },

  /**
   * Extract title from body text (first H2 content or first line).
   */
  extractTitle(meta, body) {
    if (meta.title) return meta.title;
    const h2 = body.match(/^## (.+)$/m);
    if (h2) return h2[1];
    const firstLine = body.split('\n').find(l => l.trim());
    return firstLine ? firstLine.replace(/^#+\s*/, '').slice(0, 60) : '(無題)';
  },

  /**
   * Extract excerpt from body text.
   */
  extractExcerpt(body, maxLen = 120) {
    const text = body
      .replace(/^#+\s.*$/gm, '')
      .replace(/^[-*]\s/gm, '')
      .replace(/\n+/g, ' ')
      .trim();
    return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
  },

  /**
   * Get default template for a new entry.
   */
  defaultTemplate(dateStr) {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const d = new Date(dateStr + 'T00:00:00');
    const dayName = days[d.getDay()];
    return [
      `## 今日の出来事`,
      '',
      '',
      '',
      `## 気づき・学び`,
      '',
      '',
      '',
      `## 明日に向けて`,
      '',
      '',
    ].join('\n');
  },

  /**
   * Format a date string for display.
   */
  formatDate(dateStr) {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${days[d.getDay()]}）`;
  },
};
