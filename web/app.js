'use strict';
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
let role = null, cur = null, pollT = null, editing = false, selected = null;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

async function api(a, body, get) {
  const opt = get ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Potluck': '1' }, body: JSON.stringify({ a, ...body }) };
  const r = await fetch('api.php' + (get ? '?a=' + a + (get === true ? '' : '&' + get) : ''), { credentials: 'same-origin', ...opt });
  const d = await r.json().catch(() => ({ error: 'Network error' }));
  if (r.status === 401 && a !== 'login') { role = null; route(); throw new Error('Please log in'); }
  if (!r.ok) throw new Error(d.error || 'Error');
  return d;
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 1800); }
const fmtDate = (d, t) => {
  if (!d) return 'Date TBD';
  const dt = new Date(d + 'T' + (t || '12:00'));
  let s = dt.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (t) s += ' · ' + dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return s;
};
const catIdx = id => Math.max(0, cur.categories.findIndex(c => c.id === id));
const EX = {appetizer:'Chips & Dip',appetizers:'Chips & Dip',entree:'turkey','entrée':'turkey',entrees:'turkey',side:'mashed potatoes',sides:'mashed potatoes',dessert:'pies',desserts:'pies',drinks:'cider',drink:'cider'};
const exFor = name => { const e = EX[String(name||'').trim().toLowerCase()]; return e ? 'e.g. ' + e : "e.g. what you're bringing"; };
const catName = id => (cur.categories.find(c => c.id === id) || {}).name || 'Item';

function header() {
  $('#topActions').hidden = !role;
  $('#roleBadge').textContent = role === 'admin' ? '👑 Admin' : '🙂 Guest';
}

async function init() {
  const me = await api('me', null, true);
  role = me.role; $('#siteTitle').textContent = me.title || 'Potluck Planner'; document.title = me.title || 'Potluck Planner';
  window.addEventListener('hashchange', route); route();
}
function route() {
  clearInterval(pollT); cur = null; selected = null; selBar();
  header();
  if (!role) return loginView();
  const m = location.hash.match(/^#\/p\/(\w+)/);
  m ? potluckView(m[1]) : listView();
}

function loginView() {
  app.innerHTML = '';
  const el = h(`<section class="card login"><div class="big" aria-hidden="true">🥧🍗🥗</div><h1>Welcome to the potluck!</h1>
    <p class="muted">Enter the password you were given.</p>
    <form><label for="pw" class="sr">Password</label><input id="pw" type="password" autocomplete="current-password" required autofocus>
    <button class="btn">Let's eat →</button><div class="err" id="lerr" role="alert"></div></form></section>`);
  el.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    try { role = (await api('login', { password: $('#pw').value })).role; route(); }
    catch (err) { $('#lerr').textContent = err.message; }
  };
  app.append(el);
}
$('#logoutBtn').onclick = async () => { await api('logout', {}).catch(() => {}); role = null; location.hash = ''; route(); };
$('#brand').onclick = e => { e.preventDefault(); location.hash = '#/'; route(); };

async function listView() {
  app.innerHTML = '<p class="muted">Loading…</p>';
  const list = await api('list', null, true);
  list.sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
  app.innerHTML = '';
  app.append(h(`<div class="hero"><div><h1>Upcoming potlucks</h1><p class="muted">Pick one to see who's bringing what.</p></div>
    ${role === 'admin' ? '<button class="btn" id="newP">＋ New potluck</button>' : ''}</div>`));
  const g = h('<div class="grid"></div>');
  if (!list.length) g.append(h(`<div class="card"><p>No potlucks yet. ${role === 'admin' ? 'Create the first one!' : 'Check back soon.'}</p></div>`));
  for (const p of list) {
    const pct = p.count ? Math.round(p.claimed / p.count * 100) : 0;
    g.append(h(`<a class="card pl" href="#/p/${p.id}"><h3>${esc(p.name)}</h3><div class="muted">${esc(fmtDate(p.date, p.time))}</div>
      <div class="progress" aria-label="${pct}% claimed"><i style="width:${pct}%"></i></div><small class="muted">${p.claimed} of ${p.count} dishes claimed</small></a>`));
  }
  app.append(g);
  const nb = $('#newP'); if (nb) nb.onclick = () => potluckDialog(null);
}

