// ===== 神経衰弱 =====
// 裏向きのカードを2枚ずつめくって、同じ絵をそろえるゲーム。
// 間違えた回数が少ないほど良い記録。

// ----- 難易度の設定 -----
//   pairs: ペアの数（カードの枚数はこの2倍）
//   cols:  横に並べる枚数
const DIFFICULTIES = {
  easy:   { label: 'やさしい',   pairs: 3,  cols: 3 }, // 3×2
  normal: { label: 'ふつう',     pairs: 6,  cols: 3 }, // 3×4
  hard:   { label: 'むずかしい', pairs: 10, cols: 4 }, // 4×5
};

// ----- 絵柄（テーマ）の設定 -----
// 1つのテーマに10個以上の絵文字を入れておく（むずかしいで10種類使うため）
const THEMES = {
  animal:  ['🐶', '🐱', '🐰', '🐻', '🐼', '🦊', '🐸', '🐵', '🐧', '🦁', '🐯', '🐨'],
  vehicle: ['🚗', '🚌', '🚓', '🚑', '🚒', '🚲', '✈️', '🚀', '🚢', '🚃', '🚁', '🚜'],
  food:    ['🍎', '🍌', '🍇', '🍓', '🍙', '🍔', '🍕', '🍩', '🍰', '🍉', '🍦', '🍤'],
};

const BEST_KEY   = 'memory-best';   // ハイスコアを保存するときの名前
const PHOTO_KEY  = 'memory-photos'; // 写真を保存するときの名前
const MAX_PHOTOS = 20;              // 保存できる写真の最大数
const PHOTO_SIZE = 200;             // 写真を縮める大きさ（1辺のpx）
const FLIP_BACK_WAIT = 800;         // 間違えたとき、裏に戻すまでの時間（ミリ秒。1000で1秒）

// ----- ゲームの状態 -----
const state = {
  level: 'easy',     // えらんでいる難易度
  theme: 'animal',   // えらんでいる絵柄
  cards: [],         // 並んでいるカード { value, el, open, matched }
  opened: [],        // いまめくっている途中のカード（0〜2枚）
  locked: false,     // true の間はカードを押せない（裏に戻している最中）
  miss: 0,           // 間違えた回数
  matchedPairs: 0,   // そろったペアの数
};
let photos = loadPhotos(); // オリジナル用の写真（文字データ data URL の一覧）

// ----- 画面の部品を取り出しておく -----
const screens = {
  select: document.getElementById('screen-select'),
  play:   document.getElementById('screen-play'),
  clear:  document.getElementById('screen-clear'),
};
const levelButtons  = document.querySelectorAll('[data-level]');
const themeButtons  = document.querySelectorAll('[data-theme]');
const photoPanel    = document.getElementById('photo-panel');
const photoInput    = document.getElementById('photo-input');
const photoCount    = document.getElementById('photo-count');
const photoList     = document.getElementById('photo-list');
const photoClear    = document.getElementById('photo-clear');
const startButton   = document.getElementById('start-button');
const boardArea     = document.getElementById('board-area');
const board         = document.getElementById('board');
const missText      = document.getElementById('miss');
const pairsText     = document.getElementById('pairs');
const bestText      = document.getElementById('best');
const finalMiss     = document.getElementById('final-miss');
const newRecordText = document.getElementById('new-record');

// ===== ハイスコアの読み書き =====
// 保存できない環境（プライベートブラウズなど）でも止まらないように try/catch で囲む
function loadBest() {
  try {
    const saved = JSON.parse(localStorage.getItem(BEST_KEY));
    return saved && typeof saved === 'object' ? saved : {};
  } catch (e) {
    return {};
  }
}

function saveBest(best) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch (e) {
    // 保存できなくても、ゲームはそのまま遊べる
  }
}

// えらぶ画面の難易度ボタンに、ベスト記録を表示する
function renderBest() {
  const best = loadBest();
  for (const level in DIFFICULTIES) {
    const label = document.querySelector(`[data-best="${level}"]`);
    label.textContent = level in best ? `ベスト ${best[level]}回` : '記録なし';
  }
}

// ===== 写真の読み書き =====
function loadPhotos() {
  try {
    const saved = JSON.parse(localStorage.getItem(PHOTO_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch (e) {
    return [];
  }
}

// 保存できたら true、できなかったら（容量がいっぱいなど）false を返す
function savePhotos() {
  try {
    localStorage.setItem(PHOTO_KEY, JSON.stringify(photos));
    return true;
  } catch (e) {
    return false;
  }
}

// 写真ファイルを読みこんで、真ん中を正方形に切り取り、小さく縮めた文字データにする。
// Promise は「あとで結果がわかる約束」。読みこみが終わったら結果を返す。
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); // ファイルを一時的に画像として読めるようにする
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height); // 短いほうの辺に合わせて正方形にする
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = PHOTO_SIZE;
      canvas.height = PHOTO_SIZE;
      canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8)); // JPEG にすると軽くなる
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像を読みこめませんでした'));
    };
    img.src = url;
  });
}

