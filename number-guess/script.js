// ===== 難易度の設定 =====
// 難易度ごとに「名前」と「いちばん大きい数」を決めておく
const DIFFICULTIES = {
  easy:   { label: 'かんたん',   max: 10 },
  normal: { label: 'ふつう',     max: 100 },
  hard:   { label: 'むずかしい', max: 1000 },
};

// ハイスコアをブラウザに保存するときの名前
const STORAGE_KEY = 'number-guess-best';

// ===== ゲームの状態 =====
// 今のゲームの情報をまとめて入れておく箱
const state = {
  level: 'easy', // 今の難易度
  answer: 0,     // 正解の数
  count: 0,      // 答えた回数
  low: 1,        // 答えがありえる一番小さい数
  high: 10,      // 答えがありえる一番大きい数
};

// ===== 画面の部品を取り出しておく =====
const screens = {
  select: document.getElementById('screen-select'),
  play:   document.getElementById('screen-play'),
  clear:  document.getElementById('screen-clear'),
};
const form          = document.getElementById('guess-form');
const input         = document.getElementById('guess-input');
const questionText  = document.getElementById('play-question');
const hintText      = document.getElementById('hint');
const countText     = document.getElementById('count');
const rangeText     = document.getElementById('range');
const historyList   = document.getElementById('history');
const clearMessage  = document.getElementById('clear-message');
const newRecordText = document.getElementById('new-record');

// ===== ハイスコアの読み書き =====
// 保存できない環境（プライベートブラウズなど）でも止まらないように try/catch で囲む
function loadBest() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && typeof saved === 'object' ? saved : {};
  } catch (e) {
    return {};
  }
}

function saveBest(best) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(best));
  } catch (e) {
    // 保存できなくても、ゲームはそのまま遊べる
  }
}

// 難易度えらびの画面に、ハイスコアを表示する
function renderBest() {
  const best = loadBest();
  for (const level in DIFFICULTIES) {
    const label = document.querySelector(`[data-best="${level}"]`);
    label.textContent = best[level] ? `ベスト ${best[level]}回` : '記録なし';
  }
}

// ===== 画面の切りかえ =====
// name の画面だけ見せて、ほかはかくす
function showScreen(name) {
  for (const key in screens) {
    screens[key].hidden = key !== name;
  }
}

// ===== ゲームを始める =====
function startGame(level) {
  const max = DIFFICULTIES[level].max;

  state.level  = level;
  state.answer = Math.floor(Math.random() * max) + 1; // 1〜max のでたらめな整数
  state.count  = 0;
  state.low    = 1;
  state.high   = max;

  questionText.textContent = `${DIFFICULTIES[level].label}：1〜${max} の数を当ててね`;
  input.min = 1;
  input.max = max;
  input.value = '';
  historyList.innerHTML = '';
  setHint('', '');
  updateStatus();

  showScreen('play');
  input.focus();
}

// ヒントの文字と色を変える
function setHint(text, type) {
  hintText.textContent = text;
  hintText.className = 'hint ' + type;
}

// 回数と答えのはんいの表示を新しくする
function updateStatus() {
  countText.textContent = `${state.count}回`;
  rangeText.textContent = `${state.low}〜${state.high}`;
}

// 入力した数を「入力した数」の一覧に追加する
function addHistory(number, type) {
  const item = document.createElement('li');
  item.textContent = number;
  item.className = type;
  historyList.appendChild(item);
}

// ===== 答えを判定する =====
// 「こたえる」ボタン・Enterキー・スマホの「実行」キーのどれでもここが動く
form.addEventListener('submit', (event) => {
  event.preventDefault(); // ページが読みこみ直されないようにする

  const max = DIFFICULTIES[state.level].max;
  const text = input.value.trim();
  const guess = Number(text);

  // おかしな入力ははじく（回数には数えない）
  if (text === '' || !Number.isInteger(guess) || guess < 1 || guess > max) {
    setHint(`1〜${max} の整数を入力してね`, 'error');
    input.select();
    return;
  }

  state.count++;

  if (guess < state.answer) {
    setHint(`${guess} より もっと大きい`, 'up');
    state.low = Math.max(state.low, guess + 1);
    addHistory(guess, 'up');
  } else if (guess > state.answer) {
    setHint(`${guess} より もっと小さい`, 'down');
    state.high = Math.min(state.high, guess - 1);
    addHistory(guess, 'down');
  } else {
    finishGame();
    return;
  }

  updateStatus();
  input.value = '';
  input.focus();
});

// ===== 正解したとき =====
function finishGame() {
  const best = loadBest();
  const isNewRecord = !best[state.level] || state.count < best[state.level];

  if (isNewRecord) {
    best[state.level] = state.count;
    saveBest(best);
  }

  clearMessage.textContent = `答えは ${state.answer}。${state.count}回で当てました！`;
  newRecordText.hidden = !isNewRecord;
  input.blur(); // スマホのキーボードを閉じる
  showScreen('clear');
}

// ===== ボタンの動き =====
// 難易度ボタン
document.querySelectorAll('.level-button').forEach((button) => {
  button.addEventListener('click', () => startGame(button.dataset.level));
});

// 「もう一回」ボタン
document.querySelector('[data-action="retry"]').addEventListener('click', () => {
  startGame(state.level);
});

// 「難易度をえらびなおす」ボタン（2つある）
document.querySelectorAll('[data-action="back"]').forEach((button) => {
  button.addEventListener('click', () => {
    renderBest();
    showScreen('select');
  });
});

// ===== ページを開いたとき =====
renderBest();
showScreen('select');
