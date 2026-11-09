const IMG_BASE = '/art/works/square-medium/';
const PLACEHOLDER = '/placeholder.svg';

const listEl = document.getElementById('paintingList');
const form = document.getElementById('paintingForm');
const placeholderEl = document.getElementById('placeholder');
const messageEl = document.getElementById('message');
const preview = document.getElementById('preview');

function imgWithFallback(img, fileName) {
  img.onerror = () => { img.onerror = null; img.src = PLACEHOLDER; }; // default image if file is missing
  // art.db stores names without an extension (art.json includes .jpg), so handle both
  const file = /\.\w+$/.test(fileName) ? fileName : fileName + '.jpg';
  img.src = IMG_BASE + file;
}

function setMessage(text, type = '') {
  messageEl.textContent = text;
  messageEl.className = 'message ' + type;
}

// ---- Load the list of paintings (API runs a SELECT query) ----
async function loadPaintings() {
  const res = await fetch('/api/paintings');
  const paintings = await res.json();
  listEl.innerHTML = '';
  paintings.forEach(p => listEl.appendChild(buildItem(p)));
}

function buildItem(p) {
  const item = document.createElement('div');
  item.className = 'item';
  item.dataset.id = p.PaintingID;

  const img = document.createElement('img');
  img.alt = p.Title;
  imgWithFallback(img, p.ImageFileName);

  const link = document.createElement('a');
  link.href = '#painting-' + p.PaintingID;
  link.textContent = p.Title;

  // Event listeners: clicking the icon or the link button opens the painting in the form
  const open = e => { e.preventDefault(); selectPainting(p.PaintingID); };
  link.addEventListener('click', open);
  img.addEventListener('click', open);

  item.append(img, link);
  return item;
}

function fillSelect(id, rows, valueKey, textKey) {
  const sel = document.getElementById(id);
  sel.innerHTML = '<option value=""></option>' +
    rows.map(r => `<option value="${r[valueKey]}">${String(r[textKey]).replace(/</g, '&lt;')}</option>`).join('');
}

async function loadLookups() {
  const l = await (await fetch('/api/lookups')).json();
  fillSelect('artistSelect', l.artists, 'ArtistID', 'Name');
  fillSelect('gallerySelect', l.galleries, 'GalleryID', 'GalleryName');
  fillSelect('shapeSelect', l.shapes, 'ShapeID', 'ShapeName');
}

// ---- Show one painting in the form ----
async function selectPainting(id) {
  const res = await fetch('/api/paintings/' + id);
  if (!res.ok) { setMessage('Could not load painting.', 'error'); return; }
  populateForm(await res.json());
  document.querySelectorAll('.item').forEach(el => el.classList.toggle('active', el.dataset.id == id));
}

function populateForm(p) {
  placeholderEl.hidden = true;
  form.hidden = false;
  form.action = '/api/paintings/' + p.PaintingID; // action attribute points at this painting's update route
  form.dataset.id = p.PaintingID;
  document.getElementById('paintingIdText').textContent = p.PaintingID; // primary key: text only, not editable
  document.getElementById('formHeading').textContent = p.Title;
  imgWithFallback(preview, p.ImageFileName);
  for (const el of form.elements) {
    if (!el.name) continue;
    el.value = p[el.name] ?? '';
    el.defaultValue = el.value; // so Reset restores the saved values
    if (el.tagName === 'SELECT') {
      [...el.options].forEach(o => o.defaultSelected = (o.value === el.value));
    }
  }
  setMessage('');
}

// ---- Save: send form data back to the database (API runs an UPDATE query) ----
form.addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  try {
    const res = await fetch(form.action, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Save failed');
    populateForm(result.painting);
    setMessage('Saved!', 'ok');
    // refresh the matching list entry (title / image may have changed)
    const item = listEl.querySelector(`.item[data-id="${result.painting.PaintingID}"]`);
    if (item) {
      item.querySelector('a').textContent = result.painting.Title;
      imgWithFallback(item.querySelector('img'), result.painting.ImageFileName);
    }
  } catch (err) {
    setMessage(err.message, 'error');
  }
});

form.addEventListener('reset', () => {
  setTimeout(() => setMessage('Form reset to saved values.'), 0);
});

loadLookups().then(loadPaintings);
