// Control de Vacaciones — local-first (sin servidores).
// Guarda en localStorage y permite exportar/importar JSON.
// Opcional: File System Access API para guardar en un JSON dentro de OneDrive/Drive/iCloud (cuando el navegador lo soporta).

const YEARS = [2026, 2027, 2028, 2029, 2030, 2031];
const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];
const DOW = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

const TYPE_META = {
  vac:   { label: "Vacaciones", cls: "vac" },
  free:  { label: "Libre disposición", cls: "free" },
  tele:  { label: "Teletrabajo", cls: "tele" },
  legal: { label: "Libre disp. legal", cls: "legal" },
};

const STORAGE_KEY = "vacaciones_app_v1";

// Plataforma (iOS usa WebKit y no soporta File System Access API)
const isIOS = (()=>{
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const iPadOS = /Macintosh/.test(ua) && ('ontouchend' in document);
  return iOS || iPadOS;
})();

function showIOSExportHint(show){
  const n = document.getElementById('ios-export-hint');
  if(!n) return;
  n.classList.toggle('hidden', !show);
}

function markIOSDirty(){
  if(isIOS) showIOSExportHint(true);
}

function pad2(n){ return String(n).padStart(2,"0"); }
function toISODate(d){
  // d is Date
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function parseISO(iso){
  // iso YYYY-MM-DD -> Date (local)
  const [y,m,dd] = iso.split("-").map(Number);
  return new Date(y, m-1, dd, 12, 0, 0, 0);
}
function clampYear(y){
  if (!YEARS.includes(y)) return YEARS[0];
  return y;
}

function uid(){
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

// --- Easter + variable holidays (Meeus/Jones/Butcher)
function easterSunday(year){
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19*a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2*e + 2*i - h - k) % 7;
  const m = Math.floor((a + 11*h + 22*l) / 451);
  const month = Math.floor((h + l - 7*m + 114) / 31); // 3=Mar,4=Apr
  const day = ((h + l - 7*m + 114) % 31) + 1;
  return new Date(year, month-1, day, 12, 0, 0, 0);
}

function addDays(date, n){
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

function defaultHolidaysForYear(year){
  // "Set típico" España + Catalunya + Barcelona (editables).
  // IMPORTANTE: los festivos municipales y algunas decisiones autonómicas pueden variar por año/empresa.
  const hol = {};

  const fixed = [
    ["01-01", "Año Nuevo"],
    ["01-06", "Reyes"],
    ["05-01", "Día del Trabajo"],
    ["06-24", "Sant Joan (Catalunya)"],
    ["08-15", "Asunción"],
    ["09-11", "Diada (Catalunya)"],
    ["09-24", "La Mercè (Barcelona)"],
    ["10-12", "Fiesta Nacional de España"],
    ["11-01", "Todos los Santos"],
    ["12-06", "Día de la Constitución"],
    ["12-08", "Inmaculada Concepción"],
    ["12-25", "Navidad"],
    ["12-26", "Sant Esteve (Catalunya)"],
  ];

  fixed.forEach(([mmdd, name]) => {
    hol[`${year}-${mmdd}`] = name;
  });

  const easter = easterSunday(year);
  const goodFriday = addDays(easter, -2);
  const easterMonday = addDays(easter, +1);
  const whitMonday = addDays(easter, +50); // Segona Pasqua / Pentecostés (habitual en BCN)

  hol[toISODate(goodFriday)] = "Viernes Santo";
  hol[toISODate(easterMonday)] = "Lunes de Pascua";
  hol[toISODate(whitMonday)] = "Segunda Pascua (habitual BCN)";

  return hol;
}

function emptyYearQuotas(){
  return { vac: 23, free: 1, tele: 2 };
}

function makeInitialState(){
  const holidays = {};
  const quotas = {};
  YEARS.forEach(y => {
    holidays[y] = defaultHolidaysForYear(y);
    quotas[y] = emptyYearQuotas();
  });

  return {
    version: 1,
    holidays, // {year: {iso: name}}
    quotas,   // {year: {vac, free, tele}}
    entries:  // [{id, type, start, end, days, excluded, note, createdAt, updatedAt}]
      []
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return makeInitialState();
    const s = JSON.parse(raw);
    // basic migration / repair
    if(!s.holidays) s.holidays = {};
    if(!s.quotas) s.quotas = {};
    if(!s.entries) s.entries = [];
    YEARS.forEach(y=>{
      if(!s.holidays[y]) s.holidays[y] = defaultHolidaysForYear(y);
      if(!s.quotas[y]) s.quotas[y] = emptyYearQuotas();
    });
    return s;
  }catch(e){
    console.warn("No se pudo cargar estado, reiniciando.", e);
    return makeInitialState();
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function download(filename, text){
  const blob = new Blob([text], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// File System Access API (Chrome/Edge)
let fileHandle = null;
async function linkFile(){
  if(!window.showSaveFilePicker){
    alert("Tu navegador no soporta 'Vincular archivo'. Usa Exportar/Importar JSON.");
    return;
  }
  try{
    fileHandle = await window.showSaveFilePicker({
      suggestedName: "vacaciones_data.json",
      types: [{ description: "JSON", accept: {"application/json": [".json"]}}],
    });
    document.querySelector("#btn-save-file").disabled = false;
    await saveToActiveFile(); // first save
  }catch(e){
    if(e?.name !== "AbortError") console.error(e);
  }
}
async function saveToActiveFile(opts = {}){
  if(!fileHandle) return;
  try{
    // Intentar pedir permisos (algunos Chromium lo requieren tras reinicios)
    if(fileHandle.requestPermission){
      const perm = await fileHandle.requestPermission({mode:'readwrite'});
      if(perm !== 'granted') throw new Error('Permiso no concedido');
    }
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(state, null, 2));
    await writable.close();
    if(!opts.silent) toast("Guardado ✅");
  }catch(e){
    console.error(e);
    alert("No se pudo guardar en el archivo activo. Usa Exportar JSON.");
  }
}

async function autoSaveIfLinked(){
  // Autoguardado: solo si hay archivo activo y estamos en Windows (no iOS).
  if(!fileHandle || isIOS) return;
  await saveToActiveFile({silent:true});
}


function toast(msg){
  // simple toast
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.position = "fixed";
  t.style.bottom = "18px";
  t.style.left = "50%";
  t.style.transform = "translateX(-50%)";
  t.style.padding = "10px 12px";
  t.style.borderRadius = "999px";
  t.style.background = "rgba(0,0,0,0.55)";
  t.style.border = "1px solid rgba(255,255,255,0.16)";
  t.style.backdropFilter = "blur(10px)";
  t.style.webkitBackdropFilter = "blur(10px)";
  t.style.zIndex = "999";
  document.body.appendChild(t);
  setTimeout(()=> t.remove(), 1800);
}

// --- Business day counting
function isWeekend(date){
  const dow = date.getDay(); // 0 Sun .. 6 Sat
  return dow === 0 || dow === 6;
}

function holidayName(iso){
  const y = Number(iso.slice(0,4));
  return state.holidays?.[y]?.[iso] || null;
}

function isHolidayISO(iso){
  const y = Number(iso.slice(0,4));
  return Boolean(state.holidays?.[y]?.[iso]);
}

function businessDaysBetween(startISO, endISO){
  const s = parseISO(startISO);
  const e = parseISO(endISO);
  if (e < s) return {days:0, excluded:0};
  let days = 0;
  let excluded = 0;
  const d = new Date(s.getTime());
  while(d <= e){
    const iso = toISODate(d);
    const weekend = isWeekend(d);
    const holiday = isHolidayISO(iso);
    if(!weekend && !holiday) days++;
    else excluded++;
    d.setDate(d.getDate()+1);
  }
  return {days, excluded};
}

// --- UI Elements
const el = (sel) => document.querySelector(sel);

function showWinAutosaveHint(show){
  const n = document.getElementById("win-autosave-hint");
  if(!n) return;
  n.classList.toggle("hidden", !show);
}


const yearSel = el("#year");
const monthSel = el("#month");
const cal = el("#calendar");
const calTitle = el("#cal-title");
const calSubtitle = el("#cal-subtitle");
const entriesEl = el("#entries");
const searchEl = el("#search");

const typeEl = el("#type");
const startEl = el("#start");
const endEl = el("#end");
const noteEl = el("#note");
const chipCount = el("#chip-count");
const chipExcluded = el("#chip-excluded");
const btnAdd = el("#btn-add");
const btnCancel = el("#btn-cancel");
const btnDelete = el("#btn-delete");

const qVacUsed = el("#q-vac-used");
const qVacTotal = el("#q-vac-total");
const qVacLeft = el("#q-vac-left");
const qFreeUsed = el("#q-free-used");
const qFreeTotal = el("#q-free-total");
const qFreeLeft = el("#q-free-left");
const qTeleUsed = el("#q-tele-used");
const qTeleTotal = el("#q-tele-total");
const qTeleLeft = el("#q-tele-left");
const qLegalUsed = el("#q-legal-used");

const setVac = el("#set-vac");
const setFree = el("#set-free");
const setTele = el("#set-tele");

const hDate = el("#h-date");
const hName = el("#h-name");
const holidayList = el("#holiday-list");

const helpDlg = el("#help");

let state = loadState();

let selectedStart = null;
let selectedEnd = null;
let editingId = null;

// --- Populate selectors
function initSelectors(){
  yearSel.innerHTML = YEARS.map(y => `<option value="${y}">${y}</option>`).join("");
  monthSel.innerHTML = MONTHS.map((m,i) => `<option value="${i}">${m}</option>`).join("");
  const now = new Date();
  const defaultYear = YEARS.includes(now.getFullYear()) ? now.getFullYear() : YEARS[0];
  yearSel.value = defaultYear;
  monthSel.value = String(now.getMonth());
}

function currentYear(){ return Number(yearSel.value); }
function currentMonth(){ return Number(monthSel.value); }

function setFormDates(startISO, endISO){
  startEl.value = startISO || "";
  endEl.value = endISO || "";
  updateCountChips();
}

function clearSelection(){
  selectedStart = null;
  selectedEnd = null;
  setFormDates("", "");
  renderCalendar();
}

function updateCountChips(){
  const s = startEl.value;
  const e = endEl.value;
  if(!s || !e){
    chipCount.textContent = "0 días laborables";
    chipExcluded.textContent = "0 excluidos";
    return;
  }
  const {days, excluded} = businessDaysBetween(s,e);
  chipCount.textContent = `${days} día${days===1?"":"s"} laborable${days===1?"":"s"}`;
  chipExcluded.textContent = `${excluded} excluido${excluded===1?"":"s"}`;
}

function quotasForYear(y){
  return state.quotas?.[y] || emptyYearQuotas();
}

function usedDaysForYear(y){
  const used = { vac:0, free:0, tele:0, legal:0 };
  state.entries.forEach(en=>{
    const year = Number(en.start.slice(0,4));
    if(year !== y) return;
    used[en.type] += Number(en.days || 0);
  });
  return used;
}

function renderQuotas(){
  const y = currentYear();
  const q = quotasForYear(y);
  const u = usedDaysForYear(y);

  qVacTotal.textContent = q.vac;
  qFreeTotal.textContent = q.free;
  qTeleTotal.textContent = q.tele;

  qVacUsed.textContent = u.vac;
  qFreeUsed.textContent = u.free;
  qTeleUsed.textContent = u.tele;
  qLegalUsed.textContent = u.legal;

  qVacLeft.textContent = `${Math.max(0, q.vac - u.vac)} restantes`;
  qFreeLeft.textContent = `${Math.max(0, q.free - u.free)} restante${(q.free - u.free)===1? "":"s"}`;
  qTeleLeft.textContent = `${Math.max(0, q.tele - u.tele)} restantes`;

  setVac.value = q.vac;
  setFree.value = q.free;
  setTele.value = q.tele;
}

function monthLabel(y,m){
  return `${MONTHS[m]} ${y}`;
}

function startOfMonthGrid(y,m){
  // We want grid Monday..Sunday
  const first = new Date(y, m, 1, 12,0,0,0);
  // convert JS Sunday=0..; we want Monday=0..6
  const jsDow = first.getDay(); // 0 Sun, 1 Mon
  const mondayBased = (jsDow + 6) % 7; // Mon=0..Sun=6
  const gridStart = new Date(first.getTime());
  gridStart.setDate(first.getDate() - mondayBased);
  return gridStart;
}

function entriesForMonth(y,m){
  // Show entries that overlap month
  const startMonth = new Date(y,m,1,12,0,0,0);
  const endMonth = new Date(y,m+1,0,12,0,0,0);

  return state.entries.filter(en=>{
    const s = parseISO(en.start);
    const e = parseISO(en.end);
    return !(e < startMonth || s > endMonth);
  });
}

function buildDayMap(y,m){
  // Map iso -> {types:Set, holidayName, isWeekend, countEntries}
  const map = {};
  const gridStart = startOfMonthGrid(y,m);
  for(let i=0;i<42;i++){
    const d = addDays(gridStart,i);
    const iso = toISODate(d);
    const types = new Set();
    entriesForMonth(y,m).forEach(en=>{
      if(en.start <= iso && iso <= en.end){
        types.add(en.type);
      }
    });
    map[iso] = {
      iso,
      types,
      holiday: holidayName(iso),
      weekend: isWeekend(d),
      month: d.getMonth(),
      day: d.getDate(),
      y: d.getFullYear()
    };
  }
  return map;
}

function renderCalendar(){
  const y = currentYear();
  const m = currentMonth();

  calTitle.textContent = monthLabel(y,m);

  const holCount = Object.keys(state.holidays?.[y] || {}).filter(iso=> iso.slice(0,7) === `${y}-${pad2(m+1)}`).length;
  calSubtitle.textContent = `Festivos en el mes: ${holCount} · Selección: ${selectedStart ? selectedStart : "—"} ${selectedEnd ? "→ " + selectedEnd : ""}`;

  const dayMap = buildDayMap(y,m);

  cal.innerHTML = DOW.map(d => `<div class="dow">${d}</div>`).join("");

  const gridStart = startOfMonthGrid(y,m);
  for(let i=0;i<42;i++){
    const d = addDays(gridStart,i);
    const iso = toISODate(d);
    const info = dayMap[iso];
    const other = info.month !== m ? "other" : "";
    const weekend = info.weekend ? "weekend" : "";
    const sel = (selectedStart && selectedEnd && iso >= selectedStart && iso <= selectedEnd) ||
                (selectedStart && !selectedEnd && iso === selectedStart) ? "selected" : "";

    const dots = [];
    if(info.holiday) dots.push(`<span class="dot hol" title="${escapeHtml(info.holiday)}"></span>`);
    // show at most 3 dots for entries; if multiple types, show distinct
    for(const t of info.types){
      dots.push(`<span class="dot ${TYPE_META[t].cls}" title="${TYPE_META[t].label}"></span>`);
    }

    const badge = info.holiday ? `<span class="badge">Festivo</span>` : "";

    cal.insertAdjacentHTML("beforeend", `
      <div class="day ${other} ${weekend} ${sel}" data-iso="${iso}" title="${info.holiday ? escapeHtml(info.holiday) : ""}">
        <div class="num">${info.day}</div>
        ${badge}
        <div class="meta">${dots.slice(0,4).join("")}</div>
      </div>
    `);
  }

  cal.querySelectorAll(".day").forEach(node=>{
    node.addEventListener("click", ()=> onDayClick(node.dataset.iso));
  });
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function onDayClick(iso){
  // Limit selection to year range
  const y = Number(iso.slice(0,4));
  if(!YEARS.includes(y)){
    toast("Fuera del rango 2026–2031");
    return;
  }

  if(editingId){
    // When editing, just set range quickly
    selectedStart = iso;
    selectedEnd = iso;
    startEl.value = iso;
    endEl.value = iso;
    updateCountChips();
    renderCalendar();
    return;
  }

  if(!selectedStart){
    selectedStart = iso;
    selectedEnd = null;
  }else if(!selectedEnd){
    if(iso < selectedStart){
      selectedEnd = selectedStart;
      selectedStart = iso;
    }else{
      selectedEnd = iso;
    }
    startEl.value = selectedStart;
    endEl.value = selectedEnd;
    updateCountChips();
  }else{
    // reset
    selectedStart = iso;
    selectedEnd = null;
  }

  renderCalendar();
}

function renderEntries(){
  const y = currentYear();
  const needle = (searchEl.value || "").trim().toLowerCase();

  let list = state.entries
    .filter(en => {
      const sy = Number(en.start.slice(0,4));
      const ey = Number(en.end.slice(0,4));
      return sy <= y && y <= ey;
    })
    .sort((a,b)=> a.start.localeCompare(b.start));

  if(needle){
    list = list.filter(en => (en.note || "").toLowerCase().includes(needle));
  }

  if(list.length === 0){
    entriesEl.innerHTML = `<div class="muted small">No hay registros en este año.</div>`;
    return;
  }

  entriesEl.innerHTML = list.map(en=>{
    const meta = TYPE_META[en.type];
    const range = en.start === en.end ? en.start : `${en.start} → ${en.end}`;
    const note = en.note ? escapeHtml(en.note) : "";
    const holNote = (en.excluded ?? 0) > 0 ? ` · ${en.excluded} excl.` : "";
    return `
      <div class="entry" data-id="${en.id}">
        <div>
          <div class="line1">
            <span class="tag ${meta.cls}">${meta.label}</span>
            <span class="range">${range}</span>
            <span class="muted small">${en.days} laborables${holNote}</span>
          </div>
          ${note ? `<div class="note">${note}</div>` : ``}
        </div>
        <div class="muted small">${(en.updatedAt||en.createdAt||"").slice(0,10)}</div>
      </div>
    `;
  }).join("");

  entriesEl.querySelectorAll(".entry").forEach(node=>{
    node.addEventListener("click", ()=> startEdit(node.dataset.id));
  });
}

function startEdit(id){
  const en = state.entries.find(e=> e.id === id);
  if(!en) return;
  editingId = id;
  typeEl.value = en.type;
  startEl.value = en.start;
  endEl.value = en.end;
  noteEl.value = en.note || "";
  selectedStart = en.start;
  selectedEnd = en.end;
  updateCountChips();

  btnAdd.textContent = "Guardar cambios";
  btnCancel.hidden = false;
  btnDelete.hidden = false;

  // jump to month of start
  const y = clampYear(Number(en.start.slice(0,4)));
  const m = Number(en.start.slice(5,7)) - 1;
  yearSel.value = y;
  monthSel.value = m;

  renderAll();

// Mini aviso (Windows Chrome) si no hay archivo vinculado
showWinAutosaveHint(!!window.showOpenFilePicker && !fileHandle && !isIOS);
}

function stopEdit(){
  editingId = null;
  btnAdd.textContent = "Guardar registro";
  btnCancel.hidden = true;
  btnDelete.hidden = true;
  noteEl.value = "";
  typeEl.value = "vac";
  clearSelection();
}

function validateRange(){
  const s = startEl.value;
  const e = endEl.value;
  if(!s || !e) return {ok:false, msg:"Selecciona inicio y fin."};
  const ys = Number(s.slice(0,4));
  const ye = Number(e.slice(0,4));
  if(!YEARS.includes(ys) || !YEARS.includes(ye)) return {ok:false, msg:"Rango fuera de 2026–2031."};
  if(e < s) return {ok:false, msg:"El fin no puede ser anterior al inicio."};
  return {ok:true};
}

function upsertEntry(){
  const v = validateRange();
  if(!v.ok){ alert(v.msg); return; }

  const type = typeEl.value;
  const start = startEl.value;
  const end = endEl.value;
  const note = noteEl.value.trim();

  const {days, excluded} = businessDaysBetween(start,end);

  if(days === 0){
    const proceed = confirm("Este rango no tiene días laborables (todo fines de semana/festivos). ¿Guardar igualmente?");
    if(!proceed) return;
  }

  const now = new Date().toISOString();

  if(editingId){
    const idx = state.entries.findIndex(e=> e.id === editingId);
    if(idx >= 0){
      state.entries[idx] = {...state.entries[idx], type, start, end, note, days, excluded, updatedAt: now};
    }
    toast("Cambios guardados ✅");
  }else{
    state.entries.push({
      id: uid(),
      type, start, end, note, days, excluded,
      createdAt: now,
      updatedAt: now,
    });
    toast("Registro guardado ✅");
  }

  saveState();
  markIOSDirty();
  // Si el usuario vinculó un JSON (Windows Chrome/Edge), autoguardamos.
  autoSaveIfLinked();
  renderAll();

// Mini aviso (Windows Chrome) si no hay archivo vinculado
showWinAutosaveHint(!!window.showOpenFilePicker && !fileHandle && !isIOS);
}

function deleteEntry(){
  if(!editingId) return;
  const en = state.entries.find(e=> e.id === editingId);
  if(!en) return;
  const ok = confirm("¿Eliminar este registro?");
  if(!ok) return;
  state.entries = state.entries.filter(e=> e.id !== editingId);
  saveState();
  markIOSDirty();
  autoSaveIfLinked();
  toast("Eliminado 🗑️");
  stopEdit();
  renderAll();

// Mini aviso (Windows Chrome) si no hay archivo vinculado
showWinAutosaveHint(!!window.showOpenFilePicker && !fileHandle && !isIOS);
}

function renderHolidayList(){
  const y = currentYear();
  const hol = state.holidays?.[y] || {};
  const list = Object.entries(hol)
    .sort((a,b)=> a[0].localeCompare(b[0]))
    .map(([iso,name])=>{
      return `
      <div class="hitem">
        <div>
          <div class="hdate">${iso}</div>
          <div class="hname">${escapeHtml(name)}</div>
        </div>
        <button data-iso="${iso}" title="Quitar">Quitar</button>
      </div>`;
    }).join("");

  holidayList.innerHTML = list || `<div class="muted small">No hay festivos cargados para este año.</div>`;

  holidayList.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const iso = btn.dataset.iso;
      delete state.holidays[y][iso];
      saveState();
      autoSaveIfLinked();
      renderAll();

// Mini aviso (Windows Chrome) si no hay archivo vinculado
showWinAutosaveHint(!!window.showOpenFilePicker && !fileHandle && !isIOS);
    });
  });
}

function addHoliday(){
  const iso = hDate.value;
  const name = (hName.value || "").trim();
  if(!iso){ alert("Elige una fecha."); return; }
  const y = Number(iso.slice(0,4));
  if(!YEARS.includes(y)){ alert("Festivo fuera del rango 2026–2031."); return; }
  if(!name){ alert("Escribe un nombre."); return; }
  if(!state.holidays[y]) state.holidays[y] = {};
  state.holidays[y][iso] = name;
  hDate.value = "";
  hName.value = "";
  saveState();
  autoSaveIfLinked();
  toast("Festivo añadido ✅");
  renderAll();

// Mini aviso (Windows Chrome) si no hay archivo vinculado
showWinAutosaveHint(!!window.showOpenFilePicker && !fileHandle && !isIOS);
}

function resetHolidaysForYear(){
  const y = currentYear();
  const ok = confirm("Esto restaurará el listado por defecto de este año (se perderán tus cambios). ¿Continuar?");
  if(!ok) return;
  state.holidays[y] = defaultHolidaysForYear(y);
  saveState();
  autoSaveIfLinked();
  toast("Festivos restaurados ✅");
  renderAll();

// Mini aviso (Windows Chrome) si no hay archivo vinculado
showWinAutosaveHint(!!window.showOpenFilePicker && !fileHandle && !isIOS);
}

function saveQuotas(){
  const y = currentYear();
  const vac = Math.max(0, Number(setVac.value || 0));
  const free = Math.max(0, Number(setFree.value || 0));
  const tele = Math.max(0, Number(setTele.value || 0));
  state.quotas[y] = { vac, free, tele };
  saveState();
  autoSaveIfLinked();
  toast("Cupos guardados ✅");
  renderAll();

// Mini aviso (Windows Chrome) si no hay archivo vinculado
showWinAutosaveHint(!!window.showOpenFilePicker && !fileHandle && !isIOS);
}

function renderAll(){
  renderCalendar();
  renderEntries();
  renderQuotas();
  renderHolidayList();
  updateCountChips();
}

// --- Export / Import
function exportJSON(){
  // En Windows (Chrome/Edge): si hay archivo activo, guardamos directamente ahí.
  if(fileHandle && !isIOS && window.showOpenFilePicker){
    saveToActiveFile({silent:false});
    return;
  }
  // En iPhone/iPad o sin archivo activo: descarga para guardar manualmente en iCloud.
  download("vacaciones_data.json", JSON.stringify(state, null, 2));
  if(isIOS) toast("Guárdalo en iCloud y sobrescribe ✅");
}

function exportJSONFixedForICloud(){
  // Para iPhone/iPad/Safari lo más sencillo es exportar siempre con el mismo nombre,
  // guardarlo en iCloud Drive y sobrescribirlo.
  download("vacaciones_data.json", JSON.stringify(state, null, 2));
  toast("En iPhone/iPad: guárdalo en iCloud y sobrescribe ✅");
}

async function quickWindowsSync(){
  if(!window.showSaveFilePicker){
    alert("Este atajo necesita Chrome/Edge con soporte de 'Vincular archivo'. Usa Exportar/Importar JSON.");
    return;
  }
  if(!fileHandle){
    await linkFile();
    toast("Archivo vinculado · Autoguardado activo ✅");
  }else{
    await saveToActiveFile();
  }
}

function importJSONFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const s = JSON.parse(reader.result);
      if(!s || typeof s !== "object") throw new Error("JSON inválido");
      if(!s.entries) s.entries = [];
      if(!s.holidays) s.holidays = {};
      if(!s.quotas) s.quotas = {};
      YEARS.forEach(y=>{
        if(!s.holidays[y]) s.holidays[y] = defaultHolidaysForYear(y);
        if(!s.quotas[y]) s.quotas[y] = emptyYearQuotas();
      });
      state = s;
      saveState();
      autoSaveIfLinked();
      toast("Importado ✅");
      stopEdit();
      renderAll();
      // En iOS el usuario debe exportar manualmente si modifica
      showIOSExportHint(false);
      // Aviso Windows: si no hay archivo activo, pedir import
      showWinAutosaveHint(!!window.showOpenFilePicker && !fileHandle && !isIOS);
    }catch(e){
      console.error(e);
      alert("No se pudo importar. Asegúrate de que sea un JSON exportado por esta app.");
    }
  };
  reader.readAsText(file);
}

