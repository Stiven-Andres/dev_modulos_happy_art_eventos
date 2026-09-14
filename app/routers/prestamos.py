"""Módulo Préstamos — préstamo simple de un artículo y wizard de préstamo por
paquete completo (3 pasos), portado de renderPrestamos()/guardarPrestamo()/
loanSelectPkg()/confirmarPrestamoPaquete() en legacy/js/main.js."""
from fastapi import APIRouter, Depends, Form, Request

from app import firebase
from app.deps import redirect_to, require_admin_o_bodega, templates
from app.models import PAQUETES
from app.services import productos as svc
from app.services import prestamo_wizard as wizard
from app.services.calculos import _norm_txt

router = APIRouter()


def _agrupar_prestamos(state):
    grupos = {}
    for pr in state["prestamos"]:
        minuto = pr["salida"] // 60000
        key = f"{pr.get('coordinador') or ''}|||{pr.get('cliente') or ''}|||{minuto}"
        g = grupos.setdefault(key, {
            "key": key, "coordinador": pr.get("coordinador") or "", "cliente": pr.get("cliente") or "—",
            "paquete": pr.get("paquete") or "", "salida": pr["salida"], "retorno": pr.get("retorno"), "items": [],
        })
        g["items"].append(pr)
        if pr["salida"] < g["salida"]:
            g["salida"] = pr["salida"]
    import datetime
    for g in grupos.values():
        pendientes = [it for it in g["items"] if not it["devuelto"]]
        vencido = any(
            not it["devuelto"] and it.get("retorno") and it["retorno"] < int(datetime.datetime.now().timestamp() * 1000)
            for it in g["items"]
        )
        g["pendientes"] = len(pendientes)
        g["vencido"] = vencido
        for it in g["items"]:
            p = svc.get_prod(state, it["prodId"])
            it["prod_nombre"] = (p["sku"] or p["nombre"]) if p else "Artículo eliminado"
            it["prod_nombre_sec"] = p["nombre"] if (p and p.get("sku") and p.get("nombre")) else None
            it["vencido"] = not it["devuelto"] and it.get("retorno") and it["retorno"] < int(datetime.datetime.now().timestamp() * 1000)
        g["items"].sort(key=lambda it: it.get("nota") or "")
    return sorted(grupos.values(), key=lambda g: -g["salida"])


@router.get("/prestamos")
def ver_prestamos(request: Request, user=Depends(require_admin_o_bodega)):
    state = firebase.get_state()
    grupos = _agrupar_prestamos(state)
    return templates.TemplateResponse(request, "prestamos.html", {
        "user": user, "active_view": "prestamos", "grupos": grupos, "productos": state["productos"],
    })


@router.post("/prestamos/nuevo")
def crear_simple(request: Request, user=Depends(require_admin_o_bodega),
                  prodId: str = Form(...), qty: str = Form(...), cliente: str = Form(...),
                  retorno: str = Form(""), nota: str = Form("")):
    state = firebase.get_state()
    try:
        svc.registrar_prestamo(state, dict(prodId=prodId, qty=qty, cliente=cliente, retorno=retorno, nota=nota))
        firebase.save_state(state)
        request.session["flash"] = {"type": "success", "text": f"Préstamo confirmado para {cliente}"}
    except svc.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
    return redirect_to("/prestamos")


@router.post("/prestamos/{id}/devolver")
def devolver(id: int, request: Request, user=Depends(require_admin_o_bodega)):
    state = firebase.get_state()
    svc.devolver_prestamo(state, id)
    firebase.save_state(state)
    request.session["flash"] = {"type": "success", "text": "¡Devolución registrada!"}
    return redirect_to("/prestamos")


# ── Wizard de préstamo por paquete ──────────────────────────────────────────

@router.get("/prestamos/wizard")
def wizard_paso1(request: Request, user=Depends(require_admin_o_bodega)):
    request.session.pop("prestamo_draft", None)
    paquetes_por_cat = {c["id"]: [p for p in PAQUETES if p["categoria"] == c["id"]] for c in wizard.CATEGORIAS_PAQUETE}
    return templates.TemplateResponse(request, "prestamo_wizard.html", {
        "user": user, "active_view": "prestamos", "paso": 1,
        "categorias": wizard.CATEGORIAS_PAQUETE, "paquetes_por_cat": paquetes_por_cat,
    })


