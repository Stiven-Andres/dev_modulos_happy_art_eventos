"""Módulo Ventas — registro de un nuevo contrato (selección de empresa,
paquete, variantes, ítems editables del paquete, artículos adicionales y
datos del cliente). Portado de la vista view-ventas y sus funciones en
legacy/js/main.js + el editor de ítems del paquete y transporte del sprint 3
(Happy Art.zip). Usa fragmentos htmx dentro de un único <form> para que la
selección de paquete, la edición de ítems y los extras no pierdan los demás
campos ya digitados (sin estado de sesión: todo el estado en curso viaja
como inputs — incluidos los ocultos que llenan los fragmentos htmx — dentro
del propio formulario)."""
from fastapi import APIRouter, Depends, Request

from app import firebase
from app.deps import redirect_to, require_asesor_o_admin, templates
from app.models import PAQUETES, fmt_precio
from app.services import ventas as svc
from app.services.calculos import _norm_txt

router = APIRouter()


def _extras_from_form(form):
    """Reconstruye la lista de extras ya seleccionados a partir de los campos
    ocultos extra_prodId[]/extra_qty[] que viajan repetidos en el form."""
    prod_ids = form.getlist("extra_prodId")
    qtys = form.getlist("extra_qty")
    extras = []
    for pid, qty in zip(prod_ids, qtys):
        try:
            extras.append({"prodId": int(pid), "qty": max(1, int(qty))})
        except ValueError:
            continue
    return extras


def _variantes_from_form(form):
    sel = {}
    for k, v in form.multi_items():
        if k.startswith("variante__") and v:
            key = k[len("variante__"):]
            try:
                sel[key] = int(v)
            except ValueError:
                pass
    return sel


def _items_from_form(form):
    return [i for i in form.getlist("item_texto")]


def _pk_efectivo(pk, items):
    return {**pk, "items": items} if pk else None


async def _panel_ctx(request, form, pk, empresa, items, editando_idx, extras_override=None):
    state = firebase.get_state()
    fecha = form.get("fecha") or ""
    festejado = form.get("festejado") or ""
    anios = form.get("anios") or ""
    pk_ef = _pk_efectivo(pk, items)
    incluidos = svc.incluidos_con_disponibilidad(state["productos"], state["contratos"], pk_ef, fecha) if pk_ef else []
    pendientes_variante = svc.pendientes_variante_paquete(state["productos"], pk_ef) if pk_ef else []
    extras = extras_override if extras_override is not None else _extras_from_form(form)
    extras_full = [{"prod": next((p for p in state["productos"] if p["id"] == e["prodId"]), None), "qty": e["qty"]} for e in extras]
    return {
        "empresa": empresa, "pk": pk, "items": items, "items_modificados": bool(pk) and items != pk["items"],
        "editando_idx": editando_idx, "incluidos": incluidos, "pendientes_variante": pendientes_variante,
        "extras": extras_full, "fecha": fecha, "festejado": festejado, "anios": anios,
        "valor_paquete": form.get("valorPaquete") or "",
        "valor_paquete_raw": pk["precio"] if pk else 0,
        "transporte": form.get("transporte") or "",
        "mensajes": [], "faltantes": [],
    }


@router.get("/ventas")
def ver_ventas(request: Request, user=Depends(require_asesor_o_admin), empresa: str = ""):
    if empresa not in ("happy", "conde"):
        return templates.TemplateResponse(request, "ventas.html", {
            "user": user, "active_view": "ventas", "empresa": "",
        })
    paquetes_por_cat = {c["id"]: [p for p in PAQUETES if p["categoria"] == c["id"]] for c in svc.CATEGORIAS_PAQUETE}
    return templates.TemplateResponse(request, "ventas.html", {
        "user": user, "active_view": "ventas", "empresa": empresa,
        "categorias": svc.CATEGORIAS_PAQUETE, "paquetes_por_cat": paquetes_por_cat,
        "pk": None, "items": [], "items_modificados": False, "editando_idx": None,
        "incluidos": [], "pendientes_variante": [], "extras": [],
        "fecha": "", "festejado": "", "anios": "", "valor_paquete": "", "transporte": "",
        "mensajes": [], "faltantes": [],
    })


