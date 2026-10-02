/* ============================================================
   Дневник расходов v6
   + счета, долги, постоянные расходы, частичные платежи, soft-delete
   + переводы между счетами (не влияют на общий баланс)
   + фикс верстки карточек постоянных расходов
   ============================================================ */

const AMP = String.fromCharCode(38);
const LS_DATA  = 'expense_diary_data_v1';
const LS_UI    = 'expense_diary_ui_v1';
const LS_MONTH = 'expense_diary_month_v1';

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

const ACCOUNT_TYPES = { cash:'Наличные', card:'Карта', bank:'Банк', other:'Другое' };
const PERIOD_LABELS = { monthly:'Ежемесячно', yearly:'Ежегодно', weekly:'Еженедельно', once:'Разово' };
const TXN_TYPES = { expense:'Расход', income:'Доход', transfer:'Перевод' };

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
  showDeletedCats: false,
  showDeletedRecurring: false,
  newTxn: {
    type: 'expense',
    categoryId: null,
    accountId: null,
    toAccountId: null,
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
  return [{ id: uid(), name: 'Основной', type: 'cash', color: COLORS[3], initialBalance: 0, deleted: false }];
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
  return defs.map(d => ({ id: uid(), name: d.name, type: d.type, color: d.color, deleted: false }));
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
      initialBalance: num(a.initialBalance),
      deleted: !!a.deleted
    }));
  }
  if (out.accounts.length === 0) out.accounts = defaultAccounts();
  const defaultAccId = out.accounts[0].id;

  if (Array.isArray(d.categories)) {
    out.categories = d.categories.map(c => ({
      id: c.id || uid(),
      name: String(c.name || 'Без названия'),
      type: c.type === 'income' ? 'income' : 'expense',
      color: /^#[0-9a-f]{3,8}$/i.test(c.color) ? c.color : COLORS[0],
      deleted: !!c.deleted
    }));
  }

  if (Array.isArray(d.transactions)) {
    out.transactions = d.transactions.map(t => {
      const tType = (t.type === 'income' || t.type === 'transfer') ? t.type : 'expense';
      const base = {
        id: t.id || uid(),
        categoryId: t.categoryId || null,
        accountId: t.accountId || defaultAccId,
        type: tType,
        amount: num(t.amount),
        date: /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : todayISO(),
        comment: String(t.comment || ''),
        recurring: !!t.recurring,
        createdAt: t.createdAt || Date.now()
      };
      if (tType === 'transfer') {
        base.toAccountId = t.toAccountId || null;
        base.recurring = false;
        delete base.skipped;
      } else if (base.recurring) {
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
    out.recurringExpenses = d.recurringExpenses.map(r => {
      const amount = num(r.amount);
      const item = {
        id: r.id || uid(),
        name: String(r.name || 'Платёж'),
        accountId: r.accountId || defaultAccId,
        categoryId: r.categoryId || null,
        amount: amount,
        remaining: (r.remaining !== undefined && r.remaining !== null) ? num(r.remaining) : amount,
        nextDate: /^\d{4}-\d{2}-\d{2}$/.test(r.nextDate) ? r.nextDate : todayISO(),
        period: PERIOD_LABELS[r.period] ? r.period : 'monthly',
        deleted: !!r.deleted,
        history: Array.isArray(r.history) ? r.history.map(h => ({
          plannedAmount: num(h.plannedAmount),
          paidAmount: num(h.paidAmount),
          paidDate: /^\d{4}-\d{2}-\d{2}$/.test(h.paidDate) ? h.paidDate : todayISO(),
          comment: String(h.comment || ''),
          isPartial: !!h.isPartial,
          remainingAfter: (h.remainingAfter !== undefined && h.remainingAfter !== null) ? num(h.remainingAfter) : null
        })) : []
      };
      if (!(item.remaining > 0)) item.remaining = amount;
      return item;
    });
  }

  out.version = num(d.version);
  return out;
}

/* ---------- Хелперы ---------- */
function findCategory(id) {
  if (!id) return null;
  return state.data.categories.find(c => c.id === id) || null;
}
function activeCategories(type) {
  return state.data.categories.filter(c => !c.deleted && (!type || c.type === type));
}
function deletedCategories() {
  return state.data.categories.filter(c => c.deleted);
}

function getAccount(id) { return state.data.accounts.find(a => a.id === id) || null; }
function activeAccounts() { return state.data.accounts.filter(a => !a.deleted); }

function accountBalance(accId) {
  const acc = getAccount(accId);
  if (!acc) return 0;
  let bal = num(acc.initialBalance);
  for (const t of state.data.transactions) {
    if (t.type === 'transfer') {
      if (t.accountId === accId) bal -= num(t.amount);
      if (t.toAccountId === accId) bal += num(t.amount);
    } else if (t.accountId === accId) {
      if (t.type === 'income') bal += num(t.amount);
      else bal -= num(t.amount);
    }
  }
  return bal;
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
  const transfersCount = txns.filter(t => t.type === 'transfer').length;

  const byCat = {};
  for (const t of txns) {
    if (t.type !== 'expense') continue;
    const key = t.categoryId || '__none__';
    byCat[key] = (byCat[key] || 0) + num(t.amount);
  }
  const catRows = Object.keys(byCat).map(id => {
    const cat = id === '__none__' ? null : findCategory(id);
    return { cat: cat, sum: byCat[id] };
  }).sort((a, b) => b.sum - a.sum);
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

  const accRows = activeAccounts().map(a => ({ acc: a, balance: accountBalance(a.id) }));
  const totalBalance = accRows.reduce((s, r) => s + r.balance, 0);

  el.innerHTML =
    '<div class="cards">' +
      '<div class="card stat"><div class="stat-label">Доходы</div><div class="stat-val ok">' + fmtMoney(income) + '</div></div>' +
      '<div class="card stat"><div class="stat-label">Расходы</div><div class="stat-val danger">' + fmtMoney(expense) + '</div></div>' +
      '<div class="card stat"><div class="stat-label">Баланс мес.</div><div class="stat-val ' + (balance >= 0 ? 'ok' : 'danger') + '">' + fmtMoney(balance) + '</div></div>' +
    '</div>' +
    (transfersCount > 0 ? '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">Переводов между счетами в этом месяце: ' + transfersCount + '</div>' : '') +
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
      : catRows.map(r => {
          const name = r.cat ? r.cat.name : 'Без категории';
          const color = r.cat ? r.cat.color : '#999';
          const isDel = r.cat && r.cat.deleted;
          return '<div class="cat-row"><div class="cat-row-head">' +
            '<span class="dot-color" style="background:' + color + '"></span>' +
            '<span class="cat-name">' + escapeHtml(name) + (isDel ? ' <span class="badge">удалена</span>' : '') + '</span>' +
            '<span class="cat-sum">' + fmtMoney(r.sum) + '</span>' +
          '</div>' +
          '<div class="bar"><div class="bar-fill" style="width:' + (r.sum / maxExp * 100).toFixed(1) + '%;background:' + color + '"></div></div></div>';
        }).join('')) +
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
  const accounts = activeAccounts();
  const cats = activeCategories(nt.type === 'transfer' ? null : nt.type);

  if (!nt.accountId && accounts.length) nt.accountId = accounts[0].id;
  if (nt.type === 'transfer' && !nt.toAccountId && accounts.length > 1) {
    nt.toAccountId = accounts.find(a => a.id !== nt.accountId).id;
  }

  const currentCat = nt.categoryId ? findCategory(nt.categoryId) : null;
  if (nt.type !== 'transfer' && currentCat && (currentCat.deleted || currentCat.type !== nt.type)) {
    nt.categoryId = cats.length ? cats[0].id : null;
  }
  if (nt.type !== 'transfer' && !nt.categoryId && cats.length) nt.categoryId = cats[0].id;

  let typeButtons =
    '<button class="tt-btn ' + (nt.type === 'expense' ? 'active exp' : '') + '" data-act="set-type" data-type="expense">Расход</button>' +
    '<button class="tt-btn ' + (nt.type === 'income'  ? 'active inc' : '') + '" data-act="set-type" data-type="income">Доход</button>' +
    '<button class="tt-btn ' + (nt.type === 'transfer' ? 'active neutral' : '') + '" data-act="set-type" data-type="transfer">Перевод</button>';

  let bodyHtml = '';

  if (nt.type === 'transfer') {
    bodyHtml +=
      '<div class="subhead" style="margin-top:0">Откуда</div>' +
      '<div class="cat-grid">' +
        (accounts.length
          ? accounts.map(a =>
              '<button class="cat-btn ' + (nt.accountId === a.id ? 'active' : '') + '" data-act="pick-acc-new" data-id="' + a.id + '" style="--c:' + a.color + '">' +
                '<span class="dot-color" style="background:' + a.color + '"></span><span>' + escapeHtml(a.name) + '</span>' +
              '</button>'
            ).join('')
          : '<div class="empty">Нужно минимум два счёта</div>') +
      '</div>' +
      '<div class="subhead" style="margin-top:0">Куда</div>' +
      '<div class="cat-grid">' +
        (accounts.length > 1
          ? accounts.filter(a => a.id !== nt.accountId).map(a =>
              '<button class="cat-btn ' + (nt.toAccountId === a.id ? 'active' : '') + '" data-act="pick-to-acc-new" data-id="' + a.id + '" style="--c:' + a.color + '">' +
                '<span class="dot-color" style="background:' + a.color + '"></span><span>' + escapeHtml(a.name) + '</span>' +
              '</button>'
            ).join('')
          : '<div class="empty">Нужно минимум два счёта. Добавь в разделе «Счета».</div>') +
      '</div>';
  } else {
    bodyHtml +=
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
          : '<div class="empty">Нет активных категорий. Добавь в разделе «Категории».</div>') +
      '</div>';
  }

  bodyHtml +=
    '<label class="field"><span>Сумма</span><input type="number" inputmode="decimal" step="0.01" min="0" id="ntAmount" value="' + escapeAttr(nt.amount) + '" placeholder="0"></label>' +
    '<label class="field"><span>Дата</span><input type="date" id="ntDate" value="' + escapeAttr(nt.date) + '"></label>' +
    '<label class="field"><span>Комментарий</span><input type="text" id="ntComment" value="' + escapeAttr(nt.comment) + '" placeholder="необязательно"></label>';

  if (nt.type !== 'transfer') {
    bodyHtml +=
      '<label class="check"><input type="checkbox" id="ntRecurring" ' + (nt.recurring ? 'checked' : '') + '><span>Повторять ежемесячно</span></label>';
  }

  bodyHtml += '<button class="btn primary" data-act="add-txn">' +
    (nt.type === 'transfer' ? 'Перевести' : 'Добавить') + '</button>';

  el.innerHTML = '<div class="type-toggle">' + typeButtons + '</div>' + bodyHtml;
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

  const filterCats = activeCategories();

  let html = '<div class="filters">' +
    '<button class="chip ' + (f.filterType === 'all' ? 'active' : '') + '" data-act="filter-type" data-v="all">Все</button>' +
    '<button class="chip ' + (f.filterType === 'expense' ? 'active' : '') + '" data-act="filter-type" data-v="expense">Расходы</button>' +
    '<button class="chip ' + (f.filterType === 'income' ? 'active' : '') + '" data-act="filter-type" data-v="income">Доходы</button>' +
    '<button class="chip ' + (f.filterType === 'transfer' ? 'active' : '') + '" data-act="filter-type" data-v="transfer">Переводы</button>' +
  '</div>' +
  '<div class="filters">' +
    '<button class="chip ' + (f.filterCat === 'all' ? 'active' : '') + '" data-act="filter-cat" data-v="all">Все категории</button>' +
    filterCats.map(c =>
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
        if (state.editingTxn === t.id) {
          html += renderTxnEditForm(t);
        } else {
          html += renderTxnCard(t);
        }
      }
      html += '</div>';
    }
  }
  el.innerHTML = html;
}

