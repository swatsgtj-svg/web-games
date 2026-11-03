// ===== よけるゲームの AI（Q学習） =====
// このファイルには「AI の頭脳」と「成長グラフを描く関数」が入っている。
// ゲームを動かす部分（script.js）から呼び出して使う。
//
// ■ Q学習とは？
// AI が「この場面（状態）で、この動き（行動）をしたら、どれくらい得か」を
// 表（Qテーブル）にメモしていく方法。最初は全部 0。
// 挑戦するたびに「ごほうび（報酬）」をもとにメモを少しずつ書きかえて、
// 得になる動きを選ぶようになっていく。

// ----- 設定（数字を変えると学習のしかたが変わる） -----
const AI_STORAGE_KEY = 'dodge-ai-v1'; // 学習結果を保存するときの名前

// 行動：0番=左、1番=止まる、2番=右。数字は「動く向き」
const ACTIONS = [-1, 0, 1];

// 状態：左どなり・真上・右どなりの3つの列の「危なさ」（各4段階）× 自分の位置（3段階）
const DANGER_LEVELS = 4;
const WALL_LEVELS = 3;
const STATE_COUNT = DANGER_LEVELS * DANGER_LEVELS * DANGER_LEVELS * WALL_LEVELS; // 4×4×4×3 = 192通り

// 報酬（ごほうびとばつ）
const REWARD_ALIVE = 1;    // 0.1秒生き残るごとに +1
const REWARD_HIT = -100;   // 玉に当たったら -100

// 学習の強さ
const LEARNING_RATE = 0.1; // 学習率：1回の経験でどれだけメモを書きかえるか
const DISCOUNT = 0.95;     // 割引率：少し先のごほうびをどれくらい大事にするか
const EPSILON_START = 1;   // ε（冒険する確率）の最初の値。1 = 100%
const EPSILON_DECAY = 0.99; // 1回挑戦するごとに ε にかける数（少しずつ減る）
const EPSILON_MIN = 0.02;  // ε はここより下げない（2% はいつも冒険する）

const HISTORY_MAX = 2000;  // グラフの点の数の上限。こえたら2つずつ平均して1つにまとめる（古い記録も消さない）
const AVERAGE_WINDOW = 20; // 「直近◯回の平均」の◯

// ===== 頭脳（AI が覚えていることを全部まとめた入れもの） =====
function createBrain() {
  return {
    q: new Float32Array(STATE_COUNT * ACTIONS.length), // Qテーブル。192場面 × 3行動 = 576個の数
    episodes: 0,            // 練習した回数
    epsilon: EPSILON_START, // 冒険する確率
    history: [],            // グラフ用の練習スコアの記録（1つの点 = historyStep 回分の平均）
    historyStep: 1,         // グラフの点1つが、何回分の練習をまとめたものか
    pending: { sum: 0, count: 0 }, // まだ点になっていない練習スコアの合計と回数
    recent: [],             // 直近20回の練習スコア（平均を出すため）
    best: 0,                // 練習の最高スコア
    test: { count: 0, last: 0, best: 0, total: 0 }, // 本番モードの記録
  };
}

// ===== 状態：いまの場面を 0〜191 の番号にする =====

// 「あと何秒で落ちてくるか」を4段階にする
// 0: 玉なし / 1: 遠い（0.5秒以上） / 2: 近い（0.25〜0.5秒） / 3: 危ない（0.25秒未満）
// 区切りの秒数はいくつか試して、いちばん上手くなったものにした（1秒・0.5秒で区切るより約1.3倍のスコア）
function dangerLevel(seconds) {
  if (seconds === Infinity) return 0;
  if (seconds >= 0.5) return 1;
  if (seconds >= 0.25) return 2;
  return 3;
}

// left〜right の列に入っている玉のうち、いちばん早く落ちてくるものが「あと何秒か」を調べる
function secondsUntilHit(left, right, player, rocks) {
  let soonest = Infinity; // Infinity は「無限大」。玉がないときはこのまま
  for (const rock of rocks) {
    const inLane = rock.x + rock.r > left && rock.x - rock.r < right;
    const notPassed = rock.y - rock.r < player.y + player.size; // まだプレイヤーの下まで行っていない
    if (inLane && notPassed) {
      // 玉の下はしからプレイヤーの頭までの距離 ÷ 落ちる速さ = かかる秒数
      const seconds = Math.max(0, (player.y - (rock.y + rock.r)) / rock.speed);
      soonest = Math.min(soonest, seconds);
    }
  }
  return soonest;
}

// プレイヤーの位置と玉の様子から、状態の番号を作る
function getAiState(player, rocks, width) {
  const s = player.size;
  // 列の幅はプレイヤー1人分。左どなり・真上・右どなりの3列を見る
  const leftLane = dangerLevel(secondsUntilHit(player.x - s * 1.5, player.x - s * 0.5, player, rocks));
  const centerLane = dangerLevel(secondsUntilHit(player.x - s * 0.5, player.x + s * 0.5, player, rocks));
  const rightLane = dangerLevel(secondsUntilHit(player.x + s * 0.5, player.x + s * 1.5, player, rocks));

  // 壁との位置：0 = 左はし（左に逃げられない）、1 = 真ん中あたり、2 = 右はし
  const half = s / 2;
  let wall = 1;
  if (player.x - half < s) wall = 0;
  else if (width - (player.x + half) < s) wall = 2;

  // 4進数のように組み合わせて、1つの番号にまとめる
  return ((leftLane * DANGER_LEVELS + centerLane) * DANGER_LEVELS + rightLane) * WALL_LEVELS + wall;
}

