'use strict';
/* Ritmo — alimentación, entrenos, sueño y medidas. Todo se guarda en el teléfono (IndexedDB). */

/* ============ Utilidades ============ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const fmtLong = s => { const d = parseD(s); return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`; };
const fmtShort = s => { const d = parseD(s); return `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`; };
const relDay = s => s === today() ? 'Hoy' : s === addDays(today(), -1) ? 'Ayer' : fmtLong(s);
const num = v => { if (v == null) return null; const n = parseFloat(String(v).trim().replace(',', '.')); return Number.isFinite(n) ? n : null; };
const fmt = (n, d = 1) => n == null ? '–' : (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('es-DO', { maximumFractionDigits: d });
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
const pl = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const hm = min => `${Math.floor(min / 60)} h ${pad(Math.round(min % 60))} min`;

/* Unidades: todo se guarda en kg y cm; aquí se convierte para mostrar. */
const KG_LB = 2.2046226218, CM_IN = 2.54, KM_MI = 0.621371;
const imp = () => state.settings.units === 'imperial';
const wOut = kg => imp() ? kg * KG_LB : kg;
const wIn = v => imp() ? v / KG_LB : v;
const wUnit = () => imp() ? 'lb' : 'kg';
const lOut = cm => imp() ? cm / CM_IN : cm;
const lIn = v => imp() ? v * CM_IN : v;
const lUnit = () => imp() ? 'in' : 'cm';
const dOut = km => imp() ? km * KM_MI : km;
const dIn = v => imp() ? v / KM_MI : v;
const dUnit = () => imp() ? 'mi' : 'km';

/* ============ Estado y base de datos ============ */
const STORES = ['foods', 'meals', 'workouts', 'templates', 'sleep', 'body'];
const DEFAULTS = { units: 'imperial', theme: 'auto', goalKcal: null, goalProtein: null, goalSleep: 8, rest: 90, lastBackup: null, draft: null };
const state = { foods: [], meals: [], workouts: [], templates: [], sleep: [], body: [], settings: { ...DEFAULTS } };
const ui = { tab: 'today', foodDate: today(), bodyRange: 90 };
let db = null, dbOk = false;

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('ritmo', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      STORES.forEach(s => d.createObjectStore(s, { keyPath: 'id' }));
      d.createObjectStore('kv', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const getAll = store => new Promise((res, rej) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
const dbPut = (store, obj) => { if (!dbOk) return; try { db.transaction(store, 'readwrite').objectStore(store).put(obj); } catch (e) { console.error(e); } };
const dbDel = (store, id) => { if (!dbOk) return; try { db.transaction(store, 'readwrite').objectStore(store).delete(id); } catch (e) { console.error(e); } };
const dbClear = store => new Promise(res => { if (!dbOk) return res(); const t = db.transaction(store, 'readwrite'); t.objectStore(store).clear(); t.oncomplete = res; t.onerror = res; });

function save(store, obj) {
  const arr = state[store], i = arr.findIndex(x => x.id === obj.id);
  if (i >= 0) arr[i] = obj; else arr.push(obj);
  dbPut(store, obj);
}
function remove(store, id) { state[store] = state[store].filter(x => x.id !== id); dbDel(store, id); }
function saveSettings() { dbPut('kv', { key: 'settings', value: state.settings }); }

async function loadAll() {
  for (const s of STORES) state[s] = await getAll(s);
  const kv = await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get('settings'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  state.settings = { ...DEFAULTS, ...(kv ? kv.value : {}) };
}

/* ============ Cálculos ============ */
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
const dayMeals = d => state.meals.filter(m => m.date === d);
const totals = list => ({ kcal: sum(list, x => x.kcal), p: sum(list, x => x.p), c: sum(list, x => x.c), f: sum(list, x => x.f) });
const weights = () => state.body.filter(b => b.weightKg != null).sort(byDateDesc);
const sleepSorted = () => [...state.sleep].sort(byDateDesc);
const workoutsSorted = () => [...state.workouts].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created || 0) - (a.created || 0)));
const volume = w => sum(w.exercises || [], e => sum(e.sets, s => (s.w || 0) * (s.r || 0)));
const setCount = w => sum(w.exercises || [], e => e.sets.length);
const norm = s => String(s || '').trim().toLowerCase();

function lastSets(name) {
  for (const w of workoutsSorted()) {
    if (w.type !== 'strength') continue;
    const ex = (w.exercises || []).find(e => norm(e.name) === norm(name));
    if (ex && ex.sets.length) return ex.sets;
  }
  return [];
}
function knownExercises() {
  const base = ['Press banca', 'Sentadilla', 'Peso muerto', 'Press militar', 'Remo con barra', 'Dominadas', 'Jalón al pecho', 'Prensa de piernas', 'Hip thrust', 'Zancadas', 'Curl de bíceps', 'Extensión de tríceps', 'Elevaciones laterales', 'Press inclinado con mancuernas', 'Curl femoral', 'Extensión de cuádriceps', 'Elevación de talones', 'Plancha'];
  const seen = new Map();
  const add = n => { if (n && !seen.has(norm(n))) seen.set(norm(n), n.trim()); };
  state.workouts.forEach(w => (w.exercises || []).forEach(e => add(e.name)));
  state.templates.forEach(t => t.exercises.forEach(e => add(e.name)));
  base.forEach(add);
  return [...seen.values()];
}

/* ============ Interfaz base ============ */
let toastT;
function toast(msg) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; requestAnimationFrame(() => t.classList.add('in'));
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('in'), 2000);
}

let sheetEl = null;
function openSheet(title, html, opts = {}) {
  closeSheet(true);
  const w = document.createElement('div');
  w.className = 'sheet-wrap';
  w.innerHTML = `<div class="scrim"></div><div class="sheet ${opts.full ? 'full' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grab"></div><header class="sheet-h"><h2>${esc(title)}</h2><button class="x" data-close aria-label="Cerrar">×</button></header><div class="sheet-b">${html}</div></div>`;
  document.body.appendChild(w);
  sheetEl = w;
  document.body.classList.add('noscroll');
  requestAnimationFrame(() => w.classList.add('in'));
  w.addEventListener('click', e => { if (e.target.classList.contains('scrim') || e.target.closest('[data-close]')) closeSheet(); });
  if (opts.onMount) opts.onMount(w);
  return w;
}
function closeSheet(instant) {
  if (!sheetEl) return;
  const w = sheetEl; sheetEl = null;
  if (instant) w.remove(); else { w.classList.remove('in'); setTimeout(() => w.remove(), 220); }
  if (!state.settings.draft || $('#session').hidden) document.body.classList.remove('noscroll');
  if (!$('#session').hidden) document.body.classList.add('noscroll');
}

const ICON = {
  chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  left: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>'
};