function renderTxnCard(t) {
  const isTransfer = t.type === 'transfer';

  let titleHtml = '';
  let amountHtml = '';
  let commentHtml = '';

  if (isTransfer) {
    const fromAcc = getAccount(t.accountId);
    const toAcc = getAccount(t.toAccountId);
    const fromName = fromAcc ? fromAcc.name : '—';
    const toName = toAcc ? toAcc.name : '—';
    const fromColor = fromAcc ? fromAcc.color : '#999';
    const toColor = toAcc ? toAcc.color : '#999';
    titleHtml =
      '<span class="dot-color" style="background:' + fromColor + '"></span>' +
      '<span class="ellip">' + escapeHtml(fromName) + '</span>' +
      '<span style="opacity:.6">→</span>' +
      '<span class="dot-color" style="background:' + toColor + '"></span>' +
      '<span class="ellip">' + escapeHtml(toName) + '</span>';
    amountHtml = '<div class="txn-amt" style="color:var(--accent)">' + fmtMoney(t.amount) + '</div>';
    commentHtml = '<div class="txn-cmt">Перевод' + (t.comment ? ' · ' + escapeHtml(t.comment) : '') + '</div>';
  } else {
    const cat = findCategory(t.categoryId);
    const catName = cat ? cat.name : 'Без категории';
    const catColor = cat ? cat.color : '#999';
    const catDeleted = cat && cat.deleted;
    const acc = getAccount(t.accountId);
    const accName = acc ? acc.name : '—';
    const accColor = acc ? acc.color : '#999';
    titleHtml =
      '<span class="dot-color" style="background:' + catColor + '"></span>' +
      '<span class="ellip">' + escapeHtml(catName) + '</span>' +
      (catDeleted ? '<span class="badge">категория удалена</span>' : '') +
      (t.recurring ? '<span class="badge">&#128257;</span>' : '') +
      (t.isVirtual ? '<span class="badge">(повтор)</span>' : '');
    amountHtml = '<div class="txn-amt ' + t.type + '">' + (t.type === 'expense' ? '−' : '+') + fmtMoney(t.amount) + '</div>';
    commentHtml = '<div class="txn-cmt">Счёт: <span class="dot-color" style="background:' + accColor + ';margin-right:4px"></span>' + escapeHtml(accName) + (t.comment ? ' · ' + escapeHtml(t.comment) : '') + '</div>';
  }

  return '<div class="txn ' + (t.isVirtual ? 'virtual' : '') + '">' +
    '<div class="txn-cat">' + titleHtml + '</div>' +
    amountHtml +
    commentHtml +
    '<div class="txn-actions">' +
      '<button class="mini yellow" data-act="edit-txn" data-id="' + t.id + '" title="Редактировать">&#9998;</button>' +
      '<button class="mini red" data-act="del-txn" data-id="' + t.id + '" title="Удалить">&#10005;</button>' +
    '</div>' +
  '</div>';
}

