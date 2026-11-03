// ===== よけるゲーム =====
// 画面の下のプレイヤーを左右に動かして、上から落ちてくる玉をよけるゲーム。
// 長く生き残るほどスコアが上がり、玉の速さと数がだんだん増える。
// 「自分で遊ぶ」モードと、AI が練習する「AIモード」がある（AIの頭脳は ai.js）。

// ----- 設定（数字を変えると遊びごこちが変わる） -----
const STORAGE_KEY = 'dodge-high-score'; // ハイスコアを保存するときの名前
const SCORE_PER_SECOND = 10;            // 1秒生き残るごとに増えるスコア
const MAX_DT = 0.05;                    // 1回の計算で進める時間の上限（秒）。タブを戻したときのワープ防止

// ----- AIモードの設定 -----
const AI_WORLD_WIDTH = 360;   // AI が練習する「仮想の画面」の幅。画面サイズが違っても学習結果を同じに使えるように固定
const AI_WORLD_HEIGHT = 640;  // 仮想の画面の高さ
const AI_STEP = 1 / 60;       // AI の計算は 1/60 秒きざみ（いつも同じきざみにすると早送りしても結果が変わらない）
const AI_DECIDE_EVERY = 6;    // 6きざみ（= 0.1秒）ごとに行動を選ぶ
const AI_TIME_LIMIT = 120;    // 1回の挑戦の最大時間（秒）。ここまで生き残ったら「クリア」で次へ
const AI_CRASH_PAUSE = 0.6;   // ×1 のとき、当たった様子を見せるために止まる秒数
const AI_AUTOSAVE_EVERY = 50; // 何回練習するごとに自動で保存するか
const FRAME_BUDGET_MS = 12;   // 早送りのとき、1回の画面更新で計算に使ってよい時間（ミリ秒）

// ----- 画面の部品を取り出しておく -----
const stage         = document.getElementById('stage');
const canvas        = document.getElementById('game');
const ctx           = canvas.getContext('2d'); // 絵を描くための道具
const statusBox     = document.getElementById('status');
const scoreText     = document.getElementById('score');
const highScoreText = document.getElementById('high-score');
const screenStart   = document.getElementById('screen-start');
const screenOver    = document.getElementById('screen-over');
const finalScore    = document.getElementById('final-score');
const newRecordText = document.getElementById('new-record');
const screenPause   = document.getElementById('screen-pause');

// AIパネルの部品
const aiPanel        = document.getElementById('ai-panel');
const aiNote         = document.getElementById('ai-note');
const aiChart        = document.getElementById('ai-chart');
const aiEpisodesText = document.getElementById('ai-episodes');
const aiScoreText    = document.getElementById('ai-score');
const aiBestText     = document.getElementById('ai-best');
const aiAverageText  = document.getElementById('ai-average');
const aiEpsilonText  = document.getElementById('ai-epsilon');
const aiTestCount    = document.getElementById('ai-test-count');
const aiTestLast     = document.getElementById('ai-test-last');
const aiTestBest     = document.getElementById('ai-test-best');
const aiTestAverage  = document.getElementById('ai-test-average');
const aiTestStats    = document.getElementById('ai-test-stats');
const aiTestButton   = document.getElementById('ai-test-button');
const aiMessage      = document.getElementById('ai-message');
const speedButtons   = document.querySelectorAll('[data-speed]');

// ----- ゲームの状態 -----
let mode = 'human';   // 'human' = 自分で遊ぶ、'ai' = AI が練習する
let width = 0;        // ゲームの世界の幅（px）。自分で遊ぶときは画面と同じ、AIモードは仮想の画面の大きさ
let height = 0;       // ゲームの世界の高さ（px）
let playing = false;  // いま遊んでいる最中か
let paused = false;   // 一時停止しているか
let elapsed = 0;      // ゲーム開始からの時間（秒）
let spawnTimer = 0;   // 次の玉を出すまでの残り時間（秒）
let lastTime = 0;     // 前回の計算をした時刻
let highScore = loadHighScore();

// 描くときの拡大率と位置（AIモードでは仮想の画面を、ゲーム画面の真ん中に拡大・縮小して描く）
let pixelRatio = 1;
let viewScale = 1;
let viewX = 0;
let viewY = 0;

const player = { x: 0, y: 0, size: 0 }; // x は真ん中の位置
let rocks = [];                          // 落ちてくる玉の一覧 { x, y, r, speed }

