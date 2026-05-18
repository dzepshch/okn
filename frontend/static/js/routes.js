const API = 'https://okn-nu.vercel.app/api/';

// ── Состояние ──
const routeState = {
  objects: [],   // объекты в маршруте [{id, name, adm_area, address, lat, lng}]
  built:   false,
};

// ── DOM ──
const addSearchInput  = document.getElementById('add-search-input');
const addSearchBtn    = document.getElementById('add-search-btn');
const addResults      = document.getElementById('add-results');
const routeItemsList  = document.getElementById('route-items');
const routeEmpty      = document.getElementById('route-empty');
const buildBtn        = document.getElementById('build-btn');
const statDuration    = document.getElementById('stat-duration');
const statDistance    = document.getElementById('stat-distance');
const statCount       = document.getElementById('stat-count');
const suggestions     = document.getElementById('suggestions-panel');
const suggList        = document.getElementById('suggestions-list');

// ── Яндекс Карта ──
let ymap        = null;
let routeLine   = null;
let routeMarkers = [];

function initMap() {
  if (typeof ymaps === 'undefined') return;
  ymaps.ready(() => {
    ymap = new ymaps.Map('routes-map', {
      center: [55.751244, 37.618423],
      zoom: 10,
      controls: ['zoomControl'],
    }, { suppressMapOpenBlock: true });
  });
}

// ── Загрузка из sessionStorage ──
function loadFromSession() {
  const stored = JSON.parse(sessionStorage.getItem('route_objects') || '[]');
  if (stored.length === 0) return;

  // Загружаем полные данные по каждому id
  Promise.all(stored.map(o =>
    fetch(`${API}/objects/${o.id}`).then(r => r.json())
  )).then(objects => {
    objects.forEach(addToRoute);
  }).catch(console.error);
}

// ── Поиск объектов для добавления ──
let searchTimeout = null;

addSearchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = addSearchInput.value.trim();
  if (q.length < 2) { addResults.classList.remove('open'); return; }

  searchTimeout = setTimeout(async () => {
    try {
      const res  = await fetch(`${API}/objects?q=${encodeURIComponent(q)}&per_page=8`);
      const data = await res.json();
      renderAddResults(data.objects);
    } catch (e) { console.error(e); }
  }, 300);
});

addSearchBtn.addEventListener('click', () => {
  const q = addSearchInput.value.trim();
  if (!q) return;
  addSearchInput.dispatchEvent(new Event('input'));
});

function renderAddResults(objects) {
  if (!objects || objects.length === 0) {
    addResults.innerHTML = `<div class="add-result-item"><div class="add-result-name" style="color:var(--ink-soft)">Ничего не найдено</div></div>`;
    addResults.classList.add('open');
    return;
  }

  addResults.innerHTML = objects.map(o => `
    <div class="add-result-item" onclick="selectObject(${o.id})">
      <div class="add-result-name">${o.name}</div>
      <div class="add-result-sub">${o.obj_type || ''} · ${o.district || o.adm_area || ''}</div>
    </div>
  `).join('');
  addResults.classList.add('open');
}

async function selectObject(id) {
  if (routeState.objects.find(o => o.id === id)) {
    addResults.classList.remove('open');
    addSearchInput.value = '';
    return;
  }

  try {
    const res = await fetch(`${API}/objects/${id}`);
    const obj = await res.json();
    addToRoute(obj);
    addResults.classList.remove('open');
    addSearchInput.value = '';
  } catch (e) { console.error(e); }
}

// Закрываем дропдаун при клике вне
document.addEventListener('click', e => {
  if (!addResults.contains(e.target) && e.target !== addSearchInput && e.target !== addSearchBtn) {
    addResults.classList.remove('open');
  }
});

// ── Управление маршрутом ──
function addToRoute(obj) {
  if (routeState.objects.find(o => o.id === obj.id)) return;
  if (routeState.objects.length >= 20) {
    alert('Максимум 20 объектов в маршруте');
    return;
  }

  routeState.objects.push(obj);
  routeState.built = false;
  renderRouteList();
  addMarker(obj);
  updateBuildBtn();
}

function removeFromRoute(id) {
  routeState.objects = routeState.objects.filter(o => o.id !== id);
  routeState.built = false;
  renderRouteList();
  refreshMarkers();
  updateBuildBtn();
  resetStats();
  suggestions.classList.remove('open');
}

function renderRouteList() {
  if (routeState.objects.length === 0) {
    routeEmpty.style.display = 'flex';
    routeItemsList.innerHTML = '';
    return;
  }

  routeEmpty.style.display = 'none';
  routeItemsList.innerHTML = routeState.objects.map((obj, i) => `
    <div class="route-item">
      <div class="route-item-num">${i + 1}</div>
      <div class="route-item-info">
        <div class="route-item-name">${obj.name}</div>
        <div class="route-item-sub">${obj.obj_type || ''} · ${obj.district || obj.adm_area || ''}</div>
      </div>
      <button class="route-item-remove" onclick="removeFromRoute(${obj.id})" title="Удалить">×</button>
    </div>
  `).join('');
}

function updateBuildBtn() {
  buildBtn.disabled = routeState.objects.length < 2;
}

