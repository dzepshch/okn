const API = 'https://okn-nu.vercel.app/api/';

const districtData = {
  'SVAO':  { count: 0, full: 'Северо-Восточный административный округ' },
  'VAO':   { count: 0, full: 'Восточный административный округ' },
  'YUZAO': { count: 0, full: 'Юго-Западный административный округ' },
  'SAO':   { count: 0, full: 'Северный административный округ' },
  'SZAO':  { count: 0, full: 'Северо-Западный административный округ' },
  'CAO':   { count: 0, full: 'Центральный административный округ' },
  'YAO':   { count: 0, full: 'Южный административный округ' },
  'ZELEN': { count: 0, full: 'Зеленоградский административный округ' },
  'YUVAO': { count: 0, full: 'Юго-Восточный административный округ' },
  'ZAO':   { count: 0, full: 'Западный административный округ' },
  'NAO':   { count: 0, full: 'Новомосковский административный округ' },
};

// Загружаем реальную статистику из API
async function loadStats() {
  try {
    const res = await fetch(`${API}/stats`);
    const data = await res.json();

    // Обновляем счётчик на странице
    const koCount = document.getElementById('ko-count');
    if (koCount) koCount.textContent = data.total.toLocaleString('ru');

    // Маппинг полного названия → id для SVG
    const areaToId = {};
    for (const [id, info] of Object.entries(districtData)) {
      areaToId[info.full] = id;
    }

    // Обновляем кол-во по округам
    for (const [area, count] of Object.entries(data.by_area || {})) {
      const id = areaToId[area];
      if (id && districtData[id]) {
        districtData[id].count = count;
      }
    }
  } catch (e) {
    console.warn('Не удалось загрузить статистику:', e);
  }
}

// Инициализация карты
function initMap() {
  const tooltip = document.getElementById('map-tooltip');
  const ttName  = document.getElementById('tt-name');
  const ttCount = document.getElementById('tt-count');

  document.querySelectorAll('.district').forEach(g => {
    const id   = g.id;
    const name = g.dataset.name;
    const full = g.dataset.full;

    g.addEventListener('mouseenter', () => {
      const count = districtData[id]?.count || 0;
      ttName.textContent  = name;
      ttCount.textContent = count + ' объектов';
      tooltip.classList.add('visible');
    });
    g.addEventListener('mousemove', e => {
      tooltip.style.left = (e.clientX + 16) + 'px';
      tooltip.style.top  = (e.clientY - 44) + 'px';
    });
    g.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });
    g.addEventListener('click', () => {
      window.location.href = `search.html?adm_area=${encodeURIComponent(full)}`;
    });
  });
}

// Mobile menu
document.getElementById('burger').addEventListener('click', () => {
  document.getElementById('mobileMenu').classList.toggle('open');
});

// Запуск
loadStats();
initMap();
