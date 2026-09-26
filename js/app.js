/* app.js — Thuisinventaris
 * Alle data blijft lokaal in de browser (IndexedDB). Geen server nodig.
 */
(function(){
'use strict';

const state = {
  locaties: [],
  spullen: [],
  view: 'dashboard',
  locDetailId: null,
  tagFilter: new Set(),
  zoekterm: '',
  editingLocId: null,
  nieuweLocParent: null,
  editingItemId: null,
  itemFotoData: null,
  uitleenItemId: null,
  scanStream: null,
};

const QR_PREFIX = 'THUISINVENTARIS-LOCATIE:';

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const viewRoot = () => $('#view-root');

function h(html){
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------------- Data helpers ---------------- */
function children(parentId){
  return state.locaties.filter(l => (l.parentId || null) === (parentId || null))
    .sort((a,b) => a.naam.localeCompare(b.naam));
}
function loc(id){ return state.locaties.find(l => l.id === id); }
function itemsIn(locId){ return state.spullen.filter(i => i.locatieId === locId); }
function itemCountRecursive(locId){
  let n = itemsIn(locId).length;
  children(locId).forEach(c => n += itemCountRecursive(c.id));
  return n;
}
function path(locId){
  const out = [];
  let cur = loc(locId);
  while(cur){ out.unshift(cur); cur = cur.parentId ? loc(cur.parentId) : null; }
  return out;
}
function pathString(locId){
  return path(locId).map(l => l.naam).join(' › ') || '—';
}
function allTags(){
  const s = new Set();
  state.spullen.forEach(i => (i.tags||[]).forEach(t => s.add(t)));
  return Array.from(s).sort();
}
function daysUntil(dateStr){
  if(!dateStr) return null;
  const ms = new Date(dateStr+'T00:00:00') - new Date(new Date().toDateString());
  return Math.round(ms / 86400000);
}

/* ---------------- Persistentie ---------------- */
async function laadAlles(){
  state.locaties = await DB.getAll('locaties');
  state.spullen = await DB.getAll('spullen');
}
async function saveLoc(l){ await DB.put('locaties', l); await laadAlles(); }
async function saveItem(i){ await DB.put('spullen', i); await laadAlles(); }
async function deleteLocCascade(id){
  for(const c of children(id)) await deleteLocCascade(c.id);
  for(const it of itemsIn(id)) await DB.delete('spullen', it.id);
  await DB.delete('locaties', id);
  await laadAlles();
}
async function deleteItem(id){ await DB.delete('spullen', id); await laadAlles(); }

/* ---------------- Navigatie ---------------- */
function switchView(view, opts={}){
  state.view = view;
  if(view === 'locatie-detail') state.locDetailId = opts.locId;
  $$('.nav-item').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
  const titels = {
    dashboard:'Overzicht', locaties:'Locaties', spullen:'Spullen', zoeken:'Zoeken',
    scannen:'QR scannen', uitleen:'Uitleen', instellingen:'Instellingen',
    'locatie-detail': view==='locatie-detail' && opts.locId ? loc(opts.locId)?.naam || 'Locatie' : 'Locatie'
  };
  $('#view-title').textContent = titels[view] || '';
  render();
}

function render(){
  const root = viewRoot();
  root.innerHTML = '';
  const fns = {
    dashboard: renderDashboard, locaties: renderLocaties, 'locatie-detail': renderLocatieDetail,
    spullen: renderSpullen, zoeken: renderZoeken, scannen: renderScannenView,
    uitleen: renderUitleen, instellingen: renderInstellingen,
  };
  (fns[state.view] || renderDashboard)(root);
}

/* ---------------- Dashboard ---------------- */
function renderDashboard(root){
  const totalItems = state.spullen.length;
  const totalLocs = state.locaties.length;
  const uitgeleend = state.spullen.filter(i => i.uitgeleendAan);
  const vervalt = state.spullen
    .filter(i => i.vervaldatum)
    .map(i => ({item:i, dagen: daysUntil(i.vervaldatum)}))
    .filter(x => x.dagen <= 30)
    .sort((a,b) => a.dagen - b.dagen);

  root.append(h(`
    <div>
      <div class="stat-row">
        <div class="stat-card"><div class="num">${totalItems}</div><div class="lbl">Voorwerpen</div></div>
        <div class="stat-card"><div class="num">${totalLocs}</div><div class="lbl">Locaties</div></div>
        <div class="stat-card"><div class="num">${uitgeleend.length}</div><div class="lbl">Uitgeleend</div></div>
        <div class="stat-card"><div class="num">${vervalt.length}</div><div class="lbl">Verloopt binnenkort</div></div>
      </div>
    </div>
  `));

  const vervalSectie = h(`<div class="section-title">Verloopt binnenkort</div>`);
  root.append(vervalSectie);
  if(vervalt.length === 0){
    root.append(h(`<div class="empty-state"><p>Niets dat binnenkort verloopt.</p></div>`));
  } else {
    const list = h(`<div class="alert-list"></div>`);
    vervalt.forEach(({item, dagen}) => {
      const tekst = dagen < 0 ? `${Math.abs(dagen)} dag(en) verlopen` : dagen === 0 ? 'Verloopt vandaag' : `Nog ${dagen} dag(en)`;
      const row = h(`
        <div class="alert-row ${dagen>7?'warn':''}">
          <div style="flex:1">
            <strong>${esc(item.naam)}</strong>
            <span class="meta">${esc(pathString(item.locatieId))}</span>
          </div>
          <span class="meta">${tekst}</span>
        </div>
      `);
      list.append(row);
    });
    root.append(list);
  }

  root.append(h(`<div class="section-title">Uitgeleend</div>`));
  if(uitgeleend.length === 0){
    root.append(h(`<div class="empty-state"><p>Je hebt momenteel niets uitstaan.</p></div>`));
  } else {
    const list = h(`<div class="alert-list"></div>`);
    uitgeleend.forEach(item => {
      list.append(h(`
        <div class="alert-row warn">
          <div style="flex:1"><strong>${esc(item.naam)}</strong> <span class="meta">bij ${esc(item.uitgeleendAan)}</span></div>
          <span class="meta">sinds ${esc(item.uitleenDatum||'')}</span>
        </div>
      `));
    });
    root.append(list);
  }

  if(totalItems === 0 && totalLocs === 0){
    root.append(h(`
      <div class="empty-state" style="margin-top:24px">
        <p><strong>Nog leeg hier.</strong> Maak eerst een paar locaties aan (zolder, garage, kast…) en voeg dan je eerste voorwerp toe.</p>
        <button class="btn btn-accent" id="dash-start-loc">+ Eerste locatie aanmaken</button>
      </div>
    `));
    $('#dash-start-loc', root)?.addEventListener('click', () => openLocatieModal(null, null));
  }
}

/* ---------------- Locaties ---------------- */
function renderLocatieRow(l, depth){
  const row = h(`
    <div class="loc-node">
      <div class="loc-row">
        <span class="loc-naam">${'　'.repeat(0)}${esc(l.naam)}</span>
        <span class="loc-count">${itemCountRecursive(l.id)} item(s)</span>
        <button class="btn btn-ghost btn-sm" data-act="qr">QR</button>
        <button class="btn btn-ghost btn-sm" data-act="edit">Bewerken</button>
        <button class="btn btn-danger btn-sm" data-act="del">Verwijderen</button>
      </div>
      <div class="loc-children"></div>
    </div>
  `);
  $('.loc-naam', row).addEventListener('click', () => switchView('locatie-detail', {locId: l.id}));
  row.querySelector('[data-act="qr"]').addEventListener('click', () => openQrModal(l.id));
  row.querySelector('[data-act="edit"]').addEventListener('click', () => openLocatieModal(l.id));
  row.querySelector('[data-act="del"]').addEventListener('click', () => bevestigVerwijderLocatie(l.id));
  const childWrap = $('.loc-children', row);
  const kids = children(l.id);
  if(kids.length === 0){ childWrap.remove(); }
  else kids.forEach(k => childWrap.append(renderLocatieRow(k, depth+1)));
  return row;
}

function renderLocaties(root){
  root.append(h(`
    <div class="section-title">
      Al je ruimtes en opbergplekken
      <button class="btn btn-accent btn-sm" id="btn-nieuwe-hoofdlocatie">+ Nieuwe hoofdruimte</button>
    </div>
  `));
  $('#btn-nieuwe-hoofdlocatie', root).addEventListener('click', () => openLocatieModal(null, null));

  const top = children(null);
  if(top.length === 0){
    root.append(h(`<div class="empty-state"><p>Nog geen locaties. Begin bijvoorbeeld met "Zolder", "Garage" of "Kast gang".</p></div>`));
    return;
  }
  const tree = h(`<div class="loc-tree"></div>`);
  top.forEach(l => tree.append(renderLocatieRow(l, 0)));
  root.append(tree);
}

async function bevestigVerwijderLocatie(id){
  const n = itemCountRecursive(id);
  const msg = n > 0
    ? `Deze locatie (en eventuele sublocaties) bevat ${n} voorwerp(en). Alles hierin wordt ook verwijderd. Doorgaan?`
    : 'Deze locatie verwijderen?';
  if(!confirm(msg)) return;
  await deleteLocCascade(id);
  if(state.locDetailId === id) switchView('locaties'); else render();
}

function renderLocatieDetail(root){
  const l = loc(state.locDetailId);
  if(!l){ switchView('locaties'); return; }
  const crumbs = path(l.id).map(p => `<span>${esc(p.naam)}</span>`).join('');
  root.append(h(`<div class="breadcrumb">${crumbs}</div>`));
  if(l.notitie){
    root.append(h(`<p class="hint" style="margin-bottom:16px">${esc(l.notitie)}</p>`));
  }

  root.append(h(`
    <div class="section-title">
      Acties
      <div style="display:flex; gap:8px">
        <button class="btn btn-ghost btn-sm" id="btn-loc-qr">QR-code</button>
        <button class="btn btn-ghost btn-sm" id="btn-loc-edit">Bewerken</button>
        <button class="btn btn-danger btn-sm" id="btn-loc-del">Verwijderen</button>
      </div>
    </div>
  `));
  $('#btn-loc-qr', root).addEventListener('click', () => openQrModal(l.id));
  $('#btn-loc-edit', root).addEventListener('click', () => openLocatieModal(l.id));
  $('#btn-loc-del', root).addEventListener('click', () => bevestigVerwijderLocatie(l.id));

  root.append(h(`
    <div class="section-title">
      Sublocaties
      <button class="btn btn-accent btn-sm" id="btn-nieuwe-subloc">+ Subplek toevoegen</button>
    </div>
  `));
  $('#btn-nieuwe-subloc', root).addEventListener('click', () => openLocatieModal(null, l.id));
  const kids = children(l.id);
  if(kids.length === 0){
    root.append(h(`<div class="empty-state"><p>Geen sublocaties.</p></div>`));
  } else {
    const tree = h(`<div class="loc-tree"></div>`);
    kids.forEach(k => tree.append(renderLocatieRow(k, 0)));
    root.append(tree);
  }

  root.append(h(`
    <div class="section-title">
      Voorwerpen hier
      <button class="btn btn-accent btn-sm" id="btn-nieuw-item-hier">+ Voorwerp hier toevoegen</button>
    </div>
  `));
  $('#btn-nieuw-item-hier', root).addEventListener('click', () => openItemModal(null, l.id));
  const items = itemsIn(l.id);
  if(items.length === 0){
    root.append(h(`<div class="empty-state"><p>Nog geen voorwerpen direct in deze locatie.</p></div>`));
  } else {
    const grid = h(`<div class="item-grid"></div>`);
    items.forEach(i => grid.append(renderItemCard(i)));
    root.append(grid);
  }
}

/* ---------------- Item card (herbruikt) ---------------- */
function renderItemCard(item){
  const dagen = daysUntil(item.vervaldatum);
  const card = h(`
    <div class="item-card">
      <div class="item-thumb">${item.foto ? `<img src="${item.foto}" alt="">` : '📦'}</div>
      <div class="item-body">
        ${item.uitgeleendAan ? `<span class="badge-uitgeleend">Bij ${esc(item.uitgeleendAan)}</span>` : ''}
        ${(dagen!==null && dagen<=30) ? `<span class="badge-vervalt">${dagen<0?'Verlopen':'Verloopt: '+item.vervaldatum}</span>` : ''}
        <span class="naam">${esc(item.naam)}${item.aantal>1?` ×${item.aantal}`:''}</span>
        <span class="loc">${esc(pathString(item.locatieId))}</span>
        <div class="item-tags">${(item.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>
        <div class="item-actions">
          <button class="btn btn-ghost btn-sm" data-act="edit">Bewerken</button>
          ${item.uitgeleendAan
            ? `<button class="btn btn-ghost btn-sm" data-act="terug">Markeer terug</button>`
            : `<button class="btn btn-ghost btn-sm" data-act="leen">Uitlenen</button>`}
          <button class="btn btn-danger btn-sm" data-act="del">Verwijder</button>
        </div>
      </div>
    </div>
  `);
  card.querySelector('[data-act="edit"]').addEventListener('click', () => openItemModal(item.id));
  card.querySelector('[data-act="del"]').addEventListener('click', async () => {
    if(confirm(`"${item.naam}" verwijderen?`)){ await deleteItem(item.id); render(); }
  });
  const leenBtn = card.querySelector('[data-act="leen"]');
  if(leenBtn) leenBtn.addEventListener('click', () => openUitleenModal(item.id));
  const terugBtn = card.querySelector('[data-act="terug"]');
  if(terugBtn) terugBtn.addEventListener('click', async () => {
    item.uitgeleendAan = null; item.uitleenDatum = null;
    await saveItem(item); render();
  });
  return card;
}

/* ---------------- Spullen (alle items) ---------------- */
function renderSpullen(root){
  const tags = allTags();
  if(tags.length){
    const chips = h(`<div class="filter-chips"></div>`);
    tags.forEach(t => {
      const chip = h(`<button class="chip ${state.tagFilter.has(t)?'is-on':''}">${esc(t)}</button>`);
      chip.addEventListener('click', () => {
        state.tagFilter.has(t) ? state.tagFilter.delete(t) : state.tagFilter.add(t);
        render();
      });
      chips.append(chip);
    });
    root.append(chips);
  }
  let items = state.spullen;
  if(state.tagFilter.size){
    items = items.filter(i => (i.tags||[]).some(t => state.tagFilter.has(t)));
  }
  if(items.length === 0){
    root.append(h(`<div class="empty-state"><p>Geen voorwerpen gevonden.</p><button class="btn btn-accent" id="es-nieuw">+ Nieuw voorwerp</button></div>`));
    $('#es-nieuw', root)?.addEventListener('click', () => openItemModal());
    return;
  }
  const grid = h(`<div class="item-grid"></div>`);
  items.sort((a,b)=>a.naam.localeCompare(b.naam)).forEach(i => grid.append(renderItemCard(i)));
  root.append(grid);
}

/* ---------------- Zoeken ---------------- */
function renderZoeken(root){
  root.append(h(`
    <label style="display:block; margin-bottom:16px">
      <input id="zoek-input" type="search" placeholder="Zoek op naam of label, bv. 'Paspoort'…"
        style="width:100%; max-width:480px; padding:11px 14px; border-radius:999px; border:1px solid var(--line); background:var(--card); color:var(--ink)"
        value="${esc(state.zoekterm)}">
    </label>
    <div id="zoek-resultaten"></div>
  `));
  $('#zoek-input', root).addEventListener('input', (e) => {
    state.zoekterm = e.target.value;
    toonZoekResultaten();
  });
  $('#zoek-input', root).focus();
  toonZoekResultaten();
}
function toonZoekResultaten(){
  const wrap = $('#zoek-resultaten');
  if(!wrap) return;
  wrap.innerHTML = '';
  const q = state.zoekterm.trim().toLowerCase();
  if(!q){
    wrap.append(h(`<div class="empty-state"><p>Typ een trefwoord om te beginnen.</p></div>`));
    return;
  }
  const results = state.spullen.filter(i =>
    i.naam.toLowerCase().includes(q) || (i.tags||[]).some(t => t.toLowerCase().includes(q))
  );
  if(results.length === 0){
    wrap.append(h(`<div class="empty-state"><p>Niets gevonden voor "${esc(state.zoekterm)}".</p></div>`));
    return;
  }
  results.forEach(item => {
    const row = h(`
      <div class="search-result">
        <div class="thumb">${item.foto ? `<img src="${item.foto}" alt="">` : '📦'}</div>
        <div class="info" style="flex:1">
          <strong>${esc(item.naam)}${item.aantal>1?` ×${item.aantal}`:''}</strong>
          <span class="loc">Ligt in: ${esc(pathString(item.locatieId))}</span>
        </div>
        <button class="btn btn-ghost btn-sm" data-act="bekijk">Naar locatie</button>
      </div>
    `);
    row.querySelector('[data-act="bekijk"]').addEventListener('click', () => switchView('locatie-detail', {locId:item.locatieId}));
    wrap.append(row);
  });
}

/* ---------------- Uitleen overzicht ---------------- */
function renderUitleen(root){
  const items = state.spullen.filter(i => i.uitgeleendAan);
  if(items.length === 0){
    root.append(h(`<div class="empty-state"><p>Je hebt momenteel niets uitgeleend.</p></div>`));
    return;
  }
  const grid = h(`<div class="item-grid"></div>`);
  items.forEach(i => grid.append(renderItemCard(i)));
  root.append(grid);
}

/* ---------------- QR scannen ---------------- */
function renderScannenView(root){
  root.append(h(`
    <div class="empty-state">
      <p>Scan de QR-code op een doos of plank om direct naar die locatie te gaan.</p>
      <button class="btn btn-accent" id="btn-start-scan">Camera openen</button>
    </div>
  `));
  $('#btn-start-scan', root).addEventListener('click', openScanModal);
}

async function openScanModal(){
  toonModal('#modal-scan');
  const video = $('#scan-video');
  const canvas = $('#scan-canvas');
  const status = $('#scan-status');
  status.textContent = 'Camera wordt gestart…';
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    state.scanStream = stream;
    video.srcObject = stream;
    await video.play();
    status.textContent = 'Richt de camera op de QR-code…';
    scanLoop(video, canvas, status);
  }catch(err){
    status.textContent = 'Kon camera niet openen: ' + err.message;
  }
}
function scanLoop(video, canvas, status){
  if(video.paused || video.ended || $('#modal-scan').classList.contains('hidden')) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if(video.videoWidth){
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height);
    if(code && code.data){
      if(code.data.startsWith(QR_PREFIX)){
        const locId = code.data.slice(QR_PREFIX.length);
        if(loc(locId)){
          status.textContent = 'Locatie gevonden!';
          stopScan();
          sluitModal($('#modal-scan'));
          switchView('locatie-detail', {locId});
          return;
        }
      } else {
        status.textContent = 'Dit is geen Thuisinventaris-code.';
      }
    }
  }
  requestAnimationFrame(() => scanLoop(video, canvas, status));
}
function stopScan(){
  if(state.scanStream){
    state.scanStream.getTracks().forEach(t => t.stop());
    state.scanStream = null;
  }
}

/* ---------------- QR genereren/printen ---------------- */
function openQrModal(locId){
  const l = loc(locId);
  toonModal('#modal-qr');
  const wrap = $('#qr-canvas-wrap');
  wrap.innerHTML = '';
  const canvas = document.createElement('canvas');
  wrap.append(canvas);
  QRCode.toCanvas(canvas, QR_PREFIX + locId, { width: 220, margin: 1 }, function(err){
    if(err) wrap.innerHTML = '<p class="hint">Kon QR-code niet genereren.</p>';
  });
  $('#btn-print-qr').onclick = () => {
    const dataUrl = canvas.toDataURL('image/png');
    const w = window.open('', '_blank');
    w.document.write(`
      <html><head><title>QR — ${esc(l?.naam||'')}</title></head>
      <body style="text-align:center; font-family:sans-serif; padding:40px">
        <img src="${dataUrl}" style="width:260px"><h2>${esc(l?.naam||'')}</h2>
        <script>window.onload=()=>window.print()</script>
      </body></html>`);
    w.document.close();
  };
}

/* ---------------- Modals: generiek ---------------- */
function toonModal(sel){ $(sel).classList.remove('hidden'); }
function sluitModal(el){
  el.classList.add('hidden');
  if(el.id === 'modal-scan') stopScan();
}
$$('.modal-backdrop [data-close-modal]').forEach(btn => {
  btn.addEventListener('click', (e) => sluitModal(e.target.closest('.modal-backdrop')));
});
$$('.modal-backdrop').forEach(bd => {
  bd.addEventListener('click', (e) => { if(e.target === bd) sluitModal(bd); });
});

/* ---------------- Modal: locatie ---------------- */
function vulLocatieSelect(select, excludeId){
  select.innerHTML = '<option value="">— Geen, dit is een hoofdruimte —</option>';
  function walk(parentId, depth){
    children(parentId).forEach(l => {
      if(l.id === excludeId) return;
      const opt = document.createElement('option');
      opt.value = l.id; opt.textContent = '　'.repeat(depth) + l.naam;
      select.append(opt);
      walk(l.id, depth+1);
    });
  }
  walk(null, 0);
}
function openLocatieModal(editId=null, parentId=null){
  state.editingLocId = editId;
  const titel = $('#modal-locatie-titel');
  const select = $('#loc-parent');
  vulLocatieSelect(select, editId);
  if(editId){
    const l = loc(editId);
    titel.textContent = 'Locatie bewerken';
    $('#loc-naam').value = l.naam;
    select.value = l.parentId || '';
    $('#loc-notitie').value = l.notitie || '';
  } else {
    titel.textContent = 'Nieuwe locatie';
    $('#loc-naam').value = '';
    select.value = parentId || '';
    $('#loc-notitie').value = '';
  }
  toonModal('#modal-locatie');
  $('#loc-naam').focus();
}
$('#form-locatie').addEventListener('submit', async (e) => {
  e.preventDefault();
  const l = state.editingLocId ? loc(state.editingLocId) : { id: uid() };
  l.naam = $('#loc-naam').value.trim();
  l.parentId = $('#loc-parent').value || null;
  l.notitie = $('#loc-notitie').value.trim();
  await saveLoc(l);
  sluitModal($('#modal-locatie'));
  render();
});

/* ---------------- Modal: item ---------------- */
function openItemModal(editId=null, locatieId=null){
  state.editingItemId = editId;
  state.itemFotoData = null;
  const titel = $('#modal-item-titel');
  const locSelect = $('#item-locatie');
  vulLocatieSelect(locSelect, null);
  // "geen hoofdruimte" optie is hier niet geldig; verwijder als er wel locaties zijn
  if(state.locaties.length){ locSelect.querySelector('option[value=""]').remove(); }
  $('#foto-preview').classList.add('hidden');
  $('#foto-placeholder').classList.remove('hidden');
  $('#item-foto').value = '';

  if(editId){
    const i = state.spullen.find(x => x.id === editId);
    titel.textContent = 'Voorwerp bewerken';
    $('#item-naam').value = i.naam;
    locSelect.value = i.locatieId;
    $('#item-aantal').value = i.aantal;
    $('#item-vervaldatum').value = i.vervaldatum || '';
    $('#item-tags').value = (i.tags||[]).join(', ');
    if(i.foto){
      state.itemFotoData = i.foto;
      $('#foto-preview').src = i.foto;
      $('#foto-preview').classList.remove('hidden');
      $('#foto-placeholder').classList.add('hidden');
    }
  } else {
    titel.textContent = 'Nieuw voorwerp';
    $('#item-naam').value = '';
    locSelect.value = locatieId || (state.locaties[0]?.id || '');
    $('#item-aantal').value = 1;
    $('#item-vervaldatum').value = '';
    $('#item-tags').value = '';
  }
  toonModal('#modal-item');
  $('#item-naam').focus();
}
$('#foto-drop').addEventListener('click', () => $('#item-foto').click());
$('#item-foto').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.itemFotoData = reader.result;
    $('#foto-preview').src = reader.result;
    $('#foto-preview').classList.remove('hidden');
    $('#foto-placeholder').classList.add('hidden');
  };
  reader.readAsDataURL(file);
});
$('#form-item').addEventListener('submit', async (e) => {
  e.preventDefault();
  const locId = $('#item-locatie').value;
  if(!locId){ alert('Maak eerst een locatie aan.'); return; }
  const i = state.editingItemId ? state.spullen.find(x=>x.id===state.editingItemId) : {
    id: uid(), uitgeleendAan:null, uitleenDatum:null, aangemaaktOp: new Date().toISOString()
  };
  i.naam = $('#item-naam').value.trim();
  i.locatieId = locId;
  i.aantal = Math.max(1, parseInt($('#item-aantal').value,10) || 1);
  i.vervaldatum = $('#item-vervaldatum').value || null;
  i.tags = $('#item-tags').value.split(',').map(t=>t.trim()).filter(Boolean);
  i.foto = state.itemFotoData;
  await saveItem(i);
  sluitModal($('#modal-item'));
  render();
});

