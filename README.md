# はぜくん Step1 - しゃべる交代タイマー

5人フットサルチーム向けの、Web版しゃべる交代タイマーです。

## 機能

- 試合時間の設定
- 交代間隔の設定
- メンバー・ゴレイロ交代順の設定
- 残り時間の大きな表示
- 現在のゴレイロ、次のゴレイロの表示
- 交代タイミングの音声再生
- 残り1分の音声再生
- 試合終了の音声再生
- 手動交代
- 一時停止、再開、リセット
- 試合中ログの画面内表示
- 画面スリープ対策 Wake Lock API 対応ブラウザのみ

## 音声ファイル

以下のファイルを `public/audio/` に配置してください。

```text
public/audio/start.mp3
public/audio/change.mp3
public/audio/last-1min.mp3
public/audio/finish.mp3
```

## ローカル実行

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

ビルド結果は `dist/` に出力されます。

## Azure Static Web Apps の設定目安

- App location: `/`
- Api location: 空欄
- Output location: `dist`

## 注意

このアプリはStep1向けのMVPです。
DB、localStorage、IndexedDBは使っていません。
設定やログは、画面を開いている間だけ保持されます。
ブラウザを更新するとリセットされます。
