// ===== ゲームのリスト =====
// 新しいゲームを作ったら、このリストに { ... } を1つ書き足すだけで
// 一覧ページにカードが増えます。
//
//   icon:        カードに出す絵文字
//   title:       ゲームの名前
//   description: ひとことの説明
//   path:        ゲームの index.html の場所（このファイルから見た場所）
//
// 書き足すときは、前の } のうしろに , （カンマ）を付けるのを忘れずに。
const GAMES = [
  {
    icon: '🔢',
    title: '数当てゲーム',
    description: 'コンピューターが決めた数を、ヒントをたよりに当てよう。難易度は3段階。',
    path: 'number-guess/index.html',
  },
  {
    icon: '☄️',
    title: 'よけるゲーム',
    description: '上から落ちてくるものを左右に動いてよけよう。長く生き残るほど高得点！AIが練習して上手くなる様子も見られる。',
    path: 'dodge/index.html',
  },
  {
    icon: '🃏',
    title: '神経衰弱',
    description: 'カードをめくって同じ絵をそろえよう。動物・乗り物・食べもののほか、自分の写真でも遊べる！',
    path: 'memory/index.html',
  },
];
