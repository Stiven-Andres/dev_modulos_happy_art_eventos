"""Módulo Contratos — historial, edición, borrado, programación de personal
(admin) y descarga de PDF. Portado de la vista view-contratos y sus
funciones en legacy/js/main.js."""
import io
import zipfile

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from app import firebase
from app.deps import redirect_to, require_admin, require_login, templates
from app.models import (
    ROLES_PERSONAL, contratos_ocupado_en_fecha, esta_disponible, fmt_fecha_contrato, fmt_hora_bodega,
    fmt_hora_evento,
)
from app.services import contratos as svc
from app.services import ventas as ventas_svc
from app.services.calculos import puede_editar_contrato
from app.services.pdf import generar_pdf_contrato, nombre_archivo_pdf

router = APIRouter()


def _con_permiso(state, c, user):
    return puede_editar_contrato(c, user["role"] == "admin", user["email"])


@router.get("/contratos")
def ver_contratos(request: Request, user=Depends(require_login), fecha: str = "", empresa: str = "", recien_creado: int = 0):
    if user["role"] == "bodega":
        raise HTTPException(status_code=403, detail="No tienes permiso para acceder a esta sección.")
    state = firebase.get_state()
    lista = sorted(state["contratos"], key=lambda c: c["fechaRegistro"], reverse=True)
    if fecha:
        lista = [c for c in lista if c.get("fecha") == fecha]
    if empresa in ("happy", "conde"):
        lista = [c for c in lista if c.get("empresa") == empresa]
    for c in lista:
        c["_autorizado"] = _con_permiso(state, c, user)
        req = c.get("personalRequerido") or {}
        asign = c.get("personalAsignado") or {}
        c["_resumen_personal"] = [
            {"icon": r["icon"], "asignados": len(asign.get(r["id"]) or []), "requeridos": req.get(r["id"], 0)}
            for r in ROLES_PERSONAL if req.get(r["id"], 0) > 0
        ]
    return templates.TemplateResponse(request, "contratos.html", {
        "user": user, "active_view": "contratos", "contratos": lista, "fecha": fecha, "empresa": empresa,
        "fecha_label": fmt_fecha_contrato(fecha) if fecha else "", "recien_creado": recien_creado,
    })


@router.post("/contratos/{id}/eliminar")
def eliminar(id: int, request: Request, user=Depends(require_login)):
    state = firebase.get_state()
    try:
        svc.borrar_contrato(state, id, user["role"] == "admin", user["email"])
        firebase.save_state(state)
        request.session["flash"] = {"type": "warning", "text": "🗑 Contrato eliminado"}
    except (svc.ValidationError, svc.ForbiddenError) as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
    return redirect_to("/contratos")


@router.get("/contratos/{id}/pdf")
def descargar_pdf(id: int, request: Request, user=Depends(require_login)):
    state = firebase.get_state()
    c = svc.get_contrato(state, id)
    if not c:
        request.session["flash"] = {"type": "danger", "text": "Contrato no encontrado"}
        return redirect_to("/contratos")
    pdf_bytes = generar_pdf_contrato(c)
    filename = nombre_archivo_pdf(c)
    return Response(content=pdf_bytes, media_type="application/pdf", headers={
        "Content-Disposition": f'inline; filename="{filename}"'
    })


@router.get("/contratos/descargar-fecha")
def descargar_todos_fecha(request: Request, user=Depends(require_login), fecha: str = ""):
    state = firebase.get_state()
    lista = [c for c in state["contratos"] if c.get("fecha") == fecha]
    if not fecha or not lista:
        request.session["flash"] = {"type": "danger", "text": "No hay contratos para esta fecha"}
        return redirect_to(f"/contratos?fecha={fecha}")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for c in lista:
            zf.writestr(nombre_archivo_pdf(c), generar_pdf_contrato(c))
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="Contratos_{fecha}.zip"'
    })


# ── Edición de contrato ──────────────────────────────────────────────────────

def _items_from_form(form):
    return [i for i in form.getlist("item_texto")]


