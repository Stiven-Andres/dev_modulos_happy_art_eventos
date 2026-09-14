"""Dashboard (solo admin) — estadísticas generales, contabilidad de ventas por
año/mes (con ajustes manuales) y encuestas de satisfacción. Portado de
renderDashboard()/renderContabilidad()/renderEncuestas() en main.js."""
from datetime import date

import csv
import io

from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from app import firebase, models
from app.deps import redirect_to, require_admin, templates
from app.services import encuestas as encuestas_svc
from app.services.calculos import calc_contabilidad_anio

router = APIRouter()


@router.get("/dashboard")
def ver_dashboard(request: Request, user=Depends(require_admin), anio: int = 0):
    state = firebase.get_state()
    productos = state["productos"]
    total = len(productos)
    valor = sum(p["precio"] * p["stock"] for p in productos)
    bajos = sum(1 for p in productos if models.stock_status(p) == "low")
    agotados = sum(1 for p in productos if models.stock_status(p) == "out")
    prest_activos = sum(1 for p in state["prestamos"] if not p["devuelto"])
    movs_recientes = sorted(state["movimientos"], key=lambda m: m["fecha"], reverse=True)[:6]
    for m in movs_recientes:
        p = next((x for x in productos if x["id"] == m["prodId"]), None)
        m["prod_nombre"] = p["nombre"] if p else "—"

    anio = anio or date.today().year
    anios_con_datos = sorted({int(c["fecha"].split("-")[0]) for c in state["contratos"] if c.get("fecha")}, reverse=True)
    if date.today().year not in anios_con_datos:
        anios_con_datos = sorted(set(anios_con_datos) | {date.today().year}, reverse=True)
    contab = calc_contabilidad_anio(state["contratos"], state["contabAjustes"], anio)

    dias_raw = request.query_params.getlist("dias")
    if dias_raw:
        dias_filtro = {int(d) for d in dias_raw}
    elif request.query_params.get("dias_submitted"):
        dias_filtro = set()
    else:
        dias_filtro = {0, 1, 2, 3, 4, 5, 6}
    filas_encuesta, stats_encuesta = encuestas_svc.agregar_por_fecha(state["encuestas"], dias_filtro)

    return templates.TemplateResponse(request, "dashboard.html", {
        "user": user, "active_view": "dashboard",
        "total": total, "valor": round(valor), "bajos": bajos, "agotados": agotados,
        "prest_activos": prest_activos, "movs_recientes": movs_recientes,
        "anio": anio, "anios_con_datos": anios_con_datos, "meses_cortos": models.MESES_CORTOS,
        "contab": contab, "contab_ajustes": state["contabAjustes"],
        "dias_filtro": dias_filtro, "filas_encuesta": filas_encuesta, "stats_encuesta": stats_encuesta,
    })


@router.get("/dashboard/contabilidad/csv")
def exportar_csv(anio: int, user=Depends(require_admin)):
    state = firebase.get_state()
    contab = calc_contabilidad_anio(state["contratos"], state["contabAjustes"], anio)
    buf = io.StringIO()
    buf.write("﻿")
    w = csv.writer(buf)
    w.writerow(["Mes", "Happy Art - Eventos", "Happy Art - Ventas", "Conde Eventos - Eventos",
                "Conde Eventos - Ventas", "Total Eventos", "Total Ventas"])
    for i, m in enumerate(contab["meses"]):
        w.writerow([f"{models.MESES_CORTOS[i]} {anio}", m["happyN"], m["happyV"], m["condeN"], m["condeV"],
                    m["happyN"] + m["condeN"], m["happyV"] + m["condeV"]])
    t = contab["totalAnio"]
    w.writerow([f"TOTAL {anio}", t["happyN"], t["happyV"], t["condeN"], t["condeV"],
                t["happyN"] + t["condeN"], t["happyV"] + t["condeV"]])
    buf.seek(0)
    return StreamingResponse(buf, media_type="text/csv", headers={
        "Content-Disposition": f'attachment; filename="Contabilidad_Ventas_{anio}.csv"'
    })


@router.post("/dashboard/contabilidad/ajuste")
def guardar_ajuste(request: Request, user=Depends(require_admin),
                    anio: int = Form(...), mes: int = Form(...),
                    happyN: str = Form("0"), happyV: str = Form("0"),
                    condeN: str = Form("0"), condeV: str = Form("0")):
    state = firebase.get_state()
    hn, hv, cn, cv = int(happyN or 0), int(happyV or 0), int(condeN or 0), int(condeV or 0)
    key = f"{anio}-{mes}"
    if not (hn or hv or cn or cv):
        state["contabAjustes"].pop(key, None)
    else:
        state["contabAjustes"][key] = {"happyN": hn, "happyV": hv, "condeN": cn, "condeV": cv}
    firebase.save_state(state)
    request.session["flash"] = {"type": "success", "text": "✅ Ajuste de contabilidad guardado"}
    return redirect_to(f"/dashboard?anio={anio}")


@router.post("/dashboard/contabilidad/ajuste/{anio}/{mes}/borrar")
def borrar_ajuste(anio: int, mes: int, request: Request, user=Depends(require_admin)):
    state = firebase.get_state()
    state["contabAjustes"].pop(f"{anio}-{mes}", None)
    firebase.save_state(state)
    request.session["flash"] = {"type": "success", "text": "🗑 Ajuste eliminado"}
    return redirect_to(f"/dashboard?anio={anio}")


@router.post("/dashboard/encuestas/cargar")
async def cargar_encuestas(request: Request, user=Depends(require_admin), archivo: UploadFile = None):
    if archivo is None or not archivo.filename:
        request.session["flash"] = {"type": "danger", "text": "Selecciona un archivo .xlsx"}
        return redirect_to("/dashboard")
    contenido = await archivo.read()
    nuevas, error = encuestas_svc.parse_excel_encuestas(contenido)
    if error:
        request.session["flash"] = {"type": "danger", "text": f"❌ {error}"}
        return redirect_to("/dashboard")
    state = firebase.get_state()
    for e in nuevas:
        e["id"] = state["nextEncuestaId"]
        state["nextEncuestaId"] += 1
        state["encuestas"].append(e)
    firebase.save_state(state)
    request.session["flash"] = {"type": "success", "text": f"✅ {len(nuevas)} encuesta(s) importada(s)"}
    return redirect_to("/dashboard")
