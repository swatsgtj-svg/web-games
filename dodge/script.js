// ===== よけるゲーム =====
// 画面の下のプレイヤーを左右に動かして、上から落ちてくる玉をよけるゲーム。
// 長く生き残るほどスコアが上がり、玉の速さと数がだんだん増える。

// ----- 設定（数字を変えると遊びごこちが変わる） -----
const STORAGE_KEY = 'dodge-high-score'; // ハイスコアを保存するときの名前
const SCORE_PER_SECOND = 10;            // 1秒生き残るごとに増えるスコア
const MAX_DT = 0.05;                    // 1回の計算で進める時間の上限（秒）。タブを戻したときのワープ防止

// ----- 画面の部品を取り出しておく -----
const stage         = document.getElementById('stage');
const canvas        = document.getElementById('game');
const ctx           = canvas.getContext('2d'); // 絵を描くための道具
const scoreText     = document.getElementById('score');
const highScoreText = document.getElementById('high-score');
const screenStart   = document.getElementById('screen-start');
const screenOver    = document.getElementById('screen-over');
const finalScore    = document.getElementById('final-score');
const newRecordText = document.getElementById('new-record');
const screenPause   = document.getElementById('screen-pause');

// ----- ゲームの状態 -----
let width = 0;        // ゲーム画面の幅（px）
let height = 0;       // ゲーム画面の高さ（px）
let playing = false;  // いま遊んでいる最中か
let paused = false;   // 一時停止しているか
let elapsed = 0;      // ゲーム開始からの時間（秒）
let spawnTimer = 0;   // 次の玉を出すまでの残り時間（秒）
let lastTime = 0;     // 前回の計算をした時刻
let highScore = loadHighScore();

const player = { x: 0, y: 0, size: 0 }; // x は真ん中の位置
let rocks = [];                          // 落ちてくる玉の一覧 { x, y, r, speed }

// ===== ハイスコアの読み書き =====
// 保存できない環境（プライベートブラウズなど）でも止まらないように try/catch で囲む
function loadHighScore() {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : 0;
  } catch (e) {
    return 0;
  }
}

function saveHighScore(score) {
  try {
    localStorage.setItem(STORAGE_KEY, String(score));
  } catch (e) {
    // 保存できなくても、ゲームはそのまま遊べる
  }
}

// ===== 画面の大きさに合わせる =====
// canvas は「表示される大きさ」と「中の絵の細かさ」が別々なので、両方をそろえる。
// devicePixelRatio は、スマホなどの高画質な画面で1pxが何ドットか（2や3など）。
function resize() {
  const rect = stage.getBoundingClientRect();
  const oldWidth = width;
  const oldHeight = height;
  width = rect.width;
  height = rect.height;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // これで以降は「表示上のpx」で描ける

  // プレイヤーの大きさは画面幅の1割（小さすぎ・大きすぎにならないように範囲を決める）
  player.size = Math.min(Math.max(width * 0.1, 28), 48);
  player.y = height - player.size - 12;

  if (oldWidth > 0) {
    // 遊んでいる途中で画面の大きさが変わったら、位置も同じ割合でのばす
    player.x = (player.x / oldWidth) * width;
    for (const rock of rocks) {
      rock.x = (rock.x / oldWidth) * width;
      rock.y = (rock.y / oldHeight) * height;
    }
  } else {
    player.x = width / 2;
  }
  clampPlayer();
  draw();
}

// プレイヤーが画面の外に出ないようにする
function clampPlayer() {
  const half = player.size / 2;
  player.x = Math.min(Math.max(player.x, half), width - half);
}

// ===== 操作 =====
// キーボードは「どのキーが押されているか」、タッチは「指がどこにあるか」を覚えておく
const keys = { left: false, right: false };
let targetX = null;        // 指（またはマウス）の横の位置。さわっていないときは null（なにもない）
let activePointer = null;  // いまプレイヤーを動かしている指の番号

// パソコン：矢印キー（A / D キーでもOK）
window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'a') keys.left = true;
  if (event.key === 'ArrowRight' || event.key === 'd') keys.right = true;
  if (event.key.startsWith('Arrow')) event.preventDefault(); // 矢印キーで画面がスクロールしないように
});

