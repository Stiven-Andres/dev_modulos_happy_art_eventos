"""Acceso a Firebase: Realtime Database (vía Admin SDK) y verificación de
credenciales contra Firebase Authentication (vía la API REST de Identity
Toolkit, ya que el Admin SDK no puede verificar contraseñas — solo puede
crear/consultar usuarios y verificar tokens ya emitidos).

Este módulo reemplaza lo que en el proyecto original hacían directamente
initializeApp/getDatabase/getAuth en el navegador (js/operations.js).
"""
import json
import threading

import firebase_admin
import httpx
from firebase_admin import credentials, db

from app import config

_lock = threading.Lock()
_app = None


class FirebaseAuthError(Exception):
    """Credenciales inválidas o error al verificar con Firebase Authentication."""


def _init_app():
    global _app
    if _app is not None:
        return _app
    with _lock:
        if _app is not None:
            return _app
        if config.FIREBASE_SERVICE_ACCOUNT_JSON:
            cred_info = json.loads(config.FIREBASE_SERVICE_ACCOUNT_JSON)
            cred = credentials.Certificate(cred_info)
        elif config.FIREBASE_SERVICE_ACCOUNT_FILE:
            cred = credentials.Certificate(config.FIREBASE_SERVICE_ACCOUNT_FILE)
        else:
            raise RuntimeError(
                "Falta configurar la cuenta de servicio de Firebase. Define "
                "FIREBASE_SERVICE_ACCOUNT_JSON (contenido del JSON) o "
                "FIREBASE_SERVICE_ACCOUNT_FILE (ruta al archivo) como variable "
                "de entorno. Se genera desde la consola de Firebase: "
                "Configuración del proyecto → Cuentas de servicio → Generar "
                "nueva clave privada."
            )
        _app = firebase_admin.initialize_app(
            cred, {"databaseURL": config.FIREBASE_DATABASE_URL}
        )
        return _app


def get_root_ref():
    _init_app()
    return db.reference(config.DB_PATH)


def get_state() -> dict:
    """Lee el bloque completo de datos, igual que cargarDatosIniciales() en
    operations.js. Devuelve un dict con listas ya normalizadas (Firebase RTDB
    guarda arrays como objetos con claves numéricas cuando hay huecos)."""
    raw = get_root_ref().get() or {}

    def as_list(key):
        val = raw.get(key)
        if val is None:
            return []
        if isinstance(val, dict):
            return list(val.values())
        return list(val)

    return {
        "productos": as_list("productos"),
        "movimientos": as_list("movimientos"),
        "prestamos": as_list("prestamos"),
        "contratos": as_list("contratos"),
        "personal": as_list("personal"),
        "encuestas": as_list("encuestas"),
        "contabAjustes": raw.get("contabAjustes") or {},
        "nextId": raw.get("nextId", 27),
        "nextMovId": raw.get("nextMovId", 17),
        "nextPrestId": raw.get("nextPrestId", 8),
        "nextContratoId": raw.get("nextContratoId", 1),
        "nextPersonalId": raw.get("nextPersonalId", 1),
        "nextEncuestaId": raw.get("nextEncuestaId", 1),
    }


def save_state(state: dict) -> None:
    """Escribe el bloque completo de datos, igual que guardarDatos() en
    operations.js — un único set() que reemplaza todo el nodo. Ver RNF3 del
    documento de requerimientos no funcionales: esto significa que dos
    guardados casi simultáneos pueden pisarse entre sí; es una limitación
    heredada tal cual del diseño original, no algo nuevo de este backend."""
    get_root_ref().set(state)


def sign_in_with_password(email: str, password: str) -> str:
    """Verifica el correo/contraseña contra Firebase Authentication usando la
    API REST de Identity Toolkit (accounts:signInWithPassword). Devuelve el
    idToken si las credenciales son válidas, o lanza FirebaseAuthError con un
    mensaje ya traducido a español (mismo mapeo de errores que hacerLogin()
    tenía en el JS original)."""
    url = (
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
        f"?key={config.FIREBASE_API_KEY}"
    )
    try:
        resp = httpx.post(
            url,
            json={"email": email, "password": password, "returnSecureToken": True},
            timeout=10.0,
        )
    except httpx.HTTPError as exc:
        raise FirebaseAuthError("No se pudo contactar el servicio de autenticación.") from exc

    data = resp.json()
    if resp.status_code == 200:
        return data["idToken"]

    code = (data.get("error", {}) or {}).get("message", "")
    mensajes = {
        "EMAIL_NOT_FOUND": "Usuario no encontrado.",
        "INVALID_PASSWORD": "Contraseña incorrecta.",
        "INVALID_EMAIL": "Correo inválido.",
        "INVALID_LOGIN_CREDENTIALS": "Correo o contraseña incorrectos.",
        "USER_DISABLED": "Este usuario está deshabilitado.",
    }
    if code.startswith("TOO_MANY_ATTEMPTS_TRY_LATER"):
        raise FirebaseAuthError("Demasiados intentos. Espera un momento.")
    raise FirebaseAuthError(mensajes.get(code, "Error al iniciar sesión. Intenta de nuevo."))


def verify_id_token(id_token: str) -> dict:
    """Verifica un idToken de Firebase ya emitido (equivalente a lo que en el
    cliente hacía onAuthStateChanged). Se usa justo después de
    sign_in_with_password para confirmar el token antes de abrir sesión de
    servidor, y así no confiar únicamente en la respuesta REST cruda."""
    _init_app()
    from firebase_admin import auth as fb_auth

    return fb_auth.verify_id_token(id_token)
