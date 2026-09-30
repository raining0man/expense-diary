/* ============================================================
   Дневник расходов — вся логика приложения
   ============================================================ */

/* ---------- Константы ---------- */
const AMP = String.fromCharCode(38);
const LS_DATA  = 'expense_diary_data_v1';
const LS_UI    = 'expense_diary_ui_v1';
const LS_MONTH = 'expense_diary_month_v1';

// >>> ЗАМЕНИ НА СВОЙ КОНФИГ ИЗ FIREBASE <<<
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBf73zJJP8LxzaOVyssk2wPDPyd0P3iziA",
  authDomain: "manager-6f1c6.firebaseapp.com",
  projectId: "manager-6f1c6",
  storageBucket: "manager-6f1c6.firebasestorage.app",
  messagingSenderId: "806246372105",
  appId: "1:806246372105:web:f8103cf763c241eacff9d8",
  measurementId: "G-MCZJ2K8LN9"
};

const COLORS = ['#e53935','#fb8c00','#fdd835','#43a047','#00897b','#1e88e5',
                '#3949ab','#8e24aa','#d81b60','#6d4c41','#546e7a','#00acc1'];
const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                   'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_RU_SHORT = ['янв','фев','мар','апр','май','июн',
                         'июл','авг','сен','окт','ноя','дек'];

/* ---------- Состояние ---------- */
const state = {
  db: null, auth: null, user: null, docRef: null,
  data: { categories: [], transactions: [], version: 0 },
  isSaving: false,
  syncStatus: 'init',
  currentMonth: loadMonth(),
  ui: loadUI(),
  editingTxn: null,
  editingCat: null,
  editingCatColor: COLORS[0],
  newTxn: {
    type: 'expense',
    categoryId: null,
    amount: '',
    date: todayISO(),
    comment: '',
    recurring: false
  }
};

/* ---------- Утилиты ---------- */
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
         + '-' + String(d.getDate()).padStart(2, '0');
}
function currentYM() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) ? n : 0;
}
function fmtMoney(n) {
  const v = Math.round(n * 100) / 100;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v) + ' \u20BD';
}
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

function addMonths(ym, n) {
  let y = parseInt(ym.slice(0, 4), 10);
  let m = parseInt(ym.slice(5, 7), 10);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1)  { m += 12; y--; }
  return y + '-' + String(m).padStart(2, '0');
}
function monthLabelFull(ym) {
  const y = ym.slice(0, 4);
  const m = parseInt(ym.slice(5, 7), 10);
  return MONTHS_RU[m - 1] + ' ' + y;
}
function dateLabel(iso) {
  const [y, m, d] = iso.split('-');
  return d + ' ' + MONTHS_RU_SHORT[parseInt(m, 10) - 1] + ' ' + y;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .split(AMP).join(AMP + 'amp;')
    .split('<').join(AMP + 'lt;')
    .split('>').join(AMP + 'gt;')
    .split('"').join(AMP + 'quot;')
    .split("'").join(AMP + '#39;');
}
function escapeAttr(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .split(AMP).join(AMP + 'amp;')
    .split('"').join(AMP + 'quot;')
    .split('<').join(AMP + 'lt;')
    .split('>').join(AMP + 'gt;');
}

function loadMonth() {
  try {
    const v = localStorage.getItem(LS_MONTH);
    if (v && /^\d{4}-\d{2}$/.test(v)) return v;
  } catch (e) {}
  return currentYM();
}
function loadUI() {
  const base = { collapsed: {}, forecastWindow: 3, filterType: 'all', filterCat: 'all', filterSearch: '' };
  try {
    const raw = localStorage.getItem(LS_UI);
    if (raw) return Object.assign(base, JSON.parse(raw));
  } catch (e) {}
  return base;
}
function saveUI() {
  try { localStorage.setItem(LS_UI, JSON.stringify(state.ui)); } catch (e) {}
}

/* ---------- Тосты и статус-бар ---------- */
function toast(msg, type) {
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'err' ? 'err' : 'ok');
  el.textContent = msg;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2200);
}
function setSync(status, text) {
  state.syncStatus = status;
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncText');
  dot.classList.remove('ok', 'warn', 'err');
  if (status === 'ok')       { dot.classList.add('ok');   txt.textContent = text || 'Синхронизировано'; }
  else if (status === 'sync'){ dot.classList.add('warn'); txt.textContent = text || 'Сохранение…'; }
  else if (status === 'off') { dot.classList.add('warn'); txt.textContent = text || 'Офлайн (локально)'; }
  else if (status === 'err') { dot.classList.add('err');  txt.textContent = text || 'Ошибка синхронизации'; }
  else                       { txt.textContent = text || 'Инициализация…'; }
}
function renderVersion() {
  document.getElementById('verText').textContent = 'v' + (state.data.version || 0);
}