@router.post("/ventas/paquete")
async def seleccionar_paquete(request: Request, user=Depends(require_asesor_o_admin)):
    form = await request.form()
    empresa = form.get("empresa") or "happy"
    # pkId (explícito, de un click en una tarjeta de paquete) = selección NUEVA,
    # que reinicia los ítems editados. Si no viene, es solo un refresco (p.ej.
    # al cambiar la fecha) del mismo paquete ya elegido (currentPkId): se
    # conservan los ítems tal como estaban.
    pk_id_nuevo = form.get("pkId") or ""
    pk_id = pk_id_nuevo or form.get("currentPkId") or ""
    state = firebase.get_state()
    pk = svc.get_paquete(pk_id)

    mensajes, faltantes = [], []
    if pk_id_nuevo:
        items = list(pk["items"]) if pk else []
        extras, mensajes, faltantes = svc.detectar_letras_numero(
            state["productos"], pk, form.get("festejado") or "", form.get("anios") or "") if pk else ([], [], [])
    else:
        # Solo un refresco (ej. cambió la fecha): conservar ítems y extras tal como estaban.
        items = _items_from_form(form) or (list(pk["items"]) if pk else [])
        extras_auto, mensajes, faltantes = svc.detectar_letras_numero(
            state["productos"], pk, form.get("festejado") or "", form.get("anios") or "") if pk else ([], [], [])
        manuales = [e for e in _extras_from_form(form) if not any(a["prodId"] == e["prodId"] for a in extras_auto)]
        extras = extras_auto + manuales

    ctx = await _panel_ctx(request, form, pk, empresa, items, None, extras_override=extras)
    ctx["mensajes"], ctx["faltantes"] = mensajes, faltantes
    if pk_id_nuevo:
        ctx["valor_paquete"] = "" if (pk and pk.get("categoria") == "personalizado") else (fmt_precio(pk["precio"]).replace("$", "") if pk else "")
    return templates.TemplateResponse(request, "partials/venta_paquete_panel.html", ctx)


@router.post("/ventas/detectar")
async def detectar(request: Request, user=Depends(require_asesor_o_admin)):
    form = await request.form()
    empresa = form.get("empresa") or "happy"
    pk_id = form.get("currentPkId") or form.get("pkId") or ""
    state = firebase.get_state()
    pk = svc.get_paquete(pk_id)
    items = _items_from_form(form) or (list(pk["items"]) if pk else [])

    extras_auto, mensajes, faltantes = svc.detectar_letras_numero(
        state["productos"], pk, form.get("festejado") or "", form.get("anios") or "") if pk else ([], [], [])
    manuales = [e for e in _extras_from_form(form) if not any(a["prodId"] == e["prodId"] for a in extras_auto)]
    extras = extras_auto + manuales

    ctx = await _panel_ctx(request, form, pk, empresa, items, None, extras_override=extras)
    ctx["mensajes"], ctx["faltantes"] = mensajes, faltantes
    return templates.TemplateResponse(request, "partials/venta_paquete_panel.html", ctx)


# ── Editor de ítems del paquete (editar texto / quitar / restablecer) ──────

@router.post("/ventas/item/editar")
async def item_editar(request: Request, user=Depends(require_asesor_o_admin)):
    form = await request.form()
    pk = svc.get_paquete(form.get("currentPkId") or "")
    items = _items_from_form(form)
    idx = int(form.get("idx"))
    ctx = await _panel_ctx(request, form, pk, form.get("empresa") or "happy", items, idx)
    return templates.TemplateResponse(request, "partials/venta_paquete_panel.html", ctx)


@router.post("/ventas/item/guardar")
async def item_guardar(request: Request, user=Depends(require_asesor_o_admin)):
    form = await request.form()
    pk = svc.get_paquete(form.get("currentPkId") or "")
    items = _items_from_form(form)
    idx = int(form.get("idx"))
    nuevo = (form.get("item_edit_texto") or "").strip()
    if nuevo and 0 <= idx < len(items):
        items[idx] = nuevo
    ctx = await _panel_ctx(request, form, pk, form.get("empresa") or "happy", items, None)
    return templates.TemplateResponse(request, "partials/venta_paquete_panel.html", ctx)