// ── Построение маршрута ──
buildBtn.addEventListener('click', async () => {
  if (routeState.objects.length < 2) return;

  buildBtn.disabled = true;
  buildBtn.textContent = 'Строим маршрут...';

  try {
    const ids = routeState.objects.map(o => o.id);
    const res  = await fetch(`${API}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json();

    // Обновляем порядок в списке
    routeState.objects = data.route;
    routeState.built   = true;
    renderRouteList();
    drawRoute(data.route);
    renderStats(data.stats);
    document.getElementById('open-yandex-btn').style.display = 'block';
    loadSuggestions(data.route);

  } catch (e) {
    console.error(e);
    alert('Ошибка построения маршрута');
  } finally {
    buildBtn.disabled = false;
    buildBtn.textContent = 'Построить маршрут';
  }
});

// ── Карта: маркеры и линия ──
function addMarker(obj) {
  if (!ymap || !obj.lat || !obj.lng) return;

  const pm = new ymaps.Placemark(
    [obj.lat, obj.lng],
    { hintContent: obj.name, balloonContent: `${obj.name}<br>${obj.address || ''}` },
    { preset: 'islands#greenDotIcon' }
  );
  ymap.geoObjects.add(pm);
  routeMarkers.push({ id: obj.id, pm });

  // Подстраиваем зум
  if (routeState.objects.length === 1) {
    ymap.setCenter([obj.lat, obj.lng], 13);
  }
}

function refreshMarkers() {
  if (!ymap) return;
  routeMarkers.forEach(m => ymap.geoObjects.remove(m.pm));
  routeMarkers = [];
  if (routeLine) { ymap.geoObjects.remove(routeLine); routeLine = null; }
  routeState.objects.forEach(addMarker);
}

function drawRoute(objects) {
  if (!ymap) return;

  // Удаляем старый маршрут и маркеры
  if (routeLine) {
    ymap.geoObjects.remove(routeLine);
    routeLine = null;
  }
  routeMarkers.forEach(m => ymap.geoObjects.remove(m.pm));
  routeMarkers = [];

  const points = objects.filter(o => o.lat && o.lng);
  if (points.length < 2) return;

  // Формируем точки для multiRouter
  const referencePoints = points.map(o => [o.lat, o.lng]);

  // Строим реальный маршрут через Яндекс
  routeLine = new ymaps.multiRouter.MultiRoute(
    {
      referencePoints: referencePoints,
      params: { routingMode: 'masstransit' }, // общественный транспорт, 
    },
    {
      // Скрываем стандартные маркеры Яндекса — сделаем свои
      wayPointVisible: false,
      routeActiveStrokeColor: '#4D8051',
      routeActiveStrokeWidth: 4,
      routeStrokeColor: '#80B384',
      routeStrokeWidth: 2,
      boundsAutoApply: true, // автоматически подстраивает зум
    }
  );

  ymap.geoObjects.add(routeLine);

  // Когда маршрут построен — получаем реальное время и расстояние от Яндекса
  routeLine.model.events.add('requestsuccess', function () {
    const activeRoute = routeLine.getActiveRoute();
    if (!activeRoute) return;

    const distanceM  = activeRoute.properties.get('distance').value;
    const durationS  = activeRoute.properties.get('duration').value;

    const distanceKm = (distanceM / 1000).toFixed(2);
    const hours      = Math.floor(durationS / 3600);
    const mins       = Math.floor((durationS % 3600) / 60);
    const durationStr = hours > 0 ? `${hours} ч ${mins} мин` : `${mins} мин`;

    // Обновляем статистику реальными данными от Яндекса
    statDuration.textContent = durationStr;
    statDistance.textContent = distanceKm + ' км';
  });

  // Пронумерованные маркеры поверх маршрута
  points.forEach((obj, i) => {
    const pm = new ymaps.Placemark(
      [obj.lat, obj.lng],
      {
        iconContent: i + 1,
        hintContent: obj.name,
        balloonContent: `${obj.name}<br><small>${obj.address || ''}</small>`,
      },
      { preset: 'islands#greenStretchyIcon' }
    );
    ymap.geoObjects.add(pm);
    routeMarkers.push({ id: obj.id, pm });
  });
}

// ── Статистика ──
function renderStats(stats) {
  statDuration.textContent = stats.duration;
  statDistance.textContent = stats.distance_km + ' км';
  statCount.textContent    = stats.objects_count + ' объектов';
}

function resetStats() {
  statDuration.textContent = '—';
  statDistance.textContent = '—';
  statCount.textContent    = routeState.objects.length + ' объектов';
}

// ── Рекомендации ──
async function loadSuggestions(route) {
  if (route.length === 0) return;

  // Берём последний объект маршрута и ищем ближайшие КО рядом
  const last = route[route.length - 1];
  if (!last.adm_area) return;

  try {
    const res  = await fetch(`${API}/objects?adm_area=${encodeURIComponent(last.adm_area)}&per_page=10`);
    const data = await res.json();

    const routeIds = new Set(route.map(o => o.id));
    const nearby = (data.objects || [])
      .filter(o => !routeIds.has(o.id))
      .slice(0, 3);

    if (nearby.length === 0) return;

    suggList.innerHTML = nearby.map(o => `
      <div class="suggestion-item" onclick="selectSuggestion(${o.id})">
        <div class="suggestion-name">${o.name}</div>
        <div class="suggestion-add">+</div>
      </div>
    `).join('');

    suggestions.classList.add('open');
  } catch (e) { console.error(e); }
}

async function selectSuggestion(id) {
  try {
    const res = await fetch(`${API}/objects/${id}`);
    const obj = await res.json();
    addToRoute(obj);
    suggestions.classList.remove('open');
  } catch (e) { console.error(e); }
}

function openInYandex() {
  const points = routeState.objects.filter(o => o.lat && o.lng);
  if (points.length < 2) return;

  const rtext = points.map(o => `${o.lat},${o.lng}`).join('~');
  const url = `https://yandex.ru/maps/?rtext=${rtext}&rtt=mt`; // mt = masstransit
  window.open(url, '_blank');
}
// Mobile menu
document.getElementById('burger').addEventListener('click', () => {
  document.getElementById('mobileMenu').classList.toggle('open');
});

// ── Запуск ──
initMap();
loadFromSession();
renderRouteList();
updateBuildBtn();
resetStats();