@router.post("/prestamos/wizard/seleccionar")
def wizard_seleccionar(request: Request, user=Depends(require_admin_o_bodega), pkId: str = Form(...)):
    state = firebase.get_state()
    try:
        draft = wizard.iniciar_draft(state, pkId)
        request.session["prestamo_draft"] = draft
    except wizard.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
        return redirect_to("/prestamos/wizard")
    return redirect_to("/prestamos/wizard/paso2")


def _get_draft(request):
    draft = request.session.get("prestamo_draft")
    return draft


@router.get("/prestamos/wizard/paso2")
def wizard_paso2(request: Request, user=Depends(require_admin_o_bodega)):
    draft = _get_draft(request)
    if not draft:
        return redirect_to("/prestamos/wizard")
    state = firebase.get_state()
    pk = next((p for p in PAQUETES if p["id"] == draft["pkId"]), None)
    productos_by_id = {p["id"]: p for p in state["productos"]}
    for item in draft["returnItems"]:
        item["prod"] = productos_by_id.get(item["prodId"])
        item["variantes"] = [productos_by_id[pid] for pid in item["variantesDisponibles"] if pid in productos_by_id]
        for linea in item["seleccionesVariante"]:
            linea["prod"] = productos_by_id.get(linea["prodId"])
    extras = []
    for e in draft["extras"]:
        p = productos_by_id.get(e["prodId"])
        if p:
            extras.append({"prod": p, "qty": e["qty"]})
    return templates.TemplateResponse(request, "prestamo_wizard.html", {
        "user": user, "active_view": "prestamos", "paso": 2, "pk": pk, "draft": draft, "extras": extras,
    })


@router.post("/prestamos/wizard/paso2/qty")
def wizard_set_qty(request: Request, user=Depends(require_admin_o_bodega), idx: int = Form(...), qty: int = Form(...)):
    draft = _get_draft(request)
    if draft and 0 <= idx < len(draft["returnItems"]):
        draft["returnItems"][idx]["qty"] = max(0, qty)
        request.session["prestamo_draft"] = draft
    return redirect_to("/prestamos/wizard/paso2")


@router.post("/prestamos/wizard/paso2/variante")
def wizard_set_variante(request: Request, user=Depends(require_admin_o_bodega),
                         idx: int = Form(...), linea: int = Form(...),
                         prodId: str = Form(""), qty: int = Form(1)):
    draft = _get_draft(request)
    if draft and 0 <= idx < len(draft["returnItems"]):
        lineas = draft["returnItems"][idx]["seleccionesVariante"]
        if 0 <= linea < len(lineas):
            lineas[linea]["prodId"] = int(prodId) if prodId else None
            lineas[linea]["qty"] = max(1, qty)
        request.session["prestamo_draft"] = draft
    return redirect_to("/prestamos/wizard/paso2")


@router.post("/prestamos/wizard/paso2/agregar-linea")
def wizard_agregar_linea(request: Request, user=Depends(require_admin_o_bodega), idx: int = Form(...)):
    draft = _get_draft(request)
    if draft and 0 <= idx < len(draft["returnItems"]):
        draft["returnItems"][idx]["seleccionesVariante"].append({"prodId": None, "qty": 1})
        request.session["prestamo_draft"] = draft
    return redirect_to("/prestamos/wizard/paso2")


@router.post("/prestamos/wizard/paso2/quitar-linea")
def wizard_quitar_linea(request: Request, user=Depends(require_admin_o_bodega), idx: int = Form(...), linea: int = Form(...)):
    draft = _get_draft(request)
    if draft and 0 <= idx < len(draft["returnItems"]):
        lineas = draft["returnItems"][idx]["seleccionesVariante"]
        if len(lineas) > 1 and 0 <= linea < len(lineas):
            lineas.pop(linea)
        request.session["prestamo_draft"] = draft
    return redirect_to("/prestamos/wizard/paso2")