async def _ec_paquete_ctx(request, id, form, pk, items, editando_idx, variantes_sel=None):
    state = firebase.get_state()
    c = svc.get_contrato(state, id)
    pk_ef = {**pk, "items": items} if pk else None
    pendientes_variante = ventas_svc.pendientes_variante_paquete(state["productos"], pk_ef) if pk_ef else []
    return {
        "c": c, "pk": pk, "items": items, "editando_idx": editando_idx,
        "items_modificados": bool(pk) and items != pk["items"],
        "pendientes_variante": pendientes_variante, "variantes_sel": variantes_sel or {},
    }


@router.get("/contratos/{id}/editar")
def editar_form(id: int, request: Request, user=Depends(require_login)):
    state = firebase.get_state()
    c = svc.get_contrato(state, id)
    if not c or not _con_permiso(state, c, user):
        request.session["flash"] = {"type": "danger", "text": "Solo el asesor que creó este contrato puede editarlo"}
        return redirect_to("/contratos")

    pk_actual = next((p for p in ventas_svc.PAQUETES if p["nombre"] == c["paquete"]), None)
    items = svc.items_iniciales_contrato(c, pk_actual)
    variantes_sel = {}
    if pk_actual:
        variantes_sel = svc.precargar_variantes_desde_contrato(state["productos"], pk_actual, c.get("descontadosPaquete") or [])
    pk_ef = {**pk_actual, "items": items} if pk_actual else None
    pendientes_variante = ventas_svc.pendientes_variante_paquete(state["productos"], pk_ef) if pk_ef else []
    paquetes_por_cat = {cat["id"]: [p for p in ventas_svc.PAQUETES if p["categoria"] == cat["id"]] for cat in ventas_svc.CATEGORIAS_PAQUETE}

    return templates.TemplateResponse(request, "contrato_editar.html", {
        "user": user, "active_view": "contratos", "c": c, "pk_actual": pk_actual, "pk": pk_actual,
        "items": items, "items_modificados": False, "editando_idx": None,
        "categorias": ventas_svc.CATEGORIAS_PAQUETE, "paquetes_por_cat": paquetes_por_cat,
        "pendientes_variante": pendientes_variante, "variantes_sel": variantes_sel,
    })


@router.post("/contratos/{id}/paquete-panel")
async def editar_paquete_panel(id: int, request: Request, user=Depends(require_login)):
    form = await request.form()
    pk_id_nuevo = form.get("pkId") or ""
    pk_id = pk_id_nuevo or form.get("currentPkId") or ""
    pk = ventas_svc.get_paquete(pk_id) if pk_id else None
    if pk_id_nuevo:
        items = list(pk["items"]) if pk else []
    else:
        items = _items_from_form(form) or (list(pk["items"]) if pk else [])
    ctx = await _ec_paquete_ctx(request, id, form, pk, items, None)
    return templates.TemplateResponse(request, "partials/contrato_paquete_panel.html", ctx)


@router.post("/contratos/{id}/item/editar")
async def ec_item_editar(id: int, request: Request, user=Depends(require_login)):
    form = await request.form()
    pk = ventas_svc.get_paquete(form.get("currentPkId") or "")
    items = _items_from_form(form)
    idx = int(form.get("idx"))
    ctx = await _ec_paquete_ctx(request, id, form, pk, items, idx)
    return templates.TemplateResponse(request, "partials/contrato_paquete_panel.html", ctx)


@router.post("/contratos/{id}/item/guardar")
async def ec_item_guardar(id: int, request: Request, user=Depends(require_login)):
    form = await request.form()
    pk = ventas_svc.get_paquete(form.get("currentPkId") or "")
    items = _items_from_form(form)
    idx = int(form.get("idx"))
    nuevo = (form.get("item_edit_texto") or "").strip()
    if nuevo and 0 <= idx < len(items):
        items[idx] = nuevo
    ctx = await _ec_paquete_ctx(request, id, form, pk, items, None)
    return templates.TemplateResponse(request, "partials/contrato_paquete_panel.html", ctx)


