const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allEntries = [];
let allShops = {}; // { [name]: { name, memo, updated_at } }
let currentEntryId = null;
let currentShopName = null;
let selectedRating = 0;
let isEditingMemo = false;

// DOM
const homeView = document.getElementById('homeView');
const shopView = document.getElementById('shopView');
const shopGrid = document.getElementById('shopGrid');
const shopEntries = document.getElementById('shopEntries');
const searchInput = document.getElementById('searchInput');
const modal = document.getElementById('modal');
const detailModal = document.getElementById('detailModal');
const entryForm = document.getElementById('entryForm');
const toast = document.getElementById('toast');

// --- Init ---
(async () => {
  await loadData();
  setupRealtime();
  handleRoute();
})();

window.addEventListener('hashchange', handleRoute);

// --- Routing ---
function handleRoute() {
  const hash = location.hash || '';
  const m = hash.match(/^#\/shop\/(.+)$/);
  if (m) {
    currentShopName = decodeURIComponent(m[1]);
    renderShopView();
  } else {
    currentShopName = null;
    renderHomeView();
  }
}

// --- Load data ---
async function loadData() {
  const [entriesRes, shopsRes] = await Promise.all([
    db.from('entries').select('*').order('created_at', { ascending: false }),
    db.from('shops').select('*'),
  ]);

  if (entriesRes.error) {
    shopGrid.innerHTML = `<div class="empty">接続エラー: ${entriesRes.error.message}</div>`;
    return;
  }

  allEntries = entriesRes.data || [];
  allShops = {};
  (shopsRes.data || []).forEach(s => { allShops[s.name] = s; });
}

// --- Realtime ---
function setupRealtime() {
  db.channel('entries-ch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, async () => {
      await loadData();
      if (!isEditingMemo) handleRoute();
    })
    .subscribe();
  db.channel('shops-ch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shops' }, async () => {
      await loadData();
      if (!isEditingMemo) handleRoute();
    })
    .subscribe();
}

// --- Home view ---
function renderHomeView() {
  homeView.classList.remove('hidden');
  shopView.classList.add('hidden');

  const shopMap = {};
  allEntries.forEach(e => {
    if (!shopMap[e.shop_name]) {
      shopMap[e.shop_name] = {
        name: e.shop_name,
        therapists: new Set(),
        ratings: [],
        lastAt: e.created_at,
      };
    }
    const s = shopMap[e.shop_name];
    s.therapists.add(e.therapist_name);
    if (e.rating > 0) s.ratings.push(e.rating);
    if (new Date(e.created_at) > new Date(s.lastAt)) s.lastAt = e.created_at;
  });

  let shops = Object.values(shopMap);
  const q = searchInput.value.trim().toLowerCase();
  if (q) shops = shops.filter(s => s.name.toLowerCase().includes(q));
  shops.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

  if (shops.length === 0) {
    shopGrid.innerHTML = '<div class="empty">まだ記録がありません</div>';
    return;
  }

  shopGrid.innerHTML = shops.map(s => {
    const avg = s.ratings.length
      ? (s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length)
      : 0;
    return `
      <a class="shop-card" href="#/shop/${encodeURIComponent(s.name)}">
        <div class="shop-card-name">${esc(s.name)}</div>
        <div class="shop-card-stars">
          ${renderStars(Math.round(avg))}
          <span class="shop-card-avg">${avg ? avg.toFixed(1) : '-'}</span>
        </div>
        <div class="shop-card-meta">嬢: ${s.therapists.size}名</div>
      </a>
    `;
  }).join('');
}

