const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allEntries = [];
let currentEntryId = null;
let selectedRating = 0;

// DOM
const entryList = document.getElementById('entryList');
const searchInput = document.getElementById('searchInput');
const modal = document.getElementById('modal');
const detailModal = document.getElementById('detailModal');
const entryForm = document.getElementById('entryForm');
const toast = document.getElementById('toast');

// --- Init ---
(async () => {
  await loadEntries();
  setupRealtime();
})();

// --- Load entries ---
async function loadEntries() {
  const { data, error } = await db
    .from('entries')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    entryList.innerHTML = `<div class="empty">接続エラー: ${error.message}</div>`;
    return;
  }

  allEntries = data || [];
  renderEntries(allEntries);
}

// --- Realtime ---
function setupRealtime() {
  db.channel('entries')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, () => {
      loadEntries();
    })
    .subscribe();
}

// --- Render ---
function renderEntries(entries) {
  if (entries.length === 0) {
    entryList.innerHTML = '<div class="empty">まだ記録がありません</div>';
    return;
  }

  entryList.innerHTML = entries.map(e => `
    <div class="entry-card" data-id="${e.id}">
      <div class="entry-card-header">
        <div>
          <div class="entry-shop">${esc(e.shop_name)}</div>
          <div class="entry-therapist">${esc(e.therapist_name)}</div>
        </div>
        <span class="entry-date">${formatDate(e.created_at)}</span>
      </div>
      <div class="entry-stars">${renderStars(e.rating)}</div>
      <div class="entry-content-preview">${esc(e.content)}</div>
    </div>
  `).join('');

  document.querySelectorAll('.entry-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

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

// --- Search ---
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { renderEntries(allEntries); return; }
  const filtered = allEntries.filter(e =>
    e.shop_name.toLowerCase().includes(q) ||
    e.therapist_name.toLowerCase().includes(q)
  );
  renderEntries(filtered);
});

// --- Modal open/close ---
document.getElementById('openFormBtn').addEventListener('click', () => {
  entryForm.reset();
  selectedRating = 0;
  updateStars(0);
  modal.classList.remove('hidden');
});

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

// --- Submit ---
entryForm.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = entryForm.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = '保存中...';

  const payload = {
    shop_name: document.getElementById('shopName').value.trim(),
    therapist_name: document.getElementById('therapistName').value.trim(),
    rating: selectedRating,
    options: document.getElementById('options').value.trim(),
    content: document.getElementById('content').value.trim(),
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
  selectedRating = 0;
  updateStars(0);
  await loadEntries();
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
      <div class="detail-label">オプション内容</div>
      <div class="detail-value">${esc(entry.options)}</div>
    </div>` : ''}
    <div class="detail-section">
      <div class="detail-label">内容・メモ</div>
      <div class="detail-value">${esc(entry.content)}</div>
    </div>
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
  await loadEntries();
});

// --- Toast ---
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2500);
}
