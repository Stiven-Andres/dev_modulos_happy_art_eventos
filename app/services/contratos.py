"""CRUD y programación de personal de Contratos, portado de editarContrato()/
guardarEdicionContrato()/borrarContrato()/borrarExtraExistente()/
abrirProgramarPersonal()/guardarProgramacionPersonal() en main.js."""
import re

from app.models import PAQUETES, ROLES_PERSONAL, telefono_valido
from app.services.calculos import puede_editar_contrato
from app.services.ventas import get_paquete
from app.services.calculos import resolver_items_paquete_inventario


class ValidationError(Exception):
    pass


class ForbiddenError(Exception):
    pass


def get_contrato(state, id_):
    return next((c for c in state["contratos"] if c["id"] == id_), None)


def _check_permiso(c, es_admin, email):
    if not puede_editar_contrato(c, es_admin, email):
        raise ForbiddenError("Solo el asesor que creó este contrato puede editarlo")


def editar_contrato(state, contrato_id, form, pk_id_nuevo, variantes_sel, extras_nuevos, es_admin, email):
    c = get_contrato(state, contrato_id)
    if not c:
        raise ValidationError("Contrato no encontrado")
    _check_permiso(c, es_admin, email)

    tel1 = (form.get("tel1") or "").strip()
    tel2 = (form.get("tel2") or "").strip()
    if not telefono_valido(tel1):
        raise ValidationError("El teléfono 1 debe tener exactamente 10 dígitos (ej: 3102112655)")
    if not telefono_valido(tel2):
        raise ValidationError("El teléfono 2 debe tener exactamente 10 dígitos (ej: 3102112655)")

    c["fecha"] = form.get("fecha") or ""
    c["hora"] = form.get("hora") or ""
    c["horaDecoracion"] = form.get("horaDecoracion") or ""
    c["cliente"] = (form.get("cliente") or "").strip() or c["cliente"]
    c["tel1"] = tel1
    c["tel2"] = tel2
    c["direccion"] = (form.get("direccion") or "").strip()
    c["barrio"] = (form.get("barrio") or "").strip()
    c["localidad"] = (form.get("localidad") or "").strip()
    c["festejado"] = (form.get("festejado") or "").strip()

    nuevo_req = {
        "logistico": int(form.get("pers_logistico") or 0),
        "recreador": int(form.get("pers_recreador") or 0),
        "coordinador": int(form.get("pers_coordinador") or 0),
        "operario": int(form.get("pers_operario") or 0),
    }
    c["requerimientosPersonal"] = nuevo_req
    c.setdefault("personalAsignado", {"logistico": [], "recreador": [], "coordinador": [], "operario": []})
    recorte = False
    for rol in ROLES_PERSONAL:
        asignados = c["personalAsignado"].get(rol["id"]) or []
        if len(asignados) > nuevo_req[rol["id"]]:
            c["personalAsignado"][rol["id"]] = asignados[:nuevo_req[rol["id"]]]
            recorte = True

    pk_ref = next((p for p in PAQUETES if p["nombre"] == c["paquete"]), None)
    if pk_id_nuevo:
        pk = get_paquete(pk_id_nuevo)
        if pk:
            c["paquete"] = pk["nombre"]
            c["items"] = list(pk["items"])
            pk_ref = pk
            resueltos, faltan_variante = resolver_items_paquete_inventario(state["productos"], pk, variantes_sel)
            if faltan_variante:
                raise ValidationError(f"Falta especificar: {', '.join(faltan_variante)}")
            c["descontadosPaquete"] = resueltos

    valor_input = int(re.sub(r"[^0-9]", "", form.get("valorPaquete") or "") or 0)
    if valor_input > 0:
        c["valor"] = valor_input
        c["valorCatalogo"] = pk_ref["precio"] if pk_ref else c.get("valorCatalogo")

    nuevos_extras_nombres = []
    for sel in extras_nuevos:
        prod = next((p for p in state["productos"] if p["id"] == sel["prodId"]), None)
        if not prod:
            continue
        qty = sel.get("qty") or 1
        nombre_up = prod["nombre"].strip().upper()
        es_variante_identificable = nombre_up.startswith("LETRA LUMINOSA") or nombre_up.startswith("LETRA GLOBO") or nombre_up.startswith("NUMERO LUMINOSO")
        etiqueta = f"{prod['nombre']} ({prod['sku']})" if (es_variante_identificable and prod.get("sku")) else prod["nombre"]
        nuevos_extras_nombres.extend([etiqueta] * qty)
    if nuevos_extras_nombres:
        c["items"] = list(c.get("items") or []) + nuevos_extras_nombres
        c["extras"] = list(c.get("extras") or []) + nuevos_extras_nombres

    return c, recorte


def borrar_extra_existente(state, contrato_id, idx, es_admin, email):
    c = get_contrato(state, contrato_id)
    if not c:
        raise ValidationError("Contrato no encontrado")
    _check_permiso(c, es_admin, email)
    extras = c.get("extras") or []
    if idx < 0 or idx >= len(extras):
        return
    nombre = extras.pop(idx)
    items = c.get("items") or []
    if nombre in items:
        idx_item = len(items) - 1 - items[::-1].index(nombre)
        items.pop(idx_item)


def borrar_contrato(state, contrato_id, es_admin, email):
    c = get_contrato(state, contrato_id)
    if not c:
        raise ValidationError("Contrato no encontrado")
    _check_permiso(c, es_admin, email)
    state["contratos"] = [x for x in state["contratos"] if x["id"] != contrato_id]


def precargar_variantes_desde_contrato(productos, pk, descontados_paquete):
    """Empareja lo ya guardado en c.descontadosPaquete con las opciones de
    cada variante pendiente del paquete, para no exigir reconfirmar
    variantes que ya estaban correctamente elegidas. Portado de
    _precargarVariantesDesdeContrato() en main.js."""
    from app.services.ventas import pendientes_variante_paquete
    def _match(o, nom_base, sku_part):
        if sku_part:
            return o.get("sku") == sku_part and o["nombre"] == nom_base
        return o["nombre"] == nom_base

    sel = {}
    disponibles = list(descontados_paquete or [])
    pendientes = pendientes_variante_paquete(productos, pk)
    for p in pendientes:
        key = f"{p['itemNombre']}::{p['termino']}::{p['idx']}"
        idx_match = None
        for i, nombre in enumerate(disponibles):
            partes = nombre.split(" · ")
            nom_base = partes[0]
            sku_part = partes[1] if len(partes) > 1 else None
            if any(_match(o, nom_base, sku_part) for o in p["opciones"]):
                idx_match = i
                break
        if idx_match is not None:
            nombre_guardado = disponibles[idx_match]
            partes = nombre_guardado.split(" · ")
            nom_base = partes[0]
            sku_part = partes[1] if len(partes) > 1 else None
            prod = next((o for o in p["opciones"] if _match(o, nom_base, sku_part)), None)
            if prod:
                sel[key] = prod["id"]
            disponibles.pop(idx_match)
    return sel


def programar_personal(state, contrato_id, selecciones):
    """selecciones: {rolId: [personalId|None, ...]}"""
    c = get_contrato(state, contrato_id)
    if not c:
        raise ValidationError("Contrato no encontrado")
    todos = [pid for slots in selecciones.values() for pid in slots if pid]
    if len(set(todos)) != len(todos):
        raise ValidationError("No puedes asignar la misma persona en dos cupos del mismo evento")
    c.setdefault("personalAsignado", {})
    for rol in ROLES_PERSONAL:
        c["personalAsignado"][rol["id"]] = [pid for pid in selecciones.get(rol["id"], []) if pid]