function renderTxnEditForm(t) {
  const isTransfer = t.type === 'transfer';
  const accounts = activeAccounts();
  const cats = activeCategories(isTransfer ? null : t.type);
  const currentCat = findCategory(t.categoryId);
  const currentDeleted = currentCat && currentCat.deleted;

  let typeButtons =
    '<button class="tt-btn ' + (t.type === 'expense' ? 'active exp' : '') + '" data-act="edit-type" data-type="expense" data-id="' + t.id + '">Расход</button>' +
    '<button class="tt-btn ' + (t.type === 'income'  ? 'active inc' : '') + '" data-act="edit-type" data-type="income"  data-id="' + t.id + '">Доход</button>' +
    '<button class="tt-btn ' + (t.type === 'transfer' ? 'active neutral' : '') + '" data-act="edit-type" data-type="transfer" data-id="' + t.id + '">Перевод</button>';

  let body = '<div class="type-toggle">' + typeButtons + '</div>';

  if (isTransfer) {
    body +=
      '<div class="subhead" style="margin-top:0">Откуда</div>' +
      '<div class="cat-grid">' +
        accounts.map(a =>
          '<button class="cat-btn ' + (t.accountId === a.id ? 'active' : '') + '" data-act="edit-txn-acc" data-id="' + t.id + '" data-acc="' + a.id + '" style="--c:' + a.color + '">' +
            '<span class="dot-color" style="background:' + a.color + '"></span><span>' + escapeHtml(a.name) + '</span>' +
          '</button>'
        ).join('') +
      '</div>' +
      '<div class="subhead" style="margin-top:0">Куда</div>' +
      '<div class="cat-grid">' +
        accounts.filter(a => a.id !== t.accountId).map(a =>
          '<button class="cat-btn ' + (t.toAccountId === a.id ? 'active' : '') + '" data-act="edit-txn-toacc" data-id="' + t.id + '" data-acc="' + a.id + '" style="--c:' + a.color + '">' +
            '<span class="dot-color" style="background:' + a.color + '"></span><span>' + escapeHtml(a.name) + '</span>' +
          '</button>'
        ).join('') +
      '</div>';
  } else {
    body +=
      '<div class="subhead" style="margin-top:0">Счёт</div>' +
      '<div class="cat-grid">' +
        accounts.map(a =>
          '<button class="cat-btn ' + (t.accountId === a.id ? 'active' : '') + '" data-act="edit-txn-acc" data-id="' + t.id + '" data-acc="' + a.id + '" style="--c:' + a.color + '">' +
            '<span class="dot-color" style="background:' + a.color + '"></span><span>' + escapeHtml(a.name) + '</span>' +
          '</button>'
        ).join('') +
      '</div>' +
      '<div class="subhead" style="margin-top:0">Категория' +
        (currentDeleted ? ' <span class="badge">текущая — «' + escapeHtml(currentCat.name) + '» (удалена)</span>' : '') +
      '</div>' +
      '<div class="cat-grid">' +
        cats.map(c =>
          '<button class="cat-btn ' + (t.categoryId === c.id ? 'active' : '') + '" data-act="edit-txn-cat" data-id="' + t.id + '" data-cat="' + c.id + '" style="--c:' + c.color + '">' +
            '<span class="dot-color" style="background:' + c.color + '"></span><span>' + escapeHtml(c.name) + '</span>' +
          '</button>'
        ).join('') +
      '</div>';
  }

  body +=
    '<label class="field"><span>Сумма</span><input type="number" inputmode="decimal" step="0.01" min="0" id="editAmount" value="' + escapeAttr(t.amount) + '"></label>' +
    '<label class="field"><span>Дата</span><input type="date" id="editDate" value="' + escapeAttr(t.date) + '"></label>' +
    '<label class="field"><span>Комментарий</span><input type="text" id="editComment" value="' + escapeAttr(t.comment) + '"></label>';

  if (!isTransfer) {
    body += '<label class="check"><input type="checkbox" id="editRecurring" ' + (t.recurring ? 'checked' : '') + '><span>Повторять ежемесячно</span></label>';
  }

  body +=
    '<div style="display:flex;gap:6px">' +
      '<button class="btn ok" style="flex:1" data-act="save-edit" data-id="' + t.id + '">Сохранить</button>' +
      '<button class="btn" style="flex:1" data-act="cancel-edit">Отмена</button>' +
    '</div>';

  return '<div class="txn" style="display:block">' + body + '</div>';
}

