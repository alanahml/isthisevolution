
// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════
const state = {
  files:           [],       // FileEntry[]
  sortOrder:       'age',    // 'age' | 'captured' | 'filename'

  currentIndex:    -1,
  isTransitioning: false,
  blazefaceModel:  null,
  pendingIndex:    -1,
  rafPending:      false,
};

// FileEntry:
// { file, name, ext, type ('image'|'video'), objectURL,
//   lastModified (ms), capturedAt (ms), faceCenter: null | {cx,cy} }

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initUploadScreen();
  document.addEventListener('keydown', handleKeydown);
});

// ══════════════════════════════════════════════════════════════
//  UPLOAD SCREEN
// ══════════════════════════════════════════════════════════════
function initUploadScreen() {
  const zone      = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const beginBtn  = document.getElementById('begin-btn');
  const backBtn   = document.getElementById('back-btn');

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', e => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });

  document.querySelectorAll('input[name="sort"]').forEach(r => {
    r.addEventListener('change', () => { state.sortOrder = r.value; });
  });


  beginBtn.addEventListener('click', () => {
    if (state.files.length) enterTimeline();
  });

  backBtn.addEventListener('click', () => {
    document.getElementById('timeline-screen').style.display = 'none';
    document.getElementById('upload-screen').style.display   = 'flex';
    // Reset preview state so re-entering works cleanly
    state.currentIndex    = -1;
    state.isTransitioning = false;
    state.pendingIndex    = -1;
    document.getElementById('metadata-panel').classList.remove('visible');
    document.getElementById('empty-hint').style.display    = '';
    document.getElementById('preview-img').style.opacity   = '0';
    document.getElementById('preview-video').style.opacity = '0';
    document.getElementById('preview-video').src           = '';

  });
}

// ══════════════════════════════════════════════════════════════
//  FILE PROCESSING
// ══════════════════════════════════════════════════════════════
const ALLOWED_EXTS = new Set(['svg', 'png', 'jpg', 'jpeg', 'gif', 'mp4', 'mov']);
const VIDEO_EXTS   = new Set(['mp4', 'mov', 'webm']);

async function handleFiles(fileList) {
  const raw = Array.from(fileList).filter(f =>
    ALLOWED_EXTS.has(f.name.split('.').pop().toLowerCase())
  );
  if (!raw.length) return;

  const countEl = document.getElementById('file-count');
  countEl.textContent = `processing ${raw.length} file${raw.length !== 1 ? 's' : ''}…`;

  // Revoke any existing object URLs before replacing
  state.files.forEach(e => URL.revokeObjectURL(e.objectURL));

  const entries = await Promise.all(raw.map(processFile));
  state.files = entries;
  sortFiles();

  countEl.textContent = `${state.files.length} file${state.files.length !== 1 ? 's' : ''} ready`;
  document.getElementById('begin-btn').style.display = 'inline-block';
}

async function processFile(file) {
  const ext     = file.name.split('.').pop().toLowerCase();
  const isVideo = VIDEO_EXTS.has(ext);

  let capturedAt = file.lastModified;
  if (!isVideo) {
    const d = await getEXIFDate(file);
    if (d) capturedAt = d.getTime();
  }

  return {
    file,
    name:         file.name,
    ext,
    type:         isVideo ? 'video' : 'image',
    objectURL:    URL.createObjectURL(file),
    lastModified: file.lastModified,
    capturedAt,
    faceCenter:   null,
  };
}

async function getEXIFDate(file) {
  try {
    const data = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'DateTime']);
    if (!data) return null;
    return data.DateTimeOriginal || data.CreateDate || data.DateTime || null;
  } catch {
    return null;
  }
}

function sortFiles() {
  const order = state.sortOrder;
  state.files.sort((a, b) => {
    if (order === 'age')      return a.lastModified - b.lastModified;
    if (order === 'captured') return a.capturedAt   - b.capturedAt;
    if (order === 'filename') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return 0;
  });
}

// ══════════════════════════════════════════════════════════════
//  ENTER TIMELINE
// ══════════════════════════════════════════════════════════════
function enterTimeline() {
  sortFiles(); // apply any radio change made after file drop

  document.getElementById('upload-screen').style.display   = 'none';
  document.getElementById('timeline-screen').style.display = 'block';

  buildScrubber();
  initScrubber();


}

// ══════════════════════════════════════════════════════════════
//  SCRUBBER
// ══════════════════════════════════════════════════════════════
function buildScrubber() {
  const scrubber = document.getElementById('scrubber');
  scrubber.innerHTML = '';
  const frag = document.createDocumentFragment();
  state.files.forEach((entry, i) => {
    const bar = document.createElement('div');
    bar.className     = 'bar';
    bar.dataset.index = i;
    if (entry.type === 'image') {
      const thumb = document.createElement('img');
      thumb.src = entry.objectURL;
      thumb.className = 'bar-thumb';
      bar.appendChild(thumb);
    } else if (entry.type === 'video') {
      const thumb = document.createElement('video');
      thumb.src = entry.objectURL;
      thumb.className = 'bar-thumb';
      thumb.muted = true;
      thumb.preload = 'metadata';
      bar.appendChild(thumb);
    }
    frag.appendChild(bar);
  });
  scrubber.appendChild(frag);
}

