// ===== ゲームの一覧を画面に並べる =====
// games.js の GAMES にあるゲームを1つずつ取り出して、カードを作る。
// （ゲームを増やすときは、このファイルではなく games.js を書きかえる）

const list = document.getElementById('game-list');

for (const game of GAMES) {
  // カード全体をリンク（<a>）にして、どこをタップしてもゲームが開くようにする
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.className = 'game-card';
  link.href = game.path;

  const icon = document.createElement('span');
  icon.className = 'game-icon';
  icon.textContent = game.icon;
  icon.setAttribute('aria-hidden', 'true'); // 読み上げでは絵文字を読まない

  const title = document.createElement('span');
  title.className = 'game-title';
  title.textContent = game.title;

  const description = document.createElement('span');
  description.className = 'game-description';
  description.textContent = game.description;

  link.append(icon, title, description);
  item.appendChild(link);
  list.appendChild(item);
}