function potluckDialog(p) {
  const d = $('#dlg'), f = $('#dlgForm');
  f.innerHTML = `<h2>${p ? 'Edit potluck' : 'New potluck'}</h2>
    <label for="fn">Name</label><input id="fn" required maxlength="80" placeholder="Thanksgiving" value="${esc(p?.name)}">
    <div class="inline"><div style="flex:1"><label for="fd">Date</label><input id="fd" type="date" value="${esc(p?.date)}"></div>
    <div style="flex:1"><label for="ft">Time</label><input id="ft" type="time" value="${esc(p?.time)}"></div></div>
    <label for="fl">Location (optional)</label><input id="fl" maxlength="120" value="${esc(p?.location)}">
    <label for="fo">Notes (optional)</label><textarea id="fo" rows="2" maxlength="500">${esc(p?.notes)}</textarea>
    <div class="inline" style="justify-content:flex-end;margin-top:14px"><button class="btn soft" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">${p ? 'Save' : 'Create'}</button></div>`;
  d.showModal();
  d.onclose = async () => {
    if (d.returnValue !== 'ok') return;
    const body = { name: $('#fn').value, date: $('#fd').value, time: $('#ft').value, location: $('#fl').value, notes: $('#fo').value };
    try {
      if (p) { cur = await api('updatePotluck', { id: p.id, ...body }); render(); toast('Saved ✓'); }
      else { const n = await api('createPotluck', body); location.hash = '#/p/' + n.id; }
    } catch (e) { toast(e.message); }
  };
}

async function potluckView(id) {
  app.innerHTML = '<p class="muted">Loading…</p>';
  try { cur = await api('get', null, 'id=' + id); } catch (e) { app.innerHTML = `<div class="card">${esc(e.message)} <a href="#/">Back</a></div>`; return; }
  render();
  pollT = setInterval(poll, 4000);
}
async function poll() {
  if (!cur || editing || drag || document.hidden) return;
  try { const n = await api('get', null, 'id=' + cur.id); if (n.rev !== cur.rev) { cur = n; render(); } } catch (e) {}
}
async function act(a, body) {
  try { cur = await api(a, { id: cur.id, ...body }); render(); return true; }
  catch (e) { toast(e.message); return false; }
}

function itemEl(it) {
  const el = h(`<div class="item" data-id="${it.id}" style="background:var(--c${catIdx(it.cat) % 8})">
    <button class="handle" aria-label="Move ${esc(catName(it.cat))} ${esc(it.sub)}" title="Drag to move (or tap, then tap a row)">⠿</button>
    <div class="body"><div class="cat">${esc(catName(it.cat))}</div><input value="${esc(it.sub)}" maxlength="60" placeholder="${esc(exFor(catName(it.cat)))}" aria-label="${esc(catName(it.cat))} details"></div>
    ${role === 'admin' ? '<button class="x" title="Delete item" aria-label="Delete item">✕</button>' : ''}</div>`);
  if (selected === it.id) el.classList.add('sel');
  const inp = el.querySelector('input');
  inp.onfocus = () => editing = true;
  inp.onblur = async () => { editing = false; if (inp.value.trim() !== it.sub) { if (await act('sub', { item: it.id, sub: inp.value })) toast('Saved ✓'); } };
  inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); };
  const x = el.querySelector('.x'); if (x) x.onclick = () => confirm('Delete this item?') && act('removeItem', { item: it.id });
  bindDrag(el.querySelector('.handle'), el, it);
  return el;
}

