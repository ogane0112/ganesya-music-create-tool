import { describe, expect, it } from 'vitest';
import { handleMcp } from '../worker/mcp.js';
import { conflict, notFound } from '../worker/db.js';
import { formatGuide } from '../worker/guide.js';
import { validateSong } from '../src/core/validate.js';

/** D1 の代わりの、メモリ上の保存先 @returns {import('../worker/db.js').SongStore} */
function memoryStore() {
  /** @type {Map<string, any>} */
  const songs = new Map();
  let n = 0;
  return {
    async list() { return [...songs].map(([id, s]) => ({ id, title: s.meta.title, updatedAt: s.meta.updatedAt, revision: s.revision })); },
    async get(id) { const s = songs.get(id); if (!s) throw notFound(); return structuredClone(s); },
    async create(song) { const id = `song${++n}`; const saved = { ...song, revision: 1 }; songs.set(id, saved); return { id, song: saved }; },
    async update(id, song, revision) {
      const cur = songs.get(id);
      if (!cur) throw notFound();
      if (cur.revision !== revision) throw conflict();
      const saved = { ...song, revision: revision + 1 };
      songs.set(id, saved);
      return saved;
    },
    async remove(id) { songs.delete(id); },
  };
}

function client() {
  const ctx = { store: memoryStore() };
  let id = 0;
  /** @param {string} method @param {any} [params] */
  const rpc = async (method, params) => {
    const res = await handleMcp(new Request('https://x/mcp/k', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }), ctx);
    return /** @type {any} */ (await res.json());
  };
  /** @param {string} name @param {any} [args] */
  const call = async (name, args = {}) => {
    const r = (await rpc('tools/call', { name, arguments: args })).result;
    const text = r.content[0].text;
    return { isError: !!r.isError, text, data: r.isError || !text.startsWith('{') ? null : JSON.parse(text), content: r.content };
  };
  return { rpc, call, ctx };
}

/** 手引きの作例を取り出す */
function guideExample() {
  const m = /```json\n([\s\S]+?)\n```/.exec(formatGuide());
  if (!m) throw new Error('作例がない');
  return JSON.parse(m[1]);
}

