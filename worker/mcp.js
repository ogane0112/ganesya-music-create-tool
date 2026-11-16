// MCP サーバー(Streamable HTTP、状態を持たない形)。JSON-RPC を1回のPOSTで受けて、JSONで返す。
import { HttpError } from './db.js';
import { ToolError, TOOLS } from './tools.js';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'ganesya-music', title: 'がねしゃ作曲ツール', version: '0.1.0' };
const INSTRUCTIONS = '歌もの(J-POP)の曲を作るツールです。最初に get_format_guide を読んでください。あなたがコード進行とメロディを書き、伴奏は自動で付きます。書き込む道具には最新の revision を渡します。';

/** @param {unknown} body @param {number} [status] */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * @param {any} msg
 * @param {import('./tools.js').ToolContext} ctx
 * @returns {Promise<object | null>} 通知には何も返さない
 */
async function handleMessage(msg, ctx) {
  const { id, method, params } = msg ?? {};
  /** @param {unknown} result */
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  /** @param {number} code @param {string} message */
  const err = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (typeof method !== 'string') return err(-32600, 'Invalid Request');
  if (id === undefined) return null; // 通知(notifications/initialized など)

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return err(-32602, `Unknown tool: ${params?.name}`);
      try {
        /** @type {any} */
        const result = await tool.run(params.arguments ?? {}, ctx);
        const content = result?.__content ?? [{ type: 'text', text: JSON.stringify(result, null, 1) }];
        return ok({ content });
      } catch (e) {
        // 道具の中の失敗は、AIが読んで直せるように本文で返す
        const error = e instanceof ToolError || e instanceof HttpError ? e.error : null;
        if (!error) console.error('tool failed', params?.name, e);
        const text = error
          ? `失敗: ${error.message}\n対処: ${error.hint}\n(code: ${error.code})`
          : `失敗: 道具の中で問題が起きました(${e instanceof Error ? e.message : String(e)})\n対処: 引数を確かめて、もう一度試してください`;
        return ok({ content: [{ type: 'text', text }], isError: true });
      }
    }
    default:
      return err(-32601, `Method not found: ${method}`);
  }
}

/**
 * @param {Request} request
 * @param {import('./tools.js').ToolContext} ctx
 */
export async function handleMcp(request, ctx) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleMessage(m, ctx)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const res = await handleMessage(body, ctx);
  return res ? json(res) : new Response(null, { status: 202 });
}
