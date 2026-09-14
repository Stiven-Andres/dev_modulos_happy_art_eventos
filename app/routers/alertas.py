"""Módulo Alertas — artículos con stock bajo o agotado. Portado de
renderAlertas()."""
from fastapi import APIRouter, Depends, Request

from app import firebase, models
from app.deps import require_admin_o_bodega, templates

router = APIRouter()


@router.get("/alertas")
def ver_alertas(request: Request, user=Depends(require_admin_o_bodega)):
    state = firebase.get_state()
    lista = sorted(
        (p for p in state["productos"] if models.stock_status(p) != "ok"),
        key=lambda p: p["stock"],
    )
    return templates.TemplateResponse(request, "alertas.html", {
        "user": user, "active_view": "alertas", "productos": lista,
    })