@router.post("/ventas/item/cancelar")
async def item_cancelar(request: Request, user=Depends(require_asesor_o_admin)):
    form = await request.form()
    pk = svc.get_paquete(form.get("currentPkId") or "")
    items = _items_from_form(form)
    ctx = await _panel_ctx(request, form, pk, form.get("empresa") or "happy", items, None)
    return templates.TemplateResponse(request, "partials/venta_paquete_panel.html", ctx)


@router.post("/ventas/item/quitar")
async def item_quitar(request: Request, user=Depends(require_asesor_o_admin)):
    form = await request.form()
    pk = svc.get_paquete(form.get("currentPkId") or "")
    items = _items_from_form(form)
    idx = int(form.get("idx"))
    if 0 <= idx < len(items):
        items.pop(idx)
    ctx = await _panel_ctx(request, form, pk, form.get("empresa") or "happy", items, None)
    return templates.TemplateResponse(request, "partials/venta_paquete_panel.html", ctx)


@router.post("/ventas/item/restablecer")
async def item_restablecer(request: Request, user=Depends(require_asesor_o_admin)):
    form = await request.form()
    pk = svc.get_paquete(form.get("currentPkId") or "")
    items = list(pk["items"]) if pk else []
    ctx = await _panel_ctx(request, form, pk, form.get("empresa") or "happy", items, None)
    return templates.TemplateResponse(request, "partials/venta_paquete_panel.html", ctx)


@router.get("/ventas/extras/buscar")
def extras_buscar(request: Request, user=Depends(require_asesor_o_admin), q: str = "", pkId: str = "", empresa: str = "happy"):
    state = firebase.get_state()
    nq = _norm_txt(q)
    resultados = []
    if nq:
        for p in state["productos"]:
            if p["stock"] <= 0:
                continue
            if nq in _norm_txt(p["nombre"]) or nq in _norm_txt(p["cat"]) or nq in _norm_txt(p["sku"]):
                resultados.append(p)
            if len(resultados) >= 8:
                break
    return templates.TemplateResponse(request, "partials/extras_dropdown_venta.html", {
        "resultados": resultados, "q": q,
    })


@router.post("/ventas/extras/agregar")
async def extras_agregar(request: Request, user=Depends(require_asesor_o_admin)):
    form = await request.form()
    prod_id = int(form.get("addProdId"))
    extras = _extras_from_form(form)
    if not any(e["prodId"] == prod_id for e in extras):
        extras.append({"prodId": prod_id, "qty": 1})
    return await _render_extras_only(request, form, extras)


@router.post("/ventas/extras/quitar")
async def extras_quitar(request: Request, user=Depends(require_asesor_o_admin)):
    form = await request.form()
    prod_id = int(form.get("removeProdId"))
    extras = [e for e in _extras_from_form(form) if e["prodId"] != prod_id]
    return await _render_extras_only(request, form, extras)


@router.post("/ventas/extras/sync")
async def extras_sync(request: Request, user=Depends(require_asesor_o_admin)):
    form = await request.form()
    extras = _extras_from_form(form)
    return await _render_extras_only(request, form, extras)


async def _render_extras_only(request, form, extras):
    state = firebase.get_state()
    extras_full = [{"prod": next((p for p in state["productos"] if p["id"] == e["prodId"]), None), "qty": e["qty"]} for e in extras]
    return templates.TemplateResponse(request, "partials/venta_extras_chips.html", {"extras": extras_full})


@router.post("/ventas/registrar")
async def registrar(request: Request, user=Depends(require_asesor_o_admin)):
    form = await request.form()
    empresa = form.get("empresa") or "happy"
    pk_id = form.get("pkId") or form.get("currentPkId") or ""
    variantes_sel = _variantes_from_form(form)
    extras_sel = _extras_from_form(form)
    items_editados = _items_from_form(form)
    state = firebase.get_state()
    try:
        contrato = svc.registrar_contrato(state, empresa, pk_id, form, variantes_sel, extras_sel, user["email"],
                                           items_editados=items_editados)
        firebase.save_state(state)
        request.session["flash"] = {"type": "success", "text": f"✅ Venta registrada · contrato creado con {len(contrato['items'])} artículo(s)"}
        return redirect_to(f"/contratos?recien_creado={contrato['id']}")
    except svc.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
        return redirect_to(f"/ventas?empresa={empresa}")