function zone(owner) {
  const z = h(`<div class="zone" data-owner="${owner || ''}"></div>`);
  const items = cur.items.filter(i => (i.owner || '') === (owner || ''));
  items.forEach(i => z.append(itemEl(i)));
  if (!items.length) z.append(h(`<div class="empty">${owner ? 'Drag a dish here' : 'All dishes claimed — hooray! 🎉'}</div>`));
  z.onclick = e => { if (selected && !e.target.closest('.item')) { const s = selected; selected = null; selBar(); moveItem({ item: s, owner: owner || null }); } };
  return z;
}

function render() {
  if (!cur) return;
  const p = cur, claimed = p.items.filter(i => i.owner).length;
  app.innerHTML = '';
  app.append(h(`<div class="hero"><div><a href="#/" class="muted">← All potlucks</a><h1>${esc(p.name)}</h1>
    <div class="chips"><span class="chip">📅 ${esc(fmtDate(p.date, p.time))}</span>${p.location ? `<span class="chip">📍 ${esc(p.location)}</span>` : ''}
    <span class="chip">🍽️ ${claimed}/${p.items.length} claimed</span></div>${p.notes ? `<p>${esc(p.notes)}</p>` : ''}</div>
    ${role === 'admin' ? '<button class="btn soft" id="editP">✏️ Edit</button>' : ''}</div>`));
  const board = h('<div class="board"></div>');
  const res = h('<div class="reservoirWrap"><div class="row reservoir"><div class="rowHead">🧺 Dish reservoir <span class="count">drag to a person</span></div></div></div>');
  res.querySelector('.row').append(zone(null));
  const rows = h('<section aria-labelledby="hC"><h2 class="secTitle" id="hC">😋 Mouths</h2></section>');
  if (!p.people.length) rows.append(h(`<div class="card muted">No mouths to feed yet.${role === 'admin' ? ' Add some in the admin panel below.' : ''}</div>`));
  for (const pe of p.people) {
    const n = p.items.filter(i => i.owner === pe.id).length;
    const r = h(`<div class="row"><div class="rowHead">${esc(pe.name)} <span class="count">${n} dish${n === 1 ? '' : 'es'}</span></div></div>`);
    r.append(zone(pe.id)); rows.append(r);
  }
  board.append(rows);
  const cs = h('<section aria-labelledby="hD"><h2 class="secTitle" id="hD">🍲 Grub</h2></section>'); cs.append(res); board.append(cs); app.append(board);
  if (role === 'admin') { $('#editP').onclick = () => potluckDialog(cur); app.append(adminPanel()); }
}

