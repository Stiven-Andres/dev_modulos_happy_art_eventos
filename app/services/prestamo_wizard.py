"""Wizard de préstamo por paquete (3 pasos), portado de loanSelectPkg()/
renderLoanStep2()/confirmarPrestamoPaquete() en legacy/js/main.js. El borrador
en curso se guarda en la sesión del servidor (equivalente a las variables
loanPkgId/loanReturnItems/loanConsumeItems/loanExtrasSelected en memoria del
navegador), ya que aquí no hay estado persistente de cliente."""
import time

from app.models import PAQUETES, is_consumable
from app.services.calculos import match_inventario_multiple
from app.services.productos import get_prod


class ValidationError(Exception):
    pass


CATEGORIAS_PAQUETE = [
    {"id": "cumpleanos", "label": "🎂 Cumpleaños"},
    {"id": "baby_shower", "label": "👶 Baby Shower"},
    {"id": "revelacion", "label": "🎀 Revelación de Género"},
]


def _buscar_terminos_inventario(item_name):
    from app.models import BUSQUEDA_INVENTARIO_ALIAS, _norm_recuperable
    n = _norm_recuperable(item_name)
    alias = next((a for a in BUSQUEDA_INVENTARIO_ALIAS if _norm_recuperable(a["match"]) in n), None)
    return alias["buscar"] if alias else [item_name]


def iniciar_draft(state, pk_id):
    pk = next((p for p in PAQUETES if p["id"] == pk_id), None)
    if not pk:
        raise ValidationError("Paquete no encontrado")
    productos = state["productos"]
    return_items = []
    consume_items = []
    for item_name in pk["items"]:
        if is_consumable(item_name):
            consume_items.append(item_name)
            continue
        for termino in _buscar_terminos_inventario(item_name):
            todas = match_inventario_multiple(productos, termino)
            necesita_variante = len(todas) > 1
            prod = None if necesita_variante else (next((p for p in todas if p["stock"] > 0), todas[0]) if todas else None)
            return_items.append({
                "name": item_name,
                "prodId": prod["id"] if prod else None,
                "qty": 1 if prod else 0,
                "fromInventory": bool(prod) or necesita_variante,
                "necesitaVariante": necesita_variante,
                "variantesDisponibles": [p["id"] for p in todas] if necesita_variante else [],
                "seleccionesVariante": [{"prodId": None, "qty": 1}] if necesita_variante else [],
            })
    return {
        "pkId": pk_id, "returnItems": return_items, "consumeItems": consume_items,
        "extras": [],  # [{prodId, qty}]
    }


def confirmar(state, draft, coordinador, cliente, fecha_evento, retorno, nota):
    cliente = (cliente or "").strip()
    if not cliente:
        raise ValidationError("Ingresa el nombre del cliente / evento")

    pendientes = [it for it in draft["returnItems"]
                  if it["necesitaVariante"] and not any(l["prodId"] for l in it["seleccionesVariante"])]
    if pendientes:
        nombres = ", ".join(it["name"] for it in pendientes[:3])
        raise ValidationError(f"⚠️ Falta elegir el tipo específico de: {nombres}")

    pk = next((p for p in PAQUETES if p["id"] == draft["pkId"]), None)
    evento_ref = f"{pk['nombre'] if pk else 'Evento'} · {cliente}"
    retorno_ts = None
    if retorno:
        import datetime
        retorno_ts = int(datetime.datetime.fromisoformat(retorno).timestamp() * 1000)
    now = int(time.time() * 1000)

    registrados = 0
    sin_stock = []

    def _crear_prestamo(p, qty, nota_extra):
        nonlocal registrados
        if p["stock"] < qty:
            sin_stock.append(p["nombre"] + (f" ({p['sku']})" if p.get("sku") else ""))
            return
        p["stock"] -= qty
        state["prestamos"].append({
            "id": state["nextPrestId"], "prodId": p["id"], "qty": qty, "cliente": evento_ref,
            "coordinador": coordinador, "paquete": pk["nombre"] if pk else None, "salida": now,
            "retorno": retorno_ts, "devuelto": False, "nota": nota + nota_extra, "tipoItem": "recuperable",
        })
        state["nextPrestId"] += 1
        state["movimientos"].append({
            "id": state["nextMovId"], "prodId": p["id"], "tipo": "prestamo", "qty": -qty,
            "evento": evento_ref, "nota": f"Préstamo paquete {pk['nombre'] if pk else ''}{nota_extra}", "fecha": now,
        })
        state["nextMovId"] += 1
        registrados += 1

    for item in draft["returnItems"]:
        if not item["fromInventory"]:
            continue
        if item["necesitaVariante"]:
            for linea in item["seleccionesVariante"]:
                if not linea["prodId"] or linea["qty"] <= 0:
                    continue
                p = get_prod(state, linea["prodId"])
                if not p:
                    continue
                nota_variante = f" ({item['name']}: {p['sku']}{' — ' + p['desc'] if p.get('desc') else ''})"
                _crear_prestamo(p, linea["qty"], nota_variante)
        else:
            if item["qty"] <= 0 or not item["prodId"]:
                continue
            p = get_prod(state, item["prodId"])
            if not p:
                continue
            _crear_prestamo(p, item["qty"], "")

    for extra in draft["extras"]:
        p = get_prod(state, extra["prodId"])
        if not p or p["stock"] < extra["qty"]:
            sin_stock.append(p["nombre"] if p else f"Producto #{extra['prodId']}")
            continue
        p["stock"] -= extra["qty"]
        state["prestamos"].append({
            "id": state["nextPrestId"], "prodId": p["id"], "qty": extra["qty"], "cliente": evento_ref,
            "coordinador": coordinador, "paquete": pk["nombre"] if pk else None, "salida": now,
            "retorno": retorno_ts, "devuelto": False, "nota": "Extra de préstamo", "tipoItem": "recuperable",
        })
        state["nextPrestId"] += 1
        state["movimientos"].append({
            "id": state["nextMovId"], "prodId": p["id"], "tipo": "prestamo", "qty": -extra["qty"],
            "evento": evento_ref, "nota": f"Extra préstamo {pk['nombre'] if pk else ''}", "fecha": now,
        })
        state["nextMovId"] += 1
        registrados += 1

    return registrados, sin_stock, evento_ref