// --- Shop view ---
function renderShopView() {
  homeView.classList.add('hidden');
  shopView.classList.remove('hidden');

  const entries = allEntries.filter(e => e.shop_name === currentShopName);
  const therapists = new Set(entries.map(e => e.therapist_name));
  const ratings = entries.filter(e => e.rating > 0).map(e => e.rating);
  const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;

  document.getElementById('shopTitle').textContent = currentShopName;
  document.getElementById('shopStats').innerHTML = `
    <span class="entry-stars">${renderStars(Math.round(avg))}</span>
    <span class="shop-stat-num">${avg ? avg.toFixed(1) : '-'}</span>
    <span class="shop-stat-sep">·</span>
    <span>嬢 ${therapists.size}名</span>
    <span class="shop-stat-sep">·</span>
    <span>記録 ${entries.length}件</span>
  `;

  // Memo
  const memo = (allShops[currentShopName] || {}).memo || '';
  const memoEl = document.getElementById('shopMemo');
  memoEl.textContent = memo || '(メモなし)';
  memoEl.classList.toggle('empty-memo', !memo);
  document.getElementById('shopMemoEdit').value = memo;
  memoEl.classList.remove('hidden');
  document.getElementById('shopMemoEdit').classList.add('hidden');
  document.getElementById('memoActions').classList.add('hidden');
  document.getElementById('editMemoBtn').classList.remove('hidden');
  isEditingMemo = false;

  // Entries
  if (entries.length === 0) {
    shopEntries.innerHTML = '<div class="empty">記録がありません</div>';
    return;
  }

  shopEntries.innerHTML = entries.map(e => `
    <div class="entry-card" data-id="${e.id}">
      <div class="entry-card-header">
        <div class="entry-therapist">${esc(e.therapist_name)}</div>
        <span class="entry-date">${formatDate(e.created_at)}</span>
      </div>
      <div class="entry-stars">${renderStars(e.rating)}</div>
      <div class="entry-content-preview">${esc(e.content)}</div>
    </div>
  `).join('');

  document.querySelectorAll('#shopEntries .entry-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

// --- Helpers ---
function renderStars(rating) {
  return [1,2,3,4,5].map(i =>
    `<span class="${i <= rating ? '' : 'off'}">★</span>`
  ).join('');
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// --- Search (home only) ---
searchInput.addEventListener('input', () => {
  if (currentShopName) return;
  renderHomeView();
});

// --- Header / Nav ---
document.getElementById('appTitle').addEventListener('click', () => {
  location.hash = '';
});

document.getElementById('backBtn').addEventListener('click', e => {
  e.preventDefault();
  location.hash = '';
});

// --- Add modal ---
document.getElementById('openFormBtn').addEventListener('click', () => {
  entryForm.reset();
  resetFormState();
  if (currentShopName) {
    document.getElementById('shopName').value = currentShopName;
  }
  renderShopPicker();
  modal.classList.remove('hidden');
});

// --- Content presets ---
const CONTENT_PRESETS = ['AN', 'HF', 'Gあり', 'NS', 'NN'];
let selectedPresets = new Set();
const contentPresetList = document.getElementById('contentPresets');

function renderContentPresets() {
  contentPresetList.innerHTML = CONTENT_PRESETS.map(opt =>
    `<button type="button" class="preset-btn${selectedPresets.has(opt) ? ' selected' : ''}" data-opt="${esc(opt)}">${esc(opt)}</button>`
  ).join('');
  contentPresetList.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const opt = btn.dataset.opt;
      if (selectedPresets.has(opt)) {
        selectedPresets.delete(opt);
        btn.classList.remove('selected');
      } else {
        selectedPresets.add(opt);
        btn.classList.add('selected');
      }
    });
  });
}

// --- Option toggle / presets / price ---
const OPTION_PRESETS = ['衣装チェンジ', 'オールヌード'];
let optionToggleState = null; // 'あり' | 'なし' | null
let selectedOptions = new Set();
const optionToggleEl = document.getElementById('optionToggle');
const optionDetailsEl = document.getElementById('optionDetails');
const optionPresetList = document.getElementById('optionPresets');
const optionPriceInput = document.getElementById('optionPrice');