/* ============ Gráficas (SVG propio, funcionan sin internet) ============ */
function lineChart(pts, { mini = false, color = 'var(--c-body)', unit = '' } = {}) {
  if (pts.length < 2) return mini ? '' : '<p class="empty-s">Con dos registros o más aparece la tendencia.</p>';
  const W = 340, H = mini ? 44 : 150, pl = mini ? 2 : 4, pr = mini ? 4 : 8, pt = mini ? 4 : 18, pb = mini ? 4 : 22;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const padY = (y1 - y0) * 0.12; y0 -= padY; y1 += padY;
  const X = x => pl + ((x - x0) / (x1 - x0 || 1)) * (W - pl - pr);
  const Y = y => pt + (1 - (y - y0) / (y1 - y0)) * (H - pt - pb);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const dot = `<circle cx="${X(last.x).toFixed(1)}" cy="${Y(last.y).toFixed(1)}" r="${mini ? 3 : 4.5}" fill="${color}"/>`;
  const path = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${mini ? 2 : 2.5}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (mini) return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tendencia">${path}${dot}</svg>`;
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const dFmt = t => fmtShort(dstr(new Date(t)));
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfica de tendencia">
    <line class="axis" x1="${pl}" y1="${H - pb}" x2="${W - pr}" y2="${H - pb}"/>
    ${path}${dot}
    <text x="${pl}" y="10">${fmt(ymax)} ${unit}</text>
    <text x="${pl}" y="${H - pb - 6}">${fmt(ymin)} ${unit}</text>
    <text x="${pl}" y="${H - 6}">${dFmt(x0)}</text>
    <text x="${W - pr}" y="${H - 6}" text-anchor="end">${dFmt(x1)}</text>
  </svg>`;
}

function barChart(items, { goal = null, color = 'var(--c-sleep)', valueFmt = v => fmt(v, 1) } = {}) {
  const W = 340, H = 150, pl = 4, pr = 4, pt = 20, pb = 22;
  const max = Math.max(goal || 0, ...items.map(i => i.v || 0), 1) * 1.1;
  const bw = (W - pl - pr) / items.length, gap = Math.min(8, bw * 0.3);
  const Y = v => pt + (1 - v / max) * (H - pt - pb);
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfica de barras"><line class="axis" x1="${pl}" y1="${H - pb}" x2="${W - pr}" y2="${H - pb}"/>`;
  if (goal) out += `<line class="goal" x1="${pl}" y1="${Y(goal).toFixed(1)}" x2="${W - pr}" y2="${Y(goal).toFixed(1)}"/>`;
  items.forEach((it, i) => {
    const x = pl + i * bw + gap / 2, w = bw - gap;
    if (it.v) {
      const y = Y(it.v), h = H - pb - y;
      out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(5, w / 2).toFixed(1)}" fill="${color}"/>`;
      if (items.length <= 8) out += `<text x="${(x + w / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle">${valueFmt(it.v)}</text>`;
    }
    out += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  return out + '</svg>';
}

/* ============ Pantallas ============ */
const views = {};
const MEALS = [['desayuno', 'Desayuno'], ['almuerzo', 'Almuerzo'], ['cena', 'Cena'], ['snack', 'Snack']];
const mealName = k => (MEALS.find(m => m[0] === k) || [0, 'Comida'])[1];
const MEASURES = [['cintura', 'Cintura'], ['pecho', 'Pecho'], ['cadera', 'Cadera'], ['brazo', 'Brazo'], ['muslo', 'Muslo'], ['cuello', 'Cuello']];
const CARDIO = ['Trote', 'Caminata', 'Bicicleta', 'Elíptica', 'Natación', 'Otro'];
const suggestMeal = () => { const h = new Date().getHours(); return h < 10 ? 'desayuno' : h < 15 ? 'almuerzo' : h < 21 ? 'cena' : 'snack'; };
const daysAgo = s => Math.round((parseD(today()) - parseD(s)) / 864e5);
const agoText = n => n <= 0 ? 'hoy' : n === 1 ? 'ayer' : `hace ${n} días`;
const header = (title, sub, right = '') => `<header class="top"><div>${sub ? `<p class="sub">${sub}</p>` : ''}<h1>${title}</h1></div>${right}</header>`;

function draftBanner() {
  const dr = state.settings.draft;
  return dr ? `<button class="banner" data-act="sessOpen"><div class="grow"><div class="t">Entreno en curso</div><div class="s">${esc(dr.name)} · toca para continuar</div></div>${ICON.chev}</button>` : '';
}
function backupBanner() {
  const n = state.meals.length + state.workouts.length + state.sleep.length + state.body.length;
  const b = state.settings.lastBackup;
  if (n < 12) return '';
  const days = b ? (Date.now() - b) / 864e5 : Infinity;
  if (days < 14) return '';
  return `<button class="banner" data-act="settings"><div class="grow"><div class="t">Haz un respaldo</div><div class="s">${b ? `El último fue ${agoText(Math.floor(days))}.` : 'Aún no has guardado ninguno.'} Si borras la app o el navegador, los datos se pierden.</div></div>${ICON.chev}</button>`;
}

views.today = () => {
  const t = today(), s = state.settings;
  const tot = totals(dayMeals(t)), g = s.goalKcal;
  const ws = weights(), w0 = ws[0], w1 = ws[1];
  const sl = sleepSorted()[0];
  const todays = state.workouts.filter(w => w.date === t);
  const lastW = workoutsSorted()[0];
  const pts = ws.slice(0, 30).reverse().map(b => ({ x: parseD(b.date).getTime(), y: wOut(b.weightKg) }));
  const delta = w0 && w1 ? wOut(w0.weightKg - w1.weightKg) : null;

  const food = `<button class="metric" data-act="tab" data-arg="food"><div class="lbl"><i class="dot food"></i>Comida</div>
    <div class="val">${fmt(tot.kcal, 0)}<small>kcal${g ? ` de ${fmt(g, 0)}` : ''}</small></div>
    ${g ? `<div class="bar"><i style="width:${clamp(tot.kcal / g * 100, 0, 100)}%"></i></div>` : ''}
    <div class="note">Proteína ${fmt(tot.p, 0)} g${s.goalProtein ? ` de ${fmt(s.goalProtein, 0)} g` : ''}</div></button>`;

  let train;
  if (todays.length) {
    const w = todays[0];
    train = `<button class="metric" data-act="tab" data-arg="train"><div class="lbl"><i class="dot train"></i>Entreno</div>
      <div class="val">${todays.length}<small>${todays.length > 1 ? 'sesiones' : 'sesión'} hoy</small></div>
      <div class="note">${esc(w.name)}${w.type === 'strength' ? ` · ${pl(setCount(w), 'serie', 'series')}` : ` · ${w.minutes || 0} min`}</div></button>`;
  } else {
    train = `<button class="metric" data-act="tab" data-arg="train"><div class="lbl"><i class="dot train"></i>Entreno</div>
      <div class="val">–<small>sin registrar hoy</small></div>
      <div class="note">${lastW ? `Último: ${esc(lastW.name)}, ${agoText(daysAgo(lastW.date))}` : 'Empieza tu primer entreno'}</div></button>`;
  }

  const sleep = `<button class="metric" data-act="tab" data-arg="sleep"><div class="lbl"><i class="dot sleep"></i>Sueño</div>
    ${sl ? `<div class="val">${Math.floor(sl.minutes / 60)}<small>h</small>${pad(Math.round(sl.minutes % 60))}<small>min</small></div>
    <div class="note">${relDay(sl.date)}${sl.quality ? ` · calidad ${sl.quality}/5` : ''}</div>`
      : `<div class="val">–<small>sin registros</small></div><div class="note">Registra tu primera noche</div>`}</button>`;

  const body = `<button class="metric" data-act="tab" data-arg="body"><div class="lbl"><i class="dot body"></i>Peso</div>
    ${w0 ? `<div class="val">${fmt(wOut(w0.weightKg))}<small>${wUnit()}</small></div>
    <div class="note">${delta != null ? `${delta > 0 ? '+' : ''}${fmt(delta)} ${wUnit()} desde el ${fmtShort(w1.date)}` : relDay(w0.date)}</div>
    <div class="spark">${lineChart(pts, { mini: true })}</div>`
      : `<div class="val">–<small>sin registros</small></div><div class="note">Registra tu peso de hoy</div>`}</button>`;

  return `${header('Hoy', fmtLong(t), `<button class="icon-btn" data-act="settings" aria-label="Ajustes">${ICON.gear}</button>`)}
    ${draftBanner()}${backupBanner()}
    <div class="pills">
      <button class="pill" data-act="addFood" data-arg="${suggestMeal()}" data-from="today">+ Comida</button>
      <button class="pill" data-act="startBlank">+ Entreno</button>
      <button class="pill" data-act="sleepForm">+ Sueño</button>
      <button class="pill" data-act="bodyForm">+ Peso y medidas</button>
    </div>
    <section class="group">${food}${train}${sleep}${body}</section>`;
};

views.food = () => {
  const d = ui.foodDate, s = state.settings;
  const list = dayMeals(d), tot = totals(list), prev = dayMeals(addDays(d, -1));
  const left = s.goalKcal ? s.goalKcal - tot.kcal : null;
  const small = (d === today() || d === addDays(today(), -1)) ? fmtLong(d) : parseD(d).getFullYear();
  const nav = `<div class="datenav"><button class="step" data-act="foodDay" data-arg="-1" aria-label="Día anterior">${ICON.left}</button>
    <div class="cur">${relDay(d)}<small>${small}</small></div>
    <button class="step" data-act="foodDay" data-arg="1" aria-label="Día siguiente">${ICON.right}</button></div>`;
  const summary = `<section class="group"><div class="summary">
    <div class="big">${fmt(tot.kcal, 0)}<small>kcal${left != null ? ` · ${left >= 0 ? fmt(left, 0) + ' restantes' : fmt(-left, 0) + ' sobre la meta'}` : ''}</small></div>
    ${s.goalKcal ? `<div class="bar"><i style="width:${clamp(tot.kcal / s.goalKcal * 100, 0, 100)}%"></i></div>` : ''}
    <div class="macros">
      <div class="macro"><b>${fmt(tot.p, 0)} g</b><span>Proteína${s.goalProtein ? ` · meta ${fmt(s.goalProtein, 0)}` : ''}</span></div>
      <div class="macro"><b>${fmt(tot.c, 0)} g</b><span>Carbos</span></div>
      <div class="macro"><b>${fmt(tot.f, 0)} g</b><span>Grasa</span></div>
    </div></div></section>`;
  const repeat = (!list.length && prev.length) ? `<div class="btns" style="margin:0 0 14px"><button class="btn ghost" data-act="repeatDay">Repetir las comidas de ayer</button></div>` : '';
  const sections = MEALS.map(([k, n]) => {
    const items = list.filter(x => x.meal === k);
    return `<section class="group"><div class="group-h"><h2>${n}</h2><span class="meta">${items.length ? fmt(sum(items, x => x.kcal), 0) + ' kcal' : ''}</span></div>
      ${items.map(it => `<button class="row" data-act="editMeal" data-id="${it.id}"><div class="grow"><div class="t">${esc(it.name)}</div><div class="s">${fmt(it.servings, 2)} × ${esc(it.serving || 'porción')}</div></div><div class="r">${fmt(it.kcal, 0)}</div></button>`).join('')}
      <button class="row" data-act="addFood" data-arg="${k}"><span class="link" style="padding:0">+ Añadir</span></button></section>`;
  }).join('');
  return `${header('Comida', '', `<button class="icon-btn" data-act="settings" aria-label="Ajustes">${ICON.gear}</button>`)}${nav}${summary}${repeat}${sections}
    <button class="btn ghost" data-act="library">Biblioteca de alimentos</button>`;
};

views.train = () => {
  const hist = workoutsSorted().slice(0, 40);
  const startBtns = state.settings.draft ? draftBanner() : `<div class="btns two" style="margin:0 0 14px"><button class="btn primary" data-act="startBlank">Empezar entreno</button><button class="btn ghost" data-act="cardioForm">Registrar cardio</button></div>`;
  const tpl = `<section class="group"><div class="group-h"><h2>Rutinas</h2></div>
    ${state.templates.map(t => `<button class="row" data-act="tplOpen" data-id="${t.id}"><div class="grow"><div class="t">${esc(t.name)}</div><div class="s">${pl(t.exercises.length, 'ejercicio', 'ejercicios')}</div></div>${ICON.chev}</button>`).join('') || '<div class="empty">Guarda un entreno como rutina para repetirlo con un toque.</div>'}
    <button class="row" data-act="tplForm"><span class="link" style="padding:0">+ Nueva rutina</span></button></section>`;
  const histHtml = hist.length ? `<section class="group"><div class="group-h"><h2>Historial</h2></div>${hist.map(w => {
    const isS = w.type === 'strength';
    const sub = isS ? `${relDay(w.date)} · ${pl(w.exercises.length, 'ejercicio', 'ejercicios')} · ${pl(setCount(w), 'serie', 'series')}` : `${relDay(w.date)} · ${w.minutes || 0} min`;
    const right = isS ? `${fmt(wOut(volume(w)), 0)} ${wUnit()}` : (w.distanceKm ? `${fmt(dOut(w.distanceKm), 2)} ${dUnit()}` : '');
    return `<button class="row" data-act="wkOpen" data-id="${w.id}"><div class="grow"><div class="t">${esc(w.name)}</div><div class="s">${sub}</div></div><div class="r">${right}</div></button>`;
  }).join('')}</section>` : '';
  return `${header('Entreno', '', `<button class="icon-btn" data-act="settings" aria-label="Ajustes">${ICON.gear}</button>`)}${startBtns}${tpl}${histHtml}`;
};

views.sleep = () => {
  const list = sleepSorted(), goal = state.settings.goalSleep;
  const items = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today(), -i), e = list.find(x => x.date === d);
    items.push({ label: DIAS[parseD(d).getDay()][0].toUpperCase(), v: e ? e.minutes / 60 : 0 });
  }
  const last7 = list.filter(x => x.date > addDays(today(), -7));
  const avg = last7.length ? sum(last7, x => x.minutes) / last7.length : null;
  const summary = `<section class="group"><div class="metric"><div class="lbl"><i class="dot sleep"></i>Promedio, últimos 7 días</div>
    <div class="val">${avg != null ? `${Math.floor(avg / 60)}<small>h</small>${pad(Math.round(avg % 60))}<small>min</small>` : '–'}</div>
    <div class="note">${avg != null ? `${last7.length} ${last7.length === 1 ? 'noche registrada' : 'noches registradas'}${goal ? ` · meta ${fmt(goal, 1)} h` : ''}` : 'Registra tus noches para ver el promedio'}</div></div>
    <div class="chart">${barChart(items, { goal })}</div></section>`;
  const rows = list.slice(0, 30).map(e => `<button class="row" data-act="sleepOpen" data-id="${e.id}"><div class="grow"><div class="t">${relDay(e.date)}</div><div class="s">${e.bed} → ${e.wake}${e.quality ? ` · calidad ${e.quality}/5` : ''}</div></div><div class="r">${hm(e.minutes)}</div></button>`).join('');
  return `${header('Sueño', '', `<button class="icon-btn" data-act="settings" aria-label="Ajustes">${ICON.gear}</button>`)}
    <div class="btns" style="margin:0 0 14px"><button class="btn primary" data-act="sleepForm">Registrar noche</button></div>
    ${summary}${rows ? `<section class="group"><div class="group-h"><h2>Registros</h2></div>${rows}</section>` : ''}`;
};

