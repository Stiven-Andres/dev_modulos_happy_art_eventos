"""Módulo Personal (admin) — CRUD de staff operativo y disponibilidad por
fecha. Portado de la vista view-personal en legacy/index.html y sus
funciones en main.js."""
from fastapi import APIRouter, Depends, Form, Request

from app import firebase
from app.deps import redirect_to, require_admin, templates
from app.services import personal as svc

router = APIRouter()


@router.get("/personal")
def ver_personal(request: Request, user=Depends(require_admin), rol: str = ""):
    state = firebase.get_state()
    lista = [p for p in state["personal"] if not rol or p["rol"] == rol]
    return templates.TemplateResponse(request, "personal.html", {
        "user": user, "active_view": "personal", "personal": lista, "filtro_rol": rol,
    })


@router.post("/personal/nuevo")
def crear(request: Request, user=Depends(require_admin),
          nombre: str = Form(...), rol: str = Form("logistico"), edad: str = Form(""),
          telefono: str = Form(""), cuentaTipo: str = Form("Nequi"), direccion: str = Form("")):
    state = firebase.get_state()
    try:
        svc.crear_personal(state, dict(nombre=nombre, rol=rol, edad=edad, telefono=telefono,
                                        cuentaTipo=cuentaTipo, direccion=direccion))
        firebase.save_state(state)
        request.session["flash"] = {"type": "success", "text": "✅ Empleado registrado"}
    except svc.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
    return redirect_to("/personal")


@router.post("/personal/{id}/editar")
def editar(id: int, request: Request, user=Depends(require_admin),
           nombre: str = Form(...), rol: str = Form("logistico"), edad: str = Form(""),
           telefono: str = Form(""), cuentaTipo: str = Form("Nequi"), direccion: str = Form("")):
    state = firebase.get_state()
    try:
        svc.editar_personal(state, id, dict(nombre=nombre, rol=rol, edad=edad, telefono=telefono,
                                             cuentaTipo=cuentaTipo, direccion=direccion))
        firebase.save_state(state)
        request.session["flash"] = {"type": "success", "text": "✅ Empleado actualizado"}
    except svc.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
    return redirect_to("/personal")


@router.post("/personal/{id}/eliminar")
def eliminar(id: int, request: Request, user=Depends(require_admin)):
    state = firebase.get_state()
    svc.eliminar_personal(state, id)
    firebase.save_state(state)
    request.session["flash"] = {"type": "warning", "text": "Empleado eliminado"}
    return redirect_to("/personal")


@router.post("/personal/{id}/disponibilidad/agregar")
def agregar_no_disponible(id: int, request: Request, user=Depends(require_admin), fecha: str = Form(...)):
    state = firebase.get_state()
    try:
        svc.agregar_fecha_no_disponible(state, id, fecha)
        firebase.save_state(state)
    except svc.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
    return redirect_to(f"/personal/{id}/disponibilidad")


@router.post("/personal/{id}/disponibilidad/quitar")
def quitar_no_disponible(id: int, request: Request, user=Depends(require_admin), fecha: str = Form(...)):
    state = firebase.get_state()
    svc.quitar_fecha_no_disponible(state, id, fecha)
    firebase.save_state(state)
    return redirect_to(f"/personal/{id}/disponibilidad")


@router.get("/personal/{id}/disponibilidad")
def ver_disponibilidad(id: int, request: Request, user=Depends(require_admin)):
    state = firebase.get_state()
    persona = next((p for p in state["personal"] if p["id"] == id), None)
    if not persona:
        request.session["flash"] = {"type": "danger", "text": "Empleado no encontrado"}
        return redirect_to("/personal")
    fechas = sorted(persona.get("noDisponibleFechas") or [])
    return templates.TemplateResponse(request, "disponibilidad.html", {
        "user": user, "active_view": "personal", "persona": persona, "fechas": fechas,
    })
