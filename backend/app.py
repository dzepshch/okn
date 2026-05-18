from flask import Flask, jsonify, request
from flask_cors import CORS
from supabase import create_client, Client
from config import SUPABASE_URL, SUPABASE_KEY, FLASK_SECRET_KEY, FLASK_ENV
import math

app = Flask(__name__)
app.secret_key = FLASK_SECRET_KEY
# CORS — для отдельного фронтенда на Vercel
CORS(app, resources={r"/api/*": {
    "origins": [
        "https://okn-365a.vercel.app",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "*"
    ],
    "methods": ["GET", "POST", "OPTIONS"],
    "allow_headers": ["Content-Type", "Authorization"]
}})

@app.after_request
def after_request(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response

# Обработка OPTIONS (preflight)
@app.route("/api/<path:path>", methods=["OPTIONS"])
def options_handler(path):
    return jsonify({}), 200  # разрешаем запросы с фронта

# Supabase клиент
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

TABLE = "cultural_objects"


# ─────────────────────────────────────────────
# GET /api/objects
# Параметры:
#   q         — поиск по названию
#   adm_area  — фильтр по округу
#   district  — фильтр по району
#   obj_type  — фильтр по типу объекта
#   category  — фильтр по категории
#   page      — номер страницы (default 1)
#   per_page  — объектов на страницу (default 20, max 100)
# ─────────────────────────────────────────────
@app.route("/api/objects", methods=["GET"])
def get_objects():
    q        = request.args.get("q", "").strip()
    adm_area = request.args.get("adm_area", "").strip()
    district = request.args.get("district", "").strip()
    obj_type = request.args.get("obj_type", "").strip()
    category = request.args.get("category", "").strip()

    try:
        page     = max(1, int(request.args.get("page", 1)))
        per_page = min(100, max(1, int(request.args.get("per_page", 20))))
    except ValueError:
        page, per_page = 1, 20

    offset = (page - 1) * per_page

    # Строим запрос
    query = supabase.table(TABLE).select("*", count="exact")

    if q:
        query = query.ilike("name", f"%{q}%")
    if adm_area:
        query = query.eq("adm_area", adm_area)
    if district:
        query = query.eq("district", district)
    if obj_type:
        query = query.eq("obj_type", obj_type)
    if category:
        query = query.eq("category", category)

    query = query.order("name").range(offset, offset + per_page - 1)

    response = query.execute()

    total = response.count or 0
    total_pages = math.ceil(total / per_page) if total else 1

    return jsonify({
        "objects": response.data,
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
        }
    })


# ─────────────────────────────────────────────
# GET /api/objects/<id>
# ─────────────────────────────────────────────
@app.route("/api/objects/<int:obj_id>", methods=["GET"])
def get_object(obj_id):
    response = supabase.table(TABLE).select("*").eq("id", obj_id).single().execute()

    if not response.data:
        return jsonify({"error": "Объект не найден"}), 404

    return jsonify(response.data)


# ─────────────────────────────────────────────
# GET /api/stats
# Возвращает кол-во объектов по округам и типам
# ─────────────────────────────────────────────
@app.route("/api/stats", methods=["GET"])
def get_stats():
    # Все объекты для подсчёта (только нужные поля)
    response = supabase.table(TABLE).select("adm_area, obj_type").execute()
    data = response.data or []

    # Считаем по округам
    by_area = {}
    by_type = {}
    for obj in data:
        area = obj.get("adm_area", "")
        otype = obj.get("obj_type", "")
        if area:
            by_area[area] = by_area.get(area, 0) + 1
        if otype:
            by_type[otype] = by_type.get(otype, 0) + 1

    return jsonify({
        "total": len(data),
        "by_area": by_area,
        "by_type": by_type,
    })


# ─────────────────────────────────────────────
# GET /api/filters
# Возвращает уникальные значения для фильтров
# ─────────────────────────────────────────────
@app.route("/api/filters", methods=["GET"])
def get_filters():
    response = supabase.table(TABLE).select("adm_area, district, obj_type, category").execute()
    data = response.data or []

    adm_areas  = sorted(set(o["adm_area"] for o in data if o.get("adm_area")))
    districts  = sorted(set(o["district"]  for o in data if o.get("district")))
    obj_types  = sorted(set(o["obj_type"]  for o in data if o.get("obj_type")))
    categories = sorted(set(o["category"]  for o in data if o.get("category")))

    return jsonify({
        "adm_areas":  adm_areas,
        "districts":  districts,
        "obj_types":  obj_types,
        "categories": categories,
    })


# ─────────────────────────────────────────────
# POST /api/route
# Принимает список id объектов, возвращает
# оптимальный порядок обхода (алгоритм
# ближайшего соседа) + общее расстояние
#
# Body: { "ids": [1, 3, 7, 12] }
# ─────────────────────────────────────────────
@app.route("/api/route", methods=["POST"])
def build_route():
    body = request.get_json()
    if not body or "ids" not in body:
        return jsonify({"error": "Передайте список ids"}), 400

    ids = body["ids"]
    if len(ids) < 2:
        return jsonify({"error": "Нужно минимум 2 объекта"}), 400
    if len(ids) > 20:
        return jsonify({"error": "Максимум 20 объектов в маршруте"}), 400

    # Загружаем объекты
    response = supabase.table(TABLE).select("id, name, adm_area, address, lat, lng").in_("id", ids).execute()
    objects = response.data or []

    if len(objects) < 2:
        return jsonify({"error": "Объекты не найдены"}), 404

    # Алгоритм ближайшего соседа (Nearest Neighbor TSP)
    def haversine(lat1, lon1, lat2, lon2):
        R = 6371  # радиус Земли в км
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
        return R * 2 * math.asin(math.sqrt(a))

    unvisited = list(objects)
    route = [unvisited.pop(0)]  # начинаем с первого

    while unvisited:
        last = route[-1]
        nearest = min(unvisited, key=lambda o: haversine(
            last["lat"], last["lng"], o["lat"], o["lng"]
        ))
        route.append(nearest)
        unvisited.remove(nearest)

    # Считаем общее расстояние и время
    total_distance_km = 0
    for i in range(len(route) - 1):
        total_distance_km += haversine(
            route[i]["lat"], route[i]["lng"],
            route[i+1]["lat"], route[i+1]["lng"]
        )

    # Пешком ~5 км/ч, на каждый объект ~30 мин
    walk_time_min = round((total_distance_km / 5) * 60)
    visit_time_min = len(route) * 30
    total_time_min = walk_time_min + visit_time_min

    hours, mins = divmod(total_time_min, 60)
    duration_str = f"{hours} ч {mins} мин" if hours else f"{mins} мин"

    return jsonify({
        "route": route,
        "stats": {
            "distance_km": round(total_distance_km, 2),
            "walk_time_min": walk_time_min,
            "visit_time_min": visit_time_min,
            "total_time_min": total_time_min,
            "duration": duration_str,
            "objects_count": len(route),
        }
    })


# ─────────────────────────────────────────────
# Healthcheck
# ─────────────────────────────────────────────
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    debug = FLASK_ENV == "development"
    app.run(debug=debug, port=5000)
