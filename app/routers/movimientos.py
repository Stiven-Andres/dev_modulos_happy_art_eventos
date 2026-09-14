"""Módulo Movimientos — historial de entradas/salidas/ajustes y registro de
nuevos movimientos. Portado de renderMovimientos()/guardarMovimiento()."""
from fastapi import APIRouter, Depends, Form, Request

from app import firebase, models
from app.deps import redirect_to, require_login, templates
from app.services import productos as svc

router = APIRouter()


@router.get("/movimientos")
def ver_movimientos(request: Request, user=Depends(require_login), prod: int = 0):
    state = firebase.get_state()
    lista = sorted(state["movimientos"], key=lambda m: m["fecha"], reverse=True)
    for m in lista:
        p = svc.get_prod(state, m["prodId"])
        m["prod_nombre"] = p["nombre"] if p else "Artículo eliminado"
    return templates.TemplateResponse(request, "movimientos.html", {
        "user": user, "active_view": "movimientos",
        "movimientos": lista, "productos": state["productos"], "prod_preseleccionado": prod,
    })


@router.post("/movimientos/nuevo")
def crear(request: Request, user=Depends(require_login),
          prodId: str = Form(...), tipo: str = Form(...), qty: str = Form(...),
          evento: str = Form(""), nota: str = Form("")):
    state = firebase.get_state()
    try:
        p = svc.registrar_movimiento(state, dict(prodId=prodId, tipo=tipo, qty=qty, evento=evento, nota=nota))
        firebase.save_state(state)
        request.session["flash"] = {"type": "success", "text": f"Movimiento registrado · Stock: {p['stock']} {p['unidad']}"}
    except svc.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
    return redirect_to("/movimientos")
