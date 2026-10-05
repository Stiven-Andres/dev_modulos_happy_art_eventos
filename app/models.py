"""Helpers puros de dominio, portados de legacy/js/models.js.

En el SPA original estas funciones leían un objeto `state` global mutable
mantenido en memoria del navegador y sincronizado en vivo con Firebase. Aquí,
siguiendo la arquitectura sin estado por-request de app/firebase.py, cada
función recibe explícitamente las listas/dicts que necesita (obtenidas de
firebase.get_state() al inicio de cada request) en vez de leer un global.

Los datos constantes (catálogos, roles, etc.) se cargaron en
app/data/catalog.json mediante una extracción directa desde el
legacy/js/models.js original (import dinámico + volcado a JSON), para
garantizar que coinciden exactamente con el original.
"""
import json
import re
import unicodedata
from pathlib import Path

_CATALOG_PATH = Path(__file__).parent / "data" / "catalog.json"
_catalog = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))

ROLES = _catalog["ROLES"]
ROLES_PERSONAL = _catalog["ROLES_PERSONAL"]
# Personal que se asigna por cupos a un evento (logístico/recreador/coordinador/
# operario). "asesor" no se programa por evento, pero sí se registra como
# integrante del staff en la sección Personal — de ahí ROLES_PERSONAL_STAFF.
ROLES_PERSONAL_STAFF = ROLES_PERSONAL + [_catalog["ROL_PERSONAL_STAFF_EXTRA"]]
CUENTAS_PAGO = _catalog["CUENTAS_PAGO"]
RECUPERABLES_KEYWORDS = _catalog["RECUPERABLES_KEYWORDS"]
BUSQUEDA_INVENTARIO_ALIAS = _catalog["BUSQUEDA_INVENTARIO_ALIAS"]
ESPECIFICACION_ITEMS_PAQUETE = _catalog["ESPECIFICACION_ITEMS_PAQUETE"]
PAQUETES = _catalog["PAQUETES"]
MESES_CORTOS = _catalog["MESES_CORTOS"]
DIAS_SEMANA = _catalog["DIAS_SEMANA"]
ENCUESTA_CAMPOS = _catalog["ENCUESTA_CAMPOS"]

_MESES_LARGOS = [
    "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
    "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
]


# ── Roles de usuario (admin/asesor/bodega, por email de login) ─────────────

def obtener_rol(email):
    e = (email or "").lower().strip()
    if not e:
        return None
    if e in ROLES["ADMIN_EMAILS"]:
        return "admin"
    if e in ROLES["ASESOR_EMAILS"]:
        return "asesor"
    if e in ROLES["BODEGA_EMAILS"]:
        return "bodega"
    return None


# ── Personal (staff operativo) ──────────────────────────────────────────────

def _rol_staff_info(rol_id):
    for r in ROLES_PERSONAL_STAFF:
        if r["id"] == rol_id:
            return r
    return None


def label_rol_personal(rol_id):
    r = _rol_staff_info(rol_id)
    return r["label"] if r else rol_id


def label_rol_personal_plural(rol_id):
    r = _rol_staff_info(rol_id)
    return r["labelPlural"] if r else rol_id


def icono_rol_personal(rol_id):
    r = _rol_staff_info(rol_id)
    return r["icon"] if r else "👤"


def get_persona(personal, id_):
    for p in personal:
        if p.get("id") == id_:
            return p
    return None


def esta_disponible(persona, fecha):
    """Por defecto TODO el personal está disponible; solo hay marca explícita
    cuando el admin lo puso como NO disponible para una fecha puntual."""
    if not persona or not fecha:
        return True
    return fecha not in (persona.get("noDisponible") or [])


def persona_asignada_en_fecha(contratos, persona_id, fecha, excluir_contrato_id=None):
    """¿Ya está asignada esta persona a OTRO contrato en la misma fecha?"""
    for c in contratos:
        if c.get("fecha") != fecha:
            continue
        if excluir_contrato_id and c.get("id") == excluir_contrato_id:
            continue
        asign = c.get("personalAsignado")
        if not asign:
            continue
        for rol in ROLES_PERSONAL:
            if persona_id in (asign.get(rol["id"]) or []):
                return True
    return False


def contratos_ocupado_en_fecha(contratos, persona_id, fecha, excluir_contrato_id=None):
    """Lista de contratos (distintos de excluir_contrato_id) donde esta persona
    ya quedó programada para la misma fecha."""
    encontrados = []
    for c in contratos:
        if excluir_contrato_id and c.get("id") == excluir_contrato_id:
            continue
        if c.get("fecha") != fecha:
            continue
        asign = c.get("personalAsignado") or {}
        if any(persona_id in (ids or []) for ids in asign.values()):
            encontrados.append(c)
    return encontrados


