// アプリ全体の設定

// YouTube Data API v3 のキー（概要欄・コメントからセットリストを探すのに使う）。
// 公開しても被害が「その日の取得が止まる」だけになるよう、次の条件で作ったキーを入れる:
//   - このアプリ専用の Google Cloud プロジェクトで、請求先（クレジットカード）を登録しない
//   - API の制限: YouTube Data API v3 のみ
//   - ウェブサイトの制限: https://utawakuwaku.netlify.app/* と http://localhost:3000/*
// 手順は readme.md の「YouTube Data API キーの設定」を参照。空のままでも、ほかの機能は使える。
export const YOUTUBE_API_KEY = 'AIzaSyCf4UkoOmWhTqtjrEpDsRZjtGrnCr0KQ9w';