function adminPanel() {
  const p = cur;
  const el = h(`<section class="admin"><h2>👑 Admin</h2>
    <details open><summary>😋 Mouths (${p.people.length})</summary><ul class="list" id="ppl"></ul>
      <form class="inline" id="addPe"><input placeholder="Name (e.g. Aunt Sue)" maxlength="80" required><button class="btn small">Add person</button></form></details>
    <details open><summary>Dish categories & items</summary><ul class="list" id="cats"></ul>
      <form class="inline" id="addCat"><input placeholder="New category (e.g. Bread)" maxlength="40" required><button class="btn small">Add category</button></form>
      <form class="inline" id="addIt"><select aria-label="Category"></select><input placeholder="Sub-name (optional)" maxlength="60">
        <input type="number" min="1" max="30" value="1" style="max-width:80px;flex:0" aria-label="How many"><button class="btn small">Add to reservoir</button></form></details>
    <details><summary>Danger zone</summary><p><button class="btn danger small" id="delP">Delete this potluck</button></p></details></section>`);
  const ppl = el.querySelector('#ppl');
  p.people.forEach((pe, i) => {
    const li = h(`<li><input value="${esc(pe.name)}" aria-label="Name"><button class="btn soft small" ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button class="btn soft small" ${i < p.people.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button><button class="btn danger small" aria-label="Remove ${esc(pe.name)}">✕</button></li>`);
    const [inp] = li.querySelectorAll('input'), [up, dn, rm] = li.querySelectorAll('button');
    inp.onfocus = () => editing = true;
    inp.onblur = () => { editing = false; if (inp.value.trim() && inp.value.trim() !== pe.name) act('renamePerson', { person: pe.id, name: inp.value }); };
    up.onclick = () => act('movePerson', { person: pe.id, dir: -1 }); dn.onclick = () => act('movePerson', { person: pe.id, dir: 1 });
    rm.onclick = () => confirm(`Remove ${pe.name}? Their dishes go back to the reservoir.`) && act('removePerson', { person: pe.id });
    ppl.append(li);
  });
  const cats = el.querySelector('#cats'), sel = el.querySelector('#addIt select');
  p.categories.forEach((c, i) => {
    const n = p.items.filter(x => x.cat === c.id).length;
    const li = h(`<li><span class="dot" style="background:var(--c${i % 8})"></span><input value="${esc(c.name)}" aria-label="Category name"><small class="muted">${n}</small><button class="btn danger small" aria-label="Delete category">✕</button></li>`);
    const inp = li.querySelector('input');
    inp.onfocus = () => editing = true;
    inp.onblur = () => { editing = false; if (inp.value.trim() && inp.value.trim() !== c.name) act('renameCategory', { cat: c.id, name: inp.value }); };
    li.querySelector('button').onclick = () => confirm(`Delete category "${c.name}" and its ${n} item(s)?`) && act('removeCategory', { cat: c.id });
    cats.append(li); sel.append(new Option(c.name, c.id));
  });
  const subIn = el.querySelector('#addIt input'); const setEx = () => subIn.placeholder = 'Sub-name (optional, ' + exFor(sel.selectedOptions[0]?.text) + ')'; sel.onchange = setEx; setEx();
  el.querySelector('#addPe').onsubmit = e => { e.preventDefault(); const i = e.target.querySelector('input'); act('addPerson', { name: i.value }).then(ok => ok && setTimeout(() => $('#addPe input')?.focus())); };
  el.querySelector('#addCat').onsubmit = e => { e.preventDefault(); act('addCategory', { name: e.target.querySelector('input').value }); };
  el.querySelector('#addIt').onsubmit = e => { e.preventDefault(); const [s, n] = e.target.querySelectorAll('input'); if (!sel.value) return toast('Add a category first'); act('addItems', { cat: sel.value, sub: s.value, count: n.value }).then(ok => ok && toast('Added to reservoir ✓')); };
  el.querySelector('#delP').onclick = async () => { if (prompt(`Type the potluck name to delete it: ${p.name}`) === p.name) { await act('deletePotluck', {}); location.hash = '#/'; } };
  return el;
}

