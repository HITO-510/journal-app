/**
 * Anthropic (Claude) API Client for HITO Journal
 * iPhoneの音声入力（口述）の生テキストを、日記フォーマットに整形する。
 *
 * セキュリティ（このリポは Public のため厳守）:
 * - APIキーはこのコードに書かない。app.js が localStorage から渡す。
 * - 固有名詞辞書（家族の実名など）もここに書かない。Private な RULES.md を
 *   app.js が取得して渡してくるので、それをシステムプロンプトに動的注入する。
 *
 * 整形結果の受け取りはツール呼び出し（構造化出力）方式。
 * モデルにJSON文字列を書かせる方式と違い、API層でスキーマ検証されるため
 * 改行エスケープ崩れなどでパースに失敗することがない。
 */
class AnthropicClient {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
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

  get entryTool() {
    return {
      name: 'save_entry',
      description: '整形した日記エントリを保存する',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'その日を一言で表すタイトル（10〜20字程度）' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'タグを3〜6個。既存タグ一覧の語彙を優先し、同義の新タグを作らない',
          },
          mood: { type: 'string', enum: ['great', 'good', 'neutral', 'bad', 'terrible'] },
          body: { type: 'string', description: '## 見出し付きのMarkdown本文。frontmatterは含めない' },
        },
        required: ['title', 'tags', 'mood', 'body'],
      },
    };
  }

  /**
   * 生テキストを {title, tags, mood, body} に整形して返す。
   * @param {string} rawText  音声入力の生テキスト
   * @param {string} dateStr  YYYY-MM-DD
   * @param {string} rulesText  RULES.md の中身（整形ルール・固有名詞辞書）
   * @param {string[]} existingTags  過去エントリの既存タグ（使用頻度順）
   */
  async formatEntry(rawText, dateStr, rulesText, existingTags) {
    const system = this.buildSystemPrompt(rulesText);
    const tagHint = (existingTags && existingTags.length)
      ? `既存タグ一覧（使用頻度順・この語彙を優先する）: ${existingTags.join(', ')}\n\n`
      : '';

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: 8192,
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        ],
        tools: [this.entryTool],
        tool_choice: { type: 'tool', name: 'save_entry' },
        messages: [
          {
            role: 'user',
            content:
              `日付: ${dateStr}\n` +
              tagHint +
              `次の音声入力（口述）を、日記として整形してください。\n` +
              `--- 音声入力ここから ---\n${rawText}\n--- ここまで ---`,
          },
        ],
      }),
    });

    if (!res.ok) {
      let detail = '';
      try { const e = await res.json(); detail = e.error?.message || ''; } catch (_) {}
      if (res.status === 401) throw new Error('APIキーが無効です');
      if (res.status === 429) throw new Error('混み合っています。少し待って再試行してください');
      if (res.status === 400 && /credit/i.test(detail)) throw new Error('APIの残高が不足しています。チャージしてください');
      throw new Error(`${res.status} ${detail}`.trim());
    }

    const data = await res.json();
    if (data.stop_reason === 'max_tokens') {
      throw new Error('日記が長く、整形結果が途中で切れました。本文を2回に分けて整形してください');
    }
    const block = (data.content || []).find(b => b.type === 'tool_use' && b.name === 'save_entry');
    if (!block || !block.input) {
      throw new Error('整形結果を受け取れませんでした。もう一度試してください');
    }
    return this.normalizeResult(block.input);
  }

  buildSystemPrompt(rulesText) {
    return [
      'あなたはHITOさんの日記の整形担当です。',
      'iPhoneの音声入力で口述された生テキストを、本人の言葉を保ったまま読みやすい日記に整えます。',
      '',
      '## 整形ルール',
      '- 音声入力の誤変換は、まずRULES.mdの辞書と突き合わせて修正する（自分の推測より辞書を優先）',
      '- 同じ意味の繰り返し・言い直しはデデュープする（「頑張る頑張ろう」→「頑張ろう」）',
      '- フィラー（えーと/あの/言い直しの断片）は除去する',
      '- 過度な要約や省略はしない。本人の言葉・ニュアンスをなるべく残す',
      '- 入力テキストに「## 今日の出来事」「## 気づき・学び」「## 明日に向けて」のような空のテンプレ見出しが含まれていても完全に無視し、本文の流れに沿って新しく見出しを構成すること',
      '- 見出しはトピック型を基本とし、本人が時間帯（朝・昼・夜）に触れた場合のみ時間帯見出しを使う',
      '- 見出しは ## （H2）で、その日の流れに沿って3〜6個程度に分ける',
      '- 文体は常体（〜だ／〜した／〜と思う）。本人の口調に合わせる',
      '- 改行は多めに。段落を分けて読みやすくする',
      '- タグは既存タグ一覧の語彙を優先する。同義の新タグ（表記揺れ）を作らない',
      '- 入力が短くても必ず整形を完遂する。空文字列を返してはならない',
      '',
      '## 日記リポジトリのルール（RULES.md・最優先で従う）',
      '※ 固有名詞・音声誤変換の辞書はここに含まれる。最優先で適用すること。',
      rulesText || '(取得できませんでした。上記の一般ルールで整形してください)',
      '',
      '整形が終わったら、必ず save_entry ツールで結果を返すこと。',
    ].join('\n');
  }

  normalizeResult(input) {
    const moods = ['great', 'good', 'neutral', 'bad', 'terrible'];
    return {
      title: typeof input.title === 'string' ? input.title.trim() : '',
      tags: Array.isArray(input.tags) ? input.tags.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [],
      mood: moods.includes(input.mood) ? input.mood : '',
      body: typeof input.body === 'string' ? input.body.trim() : '',
    };
  }
}