// ----- AIモードの状態 -----
let brain = loadBrain();   // AI の頭脳（保存したものがあれば続きから）
let aiSpeed = 1;           // 早送りの倍率（1, 10, 100, または 'max'）
let aiTesting = false;     // 本番モードか（冒険しない・学習しない）
let aiTick = 0;            // 今回の挑戦で何きざみ進んだか
let aiPrev = null;         // 前に選んだ { state: 状態, action: 行動 }
let aiMove = 0;            // いま動いている向き（-1, 0, 1）
let aiTimeBank = 0;        // まだ計算していない時間（早送り用のためておく時間）
let aiCrashPause = 0;      // 当たった様子を見せる残り時間
let chartDirty = true;     // グラフを描き直す必要があるか
let messageTimer = null;

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
  pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * pixelRatio);
  canvas.height = Math.round(rect.height * pixelRatio);

  if (mode === 'ai') {
    // AIモード：世界の大きさは固定。画面に収まるように縮めて、真ん中に置く
    setWorldSize(AI_WORLD_WIDTH, AI_WORLD_HEIGHT);
    viewScale = Math.min(rect.width / width, rect.height / height);
    viewX = (rect.width - width * viewScale) / 2;
    viewY = (rect.height - height * viewScale) / 2;
  } else {
    // 自分で遊ぶ：世界の大きさ = 画面の大きさ
    setWorldSize(rect.width, rect.height);
    viewScale = 1;
    viewX = 0;
    viewY = 0;
  }
  draw();
  chartDirty = true;
  if (mode === 'ai') drawChartIfNeeded();
}

