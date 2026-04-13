/**
 * GitHub API Client for HITO Journal
 * Handles all communication with the GitHub Contents API.
 */
class GitHubClient {
  constructor(token, repo, basePath) {
    this.token = token;
    this.repo = repo;
    this.basePath = basePath.replace(/^\/|\/$/g, '');
    this.apiBase = 'https://api.github.com';
    this.cache = new Map(); // path -> { content, sha, etag }
  }

  get headers() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  /**
   * Test the connection by fetching repo info.
   */
  async testConnection() {
    const res = await fetch(`${this.apiBase}/repos/${this.repo}`, {
      headers: this.headers,
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error('トークンが無効です');
      if (res.status === 404) throw new Error('リポジトリが見つかりません');
      throw new Error(`接続エラー: ${res.status}`);
    }
    return await res.json();
  }

  /**
   * Fetch the directory tree for a given path (recursive).
   * Returns an array of file paths relative to basePath.
   */
  async fetchTree(subPath = '') {
    const fullPath = subPath
      ? `${this.basePath}/${subPath}`
      : this.basePath;

    try {
      const res = await fetch(
        `${this.apiBase}/repos/${this.repo}/contents/${encodeURIComponent(fullPath)}`,
        { headers: this.headers }
      );
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`ツリー取得エラー: ${res.status}`);

      const items = await res.json();
      if (!Array.isArray(items)) return [];

      let files = [];
      for (const item of items) {
        if (item.type === 'file' && item.name.endsWith('.md')) {
          files.push({
            path: item.path,
            name: item.name,
            sha: item.sha,
          });
        } else if (item.type === 'dir') {
          const relPath = subPath ? `${subPath}/${item.name}` : item.name;
          const subFiles = await this.fetchTree(relPath);
          files = files.concat(subFiles);
        }
      }
      return files;
    } catch (err) {
      if (err.message.includes('404')) return [];
      throw err;
    }
  }

  /**
   * Fetch a single file's content.
   */
  async fetchFile(filePath) {
    const res = await fetch(
      `${this.apiBase}/repos/${this.repo}/contents/${encodeURIComponent(filePath)}`,
      { headers: this.headers }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`ファイル取得エラー: ${res.status}`);

    const data = await res.json();
    const content = this.decodeContent(data.content);

    this.cache.set(filePath, { content, sha: data.sha });
    return { content, sha: data.sha };
  }

  /**
   * Create or update a file.
   */
  async saveFile(filePath, content, message) {
    const cached = this.cache.get(filePath);
    const body = {
      message: message || `Update ${filePath}`,
      content: this.encodeContent(content),
    };
    if (cached && cached.sha) {
      body.sha = cached.sha;
    }

    const res = await fetch(
      `${this.apiBase}/repos/${this.repo}/contents/${encodeURIComponent(filePath)}`,
      {
        method: 'PUT',
        headers: { ...this.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 409) {
        throw new Error('競合が発生しました。再読み込みしてください。');
      }
      throw new Error(`保存エラー: ${res.status} ${err.message || ''}`);
    }

    const data = await res.json();
    this.cache.set(filePath, { content, sha: data.content.sha });
    return data;
  }

  /**
   * Build the file path for a given date.
   * Format: entries/YYYY/MM/YYYY-MM-DD.md
   */
  buildEntryPath(dateStr) {
    const [y, m] = dateStr.split('-');
    return `${this.basePath}/${y}/${m}/${dateStr}.md`;
  }

  /**
   * Extract date string from a file path.
   */
  extractDate(filePath) {
    const match = filePath.match(/(\d{4}-\d{2}-\d{2})\.md$/);
    return match ? match[1] : null;
  }

  // ---- Encoding helpers ----

  decodeContent(base64) {
    const bytes = Uint8Array.from(atob(base64.replace(/\n/g, '')), c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }

  encodeContent(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }
}