// ===== 行動を選ぶ =====

// Qテーブルでいちばん点数の高い行動を選ぶ（同点のときはその中からランダム）
function bestAction(brain, state) {
  const base = state * ACTIONS.length;
  let best = [];
  let bestValue = -Infinity;
  for (let a = 0; a < ACTIONS.length; a++) {
    const value = brain.q[base + a];
    if (value > bestValue) {
      bestValue = value;
      best = [a];
    } else if (value === bestValue) {
      best.push(a);
    }
  }
  return best[Math.floor(Math.random() * best.length)];
}

// ε-greedy（イプシロン・グリーディ）：ε の確率でデタラメに冒険し、それ以外は一番良い行動を選ぶ。
// 本番モード（testing が true）のときは冒険しない。
function chooseAction(brain, state, testing) {
  if (!testing && Math.random() < brain.epsilon) {
    return Math.floor(Math.random() * ACTIONS.length);
  }
  return bestAction(brain, state);
}

// 次の場面でいちばん良い行動の点数
function maxQ(brain, state) {
  const base = state * ACTIONS.length;
  return Math.max(brain.q[base], brain.q[base + 1], brain.q[base + 2]);
}

// ===== 学習：Qテーブルを書きかえる =====
// Q[状態][行動] += 学習率 × (報酬 + 割引率 × 次の場面でいちばん良いQ − Q[状態][行動])
// nextState が null のときは「当たって終わり」なので、その先のごほうびはない
function learn(brain, state, action, reward, nextState) {
  const index = state * ACTIONS.length + action;
  const future = nextState === null ? 0 : DISCOUNT * maxQ(brain, nextState);
  const target = reward + future;          // 「本当はこれくらいの点数だったはず」という目標
  brain.q[index] += LEARNING_RATE * (target - brain.q[index]); // 目標に少しだけ近づける
}

// ===== 記録 =====

// 練習が1回終わったとき
function finishEpisode(brain, score) {
  brain.episodes += 1;
  brain.best = Math.max(brain.best, score);

  // 直近20回の記録（21回目が来たら、いちばん古いものを捨てる）
  brain.recent.push(score);
  if (brain.recent.length > AVERAGE_WINDOW) brain.recent.shift();

  // グラフ用の記録。historyStep 回分たまったら、その平均を1つの点にする
  brain.pending.sum += score;
  brain.pending.count += 1;
  if (brain.pending.count >= brain.historyStep) {
    brain.history.push(Math.round((brain.pending.sum / brain.pending.count) * 10) / 10);
    brain.pending = { sum: 0, count: 0 };
  }
  // 点が多くなりすぎたら、となり同士の2つを平均して1つにまとめる（点の数が半分になる）
  if (brain.history.length >= HISTORY_MAX) {
    const merged = [];
    for (let i = 0; i + 1 < brain.history.length; i += 2) {
      merged.push((brain.history[i] + brain.history[i + 1]) / 2);
    }
    brain.history = merged;
    brain.historyStep *= 2;
  }

  // 冒険する確率を少し下げる（でも EPSILON_MIN より下にはしない）
  brain.epsilon = Math.max(EPSILON_MIN, brain.epsilon * EPSILON_DECAY);
}

// 本番が1回終わったとき（練習のグラフには入れない）
function recordTest(brain, score) {
  brain.test.count += 1;
  brain.test.last = score;
  brain.test.best = Math.max(brain.test.best, score);
  brain.test.total += score;
}

// 直近20回の練習スコアの平均
function recentAverage(brain) {
  if (brain.recent.length === 0) return 0;
  return brain.recent.reduce((sum, score) => sum + score, 0) / brain.recent.length;
}