window.addEventListener('keyup', (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'a') keys.left = false;
  if (event.key === 'ArrowRight' || event.key === 'd') keys.right = false;
});

// キーや指の状態を「なにも押していない」にもどす
function resetInput() {
  keys.left = false;
  keys.right = false;
  targetX = null;
  activePointer = null;
}

// スマホ：指を置いた位置に向かってプレイヤーが動く（マウスで押しても同じ）
// 「pointer」は、指・マウス・ペンをまとめてあつかえるしくみ
function pointerX(event) {
  const rect = canvas.getBoundingClientRect();
  return event.clientX - rect.left; // ゲーム画面の左はしから何pxの所か
}

canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId); // 指が画面の外に出ても追いかける
  activePointer = event.pointerId;           // あとから置いた指を優先する
  targetX = pointerX(event);
});

canvas.addEventListener('pointermove', (event) => {
  // 押したまま指をすべらせたら、目標の位置も動かす
  if (event.pointerId === activePointer) {
    targetX = pointerX(event);
  }
});

function releasePointer(event) {
  if (event.pointerId === activePointer) {
    targetX = null;
    activePointer = null;
  }
}
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('contextmenu', (event) => event.preventDefault()); // 長押しメニューを出さない

// キーボードで、いま左右どちらに動かすか（-1: 左、0: 止まる、1: 右）
function keyDirection() {
  let dir = 0;
  if (keys.left) dir -= 1;
  if (keys.right) dir += 1;
  return dir;
}

// ===== 一時停止 =====
// ほかのアプリやタブに切りかえたら止めて、「タップで再開」を出す
function pause() {
  if (!playing || paused) return;
  paused = true;
  resetInput(); // 切りかえ中に離したキーや指が「押しっぱなし」にならないように
  screenPause.hidden = false;
}