def empty_personal_counts():
    return {"logistico": 0, "recreador": 0, "coordinador": 0, "operario": 0}


def empty_personal_asignado():
    return {"logistico": [], "recreador": [], "coordinador": [], "operario": []}


def total_personal_requerido(c):
    r = c.get("personalRequerido") or {}
    return sum(int(r.get(rol["id"]) or 0) for rol in ROLES_PERSONAL)


def total_personal_asignado(c):
    a = c.get("personalAsignado") or {}
    return sum(len(a.get(rol["id"]) or []) for rol in ROLES_PERSONAL)


def programacion_completa(c):
    r = c.get("personalRequerido") or {}
    a = c.get("personalAsignado") or {}
    return all(len(a.get(rol["id"]) or []) >= int(r.get(rol["id"]) or 0) for rol in ROLES_PERSONAL)


def resolver_personal_asignado(personal, c):
    """Nombres del personal ya asignado a un contrato, agrupados por rol."""
    asign = c.get("personalAsignado") or {}
    grupos = []
    for rol in ROLES_PERSONAL:
        ids = asign.get(rol["id"]) or []
        nombres = [p["nombre"] for pid in ids if (p := get_persona(personal, pid))]
        if nombres:
            grupos.append({"rol": rol["id"], "label": rol["labelPlural"], "icono": rol["icon"], "nombres": nombres})
    return grupos


# ── Programación por horario: el personal debe estar en bodega 3 horas antes
# del inicio más temprano del evento (decoración si aplica; si no, la hora de
# inicio de la recreación/animación). ──────────────────────────────────────

def _minutos_desde_hora(time_str):
    if not time_str:
        return None
    try:
        h, m = (int(x) for x in time_str.split(":"))
    except ValueError:
        return None
    return h * 60 + m


def calc_minutos_hora_bodega(c):
    candidatos = []
    m_deco = _minutos_desde_hora(c.get("horaDecoracion"))
    m_ini = _minutos_desde_hora(c.get("hora"))
    if m_deco is not None:
        candidatos.append(m_deco)
    if m_ini is not None:
        candidatos.append(m_ini)
    if not candidatos:
        return None
    return min(candidatos) - 180


def fmt_minutos_hora(mins):
    if mins is None:
        return ""
    dia_anterior = mins < 0
    normalizado = ((mins % 1440) + 1440) % 1440
    h, m = divmod(normalizado, 60)
    hr12 = 12 if h == 0 else (h - 12 if h > 12 else h)
    ampm = "PM" if h >= 12 else "AM"
    sufijo = " (día anterior)" if dia_anterior else ""
    return f"{hr12}:{m:02d} {ampm}{sufijo}"


def fmt_hora_bodega(c):
    mins = calc_minutos_hora_bodega(c)
    return "—" if mins is None else fmt_minutos_hora(mins)


# ── Encuestas de satisfacción ───────────────────────────────────────────────

def _norm_encuesta_header(s):
    s = str(s or "").lower().strip()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s


# ── Inventario ───────────────────────────────────────────────────────────────

def get_prod(productos, id_):
    for p in productos:
        if p.get("id") == id_:
            return p
    return None


def telefono_valido(valor):
    if not valor:
        return True
    return re.fullmatch(r"3[0-9]{9}", valor) is not None


def stock_status(p):
    if p.get("stock") == 0:
        return "out"
    if p.get("stock") <= p.get("min"):
        return "low"
    return "ok"


def status_badge(p):
    s = stock_status(p)
    if s == "out":
        return '<span class="badge badge-out">❌ Agotado</span>'
    if s == "low":
        return '<span class="badge badge-low">⚠️ Stock bajo</span>'
    return '<span class="badge badge-ok">✅ Disponible</span>'


def cat_class(cat):
    slug = re.sub(r"\s*/\s*", "---", cat.lower())
    slug = re.sub(r"\s+", "-", slug)
    return "bc-" + slug


def evento_badge(ev):
    if ev == "Social":
        return '<span class="badge-ev bev-social">🎊 Social</span>'
    if ev == "Empresarial":
        return '<span class="badge-ev bev-empresarial">💼 Empresarial</span>'
    return '<span class="badge-ev bev-ambos">✨ Ambos</span>'


def _norm_recuperable(s):
    s = s.lower()
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def is_consumable(item_name):
    n = _norm_recuperable(item_name)
    es_recuperable = any(
        (n in _norm_recuperable(kw)) or (_norm_recuperable(kw) in n)
        for kw in RECUPERABLES_KEYWORDS
    )
    return not es_recuperable


def buscar_terminos_inventario(item_name):
    n = _norm_recuperable(item_name)
    alias = next(
        (a for a in BUSQUEDA_INVENTARIO_ALIAS if _norm_recuperable(a["match"]) in n),
        None,
    )
    return alias["buscar"] if alias else [item_name]