// ===== 保存と読みこみ =====
// localStorage（ブラウザの中の小さな保存場所）に、文字（JSON）にして保存する。
// 保存できない環境（プライベートブラウズなど）でも止まらないように try/catch で囲む。
function saveBrain(brain) {
  try {
    const data = {
      version: 1,
      q: Array.from(brain.q),
      episodes: brain.episodes,
      epsilon: brain.epsilon,
      history: brain.history,
      historyStep: brain.historyStep,
      pending: brain.pending,
      recent: brain.recent,
      best: brain.best,
      test: brain.test,
    };
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

// 保存したものがあれば読みこむ。なければ（または壊れていたら）新しい頭脳を作る
function loadBrain() {
  const brain = createBrain();
  try {
    const data = JSON.parse(localStorage.getItem(AI_STORAGE_KEY));
    if (!data || data.version !== 1 || !Array.isArray(data.q) || data.q.length !== brain.q.length) {
      return brain;
    }
    brain.q.set(data.q.map((value) => Number(value) || 0));
    brain.episodes = Number(data.episodes) || 0;
    brain.epsilon = Number.isFinite(data.epsilon) ? data.epsilon : EPSILON_START;
    brain.history = Array.isArray(data.history) ? data.history.map(Number) : [];
    brain.historyStep = Number(data.historyStep) || 1;
    if (data.pending) {
      brain.pending = { sum: Number(data.pending.sum) || 0, count: Number(data.pending.count) || 0 };
    }
    brain.recent = Array.isArray(data.recent) ? data.recent.map(Number).slice(-AVERAGE_WINDOW) : [];
    brain.best = Number(data.best) || 0;
    if (data.test) {
      brain.test = {
        count: Number(data.test.count) || 0,
        last: Number(data.test.last) || 0,
        best: Number(data.test.best) || 0,
        total: Number(data.test.total) || 0,
      };
    }
  } catch (e) {
    // 読めなければ新しい頭脳のまま
  }
  return brain;
}

function deleteSavedBrain() {
  try {
    localStorage.removeItem(AI_STORAGE_KEY);
  } catch (e) {
    // 消せなくても続ける
  }
}

// ===== 成長グラフ =====
// 横 = 何回目の練習か（1回目から今まで）、縦 = スコア。
// 1回ごとのスコアを薄い青の点、平均のながれをオレンジの線で描く。
// 練習が2000回をこえると、点1つが「2回分の平均」「4回分の平均」…になる。
// 線が右上がりなら、AI が上手くなっているということ。
function drawChart(chartCanvas, brain) {
  const rect = chartCanvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return; // 画面に出ていないときは描かない

  const dpr = window.devicePixelRatio || 1;
  const pixelW = Math.round(rect.width * dpr);
  const pixelH = Math.round(rect.height * dpr);
  if (chartCanvas.width !== pixelW || chartCanvas.height !== pixelH) {
    chartCanvas.width = pixelW;
    chartCanvas.height = pixelH;
  }
  const g = chartCanvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = rect.height;
  g.clearRect(0, 0, w, h);
  g.font = '11px system-ui, sans-serif';

  const scores = brain.history;
  const n = scores.length;
  if (n === 0) {
    g.fillStyle = '#5b6b82';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('練習するとここにグラフが出ます', w / 2, h / 2);
    return;
  }

  // グラフを描く範囲（文字を書くすき間をあける）
  const left = 36;
  const right = w - 8;
  const top = 16;
  const bottom = h - 16;

  // 縦軸のいちばん上の数（100きざみで切り上げ）
  let highest = 100;
  for (const score of scores) highest = Math.max(highest, score);
  const yMax = Math.ceil(highest / 100) * 100;

  // i 番目の点は、(i + 1) × historyStep 回目までの記録
  const step = brain.historyStep;
  const lastEpisode = Math.max(n * step, 1);
  const xOf = (i) => left + (((i + 1) * step) / lastEpisode) * (right - left);
  const yOf = (score) => bottom - (score / yMax) * (bottom - top);

  // 目もり線と数字
  g.strokeStyle = '#dde4ef';
  g.lineWidth = 1;
  g.fillStyle = '#5b6b82';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (const value of [0, yMax / 2, yMax]) {
    const y = Math.round(yOf(value)) + 0.5;
    g.beginPath();
    g.moveTo(left, y);
    g.lineTo(right, y);
    g.stroke();
    g.fillText(String(value), left - 4, y);
  }

  // 横軸の数字（左はしが1回目、右はしが最後の点の回数）
  g.textBaseline = 'top';
  g.textAlign = 'left';
  g.fillText('1回目', left, bottom + 3);
  g.textAlign = 'right';
  g.fillText(`${n * step}回目`, right, bottom + 3);

  // 1回ごとのスコア（薄い点）
  g.fillStyle = 'rgba(47, 111, 228, 0.35)';
  for (let i = 0; i < n; i++) {
    g.fillRect(xOf(i) - 1.5, yOf(scores[i]) - 1.5, 3, 3);
  }

  // 平均のながれ（線）。だいたい20回分の平均。足し算をためておき、はみ出た古い分を引いて平均を出す
  const windowSize = Math.max(1, Math.round(AVERAGE_WINDOW / step));
  g.strokeStyle = '#e4572f';
  g.lineWidth = 2;
  g.beginPath();
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += scores[i];
    if (i >= windowSize) sum -= scores[i - windowSize];
    const count = Math.min(i + 1, windowSize);
    const x = xOf(i);
    const y = yOf(sum / count);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();

  // 凡例（グラフの見方）
  g.textAlign = 'right';
  g.textBaseline = 'top';
  g.fillStyle = '#e4572f';
  g.fillText('━ 平均のながれ', right, 1);
  const legendWidth = g.measureText('━ 平均のながれ').width;
  g.fillStyle = '#2f6fe4';
  g.fillText(step === 1 ? '● 1回ごと' : `● ${step}回ごとの平均`, right - legendWidth - 10, 1);
}