views.body = () => {
  const ws = weights(), w0 = ws[0], r = ui.bodyRange;
  const cutoff = r ? addDays(today(), -r) : '0000-00-00';
  const inRange = ws.filter(b => b.date >= cutoff).reverse();
  const pts = inRange.map(b => ({ x: parseD(b.date).getTime(), y: wOut(b.weightKg) }));
  const change = inRange.length > 1 ? wOut(inRange[inRange.length - 1].weightKg - inRange[0].weightKg) : null;
  const summary = `<section class="group"><div class="metric"><div class="lbl"><i class="dot body"></i>Peso actual</div>
    <div class="val">${w0 ? fmt(wOut(w0.weightKg)) : '–'}<small>${w0 ? wUnit() : 'sin registros'}</small></div>
    <div class="note">${w0 ? (change != null ? `${change > 0 ? '+' : ''}${fmt(change)} ${wUnit()} en este periodo` : relDay(w0.date)) : 'Registra tu peso para ver la tendencia'}</div></div>
    <div class="range"><div class="seg">${[[30, '30 días'], [90, '90 días'], [0, 'Todo']].map(([v, l]) => `<button class="${r === v ? 'on' : ''}" data-act="bodyRange" data-arg="${v}">${l}</button>`).join('')}</div></div>
    <div class="chart">${lineChart(pts, { unit: wUnit() })}</div></section>`;

  const sorted = [...state.body].sort(byDateDesc);
  const meas = MEASURES.map(([k, n]) => {
    const has = sorted.filter(b => b.cm && b.cm[k] != null);
    if (!has.length) return '';
    const dlt = has[1] ? lOut(has[0].cm[k] - has[1].cm[k]) : null;
    return `<div class="row"><div class="grow"><div class="t">${n}</div><div class="s">${dlt != null ? `${dlt > 0 ? '+' : ''}${fmt(dlt)} ${lUnit()} vs. anterior` : relDay(has[0].date)}</div></div><div class="r">${fmt(lOut(has[0].cm[k]))} ${lUnit()}</div></div>`;
  }).join('');
  const fats = sorted.filter(b => b.fat != null);
  const fatRow = fats.length ? `<div class="row"><div class="grow"><div class="t">Grasa corporal</div><div class="s">${fats[1] ? `${fats[0].fat - fats[1].fat > 0 ? '+' : ''}${fmt(fats[0].fat - fats[1].fat)} % vs. anterior` : relDay(fats[0].date)}</div></div><div class="r">${fmt(fats[0].fat)} %</div></div>` : '';
  const measures = (meas || fatRow) ? `<section class="group"><div class="group-h"><h2>Últimas medidas</h2></div>${meas}${fatRow}</section>` : '';

  const hist = sorted.slice(0, 40).map(b => {
    const parts = [];
    const n = Object.keys(b.cm || {}).filter(k => b.cm[k] != null).length;
    if (n) parts.push(`${n} ${n === 1 ? 'medida' : 'medidas'}`);
    if (b.fat != null) parts.push(`${fmt(b.fat)} % grasa`);
    return `<button class="row" data-act="bodyOpen" data-id="${b.id}"><div class="grow"><div class="t">${relDay(b.date)}</div><div class="s">${parts.join(' · ') || 'Solo peso'}</div></div><div class="r">${b.weightKg != null ? fmt(wOut(b.weightKg)) + ' ' + wUnit() : ''}</div></button>`;
  }).join('');
  return `${header('Cuerpo', '', `<button class="icon-btn" data-act="settings" aria-label="Ajustes">${ICON.gear}</button>`)}
    <div class="btns" style="margin:0 0 14px"><button class="btn primary" data-act="bodyForm">Registrar peso y medidas</button></div>
    ${summary}${measures}${hist ? `<section class="group"><div class="group-h"><h2>Registros</h2></div>${hist}</section>` : ''}`;
};

