// アプリの入口。
import { mountApp } from './ui/app.js';

const app = document.getElementById('app');
if (app) mountApp(app);