/* ---------- Категории по умолчанию ---------- */
function defaultCategories() {
  const defs = [
    { name: 'Продукты',      type: 'expense', color: COLORS[0] },
    { name: 'Транспорт',     type: 'expense', color: COLORS[1] },
    { name: 'Жильё',         type: 'expense', color: COLORS[2] },
    { name: 'Развлечения',   type: 'expense', color: COLORS[3] },
    { name: 'Здоровье',      type: 'expense', color: COLORS[4] },
    { name: 'Одежда',        type: 'expense', color: COLORS[5] },
    { name: 'Прочее',        type: 'expense', color: COLORS[6] },
    { name: 'Зарплата',      type: 'income',  color: COLORS[7] },
    { name: 'Фриланс',       type: 'income',  color: COLORS[8] },
    { name: 'Подарки',       type: 'income',  color: COLORS[9] }
  ];
  return defs.map(d => ({ id: uid(), name: d.name, type: d.type, color: d.color }));
}

/* ---------- Нормализация данных (миграция) ---------- */
function normalizeData(d) {
  const out = { categories: [], transactions: [], version: 0 };
  if (!d || typeof d !== 'object') d = {};
  if (Array.isArray(d.categories)) {
    out.categories = d.categories.map(c => ({
      id: c.id || uid(),
      name: String(c.name || 'Без названия'),
      type: c.type === 'income' ? 'income' : 'expense',
      color: /^#[0-9a-f]{3,8}$/i.test(c.color) ? c.color : COLORS[0]
    }));
  }
  if (Array.isArray(d.transactions)) {
    out.transactions = d.transactions.map(t => {
      const base = {
        id: t.id || uid(),
        categoryId: t.categoryId || null,
        type: t.type === 'income' ? 'income' : 'expense',
        amount: num(t.amount),
        date: /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : todayISO(),
        comment: String(t.comment || ''),
        recurring: !!t.recurring,
        createdAt: t.createdAt || Date.now()
      };
      if (base.recurring) {
        base.skipped = Array.isArray(t.skipped) ? t.skipped.filter(x => /^\d{4}-\d{2}$/.test(x)) : [];
      }
      return base;
    });
  }
  out.version = num(d.version);
  return out;
}

/* ---------- Разворачивание повторяющихся операций ---------- */
function getMonthTransactions(ym) {
  const y = parseInt(ym.slice(0, 4), 10);
  const m = parseInt(ym.slice(5, 7), 10);
  const dim = daysInMonth(y, m);
  const result = [];
  for (const t of state.data.transactions) {
    const tMonth = t.date.slice(0, 7);
    if (!t.recurring) {
      if (tMonth === ym) result.push(Object.assign({}, t, { effectiveDate: t.date, isVirtual: false }));
    } else {
      if (ym < tMonth) continue;
      if (Array.isArray(t.skipped) && t.skipped.indexOf(ym) !== -1) continue;
      const day = Math.min(parseInt(t.date.slice(8, 10), 10), dim);
      const effectiveDate = ym + '-' + String(day).padStart(2, '0');
      const isVirtual = (tMonth !== ym);
      result.push(Object.assign({}, t, { effectiveDate: effectiveDate, isVirtual: isVirtual }));
    }
  }
  return result;
}

/* ---------- Сохранение ---------- */
function saveLocal() {
  try { localStorage.setItem(LS_DATA, JSON.stringify(state.data)); } catch (e) {}
}
async function save() {
  state.data.version = (state.data.version || 0) + 1;
  saveLocal();
  renderVersion();
  setSync('sync', 'Сохранение…');
  if (!state.docRef) {
    state.isSaving = false;
    setSync('off', 'Офлайн (локально)');
    return;
  }
  state.isSaving = true;
  try {
    await state.docRef.set(state.data);
    setSync('ok');
  } catch (e) {
    console.error('save error', e);
    setSync('err', 'Ошибка сохранения');
    toast('Не удалось сохранить', 'err');
  } finally {
    setTimeout(() => { state.isSaving = false; }, 700);
  }
}

/* ---------- Инициализация Firebase ---------- */
async function initFirebase() {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    state.auth = firebase.auth();
    state.db = firebase.firestore();
    state.db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    const cred = await state.auth.signInAnonymously();
    state.user = cred.user;
    state.docRef = state.db.collection('data').doc('main');
    state.docRef.onSnapshot(snap => {
      if (state.isSaving) return;
      const remote = snap.exists ? normalizeData(snap.data()) : null;
      if (!remote) {
        if (state.data.categories.length === 0) {
          state.data = normalizeData({ categories: defaultCategories(), transactions: [], version: 1 });
        }
        save();
        return;
      }
      if (remote.version >= (state.data.version || 0)) {
        state.data = remote;
        saveLocal();
        renderAll();
        renderVersion();
        setSync('ok');
      }
    }, err => {
      console.error('snapshot error', err);
      setSync('err', 'Ошибка соединения');
    });
    setSync('ok');
  } catch (e) {
    console.error('firebase init error', e);
    setSync('off', 'Офлайн (локально)');
    toast('Firebase недоступен, работаем локально', 'err');
  }
}

/* ============================================================
   РЕНДЕРИНГ
   ============================================================ */