function render() {
  const y = window.scrollY;
  $('#view').innerHTML = views[ui.tab]();
  $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  window.scrollTo(0, y);
}
function go(tab) { ui.tab = tab; window.scrollTo(0, 0); render(); }

/* ============ Acciones ============ */
const A = {};
const inpNum = n => String(Math.round(n * 10) / 10);
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && A[el.dataset.act]) A[el.dataset.act](el, e);
});

A.tab = el => go(el.dataset.arg);

/* ---------- Comida ---------- */
A.foodDay = el => {
  const d = addDays(ui.foodDate, +el.dataset.arg);
  if (d > today()) return;
  ui.foodDate = d; render();
};
A.repeatDay = () => {
  dayMeals(addDays(ui.foodDate, -1)).forEach(m => save('meals', { ...m, id: uid(), date: ui.foodDate }));
  render(); toast('Comidas copiadas');
};
A.addFood = el => { if (el.dataset.from === 'today') ui.foodDate = today(); foodPicker(el.dataset.arg); };

function foodPicker(meal) {
  openSheet(`Añadir a ${mealName(meal).toLowerCase()}`, `
    <input id="fq" class="input" type="search" placeholder="Buscar en tu biblioteca" autocomplete="off">
    <div id="flist" class="list"></div>
    <div class="btns two"><button class="btn ghost" data-act="quickEntry" data-arg="${meal}">Entrada rápida</button><button class="btn ghost" data-act="newFood" data-arg="${meal}">Nuevo alimento</button></div>`, {
    onMount: w => {
      const usage = new Map(); state.meals.forEach(m => usage.set(m.foodId, (usage.get(m.foodId) || 0) + 1));
      const foods = [...state.foods].sort((a, b) => (usage.get(b.id) || 0) - (usage.get(a.id) || 0) || a.name.localeCompare(b.name, 'es'));
      const inp = $('#fq', w), box = $('#flist', w);
      const draw = () => {
        const q = norm(inp.value), f = foods.filter(x => norm(x.name).includes(q));
        box.innerHTML = f.length ? f.map(x => `<button class="row" data-act="pickFood" data-id="${x.id}" data-arg="${meal}"><div class="grow"><div class="t">${esc(x.name)}</div><div class="s">${esc(x.serving)}</div></div><div class="r">${fmt(x.kcal, 0)} kcal</div></button>`).join('')
          : `<div class="empty">${foods.length ? 'Sin resultados.' : 'Tu biblioteca está vacía. Crea un alimento nuevo o usa la entrada rápida.'}</div>`;
      };
      inp.addEventListener('input', draw); draw();
    }
  });
}
A.pickFood = el => servingsSheet(el.dataset.arg, el.dataset.id);
A.newFood = el => foodForm(null, el.dataset.arg);
A.quickEntry = el => quickSheet(el.dataset.arg);

function servingsSheet(meal, id) {
  const f = state.foods.find(x => x.id === id); if (!f) return;
  openSheet(f.name, `
    <p class="muted">${esc(f.serving)} · ${fmt(f.kcal, 0)} kcal</p>
    <label class="field"><span>Porciones</span><input id="sv" class="input" inputmode="decimal" value="1"></label>
    <div id="svprev" class="preview"></div>
    <div class="btns"><button class="btn primary" data-act="saveMeal" data-arg="${meal}" data-id="${f.id}">Añadir</button></div>`, {
    onMount: w => {
      const inp = $('#sv', w), pv = $('#svprev', w);
      const up = () => { const n = num(inp.value) || 0; pv.textContent = `${fmt(f.kcal * n, 0)} kcal · P ${fmt(f.p * n, 0)} g · C ${fmt(f.c * n, 0)} g · G ${fmt(f.f * n, 0)} g`; };
      inp.addEventListener('input', up); up();
    }
  });
}
A.saveMeal = el => {
  const f = state.foods.find(x => x.id === el.dataset.id), n = num($('#sv').value);
  if (!f || !n || n <= 0) return toast('Escribe cuántas porciones');
  save('meals', { id: uid(), date: ui.foodDate, meal: el.dataset.arg, foodId: f.id, name: f.name, serving: f.serving, servings: n, kcal: f.kcal * n, p: f.p * n, c: f.c * n, f: f.f * n });
  closeSheet(); render(); toast('Añadido');
};

function foodForm(id, meal) {
  const f = id ? state.foods.find(x => x.id === id) : null;
  const val = v => v != null ? esc(v) : '';
  openSheet(f ? 'Editar alimento' : 'Nuevo alimento', `
    <label class="field"><span>Nombre</span><input id="fn" class="input" value="${val(f && f.name)}" autocomplete="off"></label>
    <label class="field"><span>Porción (por ejemplo: 100 g, 1 huevo)</span><input id="fs" class="input" value="${val(f ? f.serving : '1 porción')}"></label>
    <div class="grid2">
      <label class="field"><span>Calorías</span><input id="fk" class="input" inputmode="decimal" value="${val(f && f.kcal)}"></label>
      <label class="field"><span>Proteína (g)</span><input id="fp" class="input" inputmode="decimal" value="${val(f && f.p)}"></label>
      <label class="field"><span>Carbos (g)</span><input id="fc" class="input" inputmode="decimal" value="${val(f && f.c)}"></label>
      <label class="field"><span>Grasa (g)</span><input id="ff" class="input" inputmode="decimal" value="${val(f && f.f)}"></label>
    </div>
    <div class="btns"><button class="btn primary" data-act="saveFood" data-id="${f ? f.id : ''}" data-arg="${meal || ''}">Guardar</button>${f ? `<button class="btn danger" data-act="delFood" data-id="${f.id}">Eliminar</button>` : ''}</div>`);
}
A.saveFood = el => {
  const name = $('#fn').value.trim(), kcal = num($('#fk').value);
  if (!name) return toast('Ponle un nombre');
  if (kcal == null) return toast('Escribe las calorías');
  const obj = { id: el.dataset.id || uid(), name, serving: $('#fs').value.trim() || '1 porción', kcal, p: num($('#fp').value) || 0, c: num($('#fc').value) || 0, f: num($('#ff').value) || 0 };
  save('foods', obj);
  if (el.dataset.arg) servingsSheet(el.dataset.arg, obj.id); else library();
};
A.delFood = el => {
  if (!confirm('¿Eliminar este alimento de la biblioteca? Tus registros anteriores no cambian.')) return;
  remove('foods', el.dataset.id); library();
};
A.editFood = el => foodForm(el.dataset.id);
A.library = () => library();
function library() {
  const foods = [...state.foods].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  openSheet('Biblioteca de alimentos', `
    <div class="list">${foods.map(x => `<button class="row" data-act="editFood" data-id="${x.id}"><div class="grow"><div class="t">${esc(x.name)}</div><div class="s">${esc(x.serving)} · P ${fmt(x.p, 0)} · C ${fmt(x.c, 0)} · G ${fmt(x.f, 0)}</div></div><div class="r">${fmt(x.kcal, 0)}</div></button>`).join('') || '<div class="empty">Aún no hay alimentos. Crea los que más comes y registrarlos será cuestión de un toque.</div>'}</div>
    <div class="btns"><button class="btn primary" data-act="newFood">Nuevo alimento</button></div>`);
}