/* ---------- Постоянные расходы ---------- */
function renderRecurring() {
  const el = document.getElementById('recurringBody');
  const activeItems = state.data.recurringExpenses.filter(r => !r.deleted);
  const deletedItems = state.data.recurringExpenses.filter(r => r.deleted);
  const accounts = activeAccounts();
  const cats = activeCategories('expense');
  const nr = state.newRecurring;

  if (!nr.accountId && accounts.length) nr.accountId = accounts[0].id;

  let html = '';

  if (activeItems.length === 0) {
    html += '<div class="empty">Нет постоянных расходов</div>';
  } else {
    for (const r of activeItems) {
      if (state.editingRecurring === r.id) {
        html += renderRecurringEditForm(r, accounts, cats);
      } else {
        html += renderRecurringCard(r, false);
      }
    }
  }

  if (deletedItems.length > 0) {
    html += '<div class="subhead" style="cursor:pointer" data-act="toggle-deleted-recurring">' +
      (state.showDeletedRecurring ? '▼' : '▶') + ' Удалённые (' + deletedItems.length + ')</div>';
    if (state.showDeletedRecurring) {
      for (const r of deletedItems) {
        html += renderRecurringCard(r, true);
      }
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

function renderRecurringCard(r, isDeleted) {
  const acc = getAccount(r.accountId);
  const cat = findCategory(r.categoryId);
  const expanded = !!state.expandedRecurring[r.id];
  const isDue = r.nextDate <= todayISO();
  const periodLabel = PERIOD_LABELS[r.period] || 'Ежемесячно';

  const remaining = (r.remaining !== undefined && r.remaining !== null) ? r.remaining : r.amount;
  const isPartial = remaining < r.amount;
  const paidSoFar = r.amount - remaining;

  let actions = '';
  if (isDeleted) {
    actions =
      '<button class="mini ok" data-act="restore-recurring" data-id="' + r.id + '" title="Восстановить">&#8635;</button>' +
      '<button class="mini" data-act="toggle-rec-hist" data-id="' + r.id + '" title="История">&#9201;</button>';
  } else {
    actions =
      '<button class="mini ok" data-act="pay-recurring" data-id="' + r.id + '" title="Внести платёж">&#10003;</button>' +
      '<button class="mini" data-act="toggle-rec-hist" data-id="' + r.id + '" title="История">&#9201;</button>' +
      '<button class="mini yellow" data-act="edit-recurring" data-id="' + r.id + '" title="Редактировать">&#9998;</button>' +
      '<button class="mini red" data-act="del-recurring" data-id="' + r.id + '" title="Удалить">&#10005;</button>';
  }

  return '<div class="txn' + (isDeleted ? ' virtual' : '') + '">' +
    '<div class="txn-cat">' +
      '<span class="ellip" style="font-weight:600">' + escapeHtml(r.name) + '</span>' +
      (isDeleted ? '<span class="badge danger">удалён</span>' : '') +
      (!isDeleted && isDue && !isPartial ? '<span class="badge warn">Срок наступил</span>' : '') +
      (!isDeleted && isPartial ? '<span class="badge warn">Частично оплачен</span>' : '') +
    '</div>' +
    '<div class="txn-amt expense">' + fmtMoney(remaining) +
      (isPartial ? '<div style="font-size:11px;color:var(--text2);font-weight:400">из ' + fmtMoney(r.amount) + '</div>' : '') +
    '</div>' +
    '<div class="txn-cmt">Счёт: <span class="dot-color" style="background:' + (acc ? acc.color : '#999') + ';margin-right:4px"></span>' + escapeHtml(acc ? acc.name : '—') +
      (cat ? ' · ' + escapeHtml(cat.name) : '') +
      ' · ' + periodLabel +
      ' · след. платёж: ' + dateLabel(r.nextDate) +
      (isPartial ? ' · уже внесено: <b>' + fmtMoney(paidSoFar) + '</b>' : '') +
    '</div>' +
    '<div class="txn-actions">' + actions + '</div>' +
    (state.payingRecurring === r.id ? renderRecurringPayForm(r) : '') +
    (expanded && r.history.length
      ? '<div style="grid-column:1/-1;margin-top:6px">' +
          '<div class="subhead" style="margin:6px 0 4px">История платежей</div>' +
          r.history.slice().reverse().map(h => {
            const after = (h.remainingAfter !== null && h.remainingAfter !== undefined && h.isPartial)
              ? ' · осталось <b>' + fmtMoney(h.remainingAfter) + '</b>'
              : ' · закрыт';
            return '<div class="history-row">' +
              '<span>' + dateLabel(h.paidDate) + (h.isPartial ? ' <span class="badge warn">частично</span>' : '') + '</span>' +
              '<span>' + fmtMoney(h.paidAmount) + after + '</span>' +
            '</div>';
          }).join('') +
        '</div>'
      : '') +
  '</div>';
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
  const remaining = (r.remaining !== undefined && r.remaining !== null) ? r.remaining : r.amount;
  const isPartial = remaining < r.amount;
  const paidSoFar = r.amount - remaining;
  return '<div style="grid-column:1/-1;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-top:8px">' +
    '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">' +
      'Оплата: ' + escapeHtml(r.name) + ' · план ' + fmtMoney(r.amount) +
      (isPartial ? ' · уже внесено ' + fmtMoney(paidSoFar) : '') +
      ' · <b>осталось ' + fmtMoney(remaining) + '</b>' +
    '</div>' +
    '<div style="font-size:11px;color:var(--text2);margin-bottom:8px">' +
      'Если внесёшь меньше остатка — это будет частичный платёж, дата следующего платежа не сдвинется.' +
    '</div>' +
    '<label class="field"><span>Сумма платежа</span><input type="number" inputmode="decimal" step="0.01" min="0" id="payRecAmount" value="' + escapeAttr(remaining) + '"></label>' +
    '<label class="field"><span>Дата платежа</span><input type="date" id="payRecDate" value="' + todayISO() + '"></label>' +
    '<label class="check"><input type="checkbox" id="payRecAddTxn" checked><span>Добавить операцию в расходы' + (acc ? ' (' + escapeHtml(acc.name) + ')' : '') + '</span></label>' +
    '<div style="display:flex;gap:6px">' +
      '<button class="btn ok" style="flex:1" data-act="confirm-pay-recurring" data-id="' + r.id + '">Подтвердить платёж</button>' +
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
  const accounts = activeAccounts();
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
      if (t.type === 'transfer') continue;
      const key = t.categoryId || '__none__';
      if (!sums[key]) sums[key] = { exp: 0, inc: 0 };
      if (t.type === 'expense') sums[key].exp += num(t.amount);
      else sums[key].inc += num(t.amount);
    }
  }

  const rows = [];
  let totalExp = 0, totalInc = 0;
  for (const key of Object.keys(sums)) {
    const s = sums[key];
    const avgExp = s.exp / window;
    const avgInc = s.inc / window;
    if (avgExp === 0 && avgInc === 0) continue;
    const cat = key === '__none__' ? null : findCategory(key);
    rows.push({ cat, avgExp, avgInc });
    totalExp += avgExp;
    totalInc += avgInc;
  }
  rows.sort((a, b) => (b.avgExp + b.avgInc) - (a.avgExp + a.avgInc));

  let recurringMonthly = 0;
  for (const r of state.data.recurringExpenses) {
    if (r.deleted) continue;
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
      const name = r.cat ? r.cat.name : 'Без категории';
      const color = r.cat ? r.cat.color : '#999';
      const isDel = r.cat && r.cat.deleted;
      html +=
        '<div class="fc-row">' +
          '<div class="fc-name"><span class="dot-color" style="background:' + color + '"></span><span>' + escapeHtml(name) + (isDel ? ' <span class="badge">удалена</span>' : '') + '</span></div>' +
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
  for (const c of state.data.categories) {
    if (c.deleted) continue;
    groups[c.type].push(c);
  }
  const deletedList = deletedCategories();

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

  if (deletedList.length > 0) {
    html += '<div class="subhead" style="cursor:pointer" data-act="toggle-deleted-cats">' +
      (state.showDeletedCats ? '▼' : '▶') + ' Удалённые (' + deletedList.length + ')</div>';
    if (state.showDeletedCats) {
      html += '<div class="hint">Удалённые категории не показываются при выборе новых операций, но все старые операции сохраняют их название.</div>';
      for (const c of deletedList) {
        const usage = state.data.transactions.filter(t => t.categoryId === c.id).length;
        html +=
          '<div class="txn virtual">' +
            '<div class="txn-cat">' +
              '<span class="dot-color" style="background:' + c.color + ';opacity:.5"></span>' +
              '<span class="ellip" style="text-decoration:line-through;opacity:.7">' + escapeHtml(c.name) + '</span>' +
              '<span class="badge">' + (c.type === 'income' ? 'доход' : 'расход') + '</span>' +
              (usage > 0 ? '<span class="badge">' + usage + ' операций</span>' : '') +
            '</div>' +
            '<div></div>' +
            '<div class="txn-actions">' +
              '<button class="mini ok" data-act="restore-cat" data-id="' + c.id + '" title="Восстановить">&#8635;</button>' +
            '</div>' +
          '</div>';
      }
    }
  }

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
    '<div class="hint">Сохраните все данные (счета, категории, операции, долги, постоянные расходы) в один файл. Позже сможете загрузить его обратно — это полностью заменит текущие данные.</div>'