@router.post("/contratos/{id}/item/cancelar")
async def ec_item_cancelar(id: int, request: Request, user=Depends(require_login)):
    form = await request.form()
    pk = ventas_svc.get_paquete(form.get("currentPkId") or "")
    items = _items_from_form(form)
    ctx = await _ec_paquete_ctx(request, id, form, pk, items, None)
    return templates.TemplateResponse(request, "partials/contrato_paquete_panel.html", ctx)


@router.post("/contratos/{id}/item/quitar")
async def ec_item_quitar(id: int, request: Request, user=Depends(require_login)):
    form = await request.form()
    pk = ventas_svc.get_paquete(form.get("currentPkId") or "")
    items = _items_from_form(form)
    idx = int(form.get("idx"))
    if 0 <= idx < len(items):
        items.pop(idx)
    ctx = await _ec_paquete_ctx(request, id, form, pk, items, None)
    return templates.TemplateResponse(request, "partials/contrato_paquete_panel.html", ctx)


@router.post("/contratos/{id}/item/restablecer")
async def ec_item_restablecer(id: int, request: Request, user=Depends(require_login)):
    form = await request.form()
    pk = ventas_svc.get_paquete(form.get("currentPkId") or "")
    items = list(pk["items"]) if pk else []
    ctx = await _ec_paquete_ctx(request, id, form, pk, items, None)
    return templates.TemplateResponse(request, "partials/contrato_paquete_panel.html", ctx)


@router.post("/contratos/{id}/extras/buscar")
async def editar_extras_buscar(id: int, request: Request, user=Depends(require_login), q: str = ""):
    from app.services.calculos import _norm_txt
    state = firebase.get_state()
    nq = _norm_txt(q)
    resultados = []
    if nq:
        for p in state["productos"]:
            if nq in _norm_txt(p["nombre"]) or nq in _norm_txt(p["cat"]) or nq in _norm_txt(p["sku"]):
                resultados.append(p)
            if len(resultados) >= 8:
                break
    return templates.TemplateResponse(request, "partials/extras_dropdown_venta.html", {
        "resultados": resultados, "q": q, "add_action": f"/contratos/{id}/extras/agregar",
    })


def _extras_from_form(form):
    prod_ids = form.getlist("extra_prodId")
    qtys = form.getlist("extra_qty")
    extras = []
    for pid, qty in zip(prod_ids, qtys):
        try:
            extras.append({"prodId": int(pid), "qty": max(1, int(qty))})
        except ValueError:
            continue
    return extras


@router.post("/contratos/{id}/extras/agregar")
async def editar_extras_agregar(id: int, request: Request, user=Depends(require_login)):
    form = await request.form()
    prod_id = int(form.get("addProdId"))
    extras = _extras_from_form(form)
    if not any(e["prodId"] == prod_id for e in extras):
        extras.append({"prodId": prod_id, "qty": 1})
    return _render_extras_nuevos(request, id, extras)


@router.post("/contratos/{id}/extras/quitar")
async def editar_extras_quitar(id: int, request: Request, user=Depends(require_login)):
    form = await request.form()
    prod_id = int(form.get("removeProdId"))
    extras = [e for e in _extras_from_form(form) if e["prodId"] != prod_id]
    return _render_extras_nuevos(request, id, extras)


@router.post("/contratos/{id}/extras/sync")
async def editar_extras_sync(id: int, request: Request, user=Depends(require_login)):
    form = await request.form()
    return _render_extras_nuevos(request, id, _extras_from_form(form))


def _render_extras_nuevos(request, contrato_id, extras):
    state = firebase.get_state()
    extras_full = [{"prod": next((p for p in state["productos"] if p["id"] == e["prodId"]), None), "qty": e["qty"]} for e in extras]
    return templates.TemplateResponse(request, "partials/venta_extras_chips.html", {
        "extras": extras_full,
        "sync_action": f"/contratos/{contrato_id}/extras/sync",
        "quitar_action": f"/contratos/{contrato_id}/extras/quitar",
    })


@router.post("/contratos/{id}/extra-existente/{idx}/borrar")
def borrar_extra_existente(id: int, idx: int, request: Request, user=Depends(require_login)):
    state = firebase.get_state()
    try:
        svc.borrar_extra_existente(state, id, idx, user["role"] == "admin", user["email"])
        firebase.save_state(state)
    except (svc.ValidationError, svc.ForbiddenError) as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
    return redirect_to(f"/contratos/{id}/editar")


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