function initScrubber() {
  const scrubber = document.getElementById('scrubber');
  let isDragging = false;

  function schedulePreview(i) {
    state.pendingIndex = i;
    if (!state.rafPending) {
      state.rafPending = true;
      requestAnimationFrame(() => {
        state.rafPending = false;
        showPreview(state.pendingIndex);
      });
    }
  }

  scrubber.addEventListener('pointermove', e => {
    const bar = e.target.closest('.bar');
    if (bar) {
      schedulePreview(parseInt(bar.dataset.index, 10));
    } else if (isDragging) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const dragged = el && el.closest('.bar');
      if (dragged) schedulePreview(parseInt(dragged.dataset.index, 10));
    }
  });

  scrubber.addEventListener('pointerdown', e => {
    isDragging = true;
    scrubber.setPointerCapture(e.pointerId);
    const bar = e.target.closest('.bar');
    if (bar) schedulePreview(parseInt(bar.dataset.index, 10));
  });

  scrubber.addEventListener('pointerup',     () => { isDragging = false; });
  scrubber.addEventListener('pointercancel', () => { isDragging = false; });
}

function highlightBar(index) {
  document.querySelectorAll('.bar').forEach((b, i) => {
    b.classList.toggle('active', i === index);
  });
}

// ══════════════════════════════════════════════════════════════
//  PREVIEW / CROSSFADE
// ══════════════════════════════════════════════════════════════
async function showPreview(index) {
  if (index === state.currentIndex || state.isTransitioning) return;
  state.isTransitioning = true;

  const entry    = state.files[index];
  const img      = document.getElementById('preview-img');
  const vid      = document.getElementById('preview-video');
  const isVideo  = entry.type === 'video';
  const incoming = isVideo ? vid : img;
  const outgoing = isVideo ? img : vid;

  // Hide empty hint on first preview
  document.getElementById('empty-hint').style.display = 'none';

  // Pause outgoing video if needed
  if (!isVideo && !vid.paused) vid.pause();

  // Set new source
  if (isVideo) {
    vid.src = entry.objectURL;
    vid.onerror = () => {
      document.getElementById('m-name').textContent =
        entry.name + '  (format may not play in this browser)';
    };
    vid.load();
  } else {
    img.src = entry.objectURL;
  }

  // Cross-fade: fade out outgoing, fade in incoming simultaneously
  outgoing.style.opacity = '0';
  incoming.style.opacity = '1';

  await sleep(100); // match CSS transition duration

  if (isVideo) {
    vid.play().catch(() => {});
  }


  updateMetadata(entry, index);
  highlightBar(index);

  state.currentIndex    = index;
  state.isTransitioning = false;

  // Serve the latest pending index if it changed during transition
  if (state.pendingIndex !== index) {
    const next = state.pendingIndex;
    if (next >= 0 && next < state.files.length) {
      showPreview(next);
    }
  }
}


// ══════════════════════════════════════════════════════════════
//  METADATA
// ══════════════════════════════════════════════════════════════
function updateMetadata(entry, index) {
  const date = new Date(entry.capturedAt);
  document.getElementById('m-age').textContent      = formatElapsed(date);
  document.getElementById('m-datetime').textContent = formatDateTime(date);
  document.getElementById('m-name').textContent     = entry.name;
  document.getElementById('m-type').textContent     =
    (entry.file.type || entry.ext.toUpperCase()).toUpperCase();
  document.getElementById('m-index').textContent    = `#${index + 1} of ${state.files.length}`;
  document.getElementById('metadata-panel').classList.add('visible');
}

// Archival day count: "2,847 days elapsed"
function formatElapsed(date) {
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  return days.toLocaleString('en-US') + ' days elapsed';
}

// "15:32:07  ·  March 14  ·  2019"
function formatDateTime(date) {
  const hms      = date.toTimeString().slice(0, 8);
  const monthDay = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const year     = date.getFullYear();
  return `${hms}  ·  ${monthDay}  ·  ${year}`;
}

// ══════════════════════════════════════════════════════════════
//  KEYBOARD NAVIGATION
// ══════════════════════════════════════════════════════════════
function handleKeydown(e) {
  if (document.getElementById('timeline-screen').style.display === 'none') return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    const next = Math.min(state.currentIndex + 1, state.files.length - 1);
    if (next !== state.currentIndex) { showPreview(next); scrollBarIntoView(next); }
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    const prev = Math.max(state.currentIndex - 1, 0);
    if (prev !== state.currentIndex) { showPreview(prev); scrollBarIntoView(prev); }
  }
}

function scrollBarIntoView(index) {
  const bars = document.querySelectorAll('.bar');
  if (bars[index]) bars[index].scrollIntoView({ inline: 'nearest', behavior: 'smooth' });
}


// ══════════════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
