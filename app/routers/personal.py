"""Módulo Personal (admin) — CRUD de staff operativo y disponibilidad por
fecha. Portado de la vista view-personal y sus funciones en main.js
(sprint 3: incluye el rol "asesor", vista agrupada por rol con buscador)."""
from fastapi import APIRouter, Depends, Form, Request

from app import firebase
from app.deps import redirect_to, require_admin, templates
from app.models import ROLES_PERSONAL_STAFF
from app.services import personal as svc
from app.services.calculos import _norm_txt

router = APIRouter()


@router.get("/personal")
def ver_personal(request: Request, user=Depends(require_admin), q: str = ""):
    state = firebase.get_state()
    nq = _norm_txt(q)
    grupos = []
    total = 0
    for rol in ROLES_PERSONAL_STAFF:
        lista = sorted(
            (p for p in state["personal"] if p["rol"] == rol["id"]),
            key=lambda p: p["nombre"] or "",
        )
        if nq:
            lista = [p for p in lista if nq in _norm_txt(p["nombre"] or "")]
        total += len(lista)
        grupos.append({"rol": rol, "personal": lista})
    return templates.TemplateResponse(request, "personal.html", {
        "user": user, "active_view": "personal", "grupos": grupos, "q": q, "total": total,
    })


@router.post("/personal/nuevo")
def crear(request: Request, user=Depends(require_admin),
          nombre: str = Form(...), rol: str = Form("logistico"), edad: str = Form(""),
          telefono: str = Form(""), cuentaTipo: str = Form("nequi"), cuentaNumero: str = Form(""),
          direccion: str = Form("")):
    state = firebase.get_state()
    try:
        svc.crear_personal(state, dict(nombre=nombre, rol=rol, edad=edad, telefono=telefono,
                                        cuentaTipo=cuentaTipo, cuentaNumero=cuentaNumero, direccion=direccion))
        firebase.save_state(state)
        request.session["flash"] = {"type": "success", "text": "✅ Personal registrado"}
    except svc.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
    return redirect_to("/personal")


@router.post("/personal/{id}/editar")
def editar(id: int, request: Request, user=Depends(require_admin),
           nombre: str = Form(...), rol: str = Form("logistico"), edad: str = Form(""),
           telefono: str = Form(""), cuentaTipo: str = Form("nequi"), cuentaNumero: str = Form(""),
           direccion: str = Form("")):
    state = firebase.get_state()
    try:
        svc.editar_personal(state, id, dict(nombre=nombre, rol=rol, edad=edad, telefono=telefono,
                                             cuentaTipo=cuentaTipo, cuentaNumero=cuentaNumero, direccion=direccion))
        firebase.save_state(state)
        request.session["flash"] = {"type": "success", "text": "✅ Personal actualizado"}
    except svc.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
    return redirect_to("/personal")


@router.post("/personal/{id}/eliminar")
def eliminar(id: int, request: Request, user=Depends(require_admin)):
    state = firebase.get_state()
    svc.eliminar_personal(state, id)
    firebase.save_state(state)
    request.session["flash"] = {"type": "warning", "text": "Personal eliminado"}
    return redirect_to("/personal")


@router.post("/personal/{id}/disponibilidad/agregar")
def agregar_no_disponible(id: int, request: Request, user=Depends(require_admin), fecha: str = Form(...)):
    state = firebase.get_state()
    try:
        svc.marcar_no_disponible(state, id, fecha)
        firebase.save_state(state)
        request.session["flash"] = {"type": "warning", "text": "Marcado como no disponible"}
    except svc.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
    return redirect_to(f"/personal/{id}/disponibilidad")


@router.post("/personal/{id}/disponibilidad/quitar")
def quitar_no_disponible(id: int, request: Request, user=Depends(require_admin), fecha: str = Form(...)):
    state = firebase.get_state()
    svc.quitar_no_disponible(state, id, fecha)
    firebase.save_state(state)
    request.session["flash"] = {"type": "success", "text": "Disponibilidad actualizada"}
    return redirect_to(f"/personal/{id}/disponibilidad")


@router.get("/personal/{id}/disponibilidad")
def ver_disponibilidad(id: int, request: Request, user=Depends(require_admin)):
    state = firebase.get_state()
    persona = next((p for p in state["personal"] if p["id"] == id), None)
    if not persona:
        request.session["flash"] = {"type": "danger", "text": "Personal no encontrado"}
        return redirect_to("/personal")
    fechas = sorted(persona.get("noDisponible") or [])
    return templates.TemplateResponse(request, "disponibilidad.html", {
        "user": user, "active_view": "personal", "persona": persona, "fechas": fechas,
    })