function renderOptionToggle() {
  optionToggleEl.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.val === optionToggleState);
  });
  if (optionToggleState === 'あり') {
    optionDetailsEl.classList.remove('hidden');
    renderOptionPresets();
  } else {
    optionDetailsEl.classList.add('hidden');
  }
}

function renderOptionPresets() {
  optionPresetList.innerHTML = OPTION_PRESETS.map(opt =>
    `<button type="button" class="preset-btn${selectedOptions.has(opt) ? ' selected' : ''}" data-opt="${esc(opt)}">${esc(opt)}</button>`
  ).join('');
  optionPresetList.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const opt = btn.dataset.opt;
      if (selectedOptions.has(opt)) {
        selectedOptions.delete(opt);
        btn.classList.remove('selected');
      } else {
        selectedOptions.add(opt);
        btn.classList.add('selected');
      }
    });
  });
}

optionToggleEl.querySelectorAll('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    optionToggleState = btn.dataset.val;
    if (optionToggleState === 'なし') {
      selectedOptions = new Set();
      optionPriceInput.value = '';
    }
    renderOptionToggle();
  });
});

function buildOptionsText() {
  if (optionToggleState === 'なし') return 'なし';
  if (optionToggleState === 'あり') {
    const items = OPTION_PRESETS.filter(o => selectedOptions.has(o)).join(', ');
    const price = optionPriceInput.value.trim();
    let out = 'あり';
    if (items) out += `: ${items}`;
    if (price) out += ` (${price}円)`;
    return out;
  }
  return '';
}

function resetFormState() {
  selectedRating = 0;
  updateStars(0);
  selectedPresets = new Set();
  renderContentPresets();
  optionToggleState = null;
  selectedOptions = new Set();
  optionPriceInput.value = '';
  renderOptionToggle();
}

// --- Shop picker (modal top) ---
const shopNameInput = document.getElementById('shopName');
const shopPickerList = document.getElementById('shopPickerList');

function getKnownShopNames() {
  const set = new Set();
  allEntries.forEach(e => { if (e.shop_name) set.add(e.shop_name); });
  Object.keys(allShops).forEach(n => set.add(n));
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
}

function renderShopPicker() {
  const names = getKnownShopNames();
  if (names.length === 0) {
    shopPickerList.innerHTML = '<div class="shop-picker-empty">まだ登録された店がありません</div>';
    return;
  }
  shopPickerList.innerHTML = names.map(n =>
    `<button type="button" class="shop-pick-btn" data-name="${esc(n)}">${esc(n)}</button>`
  ).join('');
  shopPickerList.querySelectorAll('.shop-pick-btn').forEach(el => {
    el.addEventListener('click', () => {
      shopNameInput.value = el.dataset.name;
      el.classList.add('selected');
      shopPickerList.querySelectorAll('.shop-pick-btn').forEach(b => {
        if (b !== el) b.classList.remove('selected');
      });
    });
  });
}

document.getElementById('closeModal').addEventListener('click', () => {
  modal.classList.add('hidden');
});

modal.addEventListener('click', e => {
  if (e.target === modal) modal.classList.add('hidden');
});

document.getElementById('closeDetailModal').addEventListener('click', () => {
  detailModal.classList.add('hidden');
  currentEntryId = null;
});

detailModal.addEventListener('click', e => {
  if (e.target === detailModal) {
    detailModal.classList.add('hidden');
    currentEntryId = null;
  }
});

// --- Star rating ---
const stars = document.querySelectorAll('.star');

stars.forEach(star => {
  star.addEventListener('mouseenter', () => updateStars(+star.dataset.value, true));
  star.addEventListener('mouseleave', () => updateStars(selectedRating));
  star.addEventListener('click', () => {
    selectedRating = +star.dataset.value;
    document.getElementById('rating').value = selectedRating;
    updateStars(selectedRating);
  });
});

function updateStars(value, isHover = false) {
  stars.forEach(s => {
    const v = +s.dataset.value;
    s.classList.remove('active', 'hover');
    if (v <= value) s.classList.add(isHover ? 'hover' : 'active');
  });
}

