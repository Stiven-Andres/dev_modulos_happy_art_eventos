"""Módulo Inventario — listado con filtros/búsqueda y disponibilidad real por
fecha (separado por contratos), más CRUD de artículos (solo admin). Portado
de la vista view-productos y renderTabla()/openModal()/guardarProducto()/
eliminarProducto() de legacy/js/main.js."""
from fastapi import APIRouter, Depends, Form, Request

from app import firebase, models
from app.deps import redirect_to, require_admin_o_bodega, templates
from app.services import productos as svc
from app.services.calculos import calc_stock_separado_por_fecha

router = APIRouter()


@router.get("/inventario")
def ver_inventario(
    request: Request, user=Depends(require_admin_o_bodega),
    q: str = "", cat: str = "", evento: str = "", stock: str = "", fecha: str = "",
):
    state = firebase.get_state()
    productos = state["productos"]
    separado, contratos_en_fecha = calc_stock_separado_por_fecha(state["contratos"], productos, fecha)

    ql = q.lower()
    lista = []
    for p in productos:
        if ql and ql not in p["nombre"].lower() and ql not in p["sku"].lower() and ql not in p["cat"].lower() and ql not in (p.get("proveedor") or "").lower():
            continue
        if cat and p["cat"] != cat:
            continue
        if evento and p["evento"] != evento:
            continue
        stock_disp = max(0, p["stock"] - separado.get(p["id"], 0)) if fecha else p["stock"]
        estado = models.stock_status({**p, "stock": stock_disp})
        if stock and estado != stock:
            continue
        lista.append({**p, "sep": separado.get(p["id"], 0), "stock_disp": stock_disp, "estado": estado})

    categorias = sorted({p["cat"] for p in productos})

    return templates.TemplateResponse(request, "inventario.html", {
        "user": user, "active_view": "productos",
        "productos": lista, "categorias": categorias, "todas_categorias": svc.CATEGORIAS,
        "unidades": svc.UNIDADES,
        "q": q, "cat": cat, "evento": evento, "stock": stock, "fecha": fecha,
        "contratos_en_fecha": contratos_en_fecha,
    })


@router.post("/inventario/nuevo")
def crear(request: Request, user=Depends(require_admin_o_bodega),
          sku: str = Form(...), nombre: str = Form(...), cat: str = Form(...),
          evento: str = Form("Ambos"), precio: str = Form("0"), stock: str = Form("0"),
          min: str = Form("0"), unidad: str = Form("Unidad"), proveedor: str = Form(""),
          ubicacion: str = Form(""), desc: str = Form("")):
    if user["role"] != "admin":
        request.session["flash"] = {"type": "danger", "text": "No tienes permisos para esta acción"}
        return redirect_to("/inventario")
    state = firebase.get_state()
    try:
        svc.crear_producto(state, dict(sku=sku, nombre=nombre, cat=cat, evento=evento, precio=precio,
                                        stock=stock, min=min, unidad=unidad, proveedor=proveedor,
                                        ubicacion=ubicacion, desc=desc))
        firebase.save_state(state)
        request.session["flash"] = {"type": "success", "text": "¡Nuevo artículo creado!"}
    except svc.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
    return redirect_to("/inventario")


@router.post("/inventario/{id}/editar")
def editar(id: int, request: Request, user=Depends(require_admin_o_bodega),
           sku: str = Form(...), nombre: str = Form(...), cat: str = Form(...),
           evento: str = Form("Ambos"), precio: str = Form("0"), stock: str = Form("0"),
           min: str = Form("0"), unidad: str = Form("Unidad"), proveedor: str = Form(""),
           ubicacion: str = Form(""), desc: str = Form("")):
    if user["role"] != "admin":
        request.session["flash"] = {"type": "danger", "text": "No tienes permisos para esta acción"}
        return redirect_to("/inventario")
    state = firebase.get_state()
    try:
        svc.editar_producto(state, id, dict(sku=sku, nombre=nombre, cat=cat, evento=evento, precio=precio,
                                             stock=stock, min=min, unidad=unidad, proveedor=proveedor,
                                             ubicacion=ubicacion, desc=desc))
        firebase.save_state(state)
        request.session["flash"] = {"type": "success", "text": "¡Artículo actualizado!"}
    except svc.ValidationError as e:
        request.session["flash"] = {"type": "danger", "text": str(e)}
    return redirect_to("/inventario")


@router.post("/inventario/{id}/eliminar")
def eliminar(id: int, request: Request, user=Depends(require_admin_o_bodega)):
    if user["role"] != "admin":
        request.session["flash"] = {"type": "danger", "text": "No tienes permisos para esta acción"}
        return redirect_to("/inventario")
    state = firebase.get_state()
    svc.eliminar_producto(state, id)
    firebase.save_state(state)
    request.session["flash"] = {"type": "warning", "text": "Artículo eliminado"}
    return redirect_to("/inventario")