describe('MCP', () => {
  it('つなぐ、道具の一覧(10個)、知らない呼び方', async () => {
    const { rpc } = client();
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(init.result.protocolVersion).toBe('2025-06-18');
    expect(init.result.capabilities.tools).toBeDefined();
    const list = await rpc('tools/list');
    expect(list.result.tools.map((/** @type {any} */ t) => t.name)).toEqual([
      'get_format_guide', 'list_songs', 'get_song', 'create_song', 'generate_alternatives', 'replace_section', 'update_arrangement', 'set_lyrics', 'update_song_settings', 'export_midi',
    ]);
    for (const t of list.result.tools) expect(t.inputSchema.type).toBe('object');
    expect((await rpc('nope')).error.code).toBe(-32601);
  });

  it('通知には 202 で何も返さない', async () => {
    const res = await handleMcp(new Request('https://x/mcp/k', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }), { store: memoryStore() });
    expect(res.status).toBe(202);
  });

  it('手引きの作例がそのまま通る', async () => {
    const { call, ctx } = client();
    expect((await call('get_format_guide')).text).toMatch('かんたん記法');
    const r = await call('create_song', { title: '作例', mood: 'setsunai', tempo: 92, key: { tonic: 'A', mode: 'minor' }, sections: [guideExample()] });
    expect(r.isError).toBe(false);
    expect(r.data.sections[0].chords).toBe(guideExample().chords);
    const song = await ctx.store.get(r.data.songId);
    expect(validateSong(song).ok).toBe(true);
  });

  it('曲を作る→読む→メロディを書き換える→並びを変える→設定を変える→MIDI', async () => {
    const { call } = client();
    const created = (await call('create_song', {
      title: '夜明け', mood: 'setsunai', tempo: 88, key: { tonic: 'A', mode: 'minor' },
      sections: [
        { name: 'Aメロ', kind: 'verse', bars: 2, chords: 'Am7:4 Fmaj7:4', melody: 'r:0.5 A3:0.5 C4:0.5 E4:0.5 E4:2 | D4:1 C4:1 A3:2' },
        { name: 'サビ', kind: 'chorus', bars: 2, chords: 'Fmaj7:4 E7:4', melody: 'A4:2 G4:1 E4:1 | G#4:2 B4:2' },
      ],
    })).data;
    expect(created.revision).toBe(1);
    expect(created.sections.map((/** @type {any} */ s) => s.name)).toEqual(['Aメロ', 'サビ']);
    const [verse, chorus] = created.sections;

    const got = (await call('get_song', { songId: created.songId })).data;
    expect(got.sections[1].melody).toContain('B4:2');

    const r2 = await call('replace_section', { songId: created.songId, revision: 1, sectionId: chorus.sectionId, melody: 'E5:2 D5:1 C5:1 | B4:2 G#4:2' });
    expect(r2.isError).toBe(false);
    expect(r2.data.revision).toBe(2);
    expect(r2.data.sections[1].melody).toContain('E5:2 D5:1 C5:1');
    expect(r2.data.sections[1].chords).toBe('Fmaj7:4 E7:4');

    // 古い revision は断られる
    const stale = await call('replace_section', { songId: created.songId, revision: 1, sectionId: chorus.sectionId, melody: 'E5:4' });
    expect(stale.isError).toBe(true);
    expect(stale.text).toMatch('revision_conflict');

    // キーにもコードにも合わない音は、場所付きで断られる
    const bad = await call('replace_section', { songId: created.songId, revision: 2, sectionId: verse.sectionId, melody: 'A3:1 C#4:1 E4:2' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/Aメロ の 1小節目 2拍目.*C#4/);

    const r3 = (await call('update_arrangement', { songId: created.songId, revision: 2, action: 'add', sectionId: chorus.sectionId })).data;
    expect(r3.arrangement.map((/** @type {any} */ a) => a.name)).toEqual(['Aメロ', 'サビ', 'サビ']);
    const r4 = (await call('update_arrangement', {
      songId: created.songId, revision: 3, action: 'add_section', index: 1,
      section: { name: 'Bメロ', kind: 'prechorus', bars: 2, chords: 'Dm7:4 E7sus4:2 E7:2', melody: 'D4:1 F4:1 A4:2 | A4:2 G#4:2' },
    })).data;
    expect(r4.arrangement.map((/** @type {any} */ a) => a.name)).toEqual(['Aメロ', 'Bメロ', 'サビ', 'サビ']);

    const r5 = (await call('update_song_settings', { songId: created.songId, revision: 4, title: '夜明け前', tempo: 96, tracks: [{ id: 't1', instrument: 'piano' }] })).data;
    expect(r5.title).toBe('夜明け前');
    expect(r5.tempo).toBe(96);
    expect(r5.revision).toBe(5);

    const alts = (await call('generate_alternatives', { songId: created.songId, sectionId: verse.sectionId, target: 'melody' })).data;
    expect(alts.alternatives).toHaveLength(3);
    const r6 = (await call('replace_section', { songId: created.songId, revision: 5, sectionId: verse.sectionId, alternative: { target: 'melody', seed: alts.seed, index: 1 } })).data;
    expect(r6.sections[0].melody).toBe(alts.alternatives[1].melody);

    const midi = await call('export_midi', { songId: created.songId });
    expect(midi.content[1].resource.mimeType).toBe('audio/midi');
    expect(atob(midi.content[1].resource.blob).slice(0, 4)).toBe('MThd');

    expect((await call('list_songs')).data.songs).toHaveLength(1);
  });

  it('歌詞:音数が合えば入り、合わなければ行ごとのズレを返す。1番と2番で別の歌詞', async () => {
    const { call } = client();
    const created = (await call('create_song', {
      title: 'うた', mood: 'setsunai', tempo: 96, key: { tonic: 'A', mode: 'minor' },
      sections: [{ name: 'Aメロ', kind: 'verse', bars: 4, chords: 'Am:8 F:8', melody: 'A4:1 C5:1 E5:1 D5:0.5 C5:1.5 r:3 | A4:0.5 A4:0.5 C5:1 E5:1 D5:1 C5:1 A4:2 r:1' }],
    })).data;
    const item = created.arrangement[0];
    expect(item.lyrics).toEqual([{ notes: 5, kana: '' }, { notes: 7, kana: '' }]);

    const bad = await call('set_lyrics', { songId: created.songId, revision: 1, itemId: item.itemId, lines: ['よるの', 'ひとりであるいたみち'] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/1行目.*2音足りない/);
    expect(bad.text).toMatch(/2行目.*3音多い/);
    expect((await call('set_lyrics', { songId: created.songId, revision: 1, itemId: item.itemId, lines: ['よるのまち'] })).text).toMatch('行数');
    expect((await call('set_lyrics', { songId: created.songId, revision: 1, itemId: item.itemId, lines: ['夜の街角', 'ひとりであるく'] })).isError).toBe(true);

    const ok = (await call('set_lyrics', { songId: created.songId, revision: 1, itemId: item.itemId, lines: ['よるのまち', 'ひとりであるく'] })).data;
    expect(ok.arrangement[0].lyrics.map((/** @type {any} */ l) => l.kana)).toEqual(['よるのまち', 'ひとりであるく']);

    // 2番:同じ部品をもう一度並べて、別の歌詞
    const twice = (await call('update_arrangement', { songId: created.songId, revision: ok.revision, action: 'add', sectionId: item.sectionId })).data;
    const second = twice.arrangement[1];
    const two = (await call('set_lyrics', { songId: created.songId, revision: twice.revision, itemId: second.itemId, lines: ['あさのかぜ', 'ふたりでわらう'] })).data;
    expect(two.arrangement.map((/** @type {any} */ a) => a.lyrics[0].kana)).toEqual(['よるのまち', 'あさのかぜ']);
  });

  it('叩き台を作る・ない曲・足りない引数', async () => {
    const { call } = client();
    const draft = (await call('create_song', { title: 'おまかせ', mood: 'wafu-edm', tempo: 160 })).data;
    expect(draft.sections.length).toBe(4);
    expect((await call('get_song', { songId: 'none' })).text).toMatch('not_found');
    expect((await call('replace_section', { songId: draft.songId, sectionId: 's1', melody: 'A4:1' })).text).toMatch('revision');
    expect((await call('create_song', { mood: 'happy', tempo: 100 })).isError).toBe(true);
  });
});