function renderAll() {
  renderMonthLabel();
  renderDashboard();
  renderAdd();
  renderTransactions();
  renderForecast();
  renderCategories();
  applyCollapsed();
  renderVersion();
}

function renderMonthLabel() {
  document.getElementById('monthLabel').textContent = monthLabelFull(state.currentMonth);
}

function applyCollapsed() {
  document.querySelectorAll('.section').forEach(sec => {
    const key = sec.dataset.sec;
    if (state.ui.collapsed[key]) sec.classList.add('collapsed');
    else sec.classList.remove('collapsed');
  });
}

/* ---------- Дашборд ---------- */
function renderDashboard() {
  const el = document.getElementById('dashboardBody');
  const txns = getMonthTransactions(state.currentMonth);
  const income = txns.filter(t => t.type === 'income').reduce((s, t) => s + num(t.amount), 0);
  const expense = txns.filter(t => t.type === 'expense').reduce((s, t) => s + num(t.amount), 0);
  const balance = income - expense;

  const byCat = {};
  for (const t of txns) {
    if (t.type !== 'expense') continue;
    byCat[t.categoryId] = (byCat[t.categoryId] || 0) + num(t.amount);
  }
  const catRows = Object.keys(byCat).map(id => {
    const cat = state.data.categories.find(c => c.id === id);
    return { cat: cat, sum: byCat[id] };
  }).filter(x => x.cat).sort((a, b) => b.sum - a.sum);
  const maxExp = catRows.length ? catRows[0].sum : 1;

  const months = [];
  for (let i = 11; i >= 0; i--) {
    const ym = addMonths(state.currentMonth, -i);
    const t = getMonthTransactions(ym);
    const inc = t.filter(x => x.type === 'income').reduce((s, x) => s + num(x.amount), 0);
    const exp = t.filter(x => x.type === 'expense').reduce((s, x) => s + num(x.amount), 0);
    months.push({ ym: ym, inc: inc, exp: exp });
  }
  const maxBar = Math.max(1, months.reduce((m, x) => Math.max(m, x.inc, x.exp), 0));

  el.innerHTML =
    '<div class="cards">' +
      '<div class="card stat"><div class="stat-label">Доходы</div><div class="stat-val ok">' + fmtMoney(income) + '</div></div>' +
      '<div class="card stat"><div class="stat-label">Расходы</div><div class="stat-val danger">' + fmtMoney(expense) + '</div></div>' +
      '<div class="card stat"><div class="stat-label">Баланс</div><div class="stat-val ' + (balance >= 0 ? 'ok' : 'danger') + '">' + fmtMoney(balance) + '</div></div>' +
    '</div>' +
    '<div class="subhead">Расходы по категориям</div>' +
    (catRows.length === 0
      ? '<div class="empty">Нет расходов в этом месяце</div>'
      : catRows.map(r =>
          '<div class="cat-row">' +
            '<div class="cat-row-head">' +
              '<span class="dot-color" style="background:' + r.cat.color + '"></span>' +
              '<span class="cat-name">' + escapeHtml(r.cat.name) + '</span>' +
              '<span class="cat-sum">' + fmtMoney(r.sum) + '</span>' +
            '</div>' +
            '<div class="bar"><div class="bar-fill" style="width:' + (r.sum / maxExp * 100).toFixed(1) + '%;background:' + r.cat.color + '"></div></div>' +
          '</div>'
        ).join('')) +
    '<div class="subhead">Последние 12 месяцев</div>' +
    '<div class="chart">' +
      months.map(m =>
        '<div class="chart-col" title="' + monthLabelFull(m.ym) + '">' +
          '<div class="chart-bars">' +
            '<div class="chart-bar inc" style="height:' + (m.inc / maxBar * 100).toFixed(1) + '%"></div>' +
            '<div class="chart-bar exp" style="height:' + (m.exp / maxBar * 100).toFixed(1) + '%"></div>' +
          '</div>' +
          '<div class="chart-lbl">' + MONTHS_RU_SHORT[parseInt(m.ym.slice(5, 7), 10) - 1] + '</div>' +
        '</div>'
      ).join('') +
    '</div>' +
    '<div class="legend"><span><i class="lg inc"></i>Доходы</span><span><i class="lg exp"></i>Расходы</span></div>';
}

