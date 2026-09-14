"""Lógica de negocio / cálculos, portada de legacy/js/operations.js (la parte
sin DOM ni Firebase: emparejamiento de ítems de paquete con productos de
inventario, cálculo de contabilidad, disponibilidad por fecha, etc.).

Todas las funciones son puras: reciben las listas del estado (productos,
contratos, ...) como argumentos en vez de leer un `state` global, siguiendo
la misma arquitectura sin estado por-request de app/models.py.
"""
import re
import unicodedata

from app.models import _buscar_especificacion, is_consumable


def puede_editar_contrato(c, es_admin, email_actual):
    if es_admin:
        return True
    asesor = (c.get("asesor") or "").lower()
    return bool(asesor) and asesor == (email_actual or "").lower()


def calc_contabilidad_anio(contratos, contab_ajustes, anio):
    """Devuelve {meses:[{happyN,happyV,condeN,condeV}×12], totalAnio:{...}}"""
    meses = [{"happyN": 0, "happyV": 0, "condeN": 0, "condeV": 0} for _ in range(12)]
    for c in contratos:
        fecha = c.get("fecha")
        if not fecha:
            continue
        try:
            y, m = (int(x) for x in fecha.split("-")[:2])
        except (ValueError, AttributeError):
            continue
        if y != anio:
            continue
        idx = m - 1
        if idx < 0 or idx > 11:
            continue
        valor = float(c.get("valor") or 0)
        if c.get("empresa") == "conde":
            meses[idx]["condeN"] += 1
            meses[idx]["condeV"] += valor
        else:
            meses[idx]["happyN"] += 1
            meses[idx]["happyV"] += valor

    for i in range(12):
        ajuste = contab_ajustes.get(f"{anio}-{i + 1}")
        if not ajuste:
            continue
        meses[i]["happyN"] += float(ajuste.get("happyN") or 0)
        meses[i]["happyV"] += float(ajuste.get("happyV") or 0)
        meses[i]["condeN"] += float(ajuste.get("condeN") or 0)
        meses[i]["condeV"] += float(ajuste.get("condeV") or 0)

    total_anio = {"happyN": 0, "happyV": 0, "condeN": 0, "condeV": 0}
    for m in meses:
        for k in total_anio:
            total_anio[k] += m[k]

    return {"meses": meses, "totalAnio": total_anio}


def calc_stock_separado_por_fecha(contratos, productos, fecha):
    """Retorna (separado: {prodId: cantidad}, contratos_en_fecha: [contrato,...])"""
    separado = {}
    contratos_en_fecha = []
    if not fecha:
        return separado, contratos_en_fecha
    for c in contratos:
        if c.get("fecha") == fecha:
            contratos_en_fecha.append(c)
            all_items = list(c.get("descontadosPaquete") or []) + list(c.get("extras") or [])
            for nombre in all_items:
                prod = next((p for p in productos if p.get("nombre") == nombre), None)
                if prod:
                    separado[prod["id"]] = separado.get(prod["id"], 0) + 1
    return separado, contratos_en_fecha


def calc_disponibilidad_paquete_fecha(productos, contratos, pk, fecha):
    if not pk or not fecha:
        return None
    separado, _ = calc_stock_separado_por_fecha(contratos, productos, fecha)
    agotados = bajos = total = 0
    for item_nombre in pk["items"]:
        if is_consumable(item_nombre):
            continue
        prod = match_inventario(productos, item_nombre)
        if not prod:
            continue
        total += 1
        sep = separado.get(prod["id"], 0)
        libre = max(0, prod["stock"] - sep)
        if libre <= 0:
            agotados += 1
        elif libre <= prod["min"]:
            bajos += 1
    return {"agotados": agotados, "bajos": bajos, "total": total}


def _norm_txt(s):
    s = s.lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9\s]", "", s)
    return s.strip()


def match_inventario_multiple(productos, item_nombre):
    if item_nombre == "disfraz_o_gigante":
        disfraces = [p for p in productos if "disfraz" in _norm_txt(p["nombre"])]
        gigantes = [
            p for p in productos
            if "gigante" in _norm_txt(p["nombre"]) or "personaje" in _norm_txt(p["nombre"])
        ]
        vistos = set()
        union = []
        for p in disfraces + gigantes:
            if p["id"] not in vistos:
                vistos.add(p["id"])
                union.append(p)
        return union

    palabras_item = [w for w in _norm_txt(item_nombre).split() if len(w) > 3]
    if not palabras_item:
        return []
    mejor_score = 0
    candidatos = []
    for p in productos:
        norm_prod = _norm_txt(p["nombre"])
        score = sum(1 for w in palabras_item if w in norm_prod)
        if score > 0 and score / len(palabras_item) >= 0.5:
            candidatos.append({"prod": p, "score": score})
            if score > mejor_score:
                mejor_score = score
    if not candidatos:
        return []
    mejores = [c for c in candidatos if c["score"] == mejor_score]
    nombre_ref = mejores[0]["prod"]["nombre"]
    mismos_nombre = [c["prod"] for c in mejores if c["prod"]["nombre"] == nombre_ref]
    return mismos_nombre if mismos_nombre else [mejores[0]["prod"]]


def match_inventario(productos, item_nombre):
    palabras_item = [w for w in _norm_txt(item_nombre).split() if len(w) > 3]
    if not palabras_item:
        return None
    mejor_match, mejor_score = None, 0
    for p in productos:
        norm_prod = _norm_txt(p["nombre"])
        score = sum(1 for w in palabras_item if w in norm_prod)
        if score > 0 and score / len(palabras_item) >= 0.5 and score > mejor_score:
            mejor_score, mejor_match = score, p
    return mejor_match


def resolver_items_paquete_inventario(productos, pk, selecciones_variante=None):
    sel = selecciones_variante or {}
    resueltos = []
    faltan_variante = []
    for item_nombre in pk["items"]:
        if is_consumable(item_nombre):
            continue
        spec = _buscar_especificacion(item_nombre)
        if spec:
            for req in spec["buscar"]:
                opciones = match_inventario_multiple(productos, req["termino"])
                if not opciones:
                    continue
                for n in range(req["qty"]):
                    if req.get("variante") and len(opciones) > 1:
                        key = f"{item_nombre}::{req['termino']}::{n}"
                        prod_id = sel.get(key)
                        elegido = next((o for o in opciones if o["id"] == prod_id), None) if prod_id else None
                        if elegido:
                            nombre = (
                                f"{elegido['nombre']} · {elegido['sku']}" if elegido.get("sku") else elegido["nombre"]
                            )
                            resueltos.append(nombre)
                        elif req.get("obligatorio"):
                            etiqueta = f"{item_nombre} #{n + 1}" if len(opciones) > 1 and req["qty"] > 1 else item_nombre
                            faltan_variante.append(etiqueta)
                    else:
                        elegido = next((p for p in opciones if p["stock"] > 0), opciones[0])
                        resueltos.append(elegido["nombre"])
        else:
            prod = match_inventario(productos, item_nombre)
            if prod:
                resueltos.append(prod["nombre"])
    return resueltos, faltan_variante