// 写真が選ばれたとき
photoInput.addEventListener('change', async () => {
  const files = Array.from(photoInput.files);
  photoInput.value = ''; // 同じ写真をもう一度えらんでも反応するように空にしておく
  let message = '';

  for (const file of files) {
    if (photos.length >= MAX_PHOTOS) {
      message = `写真は${MAX_PHOTOS}枚までです`;
      break;
    }
    try {
      photos.push(await shrinkPhoto(file)); // await は「終わるまで待つ」という意味
    } catch (e) {
      message = '読みこめない写真がありました';
    }
  }

  if (!savePhotos()) {
    message = '保存しきれませんでした。今回だけ遊べますが、ページを閉じると写真は消えます';
  }
  renderPhotos(message);
});

// 写真を「ぜんぶ消す」
photoClear.addEventListener('click', () => {
  if (!confirm('写真をぜんぶ消しますか？')) return;
  photos = [];
  savePhotos();
  renderPhotos();
});

// 写真の一覧と「あと○枚」の表示を作りなおす
function renderPhotos(message = '') {
  photoList.textContent = ''; // 一度からっぽにする
  photos.forEach((src, index) => {
    const item = document.createElement('li');
    const img = document.createElement('img');
    img.src = src;
    img.alt = `写真${index + 1}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'photo-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `写真${index + 1}を消す`);
    remove.addEventListener('click', () => {
      photos.splice(index, 1); // index 番目を1つ取りのぞく
      savePhotos();
      renderPhotos();
    });
    item.append(img, remove);
    photoList.appendChild(item);
  });
  photoClear.hidden = photos.length === 0;

  const need = DIFFICULTIES[state.level].pairs;
  if (message) {
    photoCount.textContent = message;
    photoCount.className = 'photo-count short';
  } else if (photos.length < need) {
    photoCount.textContent = `あと ${need - photos.length}枚 必要です（いま ${photos.length}枚）`;
    photoCount.className = 'photo-count short';
  } else {
    photoCount.textContent = `OK！（いま ${photos.length}枚。${need}枚をえらんで使います）`;
    photoCount.className = 'photo-count ok';
  }
  updateStartButton();
}

// オリジナルで写真が足りないときは、スタートを押せなくする
function updateStartButton() {
  const need = DIFFICULTIES[state.level].pairs;
  startButton.disabled = state.theme === 'original' && photos.length < need;
}

// ===== 画面の切りかえ =====
// name の画面だけ見せて、ほかはかくす
function showScreen(name) {
  for (const key in screens) {
    screens[key].hidden = key !== name;
  }
  // あそぶ画面のときだけ、ページを画面の高さぴったりにしてスクロールしないようにする
  document.body.classList.toggle('is-playing', name === 'play');
}

// ===== 難易度・絵柄のボタン =====
// えらんだボタンだけ aria-pressed="true"（押されている状態）にする
function markPressed(buttons, isPressed) {
  for (const button of buttons) {
    button.setAttribute('aria-pressed', String(isPressed(button)));
  }
}

for (const button of levelButtons) {
  button.addEventListener('click', () => {
    state.level = button.dataset.level;
    markPressed(levelButtons, (b) => b.dataset.level === state.level);
    renderPhotos(); // 必要な写真の枚数が変わるので表示しなおす
  });
}

for (const button of themeButtons) {
  button.addEventListener('click', () => {
    state.theme = button.dataset.theme;
    markPressed(themeButtons, (b) => b.dataset.theme === state.theme);
    photoPanel.hidden = state.theme !== 'original';
    updateStartButton();
  });
}

// ===== カードを用意する =====
// 配列の順番をバラバラに混ぜる（Fisher–Yates という、かたよりなく混ぜる方法）
function shuffle(list) {
  const result = list.slice(); // もとの配列をこわさないようにコピーする
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]]; // i 番目と j 番目を入れかえる
  }
  return result;
}

function startGame() {
  const { pairs, cols } = DIFFICULTIES[state.level];
  const isPhoto = state.theme === 'original';
  const source = isPhoto ? photos : THEMES[state.theme];

  // 絵柄をペアの数だけえらび、それぞれ2枚ずつにして混ぜる
  const picked = shuffle(source).slice(0, pairs);
  const values = shuffle([...picked, ...picked]);

  state.cards = [];
  state.opened = [];
  state.locked = false;
  state.miss = 0;
  state.matchedPairs = 0;

  board.textContent = '';
  board.style.setProperty('--cols', cols);

  values.forEach((value, index) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'mcard';
    el.setAttribute('aria-label', `${index + 1}番のカード`);

    const inner = document.createElement('span');
    inner.className = 'mcard-inner';
    const back = document.createElement('span');
    back.className = 'mcard-face mcard-back';
    const front = document.createElement('span');
    front.className = 'mcard-face mcard-front';
    if (isPhoto) {
      const img = document.createElement('img');
      img.src = value;
      img.alt = '';
      img.draggable = false; // 写真をドラッグして動かせないようにする
      front.appendChild(img);
    } else {
      front.textContent = value;
    }
    inner.append(back, front);
    el.appendChild(inner);

    const card = { value, el, open: false, matched: false };
    el.addEventListener('click', () => flip(card));
    el.addEventListener('focus', () => { focusIndex = index; });
    state.cards.push(card);
    board.appendChild(el);
  });

  focusIndex = 0;
  updateStatus();
  showScreen('play');
  layoutBoard();
}

// ===== カードの大きさを画面に合わせる =====
// 置ける場所の幅と高さの両方を見て、はみ出さないいちばん大きいカードの幅を決める
function layoutBoard() {
  if (screens.play.hidden) return;
  const { pairs, cols } = DIFFICULTIES[state.level];
  const rows = Math.ceil((pairs * 2) / cols);
  const rect = boardArea.getBoundingClientRect();
  const gap = rect.width < 400 ? 6 : 10;

  const byWidth  = (rect.width - gap * (cols - 1)) / cols;
  const byHeight = ((rect.height - gap * (rows - 1)) / rows) * 3 / 4; // カードは 横3：縦4
  const cardWidth = Math.max(Math.floor(Math.min(byWidth, byHeight, 140)), 30);

  board.style.setProperty('--gap', `${gap}px`);
  board.style.setProperty('--card-w', `${cardWidth}px`);
}

window.addEventListener('resize', layoutBoard);

// ===== カードをめくる =====
function flip(card) {
  // 押せないとき：裏に戻している最中・もうそろったカード・すでに表のカード
  if (state.locked || card.matched || card.open) return;

  card.open = true;
  card.el.classList.add('is-open');
  card.el.setAttribute('aria-label', `${labelOf(card)}（めくった）`);
  state.opened.push(card);

  if (state.opened.length < 2) return; // 1枚目なら、2枚目を待つ

  const [a, b] = state.opened;
  state.opened = [];

  if (a.value === b.value) {
    // そろった！
    for (const c of [a, b]) {
      c.matched = true;
      c.el.classList.add('is-matched');
      c.el.setAttribute('aria-label', `${labelOf(c)}（そろった）`);
    }
    state.matchedPairs++;
    updateStatus();
    if (state.matchedPairs === DIFFICULTIES[state.level].pairs) {
      setTimeout(finishGame, 600); // そろった様子を少し見せてからクリア画面へ
    }
  } else {
    // ちがった → 間違いを数えて、少し待ってから裏に戻す
    state.miss++;
    updateStatus();
    state.locked = true;
    setTimeout(() => {
      for (const c of [a, b]) {
        c.open = false;
        c.el.classList.remove('is-open');
        c.el.setAttribute('aria-label', `${state.cards.indexOf(c) + 1}番のカード`);
      }
      state.locked = false;
    }, FLIP_BACK_WAIT);
  }
}

// 読み上げ用のカードの名前（写真なら「写真」）
function labelOf(card) {
  return state.theme === 'original' ? '写真' : card.value;
}

function updateStatus() {
  const best = loadBest();
  missText.textContent = state.miss;
  pairsText.textContent = `${state.matchedPairs}/${DIFFICULTIES[state.level].pairs}`;
  bestText.textContent = state.level in best ? best[state.level] : '-';
}

// ===== クリア =====
function finishGame() {
  const best = loadBest();
  const isRecord = !(state.level in best) || state.miss < best[state.level];
  if (isRecord) {
    best[state.level] = state.miss;
    saveBest(best);
  }
  finalMiss.textContent = state.miss;
  newRecordText.hidden = !isRecord;
  showScreen('clear');
  document.getElementById('retry-button').focus();
}

// ===== 矢印キーでカードをえらぶ =====
// focusIndex は「いまえらんでいるカードの番号」。focus() でそのカードに枠を出す
let focusIndex = 0;

window.addEventListener('keydown', (event) => {
  if (screens.play.hidden) return;
  const { cols } = DIFFICULTIES[state.level];
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };
  if (!(event.key in moves)) return;
  event.preventDefault(); // 矢印キーで画面がスクロールしないようにする

  const onCard = state.cards.some((c) => c.el === document.activeElement);
  if (onCard) {
    const next = focusIndex + moves[event.key];
    // 端より先には動かない
    if (next >= 0 && next < state.cards.length) focusIndex = next;
  }
  // まだどのカードもえらんでいなければ、いまの番号（最初は左上）をえらぶ
  state.cards[focusIndex].el.focus();
});

// ===== ボタン =====
startButton.addEventListener('click', startGame);
document.getElementById('retry-button').addEventListener('click', startGame);
document.getElementById('back-button').addEventListener('click', backToSelect);
document.getElementById('quit-button').addEventListener('click', () => {
  if (confirm('ゲームをやめて、えらぶ画面に戻りますか？')) backToSelect();
});

function backToSelect() {
  renderBest();
  renderPhotos();
  showScreen('select');
}

// ===== はじめに =====
renderBest();
renderPhotos();