/* ---------- Форма добавления ---------- */
function renderAdd() {
  const el = document.getElementById('addBody');
  const nt = state.newTxn;
  const cats = state.data.categories.filter(c => c.type === nt.type);

  el.innerHTML =
    '<div class="type-toggle">' +
      '<button class="tt-btn ' + (nt.type === 'expense' ? 'active exp' : '') + '" data-act="set-type" data-type="expense">Расход</button>' +
      '<button class="tt-btn ' + (nt.type === 'income'  ? 'active inc' : '') + '" data-act="set-type" data-type="income">Доход</button>' +
    '</div>' +
    '<div class="cat-grid">' +
      (cats.length
        ? cats.map(c =>
            '<button class="cat-btn ' + (nt.categoryId === c.id ? 'active' : '') + '" data-act="pick-cat-new" data-id="' + c.id + '" style="--c:' + c.color + '">' +
              '<span class="dot-color" style="background:' + c.color + '"></span>' +
              '<span>' + escapeHtml(c.name) + '</span>' +
            '</button>'
          ).join('')
        : '<div class="empty">Нет категорий. Добавь в разделе «Категории».</div>') +
    '</div>' +
    '<label class="field"><span>Сумма</span>' +
      '<input type="number" inputmode="decimal" step="0.01" min="0" id="ntAmount" value="' + escapeAttr(nt.amount) + '" placeholder="0"></label>' +
    '<label class="field"><span>Дата</span>' +
      '<input type="date" id="ntDate" value="' + escapeAttr(nt.date) + '"></label>' +
    '<label class="field"><span>Комментарий</span>' +
      '<input type="text" id="ntComment" value="' + escapeAttr(nt.comment) + '" placeholder="необязательно"></label>' +
    '<label class="check">' +
      '<input type="checkbox" id="ntRecurring" ' + (nt.recurring ? 'checked' : '') + '>' +
      '<span>Повторять ежемесячно</span></label>' +
    '<button class="btn primary" data-act="add-txn">Добавить</button>';
}

/* ---------- Список операций ---------- */
function renderTransactions() {
  const el = document.getElementById('txnBody');
  const f = state.ui;
  let txns = getMonthTransactions(state.currentMonth);

  if (f.filterType !== 'all') txns = txns.filter(t => t.type === f.filterType);
  if (f.filterCat !== 'all')  txns = txns.filter(t => t.categoryId === f.filterCat);
  if (f.filterSearch) {
    const q = f.filterSearch.toLowerCase();
    txns = txns.filter(t => (t.comment || '').toLowerCase().indexOf(q) !== -1);
  }

  const groups = {};
  for (const t of txns) {
    const d = t.effectiveDate;
    if (!groups[d]) groups[d] = [];
    groups[d].push(t);
  }
  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  let html = '<div class="filters">' +
    '<button class="chip ' + (f.filterType === 'all' ? 'active' : '') + '" data-act="filter-type" data-v="all">Все</button>' +
    '<button class="chip ' + (f.filterType === 'expense' ? 'active' : '') + '" data-act="filter-type" data-v="expense">Расходы</button>' +
    '<button class="chip ' + (f.filterType === 'income' ? 'active' : '') + '" data-act="filter-type" data-v="income">Доходы</button>' +
  '</div>' +
  '<div class="filters">' +
    '<button class="chip ' + (f.filterCat === 'all' ? 'active' : '') + '" data-act="filter-cat" data-v="all">Все категории</button>' +
    state.data.categories.map(c =>
      '<button class="chip ' + (f.filterCat === c.id ? 'active' : '') + '" data-act="filter-cat" data-v="' + c.id + '">' + escapeHtml(c.name) + '</button>'
    ).join('') +
  '</div>' +
  '<input class="search" type="text" id="filterSearch" placeholder="Поиск по комментарию…" value="' + escapeAttr(f.filterSearch) + '">';

  if (dates.length === 0) {
    html += '<div class="empty">Нет операций по фильтру</div>';
  } else {
    for (const d of dates) {
      html += '<div class="day-group">';
      html += '<div class="day-head">' + dateLabel(d) + '</div>';
      for (const t of groups[d]) {
        const cat = state.data.categories.find(c => c.id === t.categoryId);
        const catName = cat ? cat.name : '—';
        const catColor = cat ? cat.color : '#999';
        if (state.editingTxn === t.id) {
          html += renderTxnEditForm(t, catColor);
        } else {
          html +=
            '<div class="txn ' + (t.isVirtual ? 'virtual' : '') + '">' +
              '<div class="txn-cat">' +
                '<span class="dot-color" style="background:' + catColor + '"></span>' +
                '<span>' + escapeHtml(catName) + '</span>' +
                (t.recurring ? '<span class="badge">&#128257;</span>' : '') +
                (t.isVirtual ? '<span class="badge">(повтор)</span>' : '') +
              '</div>' +
              '<div class="txn-amt ' + t.type + '">' + (t.type === 'expense' ? '−' : '+') + fmtMoney(t.amount) + '</div>' +
              (t.comment ? '<div class="txn-cmt">' + escapeHtml(t.comment) + '</div>' : '') +
              '<div class="txn-actions">' +
                '<button class="mini yellow" data-act="edit-txn" data-id="' + t.id + '" title="Редактировать">&#9998;</button>' +
                '<button class="mini red" data-act="del-txn" data-id="' + t.id + '" title="Удалить">&#10005;</button>' +
              '</div>' +
            '</div>';
        }
      }
      html += '</div>';
    }
  }
  el.innerHTML = html;
}