@router.post("/contratos/{id}/guardar")
async def guardar_edicion(id: int, request: Request, user=Depends(require_login)):
    form = await request.form()
    pk_id_actual = form.get("pkId") or form.get("currentPkId") or ""
    items_editados = _items_from_form(form)
    variantes_sel = _variantes_from_form(form)
    extras_nuevos = _extras_from_form(form)
    state = firebase.get_state()
    try:
        c, recorte = svc.editar_contrato(state, id, form, pk_id_actual, items_editados, variantes_sel, extras_nuevos,
                                          user["role"] == "admin", user["email"])
        firebase.save_state(state)
        if recorte:
            request.session["flash"] = {"type": "warning", "text": "⚠️ Se ajustó el personal ya programado al nuevo límite solicitado"}
        else:
            request.session["flash"] = {"type": "success", "text": "Contrato actualizado ✅"}
        return redirect_to(f"/contratos/{id}/pdf")
    except svc.ForbiddenError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
        return redirect_to("/contratos")
    except svc.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
        return redirect_to(f"/contratos/{id}/editar")


# ── Programación de personal (admin) ────────────────────────────────────────

@router.get("/contratos/{id}/programar-personal")
def programar_form(id: int, request: Request, user=Depends(require_admin)):
    state = firebase.get_state()
    c = svc.get_contrato(state, id)
    if not c:
        request.session["flash"] = {"type": "danger", "text": "Contrato no encontrado"}
        return redirect_to("/contratos")
    req = c.get("personalRequerido") or {r["id"]: 0 for r in ROLES_PERSONAL}
    asign = c.get("personalAsignado") or {}
    bloques = []
    for rol in ROLES_PERSONAL:
        necesarios = int(req.get(rol["id"]) or 0)
        if not necesarios:
            continue
        seleccionados = asign.get(rol["id"]) or []
        candidatos = sorted((p for p in state["personal"] if p["rol"] == rol["id"]), key=lambda p: p["nombre"] or "")
        opciones = []
        for p in candidatos:
            marcado = p["id"] in seleccionados
            disponible = esta_disponible(p, c["fecha"])
            ocupado_en = contratos_ocupado_en_fecha(state["contratos"], p["id"], c["fecha"], id)
            cupo_lleno = not marcado and len(seleccionados) >= necesarios
            deshabilitado = not marcado and (not disponible or bool(ocupado_en) or cupo_lleno)
            motivo = ""
            if not disponible:
                motivo = "🚫 Marcado como no disponible esta fecha"
            elif ocupado_en:
                motivo = f"⚠️ Ya programado en otro evento ({ocupado_en[0]['cliente']}) este mismo día"
            elif cupo_lleno:
                motivo = f"Ya se completó el cupo de {necesarios}"
            opciones.append({
                "id": p["id"], "nombre": p["nombre"], "telefono": p.get("telefono"),
                "marcado": marcado, "deshabilitado": deshabilitado, "motivo": motivo,
            })
        bloques.append({"rol": rol, "necesarios": necesarios, "asignados": len(seleccionados), "opciones": opciones})
    return templates.TemplateResponse(request, "programar_personal.html", {
        "user": user, "active_view": "contratos", "c": c, "bloques": bloques,
        "hora_bodega": fmt_hora_bodega(c), "hora_evento": fmt_hora_evento(c),
    })


@router.post("/contratos/{id}/programar-personal")
async def programar_guardar(id: int, request: Request, user=Depends(require_admin)):
    form = await request.form()
    selecciones = {}
    for rol in ROLES_PERSONAL:
        vals = form.getlist(f"sel__{rol['id']}")
        selecciones[rol["id"]] = [int(v) for v in vals if v]
    state = firebase.get_state()
    try:
        svc.programar_personal(state, id, selecciones)
        firebase.save_state(state)
        request.session["flash"] = {"type": "success", "text": "✅ Personal programado"}
    except svc.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
        return redirect_to(f"/contratos/{id}/programar-personal")
    return redirect_to("/contratos")