function quickSheet(meal) {
  openSheet('Entrada rápida', `
    <label class="field"><span>Nombre (opcional)</span><input id="qn" class="input" autocomplete="off"></label>
    <div class="grid2">
      <label class="field"><span>Calorías</span><input id="qk" class="input" inputmode="decimal"></label>
      <label class="field"><span>Proteína (g)</span><input id="qp" class="input" inputmode="decimal"></label>
      <label class="field"><span>Carbos (g)</span><input id="qc" class="input" inputmode="decimal"></label>
      <label class="field"><span>Grasa (g)</span><input id="qf" class="input" inputmode="decimal"></label>
    </div>
    <label class="check"><input type="checkbox" id="qs">Guardar en mi biblioteca</label>
    <div class="btns"><button class="btn primary" data-act="saveQuick" data-arg="${meal}">Añadir</button></div>`);
}
A.saveQuick = el => {
  const kcal = num($('#qk').value);
  if (kcal == null) return toast('Escribe las calorías');
  const name = $('#qn').value.trim() || 'Comida', p = num($('#qp').value) || 0, c = num($('#qc').value) || 0, f = num($('#qf').value) || 0;
  let foodId = null;
  if ($('#qs').checked) { foodId = uid(); save('foods', { id: foodId, name, serving: '1 porción', kcal, p, c, f }); }
  save('meals', { id: uid(), date: ui.foodDate, meal: el.dataset.arg, foodId, name, serving: '1 porción', servings: 1, kcal, p, c, f });
  closeSheet(); render(); toast('Añadido');
};

A.editMeal = el => {
  const m = state.meals.find(x => x.id === el.dataset.id); if (!m) return;
  openSheet(m.name, `
    <p class="muted">${esc(mealName(m.meal))} · ${esc(m.serving || 'porción')}</p>
    <label class="field"><span>Porciones</span><input id="sv" class="input" inputmode="decimal" value="${m.servings}"></label>
    <div id="svprev" class="preview"></div>
    <div class="btns"><button class="btn primary" data-act="saveMealEdit" data-id="${m.id}">Guardar</button><button class="btn danger" data-act="delMeal" data-id="${m.id}">Eliminar</button></div>`, {
    onMount: w => {
      const inp = $('#sv', w), pv = $('#svprev', w), k = m.servings || 1;
      const up = () => { const n = num(inp.value) || 0; pv.textContent = `${fmt(m.kcal / k * n, 0)} kcal · P ${fmt(m.p / k * n, 0)} g · C ${fmt(m.c / k * n, 0)} g · G ${fmt(m.f / k * n, 0)} g`; };
      inp.addEventListener('input', up); up();
    }
  });
};
A.saveMealEdit = el => {
  const m = state.meals.find(x => x.id === el.dataset.id), n = num($('#sv').value);
  if (!m || !n || n <= 0) return toast('Escribe cuántas porciones');
  const k = m.servings || 1;
  save('meals', { ...m, servings: n, kcal: m.kcal / k * n, p: m.p / k * n, c: m.c / k * n, f: m.f / k * n });
  closeSheet(); render();
};
A.delMeal = el => { remove('meals', el.dataset.id); closeSheet(); render(); };

/* ---------- Sueño ---------- */
A.sleepForm = () => sleepForm();
A.sleepOpen = el => sleepForm(state.sleep.find(x => x.id === el.dataset.id));
function sleepForm(e) {
  openSheet(e ? 'Editar noche' : 'Registrar noche', `
    <label class="field"><span>Día en que despertaste</span><input id="sdate" type="date" class="input" value="${e ? e.date : today()}" max="${today()}"></label>
    <div class="grid2">
      <label class="field"><span>Me dormí a las</span><input id="sbed" type="time" class="input" value="${e ? e.bed : '23:00'}"></label>
      <label class="field"><span>Desperté a las</span><input id="swake" type="time" class="input" value="${e ? e.wake : '06:30'}"></label>
    </div>
    <label class="field"><span>Calidad</span></label>
    <div class="rate" id="srate" data-val="${e && e.quality ? e.quality : 0}">${[1, 2, 3, 4, 5].map(n => `<button class="${e && e.quality === n ? 'on' : ''}" data-act="rate" data-arg="${n}">${n}</button>`).join('')}</div>
    <label class="field"><span>Nota (opcional)</span><input id="snote" class="input" value="${esc(e ? e.note : '')}" autocomplete="off"></label>
    <div class="btns"><button class="btn primary" data-act="saveSleep" data-id="${e ? e.id : ''}">Guardar</button>${e ? `<button class="btn danger" data-act="delSleep" data-id="${e.id}">Eliminar</button>` : ''}</div>`);
}
A.rate = el => {
  const box = el.parentElement, n = +el.dataset.arg, cur = +box.dataset.val;
  const v = cur === n ? 0 : n; box.dataset.val = v;
  $$('button', box).forEach(b => b.classList.toggle('on', +b.dataset.arg === v));
};
A.saveSleep = el => {
  const date = $('#sdate').value || today(), bed = $('#sbed').value, wake = $('#swake').value;
  if (!bed || !wake) return toast('Indica la hora de dormir y despertar');
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const minutes = (toMin(wake) - toMin(bed) + 1440) % 1440;
  if (!minutes) return toast('Las horas no pueden ser iguales');
  const existing = el.dataset.id ? null : state.sleep.find(x => x.date === date);
  save('sleep', { id: el.dataset.id || (existing ? existing.id : uid()), date, bed, wake, minutes, quality: +$('#srate').dataset.val || null, note: $('#snote').value.trim() });
  closeSheet(); render(); toast('Noche guardada');
};
A.delSleep = el => { remove('sleep', el.dataset.id); closeSheet(); render(); };