@router.get("/prestamos/wizard/extras/buscar")
def wizard_extras_buscar(request: Request, user=Depends(require_admin_o_bodega), q: str = ""):
    draft = _get_draft(request)
    if not draft:
        return redirect_to("/prestamos/wizard")
    state = firebase.get_state()
    ya = {e["prodId"] for e in draft["extras"]}
    nq = _norm_txt(q)
    resultados = []
    if nq:
        for p in state["productos"]:
            if p["id"] in ya:
                continue
            if nq in _norm_txt(p["nombre"]) or nq in _norm_txt(p["cat"]) or nq in _norm_txt(p["sku"]):
                resultados.append(p)
            if len(resultados) >= 8:
                break
    return templates.TemplateResponse(request, "partials/extras_dropdown.html", {
        "resultados": resultados, "q": q, "add_action": "/prestamos/wizard/extras/agregar",
        "search_action": "/prestamos/wizard/extras/buscar", "redirect_to": "/prestamos/wizard/paso2",
    })


@router.post("/prestamos/wizard/extras/agregar")
def wizard_extras_agregar(request: Request, user=Depends(require_admin_o_bodega), prodId: int = Form(...)):
    draft = _get_draft(request)
    if draft and not any(e["prodId"] == prodId for e in draft["extras"]):
        draft["extras"].append({"prodId": prodId, "qty": 1})
        request.session["prestamo_draft"] = draft
    return redirect_to("/prestamos/wizard/paso2")


@router.post("/prestamos/wizard/extras/quitar")
def wizard_extras_quitar(request: Request, user=Depends(require_admin_o_bodega), prodId: int = Form(...)):
    draft = _get_draft(request)
    if draft:
        draft["extras"] = [e for e in draft["extras"] if e["prodId"] != prodId]
        request.session["prestamo_draft"] = draft
    return redirect_to("/prestamos/wizard/paso2")


@router.post("/prestamos/wizard/extras/qty")
def wizard_extras_qty(request: Request, user=Depends(require_admin_o_bodega), prodId: int = Form(...), qty: int = Form(1)):
    draft = _get_draft(request)
    if draft:
        for e in draft["extras"]:
            if e["prodId"] == prodId:
                e["qty"] = max(1, qty)
        request.session["prestamo_draft"] = draft
    return redirect_to("/prestamos/wizard/paso2")


@router.get("/prestamos/wizard/paso3")
def wizard_paso3(request: Request, user=Depends(require_admin_o_bodega)):
    draft = _get_draft(request)
    if not draft:
        return redirect_to("/prestamos/wizard")
    pk = next((p for p in PAQUETES if p["id"] == draft["pkId"]), None)
    import datetime
    retorno_default = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
    return templates.TemplateResponse(request, "prestamo_wizard.html", {
        "user": user, "active_view": "prestamos", "paso": 3, "pk": pk, "retorno_default": retorno_default,
    })


@router.post("/prestamos/wizard/confirmar")
def wizard_confirmar(request: Request, user=Depends(require_admin_o_bodega),
                      coordinador: str = Form(""), cliente: str = Form(""), fecha_evento: str = Form(""),
                      retorno: str = Form(""), nota: str = Form("")):
    draft = _get_draft(request)
    if not draft:
        return redirect_to("/prestamos/wizard")
    state = firebase.get_state()
    try:
        registrados, sin_stock, evento_ref = wizard.confirmar(
            state, draft, coordinador, cliente, fecha_evento, retorno, nota)
        firebase.save_state(state)
        request.session.pop("prestamo_draft", None)
        if sin_stock:
            texto = ", ".join(sin_stock[:3]) + ("..." if len(sin_stock) > 3 else "")
            request.session["flash"] = {"type": "warning", "text": f"⚠️ Sin stock: {texto}. Resto confirmado."}
        else:
            request.session["flash"] = {"type": "success", "text": f"✅ Préstamo confirmado · {registrados} artículo(s) registrado(s) para {evento_ref}"}
        return redirect_to("/prestamos")
    except wizard.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
        return redirect_to("/prestamos/wizard/paso3")