// ゲームの世界の大きさを決めて、プレイヤーの大きさと位置を合わせる
function setWorldSize(newWidth, newHeight) {
  const oldWidth = width;
  const oldHeight = height;
  width = newWidth;
  height = newHeight;

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
  if (mode === 'human' && event.key.startsWith('Arrow')) event.preventDefault(); // 矢印キーで画面がスクロールしないように
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
  if (mode === 'ai') return; // AIモードでは指で動かさない（画面のスクロールはできるようにする）
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
  if (mode === 'ai') saveBrain(brain); // AI の学習は、止めるときに保存しておく
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

// ===== ゲームの世界を進める（人間モードとAIモードで共通） =====

// プレイヤーがいちばん速く動いたとき、1秒で進む距離（画面幅の1.1倍）
function playerMaxSpeed() {
  return width * 1.1;
}

// 玉を出したり落としたりして、時間を dt 秒すすめる。玉に当たったら true を返す
function stepWorld(dt) {
  elapsed += dt;

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

  return rocks.some(hits);
}

// 新しい挑戦のために、世界を最初の状態にもどす
function resetWorld() {
  rocks = [];
  elapsed = 0;
  spawnTimer = 0.5;
  player.x = width / 2;
}

function currentScore() {
  return Math.floor(elapsed * SCORE_PER_SECOND);
}

// ===== 自分で遊ぶモード =====
function startGame() {
  setMode('human');
  resetWorld();
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

// 1回分の計算（dt は前回からの経過秒数）
function update(dt) {
  // プレイヤーを動かす
  const maxMove = playerMaxSpeed() * dt; // 今回の計算で動ける最大の距離
  if (targetX !== null) {
    // 指がある：指の位置に向かって動く。近ければぴったり止まる（瞬間移動はしない）
    const diff = targetX - player.x;
    player.x += Math.max(-maxMove, Math.min(maxMove, diff));
  } else {
    // 指がない：矢印キーで動く
    player.x += keyDirection() * maxMove;
  }
  clampPlayer();

  const hit = stepWorld(dt);
  scoreText.textContent = String(currentScore());
  if (hit) {
    gameOver();
  }
}

// ===== AIモード =====

// 「自分で遊ぶ」と「AIモード」を切りかえる
function setMode(newMode) {
  if (mode === newMode) return;
  mode = newMode;
  const isAi = mode === 'ai';
  document.body.classList.toggle('ai-mode', isAi); // CSS で見た目を切りかえるための目印
  aiPanel.hidden = !isAi;
  statusBox.hidden = isAi;
  resize(); // 世界の大きさが変わるので計算し直す
}

function startAi() {
  setMode('ai');
  aiTesting = false;
  updateTestButton();
  resetAiEpisode();
  playing = true;
  paused = false;
  resetInput();
  screenStart.hidden = true;
  screenOver.hidden = true;
  chartDirty = true;
  updateAiStats();
  drawChartIfNeeded();
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function quitAi() {
  saveBrain(brain);
  playing = false;
  setMode('human');
  resetWorld();
  draw();
  updateAiNote();
  screenStart.hidden = false;
}

// 新しい挑戦を始める
function resetAiEpisode() {
  resetWorld();
  aiTick = 0;
  aiPrev = null;
  aiMove = 0;
  aiCrashPause = 0;
}

// AI を1きざみ（1/60秒）すすめる
function aiStep() {
  // 0.1秒ごとに「いまの場面」を見て、行動を選ぶ
  if (aiTick % AI_DECIDE_EVERY === 0) {
    const state = getAiState(player, rocks, width);
    // 前の行動のあと 0.1秒 生き残れたので、ごほうび +1 で表を書きかえる（本番では書きかえない）
    if (!aiTesting && aiPrev) {
      learn(brain, aiPrev.state, aiPrev.action, REWARD_ALIVE, state);
    }
    const action = chooseAction(brain, state, aiTesting);
    aiPrev = { state: state, action: action };
    aiMove = ACTIONS[action];
  }
  aiTick += 1;

  // 選んだ向きに動く（人間の矢印キーと同じ速さ）
  player.x += aiMove * playerMaxSpeed() * AI_STEP;
  clampPlayer();

  const hit = stepWorld(AI_STEP);
  if (hit) {
    // 当たった！ ばつ -100 で表を書きかえる
    if (!aiTesting) {
      learn(brain, aiPrev.state, aiPrev.action, REWARD_HIT, null);
    }
    endAiEpisode(true);
  } else if (elapsed >= AI_TIME_LIMIT) {
    endAiEpisode(false); // 最後まで生き残った（クリア）
  }
}

// 1回の挑戦が終わったとき
function endAiEpisode(crashed) {
  const score = currentScore();
  if (aiTesting) {
    recordTest(brain, score);
  } else {
    finishEpisode(brain, score);
    chartDirty = true;
    if (brain.episodes % AI_AUTOSAVE_EVERY === 0) saveBrain(brain); // ときどき自動で保存
  }
  aiScoreText.textContent = String(score);

  if (crashed && aiSpeed === 1) {
    aiCrashPause = AI_CRASH_PAUSE; // ×1 のときは、当たった様子を少し見せてから次へ
  } else {
    resetAiEpisode();
  }
}

// 画面を1回書きかえるあいだに、AI をどれだけ進めるか
function aiFrame(realDt) {
  // 当たった様子を見せている最中
  if (aiCrashPause > 0) {
    aiCrashPause -= realDt;
    if (aiCrashPause <= 0) resetAiEpisode();
    return;
  }

  const startTime = performance.now();
  if (aiSpeed === 'max') {
    // 最速：時間の許すかぎり計算する（絵は最後に1回だけ描く）
    while (performance.now() - startTime < FRAME_BUDGET_MS) {
      for (let i = 0; i < 20; i++) aiStep();
    }
  } else {
    // ×1, ×10, ×100：実際に経った時間 × 倍率 ぶんだけ進める
    aiTimeBank += realDt * aiSpeed;
    while (aiTimeBank >= AI_STEP) {
      aiStep();
      aiTimeBank -= AI_STEP;
      if (aiCrashPause > 0) break;
      if (performance.now() - startTime > FRAME_BUDGET_MS) {
        aiTimeBank = 0; // 計算が追いつかないときは、あきらめて次の画面更新へ
        break;
      }
    }
  }
}

// AIパネルの数字を新しくする
function updateAiStats() {
  aiEpisodesText.textContent = String(brain.episodes);
  if (aiCrashPause <= 0) aiScoreText.textContent = String(currentScore());
  aiBestText.textContent = String(brain.best);
  aiAverageText.textContent = String(Math.round(recentAverage(brain)));
  aiEpsilonText.textContent = aiTesting ? '0%（本番）' : `${Math.round(brain.epsilon * 100)}%`;

  const test = brain.test;
  aiTestCount.textContent = String(test.count);
  aiTestLast.textContent = test.count ? String(test.last) : '-';
  aiTestBest.textContent = test.count ? String(test.best) : '-';
  aiTestAverage.textContent = test.count ? String(Math.round(test.total / test.count)) : '-';
}

function drawChartIfNeeded() {
  if (!chartDirty) return;
  chartDirty = false;
  drawChart(aiChart, brain);
}

// 本番モードボタンの見た目を、いまの状態に合わせる
function updateTestButton() {
  aiTestButton.textContent = aiTesting ? '練習にもどる' : '本番モード';
  aiTestButton.setAttribute('aria-pressed', String(aiTesting));
  aiTestStats.classList.toggle('active', aiTesting);
}

// スタート画面の「続きから」の案内
function updateAiNote() {
  aiNote.textContent = brain.episodes > 0
    ? `前回の続きから練習するよ（これまで ${brain.episodes} 回練習）`
    : 'AIが何度も挑戦して、よけ方を自分で覚えていくよ';
}

// 「保存しました」などを2秒だけ表示する
function showMessage(text) {
  aiMessage.textContent = text;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    aiMessage.textContent = '';
  }, 2000);
}

// ----- AIパネルのボタン -----
for (const button of speedButtons) {
  button.addEventListener('click', () => {
    const value = button.dataset.speed;
    aiSpeed = value === 'max' ? 'max' : Number(value);
    aiTimeBank = 0;
    for (const other of speedButtons) {
      other.setAttribute('aria-pressed', String(other === button));
    }
  });
}

aiTestButton.addEventListener('click', () => {
  aiTesting = !aiTesting;
  updateTestButton();
  resetAiEpisode(); // 途中の挑戦は数えずに、新しく始める
  updateAiStats();
});

document.getElementById('ai-save-button').addEventListener('click', () => {
  showMessage(saveBrain(brain) ? '保存しました' : 'このブラウザでは保存できませんでした');
});

document.getElementById('ai-reset-button').addEventListener('click', () => {
  // confirm は「OK / キャンセル」を聞く小さな画面
  if (!confirm('AIが覚えたことを全部消して、0からやり直しますか？')) return;
  brain = createBrain();
  deleteSavedBrain();
  resetAiEpisode();
  chartDirty = true;
  updateAiStats();
  drawChartIfNeeded();
  showMessage('学習をリセットしました');
});

document.getElementById('ai-quit-button').addEventListener('click', quitAi);

// ===== くり返し =====
// requestAnimationFrame は「次に画面を書きかえるときに呼んでね」というお願い。
// 1秒に約60回呼ばれるので、これをくり返すとアニメーションになる。
function loop(now) {
  if (!playing || paused) return; // 一時停止中はここで止める
  // 端末の速さに関係なく同じスピードになるよう、実際に経った時間で計算する
  const dt = Math.min((now - lastTime) / 1000, MAX_DT);
  lastTime = now;

  if (mode === 'ai') {
    aiFrame(dt);
    updateAiStats();
    drawChartIfNeeded();
  } else {
    update(dt);
  }

  if (playing && !paused) {
    draw(mode === 'ai' && aiCrashPause > 0);
    requestAnimationFrame(loop);
  }
}

// ===== 絵を描く =====
function draw(crashed = false) {
  // AIモードでは、仮想の画面のまわりのすき間を暗い色でぬる
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  if (mode === 'ai') {
    ctx.fillStyle = '#141b27';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  // ここから先は「ゲームの世界の座標」で描く（AIモードでは拡大・縮小して真ん中に置く）
  const s0 = pixelRatio * viewScale;
  ctx.setTransform(s0, 0, 0, s0, pixelRatio * viewX, pixelRatio * viewY);

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

  // プレイヤー（角の丸い四角に目を2つ）。AIモードでは緑色
  const s = player.size;
  const left = player.x - s / 2;
  ctx.fillStyle = crashed ? '#e4572f' : (mode === 'ai' ? '#27a96b' : '#2f6fe4');
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

  // AIモード：左上に「何回目の練習か」、右上にスコアを書く
  if (mode === 'ai') {
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(aiTesting ? '🤖 本番' : `🤖 練習 ${brain.episodes + 1}回目`, 12, 12);
    ctx.textAlign = 'right';
    ctx.fillText(String(currentScore()), width - 12, 12);
  }
}

// ===== はじめの準備 =====
highScoreText.textContent = String(highScore);
updateAiNote();
document.getElementById('start-button').addEventListener('click', startGame);
document.getElementById('retry-button').addEventListener('click', startGame);
document.getElementById('ai-button').addEventListener('click', startAi);
window.addEventListener('resize', resize);
resize();