/* ---------- Cuerpo ---------- */
A.bodyRange = el => { ui.bodyRange = +el.dataset.arg; render(); };
A.bodyForm = () => bodyForm();
A.bodyOpen = el => bodyForm(state.body.find(x => x.id === el.dataset.id));
function bodyForm(e) {
  const last = {};
  [...state.body].sort(byDateDesc).forEach(b => Object.entries(b.cm || {}).forEach(([k, v]) => { if (last[k] == null) last[k] = v; }));
  const lw = weights()[0], lf = [...state.body].sort(byDateDesc).find(b => b.fat != null);
  openSheet(e ? 'Editar registro' : 'Peso y medidas', `
    <label class="field"><span>Fecha</span><input id="bdate" type="date" class="input" value="${e ? e.date : today()}" max="${today()}"></label>
    <label class="field"><span>Peso (${wUnit()})</span><input id="bw" class="input" inputmode="decimal" value="${e && e.weightKg != null ? inpNum(wOut(e.weightKg)) : ''}" placeholder="${lw ? inpNum(wOut(lw.weightKg)) : ''}"></label>
    <p class="muted" style="margin-top:18px;font-size:14px">Medidas opcionales, en ${lUnit()}</p>
    <div class="grid2">${MEASURES.map(([k, n]) => `<label class="field"><span>${n}</span><input class="input" inputmode="decimal" data-m="${k}" value="${e && e.cm && e.cm[k] != null ? inpNum(lOut(e.cm[k])) : ''}" placeholder="${last[k] != null ? inpNum(lOut(last[k])) : ''}"></label>`).join('')}
      <label class="field"><span>Grasa corporal (%)</span><input id="bfat" class="input" inputmode="decimal" value="${e && e.fat != null ? inpNum(e.fat) : ''}" placeholder="${lf ? inpNum(lf.fat) : ''}"></label>
    </div>
    <div class="btns"><button class="btn primary" data-act="saveBody" data-id="${e ? e.id : ''}">Guardar</button>${e ? `<button class="btn danger" data-act="delBody" data-id="${e.id}">Eliminar</button>` : ''}</div>`);
}
A.saveBody = el => {
  const date = $('#bdate').value || today(), w = num($('#bw').value), fat = num($('#bfat').value), cm = {};
  $$('[data-m]', sheetEl).forEach(i => { const v = num(i.value); if (v != null && v > 0) cm[i.dataset.m] = lIn(v); });
  if ((w == null || w <= 0) && !Object.keys(cm).length && fat == null) return toast('Escribe al menos un valor');
  let obj;
  if (el.dataset.id) {
    obj = { id: el.dataset.id, date, cm }; if (w > 0) obj.weightKg = wIn(w); if (fat != null) obj.fat = fat;
  } else {
    const base = state.body.find(b => b.date === date);
    obj = base ? { ...base, cm: { ...(base.cm || {}), ...cm } } : { id: uid(), date, cm };
    if (w > 0) obj.weightKg = wIn(w); if (fat != null) obj.fat = fat;
  }
  save('body', obj); closeSheet(); render(); toast('Guardado');
};
A.delBody = el => { remove('body', el.dataset.id); closeSheet(); render(); };

/* ---------- Entreno ---------- */
const D = () => state.settings.draft;
function newDraft(name, exercises, tplId) {
  if (D() && !confirm('Ya tienes un entreno en curso. ¿Reemplazarlo?')) return;
  state.settings.draft = { id: uid(), name: name || 'Entreno', date: today(), startedAt: Date.now(), tplId: tplId || null, exercises: exercises || [] };
  saveSettings(); closeSheet(true); renderSession(); render();
}
const blankSets = n => Array.from({ length: n }, () => ({ w: null, r: null, done: false }));
A.startBlank = () => { if (D()) return renderSession(); newDraft('Entreno', []); };
A.sessOpen = () => renderSession();
A.sessMin = () => { $('#session').hidden = true; document.body.classList.remove('noscroll'); stopRest(); render(); };

function renderSession() {
  const s = $('#session'), dr = D();
  if (!dr) { s.hidden = true; s.innerHTML = ''; document.body.classList.remove('noscroll'); return; }
  const keep = s.scrollTop;
  s.hidden = false; document.body.classList.add('noscroll');
  s.innerHTML = `<div class="s-wrap">
    <div class="s-top"><button class="link" data-act="sessMin">Minimizar</button><input class="input" id="sname" value="${esc(dr.name)}" aria-label="Nombre del entreno" autocomplete="off"><button class="btn primary sm" data-act="sessFinish">Terminar</button></div>
    ${dr.exercises.map(exBlock).join('') || '<div class="empty" style="text-align:center">Añade tu primer ejercicio.</div>'}
  </div>
  <div class="s-foot"><div class="in"><div id="rest"></div><div class="btns two" style="margin:0"><button class="btn ghost" data-act="addEx">+ Ejercicio</button><button class="btn danger" data-act="sessDiscard">Descartar</button></div></div></div>`;
  s.scrollTop = keep; renderRest(true);
}
function exBlock(ex, i) {
  const prev = lastSets(ex.name);
  const prevTxt = prev.length ? 'Última vez: ' + prev.map(s => `${s.w != null ? inpNum(wOut(s.w)) : '–'}×${s.r != null ? s.r : '–'}`).join(' · ') : 'Primera vez con este ejercicio';
  return `<section class="ex"><header><h3>${esc(ex.name)}</h3></header><p class="prev">${prevTxt}</p>
    <div class="sets"><div class="sh"><span>Serie</span><span>${wUnit()}</span><span>Reps</span><span></span></div>
    ${ex.sets.map((st, j) => { const p = prev[j] || {}; return `<div class="set ${st.done ? 'done' : ''}"><span class="n">${j + 1}</span>
      <input inputmode="decimal" data-f="w" data-ex="${i}" data-set="${j}" value="${st.w != null ? inpNum(wOut(st.w)) : ''}" placeholder="${p.w != null ? inpNum(wOut(p.w)) : wUnit()}" aria-label="Peso, serie ${j + 1}">
      <input inputmode="numeric" data-f="r" data-ex="${i}" data-set="${j}" value="${st.r != null ? st.r : ''}" placeholder="${p.r != null ? p.r : 'reps'}" aria-label="Repeticiones, serie ${j + 1}">
      <button class="chk" data-act="setDone" data-ex="${i}" data-set="${j}" aria-pressed="${!!st.done}" aria-label="Completar serie ${j + 1}">${ICON.check}</button></div>`; }).join('')}
    </div>
    <div class="ex-actions"><button class="link" data-act="addSet" data-ex="${i}">+ Serie</button><button class="link danger" data-act="delEx" data-ex="${i}">Quitar</button></div></section>`;
}
document.addEventListener('input', e => {
  const t = e.target, dr = D();
  if (!dr) return;
  if (t.id === 'sname') { dr.name = t.value; saveSettings(); return; }
  if (t.matches('#session input[data-f]')) {
    const st = dr.exercises[+t.dataset.ex].sets[+t.dataset.set], v = num(t.value);
    if (t.dataset.f === 'w') st.w = v == null ? null : wIn(v); else st.r = v == null ? null : Math.round(v);
    saveSettings();
  }
});
A.setDone = el => {
  const dr = D(), ex = dr.exercises[+el.dataset.ex], j = +el.dataset.set, st = ex.sets[j];
  if (!st.done) {
    const p = lastSets(ex.name)[j] || ex.sets[j - 1] || {};
    if (st.w == null && p.w != null) st.w = p.w;
    if (st.r == null && p.r != null) st.r = p.r;
    st.done = true; startRest();
  } else st.done = false;
  saveSettings(); renderSession();
};
A.addSet = el => { D().exercises[+el.dataset.ex].sets.push({ w: null, r: null, done: false }); saveSettings(); renderSession(); };
A.delEx = el => { if (!confirm('¿Quitar este ejercicio del entreno?')) return; D().exercises.splice(+el.dataset.ex, 1); saveSettings(); renderSession(); };
A.addEx = () => {
  openSheet('Añadir ejercicio', `
    <input id="exq" class="input" type="search" placeholder="Busca o escribe un ejercicio" autocomplete="off">
    <div id="exchips" class="chips"></div>
    <div class="btns"><button class="btn primary" data-act="exTyped">Añadir</button></div>`, {
    onMount: w => {
      const names = knownExercises(), inp = $('#exq', w), box = $('#exchips', w);
      const draw = () => { const q = norm(inp.value); box.innerHTML = names.filter(n => norm(n).includes(q)).slice(0, 24).map(n => `<button class="chip" data-act="exPick" data-arg="${esc(n)}">${esc(n)}</button>`).join(''); };
      inp.addEventListener('input', draw); draw();
    }
  });
};
function addExercise(name) {
  D().exercises.push({ id: uid(), name, sets: blankSets(3) });
  saveSettings(); closeSheet(); renderSession();
  const s = $('#session'); s.scrollTop = s.scrollHeight;
}
A.exPick = el => addExercise(el.dataset.arg);
A.exTyped = () => { const n = $('#exq').value.trim(); if (!n) return toast('Escribe el nombre del ejercicio'); addExercise(n); };