// --- Submit entry ---
entryForm.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = entryForm.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = '保存中...';

  const payload = {
    shop_name: document.getElementById('shopName').value.trim(),
    therapist_name: document.getElementById('therapistName').value.trim(),
    rating: selectedRating,
    options: buildOptionsText(),
    content: CONTENT_PRESETS.filter(o => selectedPresets.has(o)).join(', '),
  };

  const { error } = await db.from('entries').insert([payload]);

  btn.disabled = false;
  btn.textContent = '保存';

  if (error) {
    showToast('エラー: ' + error.message);
    return;
  }

  modal.classList.add('hidden');
  showToast('保存しました');
  entryForm.reset();
  resetFormState();
  shopPickerList.innerHTML = '';
  await loadData();
  handleRoute();
});

// --- Detail ---
function openDetail(id) {
  const entry = allEntries.find(e => e.id === id);
  if (!entry) return;
  currentEntryId = id;

  document.getElementById('detailTitle').textContent = `${entry.shop_name} / ${entry.therapist_name}`;
  document.getElementById('detailBody').innerHTML = `
    <div class="detail-section">
      <div class="detail-label">店名</div>
      <div class="detail-value">${esc(entry.shop_name)}</div>
    </div>
    <div class="detail-section">
      <div class="detail-label">嬢の名前</div>
      <div class="detail-value">${esc(entry.therapist_name)}</div>
    </div>
    <div class="detail-section">
      <div class="detail-label">評価</div>
      <div class="detail-value entry-stars">${renderStars(entry.rating)}</div>
    </div>
    ${entry.options ? `
    <div class="detail-section">
      <div class="detail-label">オプション</div>
      <div class="detail-value">${esc(entry.options)}</div>
    </div>` : ''}
    ${entry.content ? `
    <div class="detail-section">
      <div class="detail-label">内容メモ</div>
      <div class="detail-value">${esc(entry.content)}</div>
    </div>` : ''}
    <div class="detail-section">
      <div class="detail-label">記録日</div>
      <div class="detail-value">${formatDate(entry.created_at)}</div>
    </div>
  `;

  detailModal.classList.remove('hidden');
}

document.getElementById('deleteBtn').addEventListener('click', async () => {
  if (!currentEntryId) return;
  if (!confirm('この記録を削除しますか？')) return;

  const { error } = await db.from('entries').delete().eq('id', currentEntryId);
  if (error) { showToast('削除エラー: ' + error.message); return; }

  detailModal.classList.add('hidden');
  currentEntryId = null;
  showToast('削除しました');
  await loadData();
  handleRoute();
});

// --- Shop memo edit ---
document.getElementById('editMemoBtn').addEventListener('click', () => {
  isEditingMemo = true;
  document.getElementById('shopMemo').classList.add('hidden');
  document.getElementById('shopMemoEdit').classList.remove('hidden');
  document.getElementById('memoActions').classList.remove('hidden');
  document.getElementById('editMemoBtn').classList.add('hidden');
  document.getElementById('shopMemoEdit').focus();
});

document.getElementById('cancelMemoBtn').addEventListener('click', () => {
  isEditingMemo = false;
  renderShopView();
});

document.getElementById('saveMemoBtn').addEventListener('click', async () => {
  if (!currentShopName) return;
  const btn = document.getElementById('saveMemoBtn');
  btn.disabled = true;
  btn.textContent = '保存中...';

  const memo = document.getElementById('shopMemoEdit').value.trim();
  const { error } = await db.from('shops').upsert({
    name: currentShopName,
    memo,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'name' });

  btn.disabled = false;
  btn.textContent = '保存';

  if (error) { showToast('保存エラー: ' + error.message); return; }
  isEditingMemo = false;
  showToast('メモを保存しました');
  await loadData();
  renderShopView();
});

// --- Toast ---
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2500);
}