function renderTxnEditForm(t, catColor) {
  const cats = state.data.categories.filter(c => c.type === t.type);
  return '<div class="txn" style="display:block">' +
    '<div class="type-toggle">' +
      '<button class="tt-btn ' + (t.type === 'expense' ? 'active exp' : '') + '" data-act="edit-type" data-type="expense" data-id="' + t.id + '">Расход</button>' +
      '<button class="tt-btn ' + (t.type === 'income'  ? 'active inc' : '') + '" data-act="edit-type" data-type="income"  data-id="' + t.id + '">Доход</button>' +
    '</div>' +
    '<div class="cat-grid">' +
      cats.map(c =>
        '<button class="cat-btn ' + (t.categoryId === c.id ? 'active' : '') + '" data-act="edit-cat" data-id="' + t.id + '" data-cat="' + c.id + '" style="--c:' + c.color + '">' +
          '<span class="dot-color" style="background:' + c.color + '"></span>' +
          '<span>' + escapeHtml(c.name) + '</span>' +
        '</button>'
      ).join('') +
    '</div>' +
    '<label class="field"><span>Сумма</span>' +
      '<input type="number" inputmode="decimal" step="0.01" min="0" id="editAmount" value="' + escapeAttr(t.amount) + '"></label>' +
    '<label class="field"><span>Дата</span>' +
      '<input type="date" id="editDate" value="' + escapeAttr(t.date) + '"></label>' +
    '<label class="field"><span>Комментарий</span>' +
      '<input type="text" id="editComment" value="' + escapeAttr(t.comment) + '"></label>' +
    '<label class="check">' +
      '<input type="checkbox" id="editRecurring" ' + (t.recurring ? 'checked' : '') + '>' +
      '<span>Повторять ежемесячно</span></label>' +
    '<div style="display:flex;gap:6px">' +
      '<button class="btn ok" style="flex:1" data-act="save-edit" data-id="' + t.id + '">Сохранить</button>' +
      '<button class="btn" style="flex:1" data-act="cancel-edit">Отмена</button>' +
    '</div>' +
  '</div>';
}

/* ---------- Прогноз ---------- */
function computeForecast(window) {
  const end = addMonths(state.currentMonth, -1);
  const months = [];
  for (let i = window - 1; i >= 0; i--) months.push(addMonths(end, -i));

  const sums = {};
  for (const c of state.data.categories) sums[c.id] = { exp: 0, inc: 0 };
  for (const ym of months) {
    const txns = getMonthTransactions(ym);
    for (const t of txns) {
      if (!sums[t.categoryId]) sums[t.categoryId] = { exp: 0, inc: 0 };
      if (t.type === 'expense') sums[t.categoryId].exp += num(t.amount);
      else sums[t.categoryId].inc += num(t.amount);
    }
  }

  const rows = [];
  let totalExp = 0, totalInc = 0;
  for (const c of state.data.categories) {
    const s = sums[c.id];
    const avgExp = s.exp / window;
    const avgInc = s.inc / window;
    if (avgExp === 0 && avgInc === 0) continue;
    rows.push({ cat: c, avgExp: avgExp, avgInc: avgInc });
    totalExp += avgExp;
    totalInc += avgInc;
  }
  rows.sort((a, b) => (b.avgExp + b.avgInc) - (a.avgExp + a.avgInc));
  return { months: months, rows: rows, totalExp: totalExp, totalInc: totalInc };
}

function renderForecast() {
  const el = document.getElementById('forecastBody');
  const w = state.ui.forecastWindow;
  const fc = computeForecast(w);
  const rangeText = fc.months.length ? (monthLabelFull(fc.months[0]) + ' — ' + monthLabelFull(fc.months[fc.months.length - 1])) : 'нет данных';

  let html =
    '<div class="filters">' +
      [3, 6, 12].map(n =>
        '<button class="chip ' + (w === n ? 'active' : '') + '" data-act="fc-window" data-n="' + n + '">Последние ' + n + ' мес.</button>'
      ).join('') +
    '</div>' +
    '<div style="font-size:12px;color:var(--text2);margin-bottom:8px">Окно расчёта: ' + rangeText + '</div>';

  if (fc.rows.length === 0) {
    html += '<div class="empty">Недостаточно данных для прогноза</div>';
  } else {
    for (const r of fc.rows) {
      const isExp = r.avgExp >= r.avgInc;
      const perMonth = isExp ? r.avgExp : r.avgInc;
      const perYear = perMonth * 12;
      html +=
        '<div class="fc-row">' +
          '<div class="fc-name">' +
            '<span class="dot-color" style="background:' + r.cat.color + '"></span>' +
            '<span>' + escapeHtml(r.cat.name) + '</span>' +
          '</div>' +
          '<div class="fc-vals">' +
            '<div class="main ' + (isExp ? 'expense' : 'income') + '" style="color:var(--' + (isExp ? 'danger' : 'ok') + ')">' +
              (isExp ? '−' : '+') + fmtMoney(perMonth) + ' / мес' +
            '</div>' +
            '<div class="sub">' + (isExp ? '−' : '+') + fmtMoney(perYear) + ' / год</div>' +
          '</div>' +
        '</div>';
    }
  }

  html +=
    '<div class="fc-total">' +
      '<div><span>Прогноз расходов (мес)</span><b style="color:var(--danger)">' + fmtMoney(fc.totalExp) + '</b></div>' +
      '<div><span>Прогноз расходов (год)</span><b style="color:var(--danger)">' + fmtMoney(fc.totalExp * 12) + '</b></div>' +
      '<div><span>Прогноз доходов (мес)</span><b style="color:var(--ok)">' + fmtMoney(fc.totalInc) + '</b></div>' +
      '<div><span>Прогноз доходов (год)</span><b style="color:var(--ok)">' + fmtMoney(fc.totalInc * 12) + '</b></div>' +
      '<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">' +
        '<span>Прогноз баланса (мес)</span>' +
        '<b style="color:var(--' + (fc.totalInc - fc.totalExp >= 0 ? 'ok' : 'danger') + ')">' + fmtMoney(fc.totalInc - fc.totalExp) + '</b>' +
      '</div>' +
      '<div><span>Прогноз баланса (год)</span>' +
        '<b style="color:var(--' + (fc.totalInc - fc.totalExp >= 0 ? 'ok' : 'danger') + ')">' + fmtMoney((fc.totalInc - fc.totalExp) * 12) + '</b>' +
      '</div>' +
    '</div>';

  el.innerHTML = html;
}