function buildExercises() {
  return D().exercises.map(e => ({ name: e.name, sets: e.sets.filter(s => s.r != null || s.w != null).map(s => ({ w: s.w, r: s.r })) })).filter(e => e.sets.length);
}
A.sessFinish = () => {
  const dr = D(), exs = buildExercises();
  if (!exs.length) return toast('Registra al menos una serie');
  const n = sum(exs, e => e.sets.length), vol = sum(exs, e => sum(e.sets, s => (s.w || 0) * (s.r || 0)));
  openSheet('Terminar entreno', `
    <p class="muted">${pl(exs.length, 'ejercicio', 'ejercicios')} · ${pl(n, 'serie', 'series')} · ${fmt(wOut(vol), 0)} ${wUnit()} de volumen</p>
    <label class="field"><span>Fecha</span><input id="fdate" type="date" class="input" value="${dr.date}" max="${today()}"></label>
    ${dr.tplId ? '' : '<label class="check"><input type="checkbox" id="fsavetpl">Guardar como rutina</label>'}
    <div class="btns"><button class="btn primary" data-act="sessSave">Guardar entreno</button></div>`);
};
A.sessSave = () => {
  const dr = D(), exs = buildExercises();
  const mins = Math.round((Date.now() - dr.startedAt) / 60000);
  const name = (dr.name || '').trim() || 'Entreno';
  save('workouts', { id: uid(), type: 'strength', date: $('#fdate').value || today(), name, exercises: exs, minutes: mins > 0 && mins < 360 ? mins : null, created: Date.now() });
  const chk = $('#fsavetpl');
  if (chk && chk.checked) save('templates', { id: uid(), name, exercises: exs.map(e => ({ name: e.name, sets: e.sets.length })) });
  state.settings.draft = null; saveSettings(); stopRest();
  closeSheet(true); renderSession(); render(); toast('Entreno guardado');
};
A.sessDiscard = () => {
  if (!confirm('¿Descartar este entreno? No se guardará nada.')) return;
  state.settings.draft = null; saveSettings(); stopRest(); renderSession(); render();
};

/* Cronómetro de descanso */
let rest = null, restIv = null, actx = null;
function beep() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.connect(g); g.connect(actx.destination); o.frequency.value = 880; g.gain.value = 0.12;
    o.start(); o.stop(actx.currentTime + 0.25);
  } catch (e) { /* sin sonido */ }
  try { navigator.vibrate && navigator.vibrate(200); } catch (e) { /* nada */ }
}
function startRest() {
  const total = state.settings.rest || 90;
  rest = { end: Date.now() + total * 1000, beeped: false };
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume && actx.resume(); } catch (e) { /* nada */ }
  clearInterval(restIv); restIv = setInterval(tickRest, 250);
}
function stopRest() { rest = null; clearInterval(restIv); renderRest(true); }
function renderRest(full) {
  const el = $('#rest'); if (!el) return;
  if (!rest) { el.innerHTML = ''; return; }
  const left = Math.max(0, Math.ceil((rest.end - Date.now()) / 1000)), done = left === 0;
  if (full || !$('#restT')) {
    el.innerHTML = `<div class="rest" id="restBox"><span id="restL">Descanso</span><b id="restT"></b><span><button class="link" data-act="restAdj" data-arg="-15">−15</button><button class="link" data-act="restAdj" data-arg="15">+15</button><button class="link" data-act="restStop">Saltar</button></span></div>`;
  }
  $('#restT').textContent = `${Math.floor(left / 60)}:${pad(left % 60)}`;
  $('#restL').textContent = done ? 'Listo' : 'Descanso';
  $('#restBox').classList.toggle('end', done);
}
function tickRest() {
  if (!rest) return;
  renderRest(false);
  if (Date.now() >= rest.end) {
    if (!rest.beeped) { rest.beeped = true; beep(); }
    if (Date.now() > rest.end + 5000) stopRest();
  }
}
A.restAdj = el => { if (!rest) return; rest.end += +el.dataset.arg * 1000; rest.beeped = Date.now() >= rest.end; renderRest(false); };
A.restStop = () => stopRest();

/* Rutinas */
const parseLines = txt => txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
  const m = l.match(/^(.*?)(?:\s*[x×]\s*(\d{1,2}))?$/i);
  return { name: (m[1] || l).trim(), sets: clamp(parseInt(m[2] || '3', 10), 1, 12) };
}).filter(e => e.name);
A.tplForm = el => tplForm(el.dataset.id ? state.templates.find(t => t.id === el.dataset.id) : null);
function tplForm(t) {
  openSheet(t ? 'Editar rutina' : 'Nueva rutina', `
    <label class="field"><span>Nombre</span><input id="tn" class="input" value="${esc(t ? t.name : '')}" autocomplete="off"></label>
    <label class="field"><span>Ejercicios, uno por línea. Añade “x4” para fijar las series.</span><textarea id="tx" class="input" placeholder="Press banca x4&#10;Press inclinado x3&#10;Fondos x3">${esc(t ? t.exercises.map(e => `${e.name} x${e.sets}`).join('\n') : '')}</textarea></label>
    <div class="btns"><button class="btn primary" data-act="saveTpl" data-id="${t ? t.id : ''}">Guardar</button></div>`);
}
A.saveTpl = el => {
  const name = $('#tn').value.trim(), exercises = parseLines($('#tx').value);
  if (!name) return toast('Ponle un nombre a la rutina');
  if (!exercises.length) return toast('Añade al menos un ejercicio');
  save('templates', { id: el.dataset.id || uid(), name, exercises }); closeSheet(); render();
};
A.tplOpen = el => {
  const t = state.templates.find(x => x.id === el.dataset.id); if (!t) return;
  openSheet(t.name, `<div class="list">${t.exercises.map(e => `<div class="row"><div class="grow t">${esc(e.name)}</div><div class="r">${pl(e.sets, 'serie', 'series')}</div></div>`).join('')}</div>
    <div class="btns"><button class="btn primary" data-act="tplStart" data-id="${t.id}">Empezar</button><button class="btn ghost" data-act="tplForm" data-id="${t.id}">Editar</button><button class="btn danger" data-act="tplDel" data-id="${t.id}">Eliminar</button></div>`);
};
A.tplStart = el => { const t = state.templates.find(x => x.id === el.dataset.id); if (t) newDraft(t.name, t.exercises.map(e => ({ id: uid(), name: e.name, sets: blankSets(e.sets) })), t.id); };
A.tplDel = el => { if (!confirm('¿Eliminar esta rutina? Tus entrenos guardados no cambian.')) return; remove('templates', el.dataset.id); closeSheet(); render(); };