/* ---------------- Modal: uitlenen ---------------- */
function openUitleenModal(itemId){
  state.uitleenItemId = itemId;
  $('#uitleen-naam').value = '';
  toonModal('#modal-uitleen');
  $('#uitleen-naam').focus();
}
$('#form-uitleen').addEventListener('submit', async (e) => {
  e.preventDefault();
  const i = state.spullen.find(x => x.id === state.uitleenItemId);
  i.uitgeleendAan = $('#uitleen-naam').value.trim();
  i.uitleenDatum = new Date().toISOString().slice(0,10);
  await saveItem(i);
  sluitModal($('#modal-uitleen'));
  render();
});

/* ---------------- Instellingen: export/import ---------------- */
function renderInstellingen(root){
  root.append(h(`
    <div class="section-title">Back-up &amp; delen met huisgenoten</div>
    <p class="hint" style="max-width:520px; margin-bottom:16px">
      Deze app bewaart alles lokaal in je browser — er is geen account nodig, maar dat
      betekent ook dat huisgenoten niet automatisch dezelfde gegevens zien. Exporteer een
      back-up en stuur het bestand door (bv. via mail of een gedeelde map) zodat een
      huisgenoot het kan importeren.
    </p>
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:28px">
      <button class="btn btn-accent" id="btn-export">Exporteer back-up (.json)</button>
      <button class="btn btn-ghost" id="btn-import">Importeer back-up</button>
      <input type="file" id="import-file" accept="application/json" class="hidden">
    </div>
    <div class="section-title">Meldingen</div>
    <p class="hint" style="max-width:520px; margin-bottom:10px">
      Zet meldingen aan om (bij het openen van de app) een seintje te krijgen als iets
      binnen 7 dagen verloopt, zoals de EHBO-doos of een paspoort.
    </p>
    <button class="btn btn-ghost" id="btn-notif">Meldingen inschakelen</button>
    <div class="section-title" style="margin-top:28px">Gevarenzone</div>
    <button class="btn btn-danger" id="btn-reset">Alles wissen</button>
  `));

  $('#btn-export', root).addEventListener('click', () => {
    const data = { versie:1, locaties: state.locaties, spullen: state.spullen };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `thuisinventaris-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  });
  $('#btn-import', root).addEventListener('click', () => $('#import-file', root).click());
  $('#import-file', root).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const tekst = await file.text();
    try{
      const data = JSON.parse(tekst);
      if(!confirm('Dit vervangt al je huidige gegevens door de gegevens uit dit back-upbestand. Doorgaan?')) return;
      await DB.clear('locaties'); await DB.clear('spullen');
      for(const l of data.locaties||[]) await DB.put('locaties', l);
      for(const i of data.spullen||[]) await DB.put('spullen', i);
      await laadAlles();
      switchView('dashboard');
    }catch(err){
      alert('Kon dit bestand niet lezen. Is het een geldige Thuisinventaris-back-up?');
    }
  });
  $('#btn-notif', root).addEventListener('click', async () => {
    const perm = await Notification.requestPermission();
    alert(perm === 'granted' ? 'Meldingen staan aan.' : 'Meldingen zijn niet ingeschakeld.');
  });
  $('#btn-reset', root).addEventListener('click', async () => {
    if(confirm('Alle locaties en voorwerpen definitief verwijderen?')){
      await DB.clear('locaties'); await DB.clear('spullen');
      await laadAlles();
      switchView('dashboard');
    }
  });
}

/* ---------------- Meldingen bij opstarten ---------------- */
function checkVervalMeldingen(){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const bijna = state.spullen.filter(i => i.vervaldatum && daysUntil(i.vervaldatum) <= 7);
  if(bijna.length){
    new Notification('Thuisinventaris', {
      body: `${bijna.length} voorwerp(en) verlopen binnen 7 dagen: ${bijna.map(i=>i.naam).join(', ')}`
    });
  }
}

/* ---------------- Init ---------------- */
$$('.nav-item').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
$('#btn-nieuw-item').addEventListener('click', () => openItemModal());
$('#quick-search').addEventListener('input', (e) => {
  state.zoekterm = e.target.value;
  switchView('zoeken');
});

(async function init(){
  await DB.init();
  await laadAlles();
  switchView('dashboard');
  checkVervalMeldingen();
})();

})();
