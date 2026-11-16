# がねしゃ作曲ツール

音楽知識ゼロでも、AIの叩き台を「聴いて選ぶ・差し替える」だけで1曲作れる作曲ソフト(PWA)。

- 設計: [docs/](docs/)(要件定義・曲データ設計・接続口設計・外部設計・P1タスク)
- 進捗: [docs/progress.md](docs/progress.md)

## 開発

```sh
npm install
npm run dev     # 開発サーバー
npm run check   # 型チェック(JSDoc)+テスト
```

アプリ本体は外部ライブラリを使わない(バニラJS+JSDoc、Web Audio API直接)。開発用の道具だけ入れている。