/* Historial y cardio */
A.wkOpen = el => {
  const w = state.workouts.find(x => x.id === el.dataset.id); if (!w) return;
  if (w.type === 'strength') {
    openSheet(w.name, `<p class="muted">${relDay(w.date)}${w.minutes ? ` · ${w.minutes} min` : ''} · ${fmt(wOut(volume(w)), 0)} ${wUnit()} de volumen</p>
      ${w.exercises.map(e => `<div class="list"><div class="group-h"><h2>${esc(e.name)}</h2></div>${e.sets.map((s, i) => `<div class="row"><div class="grow s">Serie ${i + 1}</div><div class="r">${s.w != null ? inpNum(wOut(s.w)) + ' ' + wUnit() : '–'} × ${s.r != null ? s.r : '–'}</div></div>`).join('')}</div>`).join('')}
      <div class="btns"><button class="btn primary" data-act="wkRepeat" data-id="${w.id}">Repetir este entreno</button><button class="btn danger" data-act="wkDel" data-id="${w.id}">Eliminar</button></div>`, { full: true });
  } else {
    openSheet(w.name, `<div class="list"><div class="row"><div class="grow s">Fecha</div><div class="r">${relDay(w.date)}</div></div>
      <div class="row"><div class="grow s">Duración</div><div class="r">${w.minutes || 0} min</div></div>
      ${w.distanceKm ? `<div class="row"><div class="grow s">Distancia</div><div class="r">${fmt(dOut(w.distanceKm), 2)} ${dUnit()}</div></div>` : ''}
      ${w.note ? `<div class="row"><div class="grow s">Nota</div><div class="r" style="font-family:var(--font);font-weight:500">${esc(w.note)}</div></div>` : ''}</div>
      <div class="btns"><button class="btn danger" data-act="wkDel" data-id="${w.id}">Eliminar</button></div>`);
  }
};
A.wkRepeat = el => { const w = state.workouts.find(x => x.id === el.dataset.id); if (w) newDraft(w.name, w.exercises.map(e => ({ id: uid(), name: e.name, sets: blankSets(e.sets.length) }))); };
A.wkDel = el => { if (!confirm('¿Eliminar este entreno?')) return; remove('workouts', el.dataset.id); closeSheet(); render(); };
A.cardioForm = () => {
  openSheet('Registrar cardio', `
    <label class="field"><span>Fecha</span><input id="cdate" type="date" class="input" value="${today()}" max="${today()}"></label>
    <label class="field"><span>Tipo</span><select id="ctype" class="input">${CARDIO.map(c => `<option>${c}</option>`).join('')}</select></label>
    <div class="grid2">
      <label class="field"><span>Minutos</span><input id="cmin" class="input" inputmode="numeric"></label>
      <label class="field"><span>Distancia (${dUnit()})</span><input id="cdist" class="input" inputmode="decimal"></label>
    </div>
    <label class="field"><span>Nota (opcional)</span><input id="cnote" class="input" autocomplete="off"></label>
    <div class="btns"><button class="btn primary" data-act="saveCardio">Guardar</button></div>`);
};
A.saveCardio = () => {
  const min = num($('#cmin').value), dist = num($('#cdist').value);
  if (!min || min <= 0) return toast('Escribe los minutos');
  save('workouts', { id: uid(), type: 'cardio', date: $('#cdate').value || today(), name: $('#ctype').value, minutes: Math.round(min), distanceKm: dist > 0 ? dIn(dist) : null, note: $('#cnote').value.trim(), created: Date.now() });
  closeSheet(); render(); toast('Cardio guardado');
};

/* ---------- Ajustes y respaldo ---------- */
function applyTheme() {
  const t = state.settings.theme, r = document.documentElement;
  if (t === 'light' || t === 'dark') r.dataset.theme = t; else delete r.dataset.theme;
  $$('meta[name="theme-color"]').forEach(m => {
    if (!m.dataset.orig) m.dataset.orig = m.content;
    m.content = t === 'light' ? '#EEF0F4' : t === 'dark' ? '#0B0E13' : m.dataset.orig;
  });
}
const segHtml = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${state.settings[key] === v ? 'on' : ''}" data-act="seg" data-key="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
A.settings = () => {
  const s = state.settings, v = x => x != null ? esc(x) : '';
  openSheet('Ajustes', `
    <label class="field"><span>Unidades</span></label>${segHtml('units', [['imperial', 'lb · in · mi'], ['metric', 'kg · cm · km']])}
    <label class="field"><span>Tema</span></label>${segHtml('theme', [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']])}
    <div class="grid2">
      <label class="field"><span>Meta de calorías</span><input class="input" inputmode="decimal" data-setting="goalKcal" value="${v(s.goalKcal)}" placeholder="Sin meta"></label>
      <label class="field"><span>Meta de proteína (g)</span><input class="input" inputmode="decimal" data-setting="goalProtein" value="${v(s.goalProtein)}" placeholder="Sin meta"></label>
      <label class="field"><span>Meta de sueño (h)</span><input class="input" inputmode="decimal" data-setting="goalSleep" value="${v(s.goalSleep)}"></label>
      <label class="field"><span>Descanso entre series (s)</span><input class="input" inputmode="numeric" data-setting="rest" value="${v(s.rest)}"></label>
    </div>
    <div class="btns two"><button class="btn ghost" data-act="exportData">Exportar respaldo</button><button class="btn ghost" data-act="importPick">Importar respaldo</button></div>
    <input id="impfile" type="file" accept="application/json,.json" hidden>
    <p class="muted" id="bkinfo" style="margin-top:12px;font-size:14px">${s.lastBackup ? `Último respaldo: ${fmtShort(dstr(new Date(s.lastBackup)))}.` : 'Aún no has hecho un respaldo.'}</p>
    <div class="btns"><button class="btn danger" data-act="wipe">Borrar todos los datos</button></div>
    <p class="muted" style="margin-top:14px;font-size:13px">Todo se guarda solo en este dispositivo. Ritmo no envía nada a internet.</p>`, {
    onMount: w => {
      $('#impfile', w).addEventListener('change', async ev => {
        const f = ev.target.files[0]; if (!f) return;
        try { await importData(JSON.parse(await f.text())); } catch (err) { console.error(err); toast('Ese archivo no es un respaldo válido'); }
      });
    }
  });
};
A.seg = el => {
  state.settings[el.dataset.key] = el.dataset.v;
  $$('button', el.parentElement).forEach(b => b.classList.toggle('on', b === el));
  if (el.dataset.key === 'theme') applyTheme();
  saveSettings(); render();
};
document.addEventListener('change', e => {
  const t = e.target;
  if (!t.dataset || !t.dataset.setting) return;
  const k = t.dataset.setting, v = num(t.value);
  state.settings[k] = v != null && v > 0 ? v : (k === 'goalSleep' ? 8 : k === 'rest' ? 90 : null);
  saveSettings(); render();
});
function markBackup() {
  state.settings.lastBackup = Date.now(); saveSettings();
  const i = $('#bkinfo'); if (i) i.textContent = `Último respaldo: ${fmtShort(today())}.`;
  render();
}
A.exportData = async () => {
  const { draft, ...settings } = state.settings;
  const payload = { app: 'ritmo', version: 1, exportedAt: new Date().toISOString(), data: { foods: state.foods, meals: state.meals, workouts: state.workouts, templates: state.templates, sleep: state.sleep, body: state.body, settings } };
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
  const name = `ritmo-respaldo-${today()}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Respaldo de Ritmo' }); markBackup(); return; }
    catch (err) { if (err && err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); markBackup();
};
A.importPick = () => $('#impfile').click();
async function importData(p) {
  if (!p || p.app !== 'ritmo' || !p.data) throw new Error('formato');
  if (!confirm('Esto reemplaza todos los datos actuales de la app con los del respaldo. ¿Continuar?')) return;
  for (const s of STORES) {
    await dbClear(s);
    state[s] = Array.isArray(p.data[s]) ? p.data[s].filter(x => x && x.id) : [];
    state[s].forEach(x => dbPut(s, x));
  }
  state.settings = { ...DEFAULTS, ...(p.data.settings || {}), draft: D() };
  saveSettings(); applyTheme(); closeSheet(true); render(); toast('Respaldo importado');
}
A.wipe = async () => {
  if (!confirm('Se borrarán todos tus registros de este dispositivo. Esto no se puede deshacer. ¿Continuar?')) return;
  if (!confirm('¿Seguro? Si no tienes un respaldo, no hay forma de recuperarlos.')) return;
  for (const s of STORES) { await dbClear(s); state[s] = []; }
  state.settings = { ...DEFAULTS };
  saveSettings(); stopRest(); applyTheme(); closeSheet(true); renderSession(); render(); toast('Datos borrados');
};

/* ============ Arranque ============ */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (ui.day !== today()) { ui.day = today(); ui.foodDate = today(); }
  if (rest) tickRest();
  if ($('#session').hidden) render();
});

async function boot() {
  try { db = await openDB(); await loadAll(); dbOk = true; }
  catch (err) { console.error(err); dbOk = false; setTimeout(() => toast('No se pudo abrir el almacenamiento: los datos no se guardarán'), 600); }
  ui.day = today();
  applyTheme(); render();
  const dr = D();
  if (dr && Date.now() - dr.startedAt < 12 * 36e5) renderSession();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* nada */ }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err));
  }
}
boot();