def _buscar_especificacion(item_name):
    n = _norm_recuperable(item_name)
    return next(
        (e for e in ESPECIFICACION_ITEMS_PAQUETE if _norm_recuperable(e["match"]) in n),
        None,
    )


# ── Formato de números / fechas ─────────────────────────────────────────────

def _miles_es_co(n):
    """Separador de miles con punto, como Number.toLocaleString('es-CO')."""
    entero = int(round(float(n)))
    return f"{entero:,}".replace(",", ".")


def fmt(n):
    return _miles_es_co(n)


def fmt_date(d):
    """Equivalente a toLocaleDateString('es-CO', {day:'2-digit', month:'short', year:'numeric'})."""
    from datetime import datetime

    dt = d if hasattr(d, "year") else datetime.fromisoformat(str(d).replace("Z", "+00:00"))
    mes = MESES_CORTOS[dt.month - 1].lower()
    return f"{dt.day:02d} {mes} {dt.year}"


def fmt_fecha(d):
    """Equivalente a toLocaleString('es-CO', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'})."""
    from datetime import datetime

    dt = d if hasattr(d, "year") else datetime.fromisoformat(str(d).replace("Z", "+00:00"))
    mes = MESES_CORTOS[dt.month - 1].lower()
    return f"{dt.day:02d} {mes}, {dt.hour:02d}:{dt.minute:02d}"


def fmt_precio(n):
    return "$" + _miles_es_co(n)


def valor_total_contrato(c):
    """Valor del paquete + transporte intermunicipal (si aplica) — es lo que
    se muestra como 'Valor del Paquete' en el contrato impreso."""
    return (float(c.get("valor") or 0)) + (float(c.get("transporte") or 0))


def fmt_fecha_contrato(date_str):
    if not date_str:
        return ""
    y, m, d = date_str.split("-")
    return f"{int(d)} DE {_MESES_LARGOS[int(m) - 1]} {y}"


# ── Comisiones de asesores (10% del valor del paquete, sin transporte) ──────
# Nada de esto se guarda en Firebase: se calcula al vuelo a partir de
# state["contratos"], portado de la sección COMISIONES de legacy/js/models.js
# y legacy/js/operations.js.
COMISION_PORCENTAJE = 0.10


def comision_contrato(c):
    return round((float(c.get("valor") or 0)) * COMISION_PORCENTAJE)


def usuario_asesor(email):
    """'brayang@asesoreventos.com' -> 'brayang'"""
    return str(email or "").split("@")[0]


def fecha_venta_contrato(c):
    """Fecha en que se VENDIÓ el contrato (cuando el asesor lo registró). Si
    algún contrato antiguo no tiene fechaRegistro, se usa la fecha del evento
    como respaldo."""
    from datetime import datetime

    if c.get("fechaRegistro"):
        return datetime.fromtimestamp(c["fechaRegistro"] / 1000).date()
    if c.get("fecha"):
        y, m, d = c["fecha"].split("-")
        return datetime(int(y), int(m), int(d)).date()
    return None


def fecha_evento_contrato(c):
    """Fecha en que SE REALIZA el evento (c.fecha), distinta de la fecha de
    venta: se usa para saber en qué mes/quincena cae el evento."""
    from datetime import datetime

    if c.get("fecha"):
        y, m, d = c["fecha"].split("-")
        return datetime(int(y), int(m), int(d)).date()
    return None


def quincena_de_fecha(fecha):
    """1 = evento entre el día 1 y el 14 del mes; 2 = entre el 15 y el fin."""
    return 1 if fecha.day <= 14 else 2


def evento_realizado(c, ahora=None):
    """¿Ya pasó la fecha del evento? Se valida contra la fecha actual,
    comparando solo el día, para que un evento "hoy" cuente como realizado."""
    from datetime import date

    f = fecha_evento_contrato(c)
    if not f:
        return False
    hoy = ahora or date.today()
    return f <= hoy


def fmt_hora(time_str):
    if not time_str:
        return ""
    h, minute = time_str.split(":")
    hr = int(h)
    hr12 = hr - 12 if hr > 12 else hr
    ampm = "PM" if hr >= 12 else "AM"
    return f"{hr12}:{minute} {ampm}"


def fmt_hora_evento(c):
    c = c or {}
    hora_inicio = fmt_hora(c.get("hora")) if c.get("hora") else ""
    hora_deco = fmt_hora(c.get("horaDecoracion")) if c.get("horaDecoracion") else ""
    if not hora_inicio and not hora_deco:
        return ""
    if hora_deco and hora_inicio:
        return f"{hora_deco} decoración · {hora_inicio} recreación"
    return hora_inicio or f"{hora_deco} decoración"
