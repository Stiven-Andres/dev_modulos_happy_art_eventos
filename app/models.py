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

def label_rol_personal(rol_id):
    for r in ROLES_PERSONAL:
        if r["id"] == rol_id:
            return r["label"]
    return rol_id


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
    return fecha not in (persona.get("noDisponibleFechas") or [])


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


def fmt_fecha_contrato(date_str):
    if not date_str:
        return ""
    y, m, d = date_str.split("-")
    return f"{int(d)} DE {_MESES_LARGOS[int(m) - 1]} {y}"


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