/* ---------- Категории ---------- */
function renderCategories() {
  const el = document.getElementById('catBody');
  const groups = { expense: [], income: [] };
  for (const c of state.data.categories) groups[c.type].push(c);

  let html = '';

  const renderGroup = (type, title) => {
    let s = '<div class="subhead">' + title + '</div>';
    if (groups[type].length === 0) {
      s += '<div class="empty">Пусто</div>';
    } else {
      for (const c of groups[type]) {
        if (state.editingCat === c.id) {
          s += renderCatEditForm(c);
        } else {
          s +=
            '<div class="txn">' +
              '<div class="txn-cat">' +
                '<span class="dot-color" style="background:' + c.color + '"></span>' +
                '<span>' + escapeHtml(c.name) + '</span>' +
              '</div>' +
              '<div></div>' +
              '<div class="txn-actions">' +
                '<button class="mini yellow" data-act="edit-cat" data-id="' + c.id + '">&#9998;</button>' +
                '<button class="mini red" data-act="del-cat" data-id="' + c.id + '">&#10005;</button>' +
              '</div>' +
            '</div>';
        }
      }
    }
    return s;
  };

  html += renderGroup('expense', 'Расходы');
  html += renderGroup('income', 'Доходы');

  html +=
    '<div class="subhead">Новая категория</div>' +
    '<label class="field"><span>Название</span>' +
      '<input type="text" id="newCatName" placeholder="Название" value="' + escapeAttr(state._newCatName || '') + '"></label>' +
    '<div class="type-toggle">' +
      '<button class="tt-btn ' + ((state._newCatType || 'expense') === 'expense' ? 'active exp' : '') + '" data-act="new-cat-type" data-type="expense">Расход</button>' +
      '<button class="tt-btn ' + ((state._newCatType || 'expense') === 'income'  ? 'active inc' : '') + '" data-act="new-cat-type" data-type="income">Доход</button>' +
    '</div>' +
    '<div class="colors">' +
      COLORS.map(col =>
        '<div class="color-dot ' + (state.editingCatColor === col ? 'active' : '') + '" style="background:' + col + '" data-act="pick-color" data-color="' + col + '"></div>'
      ).join('') +
    '</div>' +
    '<button class="btn primary" data-act="add-cat">Добавить категорию</button>';

  el.innerHTML = html;
}

function renderCatEditForm(c) {
  return '<div class="txn" style="display:block">' +
    '<label class="field"><span>Название</span>' +
      '<input type="text" id="editCatName" value="' + escapeAttr(c.name) + '"></label>' +
    '<div class="type-toggle">' +
      '<button class="tt-btn ' + (c.type === 'expense' ? 'active exp' : '') + '" data-act="edit-cat-type" data-id="' + c.id + '" data-type="expense">Расход</button>' +
      '<button class="tt-btn ' + (c.type === 'income'  ? 'active inc' : '') + '" data-act="edit-cat-type" data-id="' + c.id + '" data-type="income">Доход</button>' +
    '</div>' +
    '<div class="colors">' +
      COLORS.map(col =>
        '<div class="color-dot ' + (c.color === col ? 'active' : '') + '" style="background:' + col + '" data-act="edit-cat-color" data-id="' + c.id + '" data-color="' + col + '"></div>'
      ).join('') +
    '</div>' +
    '<div style="display:flex;gap:6px">' +
      '<button class="btn ok" style="flex:1" data-act="save-cat" data-id="' + c.id + '">Сохранить</button>' +
      '<button class="btn" style="flex:1" data-act="cancel-cat">Отмена</button>' +
    '</div>' +
  '</div>';
}

