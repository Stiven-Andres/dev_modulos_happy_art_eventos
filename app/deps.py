"""Dependencias compartidas de FastAPI: plantillas Jinja2 y control de acceso
por sesión (equivalente a onAuthStateChanged + obtenerRol() del SPA original,
pero verificado en el servidor en cada request en vez de mantenerse en el
cliente)."""
from fastapi import HTTPException, Request
from fastapi.templating import Jinja2Templates
from starlette.responses import RedirectResponse
from starlette.status import HTTP_303_SEE_OTHER

from app import models

templates = Jinja2Templates(directory="app/templates")
templates.env.globals["fmt"] = models.fmt
templates.env.globals["fmt_precio"] = models.fmt_precio
templates.env.globals["fmt_date"] = models.fmt_date
templates.env.globals["fmt_fecha"] = models.fmt_fecha
templates.env.globals["fmt_hora_evento"] = models.fmt_hora_evento
templates.env.globals["stock_status"] = models.stock_status
templates.env.globals["cat_class"] = models.cat_class
templates.env.globals["label_rol_personal"] = models.label_rol_personal
templates.env.globals["ROLES_PERSONAL"] = models.ROLES_PERSONAL
templates.env.globals["CUENTAS_PAGO"] = models.CUENTAS_PAGO


class RedirectToLogin(Exception):
    pass


def get_current_user(request: Request):
    """Lee el usuario de la sesión (cookie firmada). None si no hay sesión."""
    return request.session.get("user")


def require_login(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=HTTP_303_SEE_OTHER, headers={"Location": "/login"})
    return user


def require_admin(request: Request):
    user = require_login(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo el administrador puede acceder a esta sección.")
    return user


def require_asesor_o_admin(request: Request):
    user = require_login(request)
    if user["role"] not in ("admin", "asesor"):
        raise HTTPException(status_code=403, detail="No tienes permiso para acceder a esta sección.")
    return user


def redirect_to(path: str):
    return RedirectResponse(url=path, status_code=HTTP_303_SEE_OTHER)