async function importJSONFromPicker(){
  if(!window.showOpenFilePicker || isIOS){
    // iOS u otros: usar selector tradicional
    document.getElementById('file-import')?.click();
    return;
  }
  try{
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      multiple: false,
    });
    if(!handle) return;
    // Pedimos permiso lectura (y luego lectura/escritura para autoguardado)
    if(handle.requestPermission){
      const perm = await handle.requestPermission({mode:'readwrite'});
      if(perm !== 'granted'){
        const perm2 = await handle.requestPermission({mode:'read'});
        if(perm2 !== 'granted') throw new Error('Permiso no concedido');
      }
    }
    const file = await handle.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text);
    // Validar/migrar usando misma ruta
    if(!parsed || typeof parsed !== 'object') throw new Error('JSON inválido');
    if(!parsed.entries) parsed.entries = [];
    if(!parsed.holidays) parsed.holidays = {};
    if(!parsed.quotas) parsed.quotas = {};
    YEARS.forEach(y=>{
      if(!parsed.holidays[y]) parsed.holidays[y] = defaultHolidaysForYear(y);
      if(!parsed.quotas[y]) parsed.quotas[y] = emptyYearQuotas();
    });
    state = parsed;
    fileHandle = handle; // archivo activo → autoguardado
    saveState();
    await autoSaveIfLinked();
    toast('Importado · Autoguardado activo ✅');
    stopEdit();
    renderAll();
    showWinAutosaveHint(false);
  }catch(e){
    if(e?.name !== 'AbortError') console.error(e);
  }
}

