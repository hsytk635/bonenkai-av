# 忘年会 AVコントローラー Web版 Ver.1.0

2026年12月17日開催の「広島東支部 南③地区会 忘年会」用の操作卓です。操作画面から BGM・登場曲・効果音と、拡張ディスプレイに出す映像を操作します。

## ローカル起動

Node.js 22 以上を使います。

```powershell
npm ci
npm run dev
npm run build
```

環境変数未設定時は、合成音とイベントタイトルを使った動作確認モードが開きます。共有、認証、権限制御を確認するときは `.env.example` を `.env.local` にコピーし、Supabase の Project URL と **Publishable key** を設定して Vite を再起動してください。

## Supabase の設定

1. Supabase Dashboard で新規プロジェクトを作成します。プロジェクトの API 接続画面から Project URL と `sb_publishable_` で始まるキーを取得します。
2. SQL Editor で [マイグレーション](supabase/migrations/202611270001_av.sql) を一度実行します。テーブル、RLS、Realtime 登録、非公開バケット `av-media` と Storage ポリシーが作成されます。既存プロジェクトに同名テーブルやバケットがある場合は、新規プロジェクトを使います。
3. Authentication の新規自己登録と匿名ログインを無効にします。Email プロバイダを有効にします。実行委員のアドレスに招待を届けるため、本番用の SMTP を設定します。
4. Authentication の URL Configuration で Site URL と Additional Redirect URLs に最終公開 URL（例 `https://OWNER.github.io/REPO/`）を設定します。招待テンプレートではプロバイダ標準の確認リンクを維持します。同じブラウザで招待を開くと、パスワード設定画面に進みます。
5. Dashboard の Authentication → Users から初期管理者を作成します。対象の User UID を確認して SQL Editor で次を実行します。自動確認で作成した場合は、管理者に安全な方法で初回資格情報を渡してください。

```sql
insert into public.profiles(user_id,display_name,role)
values ('管理者ユーザーのUUID','実行委員 管理者','admin');
```

6. Supabase CLI にログインして関数をデプロイします。関数は受信 JWT で `av_role()` を呼び出し、管理者を確認した上でサーバー側の Auth Admin API を使います。プロジェクトに以下を実行します。

```powershell
supabase login
supabase link --project-ref PROJECT_REF
supabase secrets set AV_SITE_URL=https://OWNER.github.io/REPO/
supabase functions deploy invite-member --no-verify-jwt
```

7. Storage で `av-media` が非公開であること、許可 MIME と 50 MB のバケット設定を確認します。Storage 全体の上限がそれ未満なら、実際の上限は小さい方です。転送量・総容量は契約プランの Usage 画面で確認してください。本番の事前読み込みでも全素材分の転送が発生します。
8. 招待や RLS の運用テストを行います。管理者の「共有設定 → メンバー」でメールを招待し、編集者と閲覧者にパスワードを設定してもらいます。権限変更・取消は同じ画面にあります。取消済みの既存アカウントを復旧する場合は Dashboard で UID を確認し、SQL Editor から対応する `profiles` 行を再作成します。

公開キーは配布される JavaScript に含まれます。秘密キー、SMTP 資格情報、DB パスワードはサーバー側で保持してください。閲覧者による操作を制限する実体は PostgreSQL RLS と Storage ポリシーです。

関連資料は [自己登録の設定](https://supabase.com/docs/guides/auth/general-configuration)、[招待機能](https://supabase.com/docs/guides/auth/users)、[アップロード容量](https://supabase.com/kb/troubleshooting/upload-file-size-restrictions-Y4wQLT)、[再開可能アップロード](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) を参照してください。

## GitHub Pages の設定

1. GitHub で空のリポジトリを作成します。既存のプロジェクトと混ざらないよう、このディレクトリの内容をリポジトリのルートに置きます。リポジトリに `.github/workflows/pages.yml` と `package-lock.json` を含めます。
2. リポジトリの Settings → Pages → Build and deployment の Source に **GitHub Actions** を選択します。
3. Settings → Secrets and variables → Actions → Variables に `VITE_SUPABASE_URL` と `VITE_SUPABASE_PUBLISHABLE_KEY` を登録します。
4. `main` に push し、Actions の Deploy AV controller が成功したことを確認します。表示された Pages URL でログインと招待リンクを確認します。Vite の相対 base を使用し、操作画面は単一 URL です。投影用ウィンドウは操作画面が同一オリジンの空ウィンドウに直接構築します。

## 構成と運用

- 音響は Web Audio の独立したゲインバスから単一のマスター・コンプレッサーへ送ります。投影する HTMLVideoElement をそのままミキサーに接続します。操作画面の投影モニターは同じ要素のフレームを Canvas へ描画します。
- 共有ライブラリの更新は Realtime と定期取得で反映します。本番セットには全素材のローカルコピーと設定を固定します。
- メディアは「メディア登録」で追加します。動画と画像のサムネイルは取り込み時に生成します。編集画面ではメタデータを更新できます。素材差替え時は新しいファイルを新規登録してください。
- 録画や楽曲が第三者の権利対象の場合は、共有・上演の許諾を確認済みの素材を使用してください。

[操作マニュアル](docs/操作マニュアル.md) · [本番チェックリスト](docs/本番チェックリスト.md) · [テスト結果](docs/テスト結果.md) · [制約事項](docs/制約事項.md)
