/**
 * Anthropic (Claude) API Client for HITO Journal
 * iPhoneの音声入力（口述）の生テキストを、日記フォーマットに整形する。
 *
 * セキュリティ（このリポは Public のため厳守）:
 * - APIキーはこのコードに書かない。app.js が localStorage から渡す。
 * - 固有名詞辞書（家族の実名など）もここに書かない。Private な RULES.md を
 *   app.js が取得して渡してくるので、それをシステムプロンプトに動的注入する。
 */
class AnthropicClient {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    // 質を上げたいときは 'claude-opus-4-8' に変更（コスト増・速度低下）
    this.model = model || 'claude-sonnet-4-6';
    this.endpoint = 'https://api.anthropic.com/v1/messages';
  }

  get headers() {
    return {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      // ブラウザからの直接呼び出しを許可（Anthropic公式）
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  /**
   * 生テキストを {title, tags, mood, body} に整形して返す。
   * @param {string} rawText  音声入力の生テキスト
   * @param {string} dateStr  YYYY-MM-DD
   * @param {string} rulesText  RULES.md の中身（整形ルール・固有名詞辞書）
   */
  async formatEntry(rawText, dateStr, rulesText) {
    const system = this.buildSystemPrompt(rulesText);

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          {
            role: 'user',
            content:
              `日付: ${dateStr}\n\n` +
              `次の音声入力（口述）を、日記として整形してください。\n` +
              `--- 音声入力ここから ---\n${rawText}\n--- ここまで ---`,
          },
          // prefill: JSONの開始を固定して出力を安定させる
          { role: 'assistant', content: '{' },
        ],
      }),
    });

    if (!res.ok) {
      let detail = '';
      try { const e = await res.json(); detail = e.error?.message || ''; } catch (_) {}
      if (res.status === 401) throw new Error('APIキーが無効です');
      if (res.status === 429) throw new Error('混み合っています。少し待って再試行してください');
      throw new Error(`${res.status} ${detail}`.trim());
    }

    const data = await res.json();
    const text = '{' + (data.content && data.content[0] ? data.content[0].text : '');
    return this.parseResult(text);
  }

  buildSystemPrompt(rulesText) {
    return [
      'あなたはHITOさんの日記の整形担当です。',
      'iPhoneの音声入力で口述された生テキストを、本人の言葉を保ったまま読みやすい日記に整えます。',
      '',
      '## 整形ルール',
      '- 音声入力の誤変換は文脈から判断して修正する',
      '- 同じ意味の繰り返し・言い直しはデデュープする（「頑張る頑張ろう」→「頑張ろう」）',
      '- フィラー（えーと/あの/言い直しの断片）は除去する',
      '- 過度な要約や省略はしない。本人の言葉・ニュアンスをなるべく残す',
      '- 見出しはトピック型を基本とし、本人が時間帯（朝・昼・夜）に触れた場合のみ時間帯見出しを使う',
      '- 見出しは ## （H2）で、その日の流れに沿って3〜6個程度に分ける',
      '- 文体は常体（〜だ／〜した／〜と思う）。本人の口調に合わせる',
      '- 改行は多めに。段落を分けて読みやすくする',
      '',
      '## 日記リポジトリのルール（RULES.md・最優先で従う）',
      '※ 固有名詞・音声誤変換の辞書はここに含まれる。最優先で適用すること。',
      rulesText || '(取得できませんでした。上記の一般ルールで整形してください)',
      '',
      '## 出力形式',
      '必ず次のJSONオブジェクト**のみ**を出力する（前後に説明文やコードフェンスを付けない）。',
      '{',
      '  "title": "その日を一言で表すタイトル（10〜20字程度）",',
      '  "tags": ["タグを3〜6個。人名・出来事・活動など"],',
      '  "mood": "great|good|neutral|bad|terrible のいずれか1つ",',
      '  "body": "## 見出し\\n\\n本文…（Markdown本文のみ。frontmatterは含めない）"',
      '}',
    ].join('\n');
  }

  parseResult(jsonText) {
    let t = (jsonText || '').trim();
    // 念のためコードフェンスを除去
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    try {
      const obj = JSON.parse(t);
      const moods = ['great', 'good', 'neutral', 'bad', 'terrible'];
      return {
        title: typeof obj.title === 'string' ? obj.title.trim() : '',
        tags: Array.isArray(obj.tags) ? obj.tags.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [],
        mood: moods.includes(obj.mood) ? obj.mood : '',
        body: typeof obj.body === 'string' ? obj.body.trim() : '',
      };
    } catch (_) {
      // JSONとして読めなければ全文をbodyに入れて手当て
      return { title: '', tags: [], mood: '', body: (jsonText || '').trim(), _parseError: true };
    }
  }
}
