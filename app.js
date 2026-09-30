/* ============================================================
   Дневник расходов v3 — счета, долги, постоянные расходы
   ============================================================ */

const AMP = String.fromCharCode(38);
const LS_DATA  = 'expense_diary_data_v1';
const LS_UI    = 'expense_diary_ui_v1';
const LS_MONTH = 'expense_diary_month_v1';

// >>> ЗАМЕНИ НА СВОЙ КОНФИГ ИЗ FIREBASE <<<
const FIREBASE_CONFIG = {
  piKey: "AIzaSyBf73zJJP8LxzaOVyssk2wPDPyd0P3iziA",
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

const ACCOUNT_TYPES = { cash:'Наличные', card:'Карта', bank:'Банк', other:'Другое' };
const PERIOD_LABELS = { monthly:'Ежемесячно', yearly:'Ежегодно', weekly:'Еженедельно', once:'Разово' };

/* ---------- Состояние ---------- */
const state = {
  db: null, auth: null, user: null, docRef: null,
  data: { accounts: [], categories: [], transactions: [], debts: [], recurringExpenses: [], version: 0 },
  isSaving: false,
  syncStatus: 'init',
  currentMonth: loadMonth(),
  ui: loadUI(),
  editingTxn: null,
  editingCat: null,
  editingCatColor: COLORS[0],
  editingAccount: null,
  editingDebt: null,
  editingRecurring: null,
  expandedRecurring: {},
  newTxn: {
    type: 'expense',
    categoryId: null,
    accountId: null,
    amount: '',
    date: todayISO(),
    comment: '',
    recurring: false
  },
  newAccount: { name:'', type:'cash', color: COLORS[3], initialBalance:'' },
  newDebt: { direction:'to_me', counterparty:'', amount:'', date: todayISO(), dueDate:'', comment:'' },
  newRecurring: { name:'', accountId:null, categoryId:null, amount:'', nextDate: todayISO(), period:'monthly' },
  payingRecurring: null,
  payingDebt: null,
  _newCatName: '', _newCatType: 'expense',
  _showJson: false, _showPasteJson: false, _pasteJsonValue: ''
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
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function num(v) { const n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : 0; }
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
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—';
  const [y, m, d] = iso.split('-');
  return d + ' ' + MONTHS_RU_SHORT[parseInt(m, 10) - 1] + ' ' + y;
}
function addDaysISO(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
         + '-' + String(d.getDate()).padStart(2, '0');
}
function addMonthsISO(iso, n) {
  const [y, m, day] = iso.split('-').map(Number);
  let ny = y, nm = m + n;
  while (nm > 12) { nm -= 12; ny++; }
  while (nm < 1) { nm += 12; ny--; }
  const dim = daysInMonth(ny, nm);
  return ny + '-' + String(nm).padStart(2, '0') + '-' + String(Math.min(day, dim)).padStart(2, '0');
}
function addYearsISO(iso, n) {
  const [y, m, day] = iso.split('-').map(Number);
  const ny = y + n;
  const dim = daysInMonth(ny, m);
  return ny + '-' + String(m).padStart(2, '0') + '-' + String(Math.min(day, dim)).padStart(2, '0');
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

/* ---------- Тосты и статус ---------- */
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

/* ---------- Дефолтные данные ---------- */
function defaultAccounts() {
  return [{ id: uid(), name: 'Основной', type: 'cash', color: COLORS[3], initialBalance: 0 }];
}
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

/* ---------- Нормализация ---------- */
function normalizeData(d) {
  const out = { accounts: [], categories: [], transactions: [], debts: [], recurringExpenses: [], version: 0 };
  if (!d || typeof d !== 'object') d = {};

  if (Array.isArray(d.accounts)) {
    out.accounts = d.accounts.map(a => ({
      id: a.id || uid(),
      name: String(a.name || 'Счёт'),
      type: ACCOUNT_TYPES[a.type] ? a.type : 'other',
      color: /^#[0-9a-f]{3,8}$/i.test(a.color) ? a.color : COLORS[3],
      initialBalance: num(a.initialBalance)
    }));
  }
  if (out.accounts.length === 0) out.accounts = defaultAccounts();
  const defaultAccId = out.accounts[0].id;

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
        accountId: t.accountId || defaultAccId,
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

  if (Array.isArray(d.debts)) {
    out.debts = d.debts.map(x => ({
      id: x.id || uid(),
      direction: x.direction === 'from_me' ? 'from_me' : 'to_me',
      counterparty: String(x.counterparty || ''),
      amount: num(x.amount),
      paid: num(x.paid),
      date: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : todayISO(),
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(x.dueDate) ? x.dueDate : '',
      comment: String(x.comment || ''),
      closed: !!x.closed,
      payments: Array.isArray(x.payments) ? x.payments.map(p => ({
        date: /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : todayISO(),
        amount: num(p.amount),
        comment: String(p.comment || '')
      })) : []
    }));
  }

  if (Array.isArray(d.recurringExpenses)) {
    out.recurringExpenses = d.recurringExpenses.map(r => ({
      id: r.id || uid(),
      name: String(r.name || 'Платёж'),
      accountId: r.accountId || defaultAccId,
      categoryId: r.categoryId || null,
      amount: num(r.amount),
      nextDate: /^\d{4}-\d{2}-\d{2}$/.test(r.nextDate) ? r.nextDate : todayISO(),
      period: PERIOD_LABELS[r.period] ? r.period : 'monthly',
      history: Array.isArray(r.history) ? r.history.map(h => ({
        plannedAmount: num(h.plannedAmount),
        paidAmount: num(h.paidAmount),
        paidDate: /^\d{4}-\d{2}-\d{2}$/.test(h.paidDate) ? h.paidDate : todayISO(),
        comment: String(h.comment || '')
      })) : []
    }));
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

/* ---------- Хелперы счетов ---------- */
function getAccount(id) { return state.data.accounts.find(a => a.id === id) || null; }
function accountBalance(accId) {
  const acc = getAccount(accId);
  if (!acc) return 0;
  let bal = num(acc.initialBalance);
  for (const t of state.data.transactions) {
    if (t.accountId !== accId) continue;
    if (t.type === 'income') bal += num(t.amount);
    else bal -= num(t.amount);
  }
  return bal;
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

/* ---------- Firebase ---------- */
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
          state.data = normalizeData({
            accounts: defaultAccounts(),
            categories: defaultCategories(),
            transactions: [], debts: [], recurringExpenses: [], version: 1
          });
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
  renderRecurring();
  renderDebts();
  renderAccounts();
  renderForecast();
  renderCategories();
  renderBackup();
  renderDanger();
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
    months.push({ ym, inc, exp });
  }
  const maxBar = Math.max(1, months.reduce((m, x) => Math.max(m, x.inc, x.exp), 0));

  const accRows = state.data.accounts.map(a => ({ acc: a, balance: accountBalance(a.id) }));
  const totalBalance = accRows.reduce((s, r) => s + r.balance, 0);

  el.innerHTML =
    '<div class="cards">' +
      '<div class="card stat"><div class="stat-label">Доходы</div><div class="stat-val ok">' + fmtMoney(income) + '</div></div>' +
      '<div class="card stat"><div class="stat-label">Расходы</div><div class="stat-val danger">' + fmtMoney(expense) + '</div></div>' +
      '<div class="card stat"><div class="stat-label">Баланс мес.</div><div class="stat-val ' + (balance >= 0 ? 'ok' : 'danger') + '">' + fmtMoney(balance) + '</div></div>' +
    '</div>' +
    '<div class="card" style="margin-bottom:10px"><div class="stat-label">Общий баланс по счетам</div><div class="stat-val" style="font-size:18px">' + fmtMoney(totalBalance) + '</div></div>' +
    (accRows.length
      ? accRows.map(r =>
          '<div class="cat-row"><div class="cat-row-head">' +
            '<span class="dot-color" style="background:' + r.acc.color + '"></span>' +
            '<span class="cat-name">' + escapeHtml(r.acc.name) + '</span>' +
            '<span class="cat-sum" style="color:var(--' + (r.balance >= 0 ? 'ok' : 'danger') + ')">' + fmtMoney(r.balance) + '</span>' +
          '</div></div>'
        ).join('')
      : '') +
    '<div class="subhead">Расходы по категориям</div>' +
    (catRows.length === 0
      ? '<div class="empty">Нет расходов в этом месяце</div>'
      : catRows.map(r =>
          '<div class="cat-row"><div class="cat-row-head">' +
            '<span class="dot-color" style="background:' + r.cat.color + '"></span>' +
            '<span class="cat-name">' + escapeHtml(r.cat.name) + '</span>' +
            '<span class="cat-sum">' + fmtMoney(r.sum) + '</span>' +
          '</div>' +
          '<div class="bar"><div class="bar-fill" style="width:' + (r.sum / maxExp * 100).toFixed(1) + '%;background:' + r.cat.color + '"></div></div></div>'
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
  const accounts = state.data.accounts;

  if (!nt.accountId && accounts.length) nt.accountId = accounts[0].id;
  if (!nt.categoryId && cats.length) nt.categoryId = cats[0].id;

  el.innerHTML =
    '<div class="type-toggle">' +
      '<button class="tt-btn ' + (nt.type === 'expense' ? 'active exp' : '') + '" data-act="set-type" data-type="expense">Расход</button>' +
      '<button class="tt-btn ' + (nt.type === 'income'  ? 'active inc' : '') + '" data-act="set-type" data-type="income">Доход</button>' +
    '</div>' +
    '<div class="subhead" style="margin-top:0">Счёт</div>' +
    '<div class="cat-grid">' +
      (accounts.length
        ? accounts.map(a =>
            '<button class="cat-btn ' + (nt.accountId === a.id ? 'active' : '') + '" data-act="pick-acc-new" data-id="' + a.id + '" style="--c:' + a.color + '">' +
              '<span class="dot-color" style="background:' + a.color + '"></span><span>' + escapeHtml(a.name) + '</span>' +
            '</button>'
          ).join('')
        : '<div class="empty">Нет счетов. Добавь в разделе «Счета».</div>') +
    '</div>' +
    '<div class="subhead" style="margin-top:0">Категория</div>' +
    '<div class="cat-grid">' +
      (cats.length
        ? cats.map(c =>
            '<button class="cat-btn ' + (nt.categoryId === c.id ? 'active' : '') + '" data-act="pick-cat-new" data-id="' + c.id + '" style="--c:' + c.color + '">' +
              '<span class="dot-color" style="background:' + c.color + '"></span><span>' + escapeHtml(c.name) + '</span>' +
            '</button>'
          ).join('')
        : '<div class="empty">Нет категорий. Добавь в разделе «Категории».</div>') +
    '</div>' +
    '<label class="field"><span>Сумма</span><input type="number" inputmode="decimal" step="0.01" min="0" id="ntAmount" value="' + escapeAttr(nt.amount) + '" placeholder="0"></label>' +
    '<label class="field"><span>Дата</span><input type="date" id="ntDate" value="' + escapeAttr(nt.date) + '"></label>' +
    '<label class="field"><span>Комментарий</span><input type="text" id="ntComment" value="' + escapeAttr(nt.comment) + '" placeholder="необязательно"></label>' +
    '<label class="check"><input type="checkbox" id="ntRecurring" ' + (nt.recurring ? 'checked' : '') + '><span>Повторять ежемесячно</span></label>' +
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
      html += '<div class="day-group"><div class="day-head">' + dateLabel(d) + '</div>';
      for (const t of groups[d]) {
        const cat = state.data.categories.find(c => c.id === t.categoryId);
        const catName = cat ? cat.name : '—';
        const catColor = cat ? cat.color : '#999';
        const acc = getAccount(t.accountId);
        const accName = acc ? acc.name : '—';
        const accColor = acc ? acc.color : '#999';
        if (state.editingTxn === t.id) {
          html += renderTxnEditForm(t);
        } else {
          html +=
            '<div class="txn ' + (t.isVirtual ? 'virtual' : '') + '">' +
              '<div class="txn-cat">' +
                '<span class="dot-color" style="background:' + catColor + '"></span>' +
                '<span class="ellip">' + escapeHtml(catName) + '</span>' +
                (t.recurring ? '<span class="badge">&#128257;</span>' : '') +
                (t.isVirtual ? '<span class="badge">(повтор)</span>' : '') +
              '</div>' +
              '<div class="txn-amt ' + t.type + '">' + (t.type === 'expense' ? '−' : '+') + fmtMoney(t.amount) + '</div>' +
              '<div class="txn-cmt">Счёт: <span class="dot-color" style="background:' + accColor + ';margin-right:4px"></span>' + escapeHtml(accName) + (t.comment ? ' · ' + escapeHtml(t.comment) : '') + '</div>' +
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

function renderTxnEditForm(t) {
  const cats = state.data.categories.filter(c => c.type === t.type);
  const accounts = state.data.accounts;
  return '<div class="txn" style="display:block">' +
    '<div class="type-toggle">' +
      '<button class="tt-btn ' + (t.type === 'expense' ? 'active exp' : '') + '" data-act="edit-type" data-type="expense" data-id="' + t.id + '">Расход</button>' +
      '<button class="tt-btn ' + (t.type === 'income'  ? 'active inc' : '') + '" data-act="edit-type" data-type="income"  data-id="' + t.id + '">Доход</button>' +
    '</div>' +
    '<div class="subhead" style="margin-top:0">Счёт</div>' +
    '<div class="cat-grid">' +
      accounts.map(a =>
        '<button class="cat-btn ' + (t.accountId === a.id ? 'active' : '') + '" data-act="edit-txn-acc" data-id="' + t.id + '" data-acc="' + a.id + '" style="--c:' + a.color + '">' +
          '<span class="dot-color" style="background:' + a.color + '"></span><span>' + escapeHtml(a.name) + '</span>' +
        '</button>'
      ).join('') +
    '</div>' +
    '<div class="subhead" style="margin-top:0">Категория</div>' +
    '<div class="cat-grid">' +
      cats.map(c =>
        '<button class="cat-btn ' + (t.categoryId === c.id ? 'active' : '') + '" data-act="edit-txn-cat" data-id="' + t.id + '" data-cat="' + c.id + '" style="--c:' + c.color + '">' +
          '<span class="dot-color" style="background:' + c.color + '"></span><span>' + escapeHtml(c.name) + '</span>' +
        '</button>'
      ).join('') +
    '</div>' +
    '<label class="field"><span>Сумма</span><input type="number" inputmode="decimal" step="0.01" min="0" id="editAmount" value="' + escapeAttr(t.amount) + '"></label>' +
    '<label class="field"><span>Дата</span><input type="date" id="editDate" value="' + escapeAttr(t.date) + '"></label>' +
    '<label class="field"><span>Комментарий</span><input type="text" id="editComment" value="' + escapeAttr(t.comment) + '"></label>' +
    '<label class="check"><input type="checkbox" id="editRecurring" ' + (t.recurring ? 'checked' : '') + '><span>Повторять ежемесячно</span></label>' +
    '<div style="display:flex;gap:6px">' +
      '<button class="btn ok" style="flex:1" data-act="save-edit" data-id="' + t.id + '">Сохранить</button>' +
      '<button class="btn" style="flex:1" data-act="cancel-edit">Отмена</button>' +
    '</div>' +
  '</div>';
}

/* ---------- Постоянные расходы ---------- */
function renderRecurring() {
  const el = document.getElementById('recurringBody');
  const items = state.data.recurringExpenses;
  const accounts = state.data.accounts;
  const cats = state.data.categories.filter(c => c.type === 'expense');
  const nr = state.newRecurring;

  if (!nr.accountId && accounts.length) nr.accountId = accounts[0].id;

  let html = '';

  if (items.length === 0) {
    html += '<div class="empty">Нет постоянных расходов</div>';
  } else {
    for (const r of items) {
      if (state.editingRecurring === r.id) {
        html += renderRecurringEditForm(r, accounts, cats);
        continue;
      }
      const acc = getAccount(r.accountId);
      const cat = r.categoryId ? state.data.categories.find(c => c.id === r.categoryId) : null;
      const expanded = !!state.expandedRecurring[r.id];
      const isToday = r.nextDate <= todayISO();
      const periodLabel = PERIOD_LABELS[r.period] || 'Ежемесячно';

      html +=
        '<div class="txn">' +
          '<div class="txn-cat">' +
            '<span class="ellip" style="font-weight:600">' + escapeHtml(r.name) + '</span>' +
            (isToday ? '<span class="badge warn">Срок наступил</span>' : '') +
          '</div>' +
          '<div class="txn-amt expense">' + fmtMoney(r.amount) + '</div>' +
          '<div class="txn-cmt">Счёт: <span class="dot-color" style="background:' + (acc ? acc.color : '#999') + ';margin-right:4px"></span>' + escapeHtml(acc ? acc.name : '—') +
            (cat ? ' · ' + escapeHtml(cat.name) : '') +
            ' · ' + periodLabel +
            ' · след. платёж: ' + dateLabel(r.nextDate) +
          '</div>' +
          '<div class="txn-actions">' +
            '<button class="mini ok" data-act="pay-recurring" data-id="' + r.id + '" title="Оплатить">&#10003;</button>' +
            '<button class="mini" data-act="toggle-rec-hist" data-id="' + r.id + '" title="История">&#9201;</button>' +
            '<button class="mini yellow" data-act="edit-recurring" data-id="' + r.id + '" title="Редактировать">&#9998;</button>' +
            '<button class="mini red" data-act="del-recurring" data-id="' + r.id + '" title="Удалить">&#10005;</button>' +
          '</div>' +
          (state.payingRecurring === r.id ? renderRecurringPayForm(r) : '') +
          (expanded && r.history.length
            ? '<div style="grid-column:1/-1;margin-top:6px">' +
                '<div class="subhead" style="margin:6px 0 4px">История платежей</div>' +
                r.history.slice().reverse().map(h =>
                  '<div class="history-row"><span>' + dateLabel(h.paidDate) + '</span><span>План: ' + fmtMoney(h.plannedAmount) + ' · Внесено: <b>' + fmtMoney(h.paidAmount) + '</b></span></div>'
                ).join('') +
              '</div>'
            : '') +
        '</div>';
    }
  }

  html +=
    '<div class="subhead">Новый постоянный расход</div>' +
    '<label class="field"><span>Название</span><input type="text" id="nrName" value="' + escapeAttr(nr.name) + '" placeholder="Например, Интернет"></label>' +
    '<div class="subhead" style="margin-top:0">Счёт списания</div>' +
    '<div class="cat-grid">' +
      (accounts.length
        ? accounts.map(a =>
            '<button class="cat-btn ' + (nr.accountId === a.id ? 'active' : '') + '" data-act="nr-pick-acc" data-id="' + a.id + '" style="--c:' + a.color + '">' +
              '<span class="dot-color" style="background:' + a.color + '"></span><span>' + escapeHtml(a.name) + '</span>' +
            '</button>'
          ).join('')
        : '<div class="empty">Сначала создай счёт</div>') +
    '</div>' +
    '<div class="subhead" style="margin-top:0">Категория (опционально)</div>' +
    '<div class="cat-grid">' +
      '<button class="cat-btn ' + (!nr.categoryId ? 'active-simple' : '') + '" data-act="nr-pick-cat" data-id=""><span>Без категории</span></button>' +
      cats.map(c =>
        '<button class="cat-btn ' + (nr.categoryId === c.id ? 'active' : '') + '" data-act="nr-pick-cat" data-id="' + c.id + '" style="--c:' + c.color + '">' +
          '<span class="dot-color" style="background:' + c.color + '"></span><span>' + escapeHtml(c.name) + '</span>' +
        '</button>'
      ).join('') +
    '</div>' +
    '<label class="field"><span>Сумма (плановая)</span><input type="number" inputmode="decimal" step="0.01" min="0" id="nrAmount" value="' + escapeAttr(nr.amount) + '" placeholder="0"></label>' +
    '<label class="field"><span>Дата первого/следующего платежа</span><input type="date" id="nrNextDate" value="' + escapeAttr(nr.nextDate) + '"></label>' +
    '<div class="subhead" style="margin-top:0">Периодичность</div>' +
    '<div class="filters">' +
      ['monthly','yearly','weekly','once'].map(p =>
        '<button class="chip ' + (nr.period === p ? 'active' : '') + '" data-act="nr-period" data-p="' + p + '">' + PERIOD_LABELS[p] + '</button>'
      ).join('') +
    '</div>' +
    '<button class="btn primary" data-act="add-recurring">Добавить постоянный расход</button>';

  el.innerHTML = html;
}

function renderRecurringEditForm(r, accounts, cats) {
  return '<div class="txn" style="display:block">' +
    '<label class="field"><span>Название</span><input type="text" id="erName" value="' + escapeAttr(r.name) + '"></label>' +
    '<div class="subhead" style="margin-top:0">Счёт списания</div>' +
    '<div class="cat-grid">' +
      accounts.map(a =>
        '<button class="cat-btn ' + (r.accountId === a.id ? 'active' : '') + '" data-act="er-pick-acc" data-id="' + r.id + '" data-acc="' + a.id + '" style="--c:' + a.color + '">' +
          '<span class="dot-color" style="background:' + a.color + '"></span><span>' + escapeHtml(a.name) + '</span>' +
        '</button>'
      ).join('') +
    '</div>' +
    '<div class="subhead" style="margin-top:0">Категория</div>' +
    '<div class="cat-grid">' +
      '<button class="cat-btn ' + (!r.categoryId ? 'active-simple' : '') + '" data-act="er-pick-cat" data-id="' + r.id + '" data-cat=""><span>Без категории</span></button>' +
      cats.map(c =>
        '<button class="cat-btn ' + (r.categoryId === c.id ? 'active' : '') + '" data-act="er-pick-cat" data-id="' + r.id + '" data-cat="' + c.id + '" style="--c:' + c.color + '">' +
          '<span class="dot-color" style="background:' + c.color + '"></span><span>' + escapeHtml(c.name) + '</span>' +
        '</button>'
      ).join('') +
    '</div>' +
    '<label class="field"><span>Сумма (плановая)</span><input type="number" inputmode="decimal" step="0.01" min="0" id="erAmount" value="' + escapeAttr(r.amount) + '"></label>' +
    '<label class="field"><span>Дата следующего платежа</span><input type="date" id="erNextDate" value="' + escapeAttr(r.nextDate) + '"></label>' +
    '<div class="subhead" style="margin-top:0">Периодичность</div>' +
    '<div class="filters">' +
      ['monthly','yearly','weekly','once'].map(p =>
        '<button class="chip ' + (r.period === p ? 'active' : '') + '" data-act="er-period" data-id="' + r.id + '" data-p="' + p + '">' + PERIOD_LABELS[p] + '</button>'
      ).join('') +
    '</div>' +
    '<div style="display:flex;gap:6px">' +
      '<button class="btn ok" style="flex:1" data-act="save-recurring" data-id="' + r.id + '">Сохранить</button>' +
      '<button class="btn" style="flex:1" data-act="cancel-recurring">Отмена</button>' +
    '</div>' +
  '</div>';
}

function renderRecurringPayForm(r) {
  const acc = getAccount(r.accountId);
  return '<div style="grid-column:1/-1;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-top:8px">' +
    '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">Оплата: ' + escapeHtml(r.name) + ' · план ' + fmtMoney(r.amount) + '</div>' +
    '<label class="field"><span>Фактически внесено</span><input type="number" inputmode="decimal" step="0.01" min="0" id="payRecAmount" value="' + escapeAttr(r.amount) + '"></label>' +
    '<label class="field"><span>Дата оплаты</span><input type="date" id="payRecDate" value="' + todayISO() + '"></label>' +
    '<label class="check"><input type="checkbox" id="payRecAddTxn" checked><span>Добавить операцию в расходы' + (acc ? ' (' + escapeHtml(acc.name) + ')' : '') + '</span></label>' +
    '<div style="display:flex;gap:6px">' +
      '<button class="btn ok" style="flex:1" data-act="confirm-pay-recurring" data-id="' + r.id + '">Подтвердить оплату</button>' +
      '<button class="btn" style="flex:1" data-act="cancel-pay-recurring">Отмена</button>' +
    '</div>' +
  '</div>';
}

/* ---------- Долги ---------- */
function renderDebts() {
  const el = document.getElementById('debtsBody');
  const debts = state.data.debts;
  const nd = state.newDebt;

  const renderList = (direction, title) => {
    const list = debts.filter(d => d.direction === direction);
    let s = '<div class="subhead">' + title + '</div>';
    if (list.length === 0) { s += '<div class="empty">Пусто</div>'; return s; }
    for (const d of list) {
      if (state.editingDebt === d.id) { s += renderDebtEditForm(d); continue; }
      const remain = d.amount - d.paid;
      const pct = d.amount > 0 ? Math.min(100, d.paid / d.amount * 100) : 0;
      const closed = d.closed || remain <= 0;
      s +=
        '<div class="txn">' +
          '<div class="txn-cat">' +
            '<span class="ellip" style="font-weight:600">' + escapeHtml(d.counterparty || 'Без имени') + '</span>' +
            (closed ? '<span class="badge ok">Закрыт</span>' : '<span class="badge warn">Открыт</span>') +
          '</div>' +
          '<div class="txn-amt ' + (direction === 'to_me' ? 'income' : 'expense') + '">' + fmtMoney(remain) + '</div>' +
          '<div class="txn-cmt">Всего: ' + fmtMoney(d.amount) + ' · оплачено: ' + fmtMoney(d.paid) + ' · с ' + dateLabel(d.date) +
            (d.dueDate ? ' · срок ' + dateLabel(d.dueDate) : '') +
            (d.comment ? '<br>' + escapeHtml(d.comment) : '') +
          '</div>' +
          '<div class="progress"><div class="progress-fill" style="width:' + pct.toFixed(1) + '%;background:var(--' + (direction === 'to_me' ? 'ok' : 'danger') + ')"></div></div>' +
          '<div class="txn-actions">' +
            (closed ? '' : '<button class="mini ok" data-act="pay-debt" data-id="' + d.id + '" title="Внести платёж">&#10003;</button>') +
            '<button class="mini yellow" data-act="edit-debt" data-id="' + d.id + '" title="Редактировать">&#9998;</button>' +
            '<button class="mini red" data-act="del-debt" data-id="' + d.id + '" title="Удалить">&#10005;</button>' +
          '</div>' +
          (state.payingDebt === d.id ? renderDebtPayForm(d) : '') +
          (d.payments.length
            ? '<div style="grid-column:1/-1;margin-top:6px">' +
                '<div class="subhead" style="margin:6px 0 4px">История платежей</div>' +
                d.payments.slice().reverse().map(p =>
                  '<div class="history-row"><span>' + dateLabel(p.date) + '</span><span>' + fmtMoney(p.amount) + '</span></div>'
                ).join('') +
              '</div>'
            : '') +
        '</div>';
    }
    return s;
  };

  let html = '';
  html += renderList('to_me', 'Мне должны');
  html += renderList('from_me', 'Я должен');

  html +=
    '<div class="subhead">Новый долг</div>' +
    '<div class="type-toggle">' +
      '<button class="tt-btn ' + (nd.direction === 'to_me' ? 'active inc' : '') + '" data-act="nd-dir" data-dir="to_me">Мне должны</button>' +
      '<button class="tt-btn ' + (nd.direction === 'from_me' ? 'active exp' : '') + '" data-act="nd-dir" data-dir="from_me">Я должен</button>' +
    '</div>' +
    '<label class="field"><span>' + (nd.direction === 'to_me' ? 'Кто должен' : 'Кому должен') + '</span><input type="text" id="ndCounterparty" value="' + escapeAttr(nd.counterparty) + '" placeholder="Имя или описание"></label>' +
    '<label class="field"><span>Сумма</span><input type="number" inputmode="decimal" step="0.01" min="0" id="ndAmount" value="' + escapeAttr(nd.amount) + '" placeholder="0"></label>' +
    '<label class="field"><span>Дата возникновения</span><input type="date" id="ndDate" value="' + escapeAttr(nd.date) + '"></label>' +
    '<label class="field"><span>Срок возврата (опционально)</span><input type="date" id="ndDueDate" value="' + escapeAttr(nd.dueDate) + '"></label>' +
    '<label class="field"><span>Комментарий</span><input type="text" id="ndComment" value="' + escapeAttr(nd.comment) + '" placeholder="необязательно"></label>' +
    '<button class="btn primary" data-act="add-debt">Добавить долг</button>';

  el.innerHTML = html;
}

function renderDebtEditForm(d) {
  return '<div class="txn" style="display:block">' +
    '<label class="field"><span>Контрагент</span><input type="text" id="edCounterparty" value="' + escapeAttr(d.counterparty) + '"></label>' +
    '<label class="field"><span>Сумма (общая)</span><input type="number" inputmode="decimal" step="0.01" min="0" id="edAmount" value="' + escapeAttr(d.amount) + '"></label>' +
    '<label class="field"><span>Уже оплачено</span><input type="number" inputmode="decimal" step="0.01" min="0" id="edPaid" value="' + escapeAttr(d.paid) + '"></label>' +
    '<label class="field"><span>Дата</span><input type="date" id="edDate" value="' + escapeAttr(d.date) + '"></label>' +
    '<label class="field"><span>Срок (опционально)</span><input type="date" id="edDueDate" value="' + escapeAttr(d.dueDate) + '"></label>' +
    '<label class="field"><span>Комментарий</span><input type="text" id="edComment" value="' + escapeAttr(d.comment) + '"></label>' +
    '<div style="display:flex;gap:6px">' +
      '<button class="btn ok" style="flex:1" data-act="save-debt" data-id="' + d.id + '">Сохранить</button>' +
      '<button class="btn" style="flex:1" data-act="cancel-debt">Отмена</button>' +
    '</div>' +
  '</div>';
}

function renderDebtPayForm(d) {
  const remain = d.amount - d.paid;
  return '<div style="grid-column:1/-1;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-top:8px">' +
    '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">Остаток по долгу: ' + fmtMoney(remain) + '</div>' +
    '<label class="field"><span>Сумма платежа</span><input type="number" inputmode="decimal" step="0.01" min="0" id="payDebtAmount" value="' + escapeAttr(remain) + '"></label>' +
    '<label class="field"><span>Дата платежа</span><input type="date" id="payDebtDate" value="' + todayISO() + '"></label>' +
    '<div style="display:flex;gap:6px">' +
      '<button class="btn ok" style="flex:1" data-act="confirm-pay-debt" data-id="' + d.id + '">Подтвердить</button>' +
      '<button class="btn" style="flex:1" data-act="cancel-pay-debt">Отмена</button>' +
    '</div>' +
  '</div>';
}

/* ---------- Счета ---------- */
function renderAccounts() {
  const el = document.getElementById('accountsBody');
  const accounts = state.data.accounts;
  const na = state.newAccount;

  let html = '';

  if (accounts.length === 0) {
    html += '<div class="empty">Нет счетов</div>';
  } else {
    for (const a of accounts) {
      if (state.editingAccount === a.id) { html += renderAccountEditForm(a); continue; }
      const bal = accountBalance(a.id);
      html +=
        '<div class="txn">' +
          '<div class="txn-cat">' +
            '<span class="dot-color" style="background:' + a.color + '"></span>' +
            '<span class="ellip" style="font-weight:600">' + escapeHtml(a.name) + '</span>' +
            '<span class="badge">' + (ACCOUNT_TYPES[a.type] || 'Другое') + '</span>' +
          '</div>' +
          '<div class="txn-amt" style="color:var(--' + (bal >= 0 ? 'ok' : 'danger') + ')">' + fmtMoney(bal) + '</div>' +
          '<div class="txn-cmt">Начальный баланс: ' + fmtMoney(a.initialBalance) + '</div>' +
          '<div class="txn-actions">' +
            '<button class="mini yellow" data-act="edit-account" data-id="' + a.id + '" title="Редактировать">&#9998;</button>' +
            '<button class="mini red" data-act="del-account" data-id="' + a.id + '" title="Удалить">&#10005;</button>' +
          '</div>' +
        '</div>';
    }
  }

  html +=
    '<div class="subhead">Новый счёт</div>' +
    '<label class="field"><span>Название</span><input type="text" id="naName" value="' + escapeAttr(na.name) + '" placeholder="Например, Карта Сбер"></label>' +
    '<div class="subhead" style="margin-top:0">Тип</div>' +
    '<div class="filters">' +
      Object.keys(ACCOUNT_TYPES).map(t =>
        '<button class="chip ' + (na.type === t ? 'active' : '') + '" data-act="na-type" data-t="' + t + '">' + ACCOUNT_TYPES[t] + '</button>'
      ).join('') +
    '</div>' +
    '<label class="field"><span>Начальный баланс</span><input type="number" inputmode="decimal" step="0.01" id="naInitial" value="' + escapeAttr(na.initialBalance) + '" placeholder="0"></label>' +
    '<div class="subhead" style="margin-top:0">Цвет</div>' +
    '<div class="colors">' +
      COLORS.map(col =>
        '<div class="color-dot ' + (na.color === col ? 'active' : '') + '" style="background:' + col + '" data-act="na-color" data-color="' + col + '"></div>'
      ).join('') +
    '</div>' +
    '<button class="btn primary" data-act="add-account">Добавить счёт</button>';

  el.innerHTML = html;
}

function renderAccountEditForm(a) {
  return '<div class="txn" style="display:block">' +
    '<label class="field"><span>Название</span><input type="text" id="eaName" value="' + escapeAttr(a.name) + '"></label>' +
    '<div class="subhead" style="margin-top:0">Тип</div>' +
    '<div class="filters">' +
      Object.keys(ACCOUNT_TYPES).map(t =>
        '<button class="chip ' + (a.type === t ? 'active' : '') + '" data-act="ea-type" data-id="' + a.id + '" data-t="' + t + '">' + ACCOUNT_TYPES[t] + '</button>'
      ).join('') +
    '</div>' +
    '<label class="field"><span>Начальный баланс</span><input type="number" inputmode="decimal" step="0.01" id="eaInitial" value="' + escapeAttr(a.initialBalance) + '"></label>' +
    '<div class="subhead" style="margin-top:0">Цвет</div>' +
    '<div class="colors">' +
      COLORS.map(col =>
        '<div class="color-dot ' + (a.color === col ? 'active' : '') + '" style="background:' + col + '" data-act="ea-color" data-id="' + a.id + '" data-color="' + col + '"></div>'
      ).join('') +
    '</div>' +
    '<div style="display:flex;gap:6px">' +
      '<button class="btn ok" style="flex:1" data-act="save-account" data-id="' + a.id + '">Сохранить</button>' +
      '<button class="btn" style="flex:1" data-act="cancel-account">Отмена</button>' +
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
    rows.push({ cat: c, avgExp, avgInc });
    totalExp += avgExp;
    totalInc += avgInc;
  }
  rows.sort((a, b) => (b.avgExp + b.avgInc) - (a.avgExp + a.avgInc));

  let recurringMonthly = 0;
  for (const r of state.data.recurringExpenses) {
    if (r.period === 'monthly') recurringMonthly += r.amount;
    else if (r.period === 'yearly') recurringMonthly += r.amount / 12;
    else if (r.period === 'weekly') recurringMonthly += r.amount * 4.345;
  }

  return { months, rows, totalExp, totalInc, recurringMonthly };
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
      html +=
        '<div class="fc-row">' +
          '<div class="fc-name"><span class="dot-color" style="background:' + r.cat.color + '"></span><span>' + escapeHtml(r.cat.name) + '</span></div>' +
          '<div class="fc-vals">' +
            '<div class="main" style="color:var(--' + (isExp ? 'danger' : 'ok') + ')">' + (isExp ? '−' : '+') + fmtMoney(perMonth) + ' / мес</div>' +
            '<div class="sub">' + (isExp ? '−' : '+') + fmtMoney(perMonth * 12) + ' / год</div>' +
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
      '<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><span>Прогноз баланса (мес)</span><b style="color:var(--' + (fc.totalInc - fc.totalExp >= 0 ? 'ok' : 'danger') + ')">' + fmtMoney(fc.totalInc - fc.totalExp) + '</b></div>' +
      '<div><span>Прогноз баланса (год)</span><b style="color:var(--' + (fc.totalInc - fc.totalExp >= 0 ? 'ok' : 'danger') + ')">' + fmtMoney((fc.totalInc - fc.totalExp) * 12) + '</b></div>' +
      (fc.recurringMonthly > 0
        ? '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)"><span>Обязательные платежи / мес</span><b style="color:var(--warn)">' + fmtMoney(fc.recurringMonthly) + '</b></div>' +
          '<div><span>Обязательные платежи / год</span><b style="color:var(--warn)">' + fmtMoney(fc.recurringMonthly * 12) + '</b></div>'
        : '') +
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
    if (groups[type].length === 0) s += '<div class="empty">Пусто</div>';
    else {
      for (const c of groups[type]) {
        if (state.editingCat === c.id) s += renderCatEditForm(c);
        else {
          s +=
            '<div class="txn">' +
              '<div class="txn-cat"><span class="dot-color" style="background:' + c.color + '"></span><span class="ellip">' + escapeHtml(c.name) + '</span></div>' +
              '<div></div>' +
              '<div class="txn-actions">' +
                '<button class="mini yellow" data-act="edit-category" data-id="' + c.id + '">&#9998;</button>' +
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
    '<label class="field"><span>Название</span><input type="text" id="newCatName" placeholder="Название" value="' + escapeAttr(state._newCatName || '') + '"></label>' +
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
    '<label class="field"><span>Название</span><input type="text" id="editCatName" value="' + escapeAttr(c.name) + '"></label>' +
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

/* ---------- Резервная копия ---------- */
function renderBackup() {
  const el = document.getElementById('backupBody');
  let html =
    '<div class="hint">Сохраните все данные (счета, категории, операции, долги, постоянные расходы) в один файл. Позже сможете загрузить его обратно — это полностью заменит текущие данные.</div>' +
    '<button class="btn block ok" data-act="export-backup">💾 Сохранить в файл</button>' +
    '<button class="btn block primary" data-act="import-backup">📂 Загрузить из файла</button>' +
    '<div class="hint" style="margin-top:12px">Резервный способ (если файлы не работают)</div>' +
    '<button class="btn block" data-act="toggle-show-json">' + (state._showJson ? '▲ Скрыть JSON' : '⬜ Показать JSON для копирования') + '</button>';

  if (state._showJson) {
    const json = JSON.stringify(state.data, null, 2);
    html += '<textarea class="json-area" id="jsonBox" readonly>' + escapeHtml(json) + '</textarea>' +
      '<div style="display:flex;gap:6px"><button class="btn ok" style="flex:1" data-act="copy-json">Скопировать</button><button class="btn" style="flex:1" data-act="toggle-show-json">Закрыть</button></div>';
  }

  html += '<button class="btn block" data-act="toggle-show-paste" style="margin-top:8px">' +
    (state._showPasteJson ? '▲ Скрыть поле вставки' : '⬇ Вставить JSON для загрузки') + '</button>';

  if (state._showPasteJson) {
    html += '<textarea class="json-area" id="pasteBox" placeholder="Вставь сюда JSON…">' + escapeHtml(state._pasteJsonValue || '') + '</textarea>' +
      '<div style="display:flex;gap:6px"><button class="btn primary" style="flex:1" data-act="apply-paste-json">Загрузить</button><button class="btn" style="flex:1" data-act="toggle-show-paste">Отмена</button></div>';
  }

  el.innerHTML = html;
}

/* ---------- Опасная зона ---------- */
function renderDanger() {
  const el = document.getElementById('dangerBody');
  el.innerHTML =
    '<div class="hint">Удаление необратимо: все счета, категории, операции, долги и постоянные расходы будут стёрты, восстановить их можно только из заранее сохранённой резервной копии.</div>' +
    '<button class="btn block danger" data-act="clear-all">Очистить все данные</button>';
}

/* ============================================================
   ОБРАБОТЧИКИ
   ============================================================ */

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;

  /* Месяц */
  if (act === 'month-prev') { state.currentMonth = addMonths(state.currentMonth, -1); try { localStorage.setItem(LS_MONTH, state.currentMonth); } catch (er) {} renderAll(); return; }
  if (act === 'month-next') { state.currentMonth = addMonths(state.currentMonth, 1); try { localStorage.setItem(LS_MONTH, state.currentMonth); } catch (er) {} renderAll(); return; }

  /* Сворачивание */
  if (act === 'toggle-sec') {
    const key = t.dataset.sec;
    state.ui.collapsed[key] = !state.ui.collapsed[key];
    saveUI(); applyCollapsed(); return;
  }

  /* Форма добавления */
  if (act === 'set-type') { state.newTxn.type = t.dataset.type; state.newTxn.categoryId = null; renderAdd(); return; }
  if (act === 'pick-cat-new') { state.newTxn.categoryId = t.dataset.id; renderAdd(); return; }
  if (act === 'pick-acc-new') { state.newTxn.accountId = t.dataset.id; renderAdd(); return; }
  if (act === 'add-txn') { handleAddTxn(); return; }

  /* Фильтры */
  if (act === 'filter-type') { state.ui.filterType = t.dataset.v; saveUI(); renderTransactions(); return; }
  if (act === 'filter-cat') { state.ui.filterCat = t.dataset.v; saveUI(); renderTransactions(); return; }

  /* Редактирование операции */
  if (act === 'edit-txn') { state.editingTxn = t.dataset.id; renderTransactions(); return; }
  if (act === 'cancel-edit') { state.editingTxn = null; renderTransactions(); return; }
  if (act === 'edit-type') {
    const txn = state.data.transactions.find(x => x.id === t.dataset.id);
    if (!txn) return;
    txn.type = t.dataset.type;
    const cat = state.data.categories.find(c => c.id === txn.categoryId);
    if (cat && cat.type !== txn.type) txn.categoryId = null;
    renderTransactions(); return;
  }
  if (act === 'edit-txn-cat') {
    const txn = state.data.transactions.find(x => x.id === t.dataset.id);
    if (!txn) return;
    txn.categoryId = t.dataset.cat; renderTransactions(); return;
  }
  if (act === 'edit-txn-acc') {
    const txn = state.data.transactions.find(x => x.id === t.dataset.id);
    if (!txn) return;
    txn.accountId = t.dataset.acc; renderTransactions(); return;
  }
  if (act === 'save-edit') { handleSaveEdit(t.dataset.id); return; }
  if (act === 'del-txn') { handleDeleteTxn(t.dataset.id); return; }

  /* Прогноз */
  if (act === 'fc-window') { state.ui.forecastWindow = parseInt(t.dataset.n, 10) || 3; saveUI(); renderForecast(); return; }

  /* Постоянные расходы */
  if (act === 'nr-pick-acc') { state.newRecurring.accountId = t.dataset.id; renderRecurring(); return; }
  if (act === 'nr-pick-cat') { state.newRecurring.categoryId = t.dataset.id || null; renderRecurring(); return; }
  if (act === 'nr-period')   { state.newRecurring.period = t.dataset.p; renderRecurring(); return; }
  if (act === 'add-recurring') { handleAddRecurring(); return; }
  if (act === 'toggle-rec-hist') { const id = t.dataset.id; state.expandedRecurring[id] = !state.expandedRecurring[id]; renderRecurring(); return; }
  if (act === 'pay-recurring') { state.payingRecurring = (state.payingRecurring === t.dataset.id) ? null : t.dataset.id; renderRecurring(); return; }
  if (act === 'cancel-pay-recurring') { state.payingRecurring = null; renderRecurring(); return; }
  if (act === 'confirm-pay-recurring') { handlePayRecurring(t.dataset.id); return; }
  if (act === 'edit-recurring')   { state.editingRecurring = t.dataset.id; renderRecurring(); return; }
  if (act === 'cancel-recurring') { state.editingRecurring = null; renderRecurring(); return; }
  if (act === 'er-pick-acc') { const r = state.data.recurringExpenses.find(x => x.id === t.dataset.id); if (r) { r.accountId = t.dataset.acc; renderRecurring(); } return; }
  if (act === 'er-pick-cat') { const r = state.data.recurringExpenses.find(x => x.id === t.dataset.id); if (r) { r.categoryId = t.dataset.cat || null; renderRecurring(); } return; }
  if (act === 'er-period')   { const r = state.data.recurringExpenses.find(x => x.id === t.dataset.id); if (r) { r.period = t.dataset.p; renderRecurring(); } return; }
  if (act === 'save-recurring')   { handleSaveRecurring(t.dataset.id); return; }
  if (act === 'del-recurring')    { handleDeleteRecurring(t.dataset.id); return; }

  /* Долги */
  if (act === 'nd-dir') { state.newDebt.direction = t.dataset.dir; renderDebts(); return; }
  if (act === 'add-debt') { handleAddDebt(); return; }
  if (act === 'edit-debt')   { state.editingDebt = t.dataset.id; renderDebts(); return; }
  if (act === 'cancel-debt') { state.editingDebt = null; renderDebts(); return; }
  if (act === 'save-debt')   { handleSaveDebt(t.dataset.id); return; }
  if (act === 'del-debt')    { handleDeleteDebt(t.dataset.id); return; }
  if (act === 'pay-debt')    { state.payingDebt = (state.payingDebt === t.dataset.id) ? null : t.dataset.id; renderDebts(); return; }
  if (act === 'cancel-pay-debt') { state.payingDebt = null; renderDebts(); return; }
  if (act === 'confirm-pay-debt') { handlePayDebt(t.dataset.id); return; }

  /* Счета */
  if (act === 'na-type') { state.newAccount.type = t.dataset.t; renderAccounts(); return; }
  if (act === 'na-color') { state.newAccount.color = t.dataset.color; renderAccounts(); return; }
  if (act === 'add-account') { handleAddAccount(); return; }
  if (act === 'edit-account')   { state.editingAccount = t.dataset.id; renderAccounts(); return; }
  if (act === 'cancel-account') { state.editingAccount = null; renderAccounts(); return; }
  if (act === 'ea-type') { const a = state.data.accounts.find(x => x.id === t.dataset.id); if (a) { a.type = t.dataset.t; renderAccounts(); } return; }
  if (act === 'ea-color') { const a = state.data.accounts.find(x => x.id === t.dataset.id); if (a) { a.color = t.dataset.color; renderAccounts(); } return; }
  if (act === 'save-account')   { handleSaveAccount(t.dataset.id); return; }
  if (act === 'del-account')    { handleDeleteAccount(t.dataset.id); return; }

  /* Категории */
  if (act === 'new-cat-type') { state._newCatType = t.dataset.type; renderCategories(); return; }
  if (act === 'pick-color')   { state.editingCatColor = t.dataset.color; renderCategories(); return; }
  if (act === 'add-cat')      { handleAddCat(); return; }
  if (act === 'edit-category') { state.editingCat = t.dataset.id; renderCategories(); return; }
  if (act === 'cancel-cat')   { state.editingCat = null; renderCategories(); return; }
  if (act === 'edit-cat-type') { const c = state.data.categories.find(x => x.id === t.dataset.id); if (c) { c.type = t.dataset.type; renderCategories(); } return; }
  if (act === 'edit-cat-color') { const c = state.data.categories.find(x => x.id === t.dataset.id); if (c) { c.color = t.dataset.color; renderCategories(); } return; }
  if (act === 'save-cat') { handleSaveCat(t.dataset.id); return; }
  if (act === 'del-cat')  { handleDeleteCat(t.dataset.id); return; }

  /* Резервная копия */
  if (act === 'export-backup')     { exportBackup(); return; }
  if (act === 'import-backup')     { triggerImport(); return; }
  if (act === 'toggle-show-json')  { state._showJson = !state._showJson; renderBackup(); return; }
  if (act === 'toggle-show-paste') { state._showPasteJson = !state._showPasteJson; if (!state._showPasteJson) state._pasteJsonValue = ''; renderBackup(); return; }
  if (act === 'copy-json')         { copyJsonToClipboard(); return; }
  if (act === 'apply-paste-json')  { applyPasteJson(); return; }

  /* Опасная зона */
  if (act === 'clear-all') { handleClearAll(); return; }
});

/* Живой ввод */
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'ntAmount')       state.newTxn.amount = t.value;
  else if (t.id === 'ntDate')    state.newTxn.date = t.value;
  else if (t.id === 'ntComment') state.newTxn.comment = t.value;
  else if (t.id === 'newCatName') state._newCatName = t.value;
  else if (t.id === 'pasteBox')  state._pasteJsonValue = t.value;
  else if (t.id === 'naName')    state.newAccount.name = t.value;
  else if (t.id === 'naInitial') state.newAccount.initialBalance = t.value;
  else if (t.id === 'nrName')    state.newRecurring.name = t.value;
  else if (t.id === 'nrAmount')  state.newRecurring.amount = t.value;
  else if (t.id === 'nrNextDate') state.newRecurring.nextDate = t.value;
  else if (t.id === 'ndCounterparty') state.newDebt.counterparty = t.value;
  else if (t.id === 'ndAmount')  state.newDebt.amount = t.value;
  else if (t.id === 'ndDate')    state.newDebt.date = t.value;
  else if (t.id === 'ndDueDate') state.newDebt.dueDate = t.value;
  else if (t.id === 'ndComment') state.newDebt.comment = t.value;
  else if (t.id === 'filterSearch') {
    state.ui.filterSearch = t.value; saveUI();
    const val = t.value;
    renderTransactions();
    const inp = document.getElementById('filterSearch');
    if (inp) { inp.focus(); inp.setSelectionRange(val.length, val.length); }
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'ntRecurring') state.newTxn.recurring = e.target.checked;
});

/* ============================================================
   ДЕЙСТВИЯ
   ============================================================ */

async function handleAddTxn() {
  const nt = state.newTxn;
  if (!nt.accountId) { toast('Выбери счёт', 'err'); return; }
  if (!nt.categoryId) { toast('Выбери категорию', 'err'); return; }
  const amount = num(nt.amount);
  if (!(amount > 0)) { toast('Укажи сумму больше нуля', 'err'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nt.date)) { toast('Укажи дату', 'err'); return; }

  const txn = {
    id: uid(), categoryId: nt.categoryId, accountId: nt.accountId,
    type: nt.type, amount, date: nt.date, comment: nt.comment.trim(),
    recurring: !!nt.recurring, createdAt: Date.now()
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
  if (!(amount > 0)) { toast('Сумма > 0', 'err'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Некорректная дата', 'err'); return; }
  if (!txn.categoryId) { toast('Выбери категорию', 'err'); return; }
  if (!txn.accountId) { toast('Выбери счёт', 'err'); return; }

  txn.amount = amount; txn.date = date; txn.comment = comment.trim();
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
    if (!confirm('Удалить всю серию повторений?')) return;
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

async function handleAddAccount() {
  const na = state.newAccount;
  if (!na.name.trim()) { toast('Введи название', 'err'); return; }
  state.data.accounts.push({
    id: uid(), name: na.name.trim(),
    type: na.type || 'other', color: na.color || COLORS[3],
    initialBalance: num(na.initialBalance)
  });
  state.newAccount = { name:'', type:'cash', color: COLORS[3], initialBalance:'' };
  toast('Счёт добавлен', 'ok');
  renderAll();
  await save();
}

async function handleSaveAccount(id) {
  const a = state.data.accounts.find(x => x.id === id);
  if (!a) return;
  const name = (document.getElementById('eaName').value || '').trim();
  if (!name) { toast('Введи название', 'err'); return; }
  a.name = name;
  a.initialBalance = num(document.getElementById('eaInitial').value);
  state.editingAccount = null;
  toast('Сохранено', 'ok');
  renderAll();
  await save();
}

async function handleDeleteAccount(id) {
  const a = state.data.accounts.find(x => x.id === id);
  if (!a) return;
  const used = state.data.transactions.filter(t => t.accountId === id).length
             + state.data.recurringExpenses.filter(r => r.accountId === id).length;
  const msg = used > 0
    ? 'К счёту привязано ' + used + ' операций/платежей. Удалить счёт? Привязки будут сброшены.'
    : 'Удалить счёт?';
  if (!confirm(msg)) return;
  state.data.accounts = state.data.accounts.filter(x => x.id !== id);
  for (const t of state.data.transactions) if (t.accountId === id) t.accountId = null;
  for (const r of state.data.recurringExpenses) if (r.accountId === id) r.accountId = null;
  toast('Удалено', 'ok');
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
  state.data.categories.push({ id: uid(), name, type, color });
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

async function handleAddRecurring() {
  const nr = state.newRecurring;
  if (!nr.name.trim()) { toast('Введи название', 'err'); return; }
  if (!nr.accountId) { toast('Выбери счёт', 'err'); return; }
  const amount = num(nr.amount);
  if (!(amount > 0)) { toast('Укажи сумму больше нуля', 'err'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nr.nextDate)) { toast('Укажи дату', 'err'); return; }

  state.data.recurringExpenses.push({
    id: uid(), name: nr.name.trim(),
    accountId: nr.accountId, categoryId: nr.categoryId || null,
    amount, nextDate: nr.nextDate, period: nr.period || 'monthly', history: []
  });
  state.newRecurring = { name:'', accountId: nr.accountId, categoryId: null, amount:'', nextDate: todayISO(), period: nr.period };
  toast('Постоянный расход добавлен', 'ok');
  renderAll();
  await save();
}

async function handleSaveRecurring(id) {
  const r = state.data.recurringExpenses.find(x => x.id === id);
  if (!r) return;
  const name = (document.getElementById('erName').value || '').trim();
  const amount = num(document.getElementById('erAmount').value);
  const nextDate = document.getElementById('erNextDate').value;
  if (!name) { toast('Введи название', 'err'); return; }
  if (!(amount > 0)) { toast('Сумма > 0', 'err'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) { toast('Некорректная дата', 'err'); return; }
  r.name = name; r.amount = amount; r.nextDate = nextDate;
  state.editingRecurring = null;
  toast('Сохранено', 'ok');
  renderAll();
  await save();
}

async function handleDeleteRecurring(id) {
  const r = state.data.recurringExpenses.find(x => x.id === id);
  if (!r) return;
  if (!confirm('Удалить постоянный расход «' + r.name + '»? История платежей тоже удалится.')) return;
  state.data.recurringExpenses = state.data.recurringExpenses.filter(x => x.id !== id);
  toast('Удалено', 'ok');
  renderAll();
  await save();
}

async function handlePayRecurring(id) {
  const r = state.data.recurringExpenses.find(x => x.id === id);
  if (!r) return;
  const paidAmount = num(document.getElementById('payRecAmount').value);
  const paidDate = document.getElementById('payRecDate').value;
  const addTxn = document.getElementById('payRecAddTxn').checked;
  if (!(paidAmount > 0)) { toast('Сумма > 0', 'err'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) { toast('Некорректная дата', 'err'); return; }

  r.history.push({ plannedAmount: r.amount, paidAmount, paidDate, comment: '' });

  if (addTxn) {
    let categoryId = r.categoryId;
    if (!categoryId) {
      let cat = state.data.categories.find(c => c.name.toLowerCase() === 'обязательные' && c.type === 'expense');
      if (!cat) {
        cat = { id: uid(), name: 'Обязательные', type: 'expense', color: COLORS[6] };
        state.data.categories.push(cat);
      }
      categoryId = cat.id;
    }
    state.data.transactions.push({
      id: uid(), categoryId, accountId: r.accountId, type: 'expense',
      amount: paidAmount, date: paidDate, comment: r.name,
      recurring: false, createdAt: Date.now()
    });
  }

  if (r.period === 'monthly')      r.nextDate = addMonthsISO(r.nextDate, 1);
  else if (r.period === 'yearly')  r.nextDate = addYearsISO(r.nextDate, 1);
  else if (r.period === 'weekly')  r.nextDate = addDaysISO(r.nextDate, 7);

  state.payingRecurring = null;
  toast('Оплата записана', 'ok');
  renderAll();
  await save();
}

async function handleAddDebt() {
  const nd = state.newDebt;
  if (!nd.counterparty.trim()) { toast('Укажи контрагента', 'err'); return; }
  const amount = num(nd.amount);
  if (!(amount > 0)) { toast('Сумма > 0', 'err'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nd.date)) { toast('Некорректная дата', 'err'); return; }

  state.data.debts.push({
    id: uid(), direction: nd.direction,
    counterparty: nd.counterparty.trim(),
    amount, paid: 0, date: nd.date,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(nd.dueDate) ? nd.dueDate : '',
    comment: nd.comment.trim(), closed: false, payments: []
  });
  state.newDebt = { direction: nd.direction, counterparty:'', amount:'', date: todayISO(), dueDate:'', comment:'' };
  toast('Долг добавлен', 'ok');
  renderAll();
  await save();
}

async function handleSaveDebt(id) {
  const d = state.data.debts.find(x => x.id === id);
  if (!d) return;
  const counterparty = (document.getElementById('edCounterparty').value || '').trim();
  const amount = num(document.getElementById('edAmount').value);
  const paid = num(document.getElementById('edPaid').value);
  const date = document.getElementById('edDate').value;
  const dueDate = document.getElementById('edDueDate').value;
  const comment = document.getElementById('edComment').value;
  if (!counterparty) { toast('Укажи контрагента', 'err'); return; }
  if (!(amount > 0)) { toast('Сумма > 0', 'err'); return; }
  d.counterparty = counterparty;
  d.amount = amount; d.paid = paid; d.date = date;
  d.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : '';
  d.comment = comment.trim();
  d.closed = d.paid >= d.amount;
  state.editingDebt = null;
  toast('Сохранено', 'ok');
  renderAll();
  await save();
}

async function handleDeleteDebt(id) {
  const d = state.data.debts.find(x => x.id === id);
  if (!d) return;
  if (!confirm('Удалить долг «' + (d.counterparty || 'без имени') + '»?')) return;
  state.data.debts = state.data.debts.filter(x => x.id !== id);
  toast('Удалено', 'ok');
  renderAll();
  await save();
}

async function handlePayDebt(id) {
  const d = state.data.debts.find(x => x.id === id);
  if (!d) return;
  const amount = num(document.getElementById('payDebtAmount').value);
  const date = document.getElementById('payDebtDate').value;
  if (!(amount > 0)) { toast('Сумма > 0', 'err'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Некорректная дата', 'err'); return; }
  d.paid += amount;
  d.payments.push({ date, amount, comment: '' });
  if (d.paid >= d.amount) d.closed = true;
  state.payingDebt = null;
  toast('Платёж записан', 'ok');
  renderAll();
  await save();
}

function exportBackup() {
  const json = JSON.stringify(state.data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const a = document.createElement('a');
  a.href = url; a.download = 'expense-diary-' + stamp + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Файл сохранён', 'ok');
}

function triggerImport() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json'; input.style.display = 'none';
  input.onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try { const parsed = JSON.parse(ev.target.result); applyImport(parsed); }
      catch (err) { console.error('JSON parse error', err); toast('Неверный формат JSON', 'err'); }
    };
    reader.readAsText(file);
  };
  document.body.appendChild(input); input.click();
  setTimeout(() => document.body.removeChild(input), 1000);
}

async function applyImport(parsed) {
  if (!parsed || typeof parsed !== 'object') { toast('Неверный формат данных', 'err'); return; }
  if (!confirm('Заменить все текущие данные загруженными из файла?\nЭто действие перезапишет данные во всех устройствах.')) return;

  const norm = normalizeData(parsed);
  norm.version = Math.max(state.data.version || 0, num(norm.version)) + 1;
  state.data = norm;

  state.editingTxn = null; state.editingCat = null; state.editingAccount = null;
  state.editingDebt = null; state.editingRecurring = null;
  state.payingRecurring = null; state.payingDebt = null;
  state._showJson = false; state._showPasteJson = false; state._pasteJsonValue = '';

  toast('Данные загружены', 'ok');
  renderAll();
  await save();
}

async function copyJsonToClipboard() {
  const ta = document.getElementById('jsonBox');
  if (!ta) return;
  const text = ta.value;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      toast('JSON скопирован', 'ok');
    } else {
      ta.select(); document.execCommand('copy'); toast('JSON скопирован', 'ok');
    }
  } catch (e) {
    ta.select();
    try { document.execCommand('copy'); toast('JSON скопирован', 'ok'); }
    catch (err) { toast('Не удалось скопировать. Выдели вручную.', 'err'); }
  }
}

async function applyPasteJson() {
  const raw = (state._pasteJsonValue || '').trim();
  if (!raw) { toast('Поле пустое', 'err'); return; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { toast('Неверный JSON', 'err'); return; }
  await applyImport(parsed);
}

async function handleClearAll() {
  if (!confirm('Очистить ВСЕ данные?\nСчета, категории, операции, долги и постоянные расходы будут стёрты.')) return;
  if (!confirm('Точно? Это действие необратимо и синхронизируется на все устройства.')) return;

  state.data = normalizeData({
    accounts: defaultAccounts(),
    categories: defaultCategories(),
    transactions: [], debts: [], recurringExpenses: [], version: 0
  });
  state.editingTxn = null; state.editingCat = null; state.editingAccount = null;
  state.editingDebt = null; state.editingRecurring = null;
  state.payingRecurring = null; state.payingDebt = null;
  state._showJson = false; state._showPasteJson = false; state._pasteJsonValue = '';

  toast('Все данные очищены', 'ok');
  renderAll();
  await save();
}

/* ============================================================
   СТАРТ
   ============================================================ */
async function init() {
  try {
    const raw = localStorage.getItem(LS_DATA);
    if (raw) state.data = normalizeData(JSON.parse(raw));
    else state.data = normalizeData({
      accounts: defaultAccounts(),
      categories: defaultCategories(),
      transactions: [], debts: [], recurringExpenses: [], version: 1
    });
  } catch (e) {
    state.data = normalizeData({
      accounts: defaultAccounts(),
      categories: defaultCategories(),
      transactions: [], debts: [], recurringExpenses: [], version: 1
    });
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
