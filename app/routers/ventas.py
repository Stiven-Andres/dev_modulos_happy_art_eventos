"""Módulo Ventas — registro de un nuevo contrato (selección de empresa,
paquete, variantes, artículos adicionales y datos del cliente). Portado de
la vista view-ventas y sus funciones en legacy/js/main.js. Usa fragmentos
htmx dentro de un único <form> para que la selección de paquete y de extras
no pierda los demás campos ya digitados (sin estado de sesión: todo el
estado en curso viaje como inputs — incluidos los ocultos que llenan los
fragmentos htmx — dentro del propio formulario)."""
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


@router.get("/ventas")
def ver_ventas(request: Request, user=Depends(require_asesor_o_admin), empresa: str = ""):
    if empresa not in ("happy", "conde"):
        return templates.TemplateResponse(request, "ventas.html", {
            "user": user, "active_view": "ventas", "empresa": "",
        })
    state = firebase.get_state()
    paquetes_por_cat = {c["id"]: [p for p in PAQUETES if p["categoria"] == c["id"]] for c in svc.CATEGORIAS_PAQUETE}
    return templates.TemplateResponse(request, "ventas.html", {
        "user": user, "active_view": "ventas", "empresa": empresa,
        "categorias": svc.CATEGORIAS_PAQUETE, "paquetes_por_cat": paquetes_por_cat,
        "pk": None, "incluidos": [], "pendientes_variante": [], "extras": [],
        "fecha": "", "festejado": "", "anios": "", "valor_paquete": "", "mensajes": [], "faltantes": [],
    })


@router.post("/ventas/paquete")
async def seleccionar_paquete(request: Request, user=Depends(require_asesor_o_admin)):
    form = await request.form()
    empresa = form.get("empresa") or "happy"
    pk_id = form.get("pkId") or form.get("currentPkId") or ""
    fecha = form.get("fecha") or ""
    festejado = form.get("festejado") or ""
    anios = form.get("anios") or ""
    state = firebase.get_state()
    pk = svc.get_paquete(pk_id)

    extras, mensajes, faltantes = ([], [], [])
    if pk:
        incluidos = svc.incluidos_con_disponibilidad(state["productos"], state["contratos"], pk, fecha)
        pendientes_variante = svc.pendientes_variante_paquete(state["productos"], pk)
        extras, mensajes, faltantes = svc.detectar_letras_numero(state["productos"], pk, festejado, anios)
    else:
        incluidos, pendientes_variante = [], []

    return templates.TemplateResponse(request, "partials/venta_paquete_panel.html", {
        "empresa": empresa, "pk": pk, "incluidos": incluidos, "pendientes_variante": pendientes_variante,
        "extras": [{"prod": next((p for p in state["productos"] if p["id"] == e["prodId"]), None), "qty": e["qty"]} for e in extras],
        "fecha": fecha, "festejado": festejado, "anios": anios,
        "valor_paquete": fmt_precio(pk["precio"]).replace("$", "") if pk else "",
        "valor_paquete_raw": pk["precio"] if pk else 0,
        "mensajes": mensajes, "faltantes": faltantes,
    })


@router.post("/ventas/detectar")
async def detectar(request: Request, user=Depends(require_asesor_o_admin)):
    form = await request.form()
    empresa = form.get("empresa") or "happy"
    pk_id = form.get("currentPkId") or form.get("pkId") or ""
    fecha = form.get("fecha") or ""
    festejado = form.get("festejado") or ""
    anios = form.get("anios") or ""
    state = firebase.get_state()
    pk = svc.get_paquete(pk_id)
    incluidos = svc.incluidos_con_disponibilidad(state["productos"], state["contratos"], pk, fecha) if pk else []
    pendientes_variante = svc.pendientes_variante_paquete(state["productos"], pk) if pk else []
    extras_auto, mensajes, faltantes = svc.detectar_letras_numero(state["productos"], pk, festejado, anios) if pk else ([], [], [])

    manuales = [e for e in _extras_from_form(form) if not any(a["prodId"] == e["prodId"] for a in extras_auto)]
    extras = extras_auto + manuales

    return templates.TemplateResponse(request, "partials/venta_paquete_panel.html", {
        "empresa": empresa, "pk": pk, "incluidos": incluidos, "pendientes_variante": pendientes_variante,
        "extras": [{"prod": next((p for p in state["productos"] if p["id"] == e["prodId"]), None), "qty": e["qty"]} for e in extras],
        "fecha": fecha, "festejado": festejado, "anios": anios,
        "valor_paquete": form.get("valorPaquete") or "", "valor_paquete_raw": pk["precio"] if pk else 0,
        "mensajes": mensajes, "faltantes": faltantes,
    })


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
    state = firebase.get_state()
    try:
        contrato = svc.registrar_contrato(state, empresa, pk_id, form, variantes_sel, extras_sel, user["email"])
        firebase.save_state(state)
        request.session["flash"] = {"type": "success", "text": f"✅ Venta registrada · contrato creado con {len(contrato['items'])} artículo(s)"}
        return redirect_to(f"/contratos?recien_creado={contrato['id']}")
    except svc.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
        return redirect_to(f"/ventas?empresa={empresa}")