/* ============================================================
   ОБРАБОТЧИКИ СОБЫТИЙ
   ============================================================ */

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;

  /* Навигация по месяцам */
  if (act === 'month-prev') {
    state.currentMonth = addMonths(state.currentMonth, -1);
    try { localStorage.setItem(LS_MONTH, state.currentMonth); } catch (er) {}
    renderAll();
    return;
  }
  if (act === 'month-next') {
    state.currentMonth = addMonths(state.currentMonth, 1);
    try { localStorage.setItem(LS_MONTH, state.currentMonth); } catch (er) {}
    renderAll();
    return;
  }

  /* Сворачивание секций */
  if (act === 'toggle-sec') {
    const key = t.dataset.sec;
    state.ui.collapsed[key] = !state.ui.collapsed[key];
    saveUI();
    applyCollapsed();
    return;
  }

  /* Форма добавления */
  if (act === 'set-type') {
    state.newTxn.type = t.dataset.type;
    state.newTxn.categoryId = null;
    renderAdd();
    return;
  }
  if (act === 'pick-cat-new') {
    state.newTxn.categoryId = t.dataset.id;
    renderAdd();
    return;
  }
  if (act === 'add-txn') {
    handleAddTxn();
    return;
  }

  /* Фильтры */
  if (act === 'filter-type') {
    state.ui.filterType = t.dataset.v; saveUI(); renderTransactions(); return;
  }
  if (act === 'filter-cat') {
    state.ui.filterCat = t.dataset.v; saveUI(); renderTransactions(); return;
  }

  /* Редактирование операции */
  if (act === 'edit-txn') {
    const id = t.dataset.id;
    const txn = state.data.transactions.find(x => x.id === id);
    if (!txn) return;
    if (txn.recurring) toast('Это шаблон повторяющейся операции', 'ok');
    state.editingTxn = id;
    renderTransactions();
    return;
  }
  if (act === 'cancel-edit') {
    state.editingTxn = null;
    renderTransactions();
    return;
  }
  if (act === 'edit-type') {
    const txn = state.data.transactions.find(x => x.id === t.dataset.id);
    if (!txn) return;
    txn.type = t.dataset.type;
    const cat = state.data.categories.find(c => c.id === txn.categoryId);
    if (cat && cat.type !== txn.type) txn.categoryId = null;
    renderTransactions();
    return;
  }
  if (act === 'edit-cat') {
    const txn = state.data.transactions.find(x => x.id === t.dataset.id);
    if (!txn) return;
    txn.categoryId = t.dataset.cat;
    renderTransactions();
    return;
  }
  if (act === 'save-edit') {
    handleSaveEdit(t.dataset.id);
    return;
  }

  /* Удаление операции */
  if (act === 'del-txn') {
    handleDeleteTxn(t.dataset.id);
    return;
  }

  /* Прогноз */
  if (act === 'fc-window') {
    state.ui.forecastWindow = parseInt(t.dataset.n, 10) || 3;
    saveUI();
    renderForecast();
    return;
  }

  /* Категории */
  if (act === 'new-cat-type') {
    state._newCatType = t.dataset.type;
    renderCategories();
    return;
  }
  if (act === 'pick-color') {
    state.editingCatColor = t.dataset.color;
    renderCategories();
    return;
  }
  if (act === 'add-cat') {
    handleAddCat();
    return;
  }
  if (act === 'edit-cat') {
    state.editingCat = t.dataset.id;
    renderCategories();
    return;
  }
  if (act === 'cancel-cat') {
    state.editingCat = null;
    renderCategories();
    return;
  }
  if (act === 'edit-cat-type') {
    const c = state.data.categories.find(x => x.id === t.dataset.id);
    if (c) { c.type = t.dataset.type; renderCategories(); }
    return;
  }
  if (act === 'edit-cat-color') {
    const c = state.data.categories.find(x => x.id === t.dataset.id);
    if (c) { c.color = t.dataset.color; renderCategories(); }
    return;
  }
  if (act === 'save-cat') {
    handleSaveCat(t.dataset.id);
    return;
  }
  if (act === 'del-cat') {
    handleDeleteCat(t.dataset.id);
    return;
  }
});

/* Живой ввод */
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'ntAmount')      state.newTxn.amount = t.value;
  else if (t.id === 'ntDate')   state.newTxn.date = t.value;
  else if (t.id === 'ntComment') state.newTxn.comment = t.value;
  else if (t.id === 'filterSearch') {
    state.ui.filterSearch = t.value;
    saveUI();
    const val = t.value;
    renderTransactions();
    const inp = document.getElementById('filterSearch');
    if (inp) { inp.focus(); inp.setSelectionRange(val.length, val.length); }
  }
  else if (t.id === 'newCatName') state._newCatName = t.value;
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'ntRecurring') state.newTxn.recurring = t.checked;
});

/* ---------- Обработчики действий ---------- */
async function handleAddTxn() {
  const nt = state.newTxn;
  if (!nt.categoryId) { toast('Выбери категорию', 'err'); return; }
  const amount = num(nt.amount);
  if (!(amount > 0)) { toast('Укажи сумму больше нуля', 'err'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nt.date)) { toast('Укажи дату', 'err'); return; }

  const txn = {
    id: uid(),
    categoryId: nt.categoryId,
    type: nt.type,
    amount: amount,
    date: nt.date,
    comment: nt.comment.trim(),
    recurring: !!nt.recurring,
    createdAt: Date.now()
  };
  if (txn.recurring) txn.skipped = [];

  state.data.transactions.push(txn);
  state.newTxn.amount = '';
  state.newTxn.comment = '';
  toast('Добавлено', 'ok');
  renderAll();
  await save();
}

