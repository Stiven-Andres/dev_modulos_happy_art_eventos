"""CRUD de inventario y registro de movimientos/préstamos, portado de las
funciones guardarProducto/eliminarProducto/guardarMovimiento/guardarPrestamo/
devolverPrestamo de legacy/js/main.js. Cada función recibe el `state` completo
(dict con las listas ya cargadas desde Firebase) y lo muta en memoria; quien
llama es responsable de firebase.save_state(state) después."""
import time


class ValidationError(Exception):
    pass


CATEGORIAS = [
    "Decoración", "Mobiliario", "Audio / Video", "Catering", "Iluminación",
    "Papelería", "Logística", "Limpieza", "Seguridad", "Otros",
]
UNIDADES = ["Unidad", "Par", "Set", "Caja", "Docena", "Metro", "Rollo", "Bolsa", "Kg", "Litro"]


def _now_ms():
    return int(time.time() * 1000)


def get_prod(state, id_):
    return next((p for p in state["productos"] if p["id"] == id_), None)


def crear_producto(state, data):
    sku = data["sku"].strip()
    nombre = data["nombre"].strip()
    cat = data["cat"]
    if not sku or not nombre or not cat:
        raise ValidationError("Completa código, nombre y categoría")
    if any(p["sku"] == sku for p in state["productos"]):
        raise ValidationError("Ese código ya existe")
    stock = int(data.get("stock") or 0)
    p = {
        "id": state["nextId"],
        "sku": sku,
        "nombre": nombre,
        "cat": cat,
        "evento": data.get("evento") or "Ambos",
        "precio": float(data.get("precio") or 0),
        "stock": stock,
        "min": int(data.get("min") or 0),
        "unidad": data.get("unidad") or "Unidad",
        "proveedor": (data.get("proveedor") or "").strip(),
        "ubicacion": (data.get("ubicacion") or "").strip(),
        "desc": (data.get("desc") or "").strip(),
    }
    state["nextId"] += 1
    state["productos"].append(p)
    if stock > 0:
        state["movimientos"].append({
            "id": state["nextMovId"], "prodId": p["id"], "tipo": "entrada",
            "qty": stock, "evento": "", "nota": "Stock inicial", "fecha": _now_ms(),
        })
        state["nextMovId"] += 1
    return p


def editar_producto(state, id_, data):
    p = get_prod(state, id_)
    if not p:
        raise ValidationError("Artículo no encontrado")
    sku = data["sku"].strip()
    nombre = data["nombre"].strip()
    cat = data["cat"]
    if not sku or not nombre or not cat:
        raise ValidationError("Completa código, nombre y categoría")
    stock = int(data.get("stock") or 0)
    diff = stock - p["stock"]
    p.update({
        "sku": sku, "nombre": nombre, "cat": cat,
        "evento": data.get("evento") or "Ambos",
        "precio": float(data.get("precio") or 0),
        "stock": stock,
        "min": int(data.get("min") or 0),
        "unidad": data.get("unidad") or "Unidad",
        "proveedor": (data.get("proveedor") or "").strip(),
        "ubicacion": (data.get("ubicacion") or "").strip(),
        "desc": (data.get("desc") or "").strip(),
    })
    if diff != 0:
        state["movimientos"].append({
            "id": state["nextMovId"], "prodId": id_, "tipo": "ajuste",
            "qty": diff, "evento": "", "nota": "Edición manual", "fecha": _now_ms(),
        })
        state["nextMovId"] += 1
    return p


def eliminar_producto(state, id_):
    state["productos"] = [p for p in state["productos"] if p["id"] != id_]
    state["movimientos"] = [m for m in state["movimientos"] if m["prodId"] != id_]


def registrar_movimiento(state, data):
    prod_id = int(data["prodId"])
    tipo = data["tipo"]
    qty = int(data.get("qty") or 0)
    evento = (data.get("evento") or "").strip()
    nota = (data.get("nota") or "").strip()
    if not prod_id:
        raise ValidationError("Selecciona un artículo")
    if qty <= 0:
        raise ValidationError("La cantidad debe ser mayor a 0")
    p = get_prod(state, prod_id)
    if not p:
        raise ValidationError("Artículo no encontrado")
    delta = -qty if tipo == "salida" else qty
    if p["stock"] + delta < 0:
        raise ValidationError(f"Stock insuficiente — disponible: {p['stock']} {p['unidad']}")
    p["stock"] += delta
    state["movimientos"].append({
        "id": state["nextMovId"], "prodId": prod_id, "tipo": tipo,
        "qty": delta, "evento": evento, "nota": nota, "fecha": _now_ms(),
    })
    state["nextMovId"] += 1
    return p


def registrar_prestamo(state, data):
    prod_id = int(data["prodId"])
    qty = int(data.get("qty") or 0)
    cliente = (data.get("cliente") or "").strip()
    retorno = data.get("retorno") or ""
    nota = (data.get("nota") or "").strip()
    if not prod_id or not cliente:
        raise ValidationError("Selecciona artículo e ingresa el cliente")
    if qty <= 0:
        raise ValidationError("Cantidad debe ser mayor a 0")
    p = get_prod(state, prod_id)
    if not p or p["stock"] < qty:
        disp = p["stock"] if p else 0
        unidad = p["unidad"] if p else ""
        raise ValidationError(f"Stock insuficiente — disponible: {disp} {unidad}")
    p["stock"] -= qty
    retorno_ms = None
    if retorno:
        import datetime
        retorno_ms = int(datetime.datetime.fromisoformat(retorno).timestamp() * 1000)
    state["prestamos"].append({
        "id": state["nextPrestId"], "prodId": prod_id, "qty": qty, "cliente": cliente,
        "salida": _now_ms(), "retorno": retorno_ms, "devuelto": False, "nota": nota,
    })
    state["nextPrestId"] += 1
    state["movimientos"].append({
        "id": state["nextMovId"], "prodId": prod_id, "tipo": "prestamo",
        "qty": -qty, "evento": cliente, "nota": "Préstamo registrado", "fecha": _now_ms(),
    })
    state["nextMovId"] += 1


def devolver_prestamo(state, id_):
    pr = next((p for p in state["prestamos"] if p["id"] == id_), None)
    if not pr or pr["devuelto"]:
        return
    p = get_prod(state, pr["prodId"])
    if p:
        p["stock"] += pr["qty"]
    pr["devuelto"] = True
    state["movimientos"].append({
        "id": state["nextMovId"], "prodId": pr["prodId"], "tipo": "devolucion",
        "qty": pr["qty"], "evento": pr["cliente"], "nota": "Devolución de préstamo", "fecha": _now_ms(),
    })
    state["nextMovId"] += 1