function resume() {
  if (!paused) return;
  paused = false;
  screenPause.hidden = true;
  // 止まっていた時間を計算に入れないように、時計をいまに合わせてから再開する
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

// visibilitychange：タブを切りかえたり、スマホでホーム画面にもどったりすると起きる
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
// blur：ブラウザの外（ほかのアプリ）をさわったときに起きる
window.addEventListener('blur', () => {
  resetInput();
  pause();
});

screenPause.addEventListener('click', resume);
// パソコンでは Enter キーかスペースキーでも再開できる
window.addEventListener('keydown', (event) => {
  if (paused && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    resume();
  }
});

// ===== むずかしさ =====
// 時間がたつほど玉が速く、出てくる間かくが短くなる（上限・下限あり）
function fallSpeed() {
  return height * Math.min(0.35 + elapsed * 0.025, 1.3); // 1秒あたりに落ちる距離
}

function spawnInterval() {
  return Math.max(0.9 - elapsed * 0.02, 0.18); // 次の玉が出るまでの秒数
}

// 上から新しい玉を1つ出す
function spawnRock() {
  const r = player.size * (0.3 + Math.random() * 0.35); // 半径はランダム
  rocks.push({
    x: r + Math.random() * (width - r * 2),
    y: -r,
    r: r,
    speed: fallSpeed() * (0.8 + Math.random() * 0.4), // 1つずつ少しだけ速さを変える
  });
}

// ===== 当たり判定 =====
// 玉（円）とプレイヤー（四角）が重なっているかを調べる。
// 見た目より少し小さめにして、「当たってないのに！」を減らす。
function hits(rock) {
  const half = player.size / 2 * 0.85;
  const cx = player.x;
  const cy = player.y + player.size / 2;
  // 四角の中で、円の中心にいちばん近い点を探す
  const nearX = Math.min(Math.max(rock.x, cx - half), cx + half);
  const nearY = Math.min(Math.max(rock.y, cy - half), cy + half);
  const dx = rock.x - nearX;
  const dy = rock.y - nearY;
  const r = rock.r * 0.85;
  return dx * dx + dy * dy < r * r;
}

// ===== ゲームの流れ =====
function startGame() {
  rocks = [];
  elapsed = 0;
  spawnTimer = 0.5;
  player.x = width / 2;
  playing = true;
  paused = false;
  resetInput();
  scoreText.textContent = '0';
  screenStart.hidden = true;
  screenOver.hidden = true;
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function gameOver() {
  playing = false;
  const score = currentScore();
  const isNewRecord = score > highScore;
  if (isNewRecord) {
    highScore = score;
    saveHighScore(score);
    highScoreText.textContent = String(score);
  }
  finalScore.textContent = String(score);
  newRecordText.hidden = !isNewRecord;
  draw(true); // 当たった瞬間を赤く表示
  screenOver.hidden = false;
  document.getElementById('retry-button').focus();
}

function currentScore() {
  return Math.floor(elapsed * SCORE_PER_SECOND);
}

// 1回分の計算（dt は前回からの経過秒数）
function update(dt) {
  elapsed += dt;

  // プレイヤーを動かす。いちばん速くて「1秒で画面幅の1.1倍」
  const maxMove = width * 1.1 * dt; // 今回の計算で動ける最大の距離
  if (targetX !== null) {
    // 指がある：指の位置に向かって動く。近ければぴったり止まる（瞬間移動はしない）
    const diff = targetX - player.x;
    player.x += Math.max(-maxMove, Math.min(maxMove, diff));
  } else {
    // 指がない：矢印キーで動く
    player.x += keyDirection() * maxMove;
  }
  clampPlayer();

  // 時間が来たら新しい玉を出す
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnRock();
    spawnTimer += spawnInterval();
  }

  // 玉を落とす。画面の下まで行ったものは消す
  for (const rock of rocks) {
    rock.y += rock.speed * dt;
  }
  rocks = rocks.filter((rock) => rock.y - rock.r < height);

  scoreText.textContent = String(currentScore());

  if (rocks.some(hits)) {
    gameOver();
  }
}

// requestAnimationFrame は「次に画面を書きかえるときに呼んでね」というお願い。
// 1秒に約60回呼ばれるので、これをくり返すとアニメーションになる。
function loop(now) {
  if (!playing || paused) return; // 一時停止中はここで止める
  // 端末の速さに関係なく同じスピードになるよう、実際に経った時間で計算する
  const dt = Math.min((now - lastTime) / 1000, MAX_DT);
  lastTime = now;
  update(dt);
  if (playing && !paused) {
    draw();
    requestAnimationFrame(loop);
  }
}

// ===== 絵を描く =====
function draw(crashed = false) {
  // 背景（上から下へ色が変わるグラデーション）
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#1f2a3c');
  sky.addColorStop(1, '#3a4d6e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  // 地面の線
  ctx.fillStyle = '#5b6b82';
  ctx.fillRect(0, player.y + player.size, width, 2);

  // 落ちてくる玉
  for (const rock of rocks) {
    ctx.beginPath();
    ctx.arc(rock.x, rock.y, rock.r, 0, Math.PI * 2);
    ctx.fillStyle = '#f2994a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rock.x - rock.r * 0.3, rock.y - rock.r * 0.3, rock.r * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = '#f8c48f'; // 光っている部分
    ctx.fill();
  }

  // プレイヤー（角の丸い四角に目を2つ）
  const s = player.size;
  const left = player.x - s / 2;
  ctx.fillStyle = crashed ? '#e4572f' : '#2f6fe4';
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(left, player.y, s, s, s * 0.25);
  } else {
    ctx.rect(left, player.y, s, s); // 古いブラウザでは普通の四角にする
  }
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(left + s * 0.32, player.y + s * 0.4, s * 0.1, 0, Math.PI * 2);
  ctx.arc(left + s * 0.68, player.y + s * 0.4, s * 0.1, 0, Math.PI * 2);
  ctx.fill();
}

// ===== はじめの準備 =====
highScoreText.textContent = String(highScore);
document.getElementById('start-button').addEventListener('click', startGame);
document.getElementById('retry-button').addEventListener('click', startGame);
window.addEventListener('resize', resize);
resize();
