// アプリの入口。
import { mountApp } from './ui/app.js';

const app = document.getElementById('app');
// サーバーでの音声の書き出し(MCP の export_audio)用のページ。画面は出さず、曲を音声にして送る
if (location.pathname === '/render' && /** @type {any} */ (window).__renderJob) {
  import('./render-job.js').then((m) => m.runRenderJob());
} else if (app) {
  mountApp(app);
}
