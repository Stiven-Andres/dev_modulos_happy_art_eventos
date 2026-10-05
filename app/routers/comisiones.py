"""Comisiones de asesores: vista de solo lectura con las comisiones semanales
del asesor con sesión iniciada, el ranking competitivo del mes (visible para
asesor y admin) y, solo para admin, la validación de quincenas ya realizadas.
Portado de la vista COMISIONES de legacy/js/main.js e index.html."""
import datetime

from fastapi import APIRouter, Depends, Request

from app import firebase, models
from app.deps import require_asesor_o_admin, templates
from app.services import comisiones

router = APIRouter()


@router.get("/comisiones")
def ver_comisiones(request: Request, user=Depends(require_asesor_o_admin), mes: str = ""):
    state = firebase.get_state()
    meses = comisiones.meses_con_ventas(state)
    mes_actual = comisiones.clave_mes(datetime.date.today())
    mes_sel = mes if mes in meses else mes_actual

    ranking = comisiones.calc_ranking_mes(state, mes_sel)
    email_actual = (user["email"] or "").lower()

    semanas = None
    semana_actual = None
    mi_mes = None
    total_acumulado = 0
    if user["role"] == "asesor":
        semanas = comisiones.calc_comisiones_semanales(state, email_actual)
        hoy_clave = comisiones.clave_dia(comisiones.inicio_semana(datetime.date.today()))
        semana_actual = next((s for s in semanas if s["clave"] == hoy_clave), None)
        ranking_actual = comisiones.calc_ranking_mes(state, mes_actual)
        mi_mes = next((r for r in ranking_actual if r["email"] == email_actual), {"n": 0, "comision": 0})
        total_acumulado = sum(s["comision"] for s in semanas)

    quincenas = None
    if user["role"] == "admin":
        quincenas = comisiones.calc_validacion_quincenas(state, mes_sel)

    return templates.TemplateResponse("comisiones.html", {
        "request": request, "user": user, "active_view": "comisiones",
        "meses": meses, "mes_sel": mes_sel, "mes_actual": mes_actual,
        "ranking": ranking, "semanas": semanas, "semana_actual": semana_actual,
        "mi_mes": mi_mes, "total_acumulado": total_acumulado,
        "quincenas": quincenas, "email_actual": email_actual,
        "meses_cortos": models.MESES_CORTOS,
    })