async function handleSaveEdit(id) {
  const txn = state.data.transactions.find(x => x.id === id);
  if (!txn) return;
  const amount = num(document.getElementById('editAmount').value);
  const date = document.getElementById('editDate').value;
  const comment = document.getElementById('editComment').value;
  const recurring = document.getElementById('editRecurring').checked;
  if (!(amount > 0)) { toast('Сумма должна быть больше нуля', 'err'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Некорректная дата', 'err'); return; }
  if (!txn.categoryId) { toast('Выбери категорию', 'err'); return; }

  txn.amount = amount;
  txn.date = date;
  txn.comment = comment.trim();
  if (recurring && !txn.recurring) { txn.recurring = true; txn.skipped = []; }
  if (!recurring && txn.recurring) { delete txn.recurring; delete txn.skipped; }

  state.editingTxn = null;
  toast('Сохранено', 'ok');
  renderAll();
  await save();
}

async function handleDeleteTxn(id) {
  const idx = state.data.transactions.findIndex(x => x.id === id);
  if (idx === -1) return;
  const txn = state.data.transactions[idx];
  const tMonth = txn.date.slice(0, 7);
  const isVirtual = txn.recurring && state.currentMonth !== tMonth;

  if (txn.recurring && isVirtual) {
    if (!confirm('Пропустить эту повторяющуюся операцию в ' + monthLabelFull(state.currentMonth) + '?')) return;
    if (!Array.isArray(txn.skipped)) txn.skipped = [];
    if (txn.skipped.indexOf(state.currentMonth) === -1) txn.skipped.push(state.currentMonth);
    toast('Пропущено в этом месяце', 'ok');
  } else if (txn.recurring) {
    if (!confirm('Удалить всю серию повторений этой операции?')) return;
    state.data.transactions.splice(idx, 1);
    toast('Серия удалена', 'ok');
  } else {
    if (!confirm('Удалить операцию?')) return;
    state.data.transactions.splice(idx, 1);
    toast('Удалено', 'ok');
  }
  state.editingTxn = null;
  renderAll();
  await save();
}

async function handleAddCat() {
  const name = (state._newCatName || '').trim();
  const type = state._newCatType || 'expense';
  const color = state.editingCatColor || COLORS[0];
  if (!name) { toast('Введи название', 'err'); return; }
  if (state.data.categories.some(c => c.name.toLowerCase() === name.toLowerCase() && c.type === type)) {
    toast('Такая категория уже есть', 'err'); return;
  }
  state.data.categories.push({ id: uid(), name: name, type: type, color: color });
  state._newCatName = '';
  state.editingCatColor = COLORS[(state.data.categories.length) % COLORS.length];
  toast('Категория добавлена', 'ok');
  renderAll();
  await save();
}

async function handleSaveCat(id) {
  const c = state.data.categories.find(x => x.id === id);
  if (!c) return;
  const name = (document.getElementById('editCatName').value || '').trim();
  if (!name) { toast('Введи название', 'err'); return; }
  c.name = name;
  state.editingCat = null;
  toast('Сохранено', 'ok');
  renderAll();
  await save();
}

async function handleDeleteCat(id) {
  const c = state.data.categories.find(x => x.id === id);
  if (!c) return;
  const used = state.data.transactions.filter(t => t.categoryId === id).length;
  const msg = used > 0
    ? 'У категории ' + used + ' операций. Удалить категорию? Операции останутся без категории.'
    : 'Удалить категорию?';
  if (!confirm(msg)) return;
  state.data.categories = state.data.categories.filter(x => x.id !== id);
  for (const t of state.data.transactions) if (t.categoryId === id) t.categoryId = null;
  toast('Удалено', 'ok');
  renderAll();
  await save();
}

/* ============================================================
   СТАРТ
   ============================================================ */
async function init() {
  try {
    const raw = localStorage.getItem(LS_DATA);
    if (raw) {
      state.data = normalizeData(JSON.parse(raw));
    } else {
      state.data = normalizeData({ categories: defaultCategories(), transactions: [], version: 1 });
    }
  } catch (e) {
    state.data = normalizeData({ categories: defaultCategories(), transactions: [], version: 1 });
  }

  renderAll();
  setSync('off', 'Ожидание Firebase…');

  if (typeof firebase !== 'undefined' && FIREBASE_CONFIG.apiKey !== 'PASTE_API_KEY') {
    await initFirebase();
  } else {
    setSync('off', 'Локальный режим (нет конфига Firebase)');
    toast('Firebase не настроен — работаем локально', 'err');
  }

  applyCollapsed();
}

document.addEventListener('DOMContentLoaded', init);
