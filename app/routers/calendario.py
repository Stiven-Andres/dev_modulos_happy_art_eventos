"""Módulo Calendario — vista mensual de eventos y reporte de materiales
comprometidos por fecha. Visible para todos los roles (portado de
view-calendario en legacy/index.html)."""
from datetime import date

from fastapi import APIRouter, Depends, Request

from app import firebase
from app.deps import require_login, templates
from app.services import calendario as svc

router = APIRouter()

MESES_NOMBRE = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
    "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]


@router.get("/calendario")
def ver_calendario(request: Request, user=Depends(require_login), anio: int = 0, mes: int = 0, dia: str = ""):
    hoy = date.today()
    anio = anio or hoy.year
    mes = mes or hoy.month
    state = firebase.get_state()
    conteos = svc.contar_por_fecha(state["contratos"])
    semanas = svc.semanas_mes(anio, mes)
    hoy_str = hoy.isoformat()

    prev_mes, prev_anio = (12, anio - 1) if mes == 1 else (mes - 1, anio)
    next_mes, next_anio = (1, anio + 1) if mes == 12 else (mes + 1, anio)

    detalle = None
    if dia:
        eventos_dia = sorted(
            (c for c in state["contratos"] if c.get("fecha") == dia),
            key=lambda c: c.get("hora") or "",
        )
        if eventos_dia:
            resumen, detalle_contratos = svc.reporte_materiales_fecha(state["productos"], eventos_dia)
            detalle = {
                "fecha": dia, "eventos": eventos_dia, "resumen": resumen,
                "detalle_contratos": detalle_contratos,
            }

    return templates.TemplateResponse(request, "calendario.html", {
        "user": user, "active_view": "calendario",
        "anio": anio, "mes": mes, "mes_nombre": MESES_NOMBRE[mes - 1],
        "semanas": semanas, "conteos": conteos, "hoy_str": hoy_str,
        "prev_mes": prev_mes, "prev_anio": prev_anio, "next_mes": next_mes, "next_anio": next_anio,
        "detalle": detalle, "dia_seleccionado": dia,
    })
