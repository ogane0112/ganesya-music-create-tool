// アプリの入口。今はスプリント2の試作画面を出す。
import { mountPrototype } from './ui/prototype.js';

const app = document.getElementById('app');
if (app) mountPrototype(app);
