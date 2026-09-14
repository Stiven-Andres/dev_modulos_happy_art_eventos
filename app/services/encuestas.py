"""Encuestas de satisfacción — carga desde plantilla Excel (Microsoft Forms) y
agregación por fecha, portado de cargarPlantillaEncuestas()/renderEncuestas()
en legacy/js/main.js. Usa openpyxl en vez de SheetJS."""
import datetime
import io
import time

import openpyxl

from app.models import DIAS_SEMANA, ENCUESTA_CAMPOS, _norm_encuesta_header


class ImportError_(Exception):
    pass


def _parse_fecha_encuesta(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    s = str(v or "").strip()
    if not s:
        return ""
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return s


def _to_number(v):
    try:
        n = float(v)
        return n if n == n else None  # filtra NaN
    except (TypeError, ValueError):
        return None


def parse_excel_encuestas(file_bytes):
    """Devuelve (encuestas_nuevas: [dict,...] sin id, error: str|None)."""
    try:
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
    except Exception:
        return [], "Error al leer el archivo — verifica que sea la plantilla correcta (.xlsx)"

    sheet = wb.worksheets[0]
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        return [], "El archivo no tiene filas de datos"
    headers = [str(h) if h is not None else "" for h in rows[0]]
    filas = [dict(zip(headers, row)) for row in rows[1:]]
    if not filas:
        return [], "El archivo no tiene filas de datos"

    mapa = {}
    for campo in ENCUESTA_CAMPOS:
        for h in headers:
            if any(k in _norm_encuesta_header(h) for k in campo["match"]):
                mapa[campo["key"]] = h
                break
    if "fecha" not in mapa:
        return [], "No se encontró una columna de fecha en el archivo"

    nuevas = []
    for fila in filas:
        def val(k):
            h = mapa.get(k)
            return fila.get(h, "") if h else ""

        fecha = _parse_fecha_encuesta(val("fecha"))
        if not fecha:
            continue
        nuevas.append({
            "nombreCliente": str(val("nombreCliente") or "").strip(),
            "telefono": str(val("telefono") or "").strip(),
            "fecha": fecha,
            "recomendacion": _to_number(val("recomendacion")),
            "satisfaccion": _to_number(val("satisfaccion")),
            "coordinador": _to_number(val("coordinador")),
            "puntualidad": _to_number(val("puntualidad")),
            "sugerencia": str(val("sugerencia") or "").strip(),
            "mejora": str(val("mejora") or "").strip(),
            "fechaCarga": int(time.time() * 1000),
        })
    return nuevas, None


def agregar_por_fecha(encuestas, dias_filtro):
    filtradas = [
        e for e in encuestas
        if e.get("fecha") and datetime.date.fromisoformat(e["fecha"]).isoweekday() % 7 in dias_filtro
    ]
    por_fecha = {}
    for e in filtradas:
        g = por_fecha.setdefault(e["fecha"], {"n": 0, "recomendacion": 0, "nRec": 0, "satisfaccion": 0, "nSat": 0,
                                               "coordinador": 0, "nCoo": 0, "puntualidad": 0, "nPun": 0})
        g["n"] += 1
        for campo, contador in (("recomendacion", "nRec"), ("satisfaccion", "nSat"),
                                 ("coordinador", "nCoo"), ("puntualidad", "nPun")):
            if e.get(campo):
                g[campo] += e[campo]
                g[contador] += 1

    def avg(suma, n):
        return round(suma / n, 1) if n else None

    filas = []
    for fecha in sorted(por_fecha, reverse=True):
        g = por_fecha[fecha]
        dow = datetime.date.fromisoformat(fecha).isoweekday() % 7
        filas.append({
            "fecha": fecha, "dia_semana": DIAS_SEMANA[dow], "n": g["n"],
            "recomendacion": avg(g["recomendacion"], g["nRec"]),
            "satisfaccion": avg(g["satisfaccion"], g["nSat"]),
            "coordinador": avg(g["coordinador"], g["nCoo"]),
            "puntualidad": avg(g["puntualidad"], g["nPun"]),
        })

    def avg_total(campo):
        vals = [e[campo] for e in filtradas if e.get(campo)]
        return round(sum(vals) / len(vals), 1) if vals else None

    stats = {
        "total": len(filtradas),
        "recomendacion": avg_total("recomendacion"),
        "satisfaccion": avg_total("satisfaccion"),
        "coordinador": avg_total("coordinador"),
    }
    return filas, stats