// ---------- drag & drop (pointer events: mouse + touch + pen) ----------
let drag = null;
function bindDrag(handle, el, it) {
  handle.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault(); handle.setPointerCapture(e.pointerId);
    drag = { it, el, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, over: null };
  });
  handle.addEventListener('pointermove', e => {
    if (!drag || drag.el !== el) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    if (!drag.moved) {
      drag.moved = true; const r = el.getBoundingClientRect();
      drag.dx = drag.x0 - r.left; drag.dy = drag.y0 - r.top;
      drag.ghost = el.cloneNode(true); drag.ghost.classList.add('ghostDrag'); drag.ghost.style.width = r.width + 'px';
      document.body.append(drag.ghost); el.classList.add('dragging');
    }
    drag.ghost.style.left = (e.clientX - drag.dx) + 'px'; drag.ghost.style.top = (e.clientY - drag.dy) + 'px';
    const z = document.elementFromPoint(e.clientX, e.clientY)?.closest('.row')?.querySelector('.zone');
    if (z !== drag.over) { drag.over?.classList.remove('over'); z?.classList.add('over'); drag.over = z; }
    // auto-scroll near edges
    const m = 60; if (e.clientY < m + 60) scrollBy(0, -12); else if (e.clientY > innerHeight - m) scrollBy(0, 12);
  });
  const end = e => {
    if (!drag || drag.el !== el) return;
    const d = drag; drag = null;
    d.ghost?.remove(); el.classList.remove('dragging'); d.over?.classList.remove('over');
    if (!d.moved) { selected = selected === it.id ? null : it.id; selBar(); document.querySelectorAll('.item').forEach(x => x.classList.toggle('sel', x.dataset.id === selected)); return; }
    if (e.type === 'pointercancel' || !d.over) return;
    const owner = d.over.dataset.owner || null;
    const before = [...d.over.querySelectorAll('.item')].find(x => { const r = x.getBoundingClientRect(); return x !== el && e.clientY < r.top + r.height / 2 && e.clientX < r.right; })?.dataset.id;
    if ((it.owner || null) === owner && !before) return;
    moveItem({ item: it.id, owner, before });
  };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selected = selected === it.id ? null : it.id; selBar(); render(); } });
}
function selBar() {
  $('.selBar')?.remove();
  if (!selected || !cur) return;
  const it = cur.items.find(i => i.id === selected); if (!it) return;
  const b = h(`<div class="selBar" role="dialog" aria-label="Move item"><span>Move <b>${esc(catName(it.cat))}${it.sub ? ': ' + esc(it.sub) : ''}</b> to…</span>
    <select aria-label="Destination"><option value="">🧺 Reservoir</option>${cur.people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
    <button class="btn small">Move</button><button class="btn ghost small" style="color:#fff">✕</button></div>`);
  const s = b.querySelector('select'); s.value = it.owner || '';
  const [mv, cx] = b.querySelectorAll('button');
  mv.onclick = () => { selected = null; b.remove(); moveItem({ item: it.id, owner: s.value || null }); };
  cx.onclick = () => { selected = null; b.remove(); render(); };
  document.body.append(b);
}
init().catch(e => app.innerHTML = `<div class="card">Could not load: ${esc(e.message)}</div>`);

// ---- move + ask for a sub-name when a blank dish lands on a person ----
async function moveItem(body) {
  // Commit any unsaved inline edit on this dish first (a pointerdown on the handle keeps the input focused, so blur never fires).
  const inp = document.querySelector(`.item:not(.ghostDrag)[data-id="${body.item}"] input`);
  const c0 = cur.items.find(i => i.id === body.item);
  if (inp && c0 && inp.value.trim() !== String(c0.sub || '').trim()) { editing = false; await act('sub', { item: c0.id, sub: inp.value }); }
  const ok = await act('move', body);
  if (!ok || !body.owner) return;
  const it = cur.items.find(i => i.id === body.item);
  if (it && !String(it.sub || '').trim()) askSub(it);
}
function askSub(it) {
  const d = $('#dlg'), f = $('#dlgForm'), cat = catName(it.cat);
  editing = true;
  f.innerHTML = `<div style="text-align:center;font-size:2.4rem" aria-hidden="true">😋</div>
    <h2 style="text-align:center;margin:.2em 0">What ${esc(cat)} are you thinking?</h2>
    <p class="muted" style="text-align:center;margin-top:0">(you can edit anytime)</p>
    <label for="askIn" class="sr">${esc(cat)} details</label>
    <input id="askIn" maxlength="60" autocomplete="off" enterkeyhint="done" placeholder="${esc(exFor(cat))}">
    <div class="inline" style="justify-content:flex-end;margin-top:14px"><button class="btn soft" value="skip" formnovalidate>Skip</button><button class="btn" value="ok">Save</button></div>`;
  d.returnValue = '';
  d.showModal();
  const inp = $('#askIn'); setTimeout(() => inp.focus(), 50);
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); d.close('ok'); } };
  d.onclose = async () => {
    editing = false;
    const v = inp.value.trim();
    if (d.returnValue === 'ok' && v) { if (await act('sub', { item: it.id, sub: v })) toast('Saved ✓'); }
  };
}