// --- Events
function wireEvents(){
  yearSel.addEventListener("change", ()=>{
    stopEdit();
    renderAll();

// Mini aviso (Windows Chrome) si no hay archivo vinculado
showWinAutosaveHint(!!window.showOpenFilePicker && !fileHandle && !isIOS);
  });
  monthSel.addEventListener("change", ()=>{
    stopEdit();
    renderAll();

// Mini aviso (Windows Chrome) si no hay archivo vinculado
showWinAutosaveHint(!!window.showOpenFilePicker && !fileHandle && !isIOS);
  });

  startEl.addEventListener("change", ()=>{
    selectedStart = startEl.value || null;
    selectedEnd = endEl.value || null;
    updateCountChips();
    renderCalendar();
  });
  endEl.addEventListener("change", ()=>{
    selectedStart = startEl.value || null;
    selectedEnd = endEl.value || null;
    updateCountChips();
    renderCalendar();
  });
  typeEl.addEventListener("change", updateCountChips);

  btnAdd.addEventListener("click", upsertEntry);
  btnCancel.addEventListener("click", stopEdit);
  btnDelete.addEventListener("click", deleteEntry);

  el("#btn-export").addEventListener("click", exportJSON);
  el("#btn-import").addEventListener("click", importJSONFromPicker);
  el("#file-import").addEventListener("change", (ev)=>{
    const f = ev.target.files?.[0];
    if(f) importJSONFile(f);
    ev.target.value = "";
  });

  
  

  // Atajos por plataforma
  
  

  el("#btn-add-holiday").addEventListener("click", addHoliday);
  el("#btn-reset-holidays").addEventListener("click", resetHolidaysForYear);

  el("#btn-save-quotas").addEventListener("click", saveQuotas);

  searchEl.addEventListener("input", renderEntries);

  // Help
  el("#btn-help").addEventListener("click", ()=> helpDlg.showModal());
  el("#btn-close-help").addEventListener("click", ()=> helpDlg.close());

  // live chips
  [startEl,endEl].forEach(x=> x.addEventListener("input", updateCountChips));
}

// init
initSelectors();
wireEvents();
renderAll();

// Mini aviso (Windows Chrome) si no hay archivo vinculado
showWinAutosaveHint(!!window.showOpenFilePicker && !fileHandle && !isIOS);

