"""Login/logout — equivalente a hacerLogin()/onAuthStateChanged() del SPA
original (js/main.js), ahora verificado en el servidor: se valida el
correo/contraseña contra Firebase Authentication (API REST de Identity
Toolkit) y se resuelve el rol con obtener_rol() del mismo modo que hacía el
cliente."""
from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse

from app import firebase, models
from app.deps import redirect_to, templates

router = APIRouter()


@router.get("/login")
def login_form(request: Request):
    if request.session.get("user"):
        return redirect_to("/")
    return templates.TemplateResponse(request, "login.html", {})


@router.post("/login")
def login_submit(request: Request, email: str = Form(...), password: str = Form(...)):
    try:
        id_token = firebase.sign_in_with_password(email, password)
        firebase.verify_id_token(id_token)
    except firebase.FirebaseAuthError as exc:
        return templates.TemplateResponse(request, "login.html", {"error": str(exc)}, status_code=400)

    rol = models.obtener_rol(email)
    if rol is None:
        error = (
            f"Tu cuenta ({email}) no tiene un rol asignado. Contacta al "
            "administrador para que te agregue a ROLES en el código."
        )
        return templates.TemplateResponse(request, "login.html", {"error": error}, status_code=403)

    request.session["user"] = {"email": email, "role": rol}
    destino = {"admin": "/dashboard", "asesor": "/ventas", "bodega": "/inventario"}[rol]
    return redirect_to(destino)


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return redirect_to("/login")
