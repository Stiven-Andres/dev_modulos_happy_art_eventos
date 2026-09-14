"""Configuración de la aplicación, leída desde variables de entorno.

En el proyecto original (SPA) esta configuración vivía embebida en el
JavaScript del cliente (firebaseConfig en js/operations.js). Aquí vive
en el servidor y se lee de variables de entorno para no comprometer
credenciales sensibles (la cuenta de servicio, en particular).
"""
import os

# Config pública del proyecto Firebase (la misma que ya usaba el frontend
# original — no son secretas, son las mismas que iban embebidas en el JS).
FIREBASE_API_KEY = os.environ.get("FIREBASE_API_KEY", "AIzaSyAQXPTHj5d03-87vSd-v1B3HTL2yFEU-Mk")
FIREBASE_AUTH_DOMAIN = os.environ.get("FIREBASE_AUTH_DOMAIN", "inventario-4c0fd.firebaseapp.com")
FIREBASE_DATABASE_URL = os.environ.get("FIREBASE_DATABASE_URL", "https://inventario-4c0fd-default-rtdb.firebaseio.com/")
FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "inventario-4c0fd")

# Cuenta de servicio para el SDK de administrador de Firebase (SÍ es secreta).
# Se puede pasar de dos formas:
#   - FIREBASE_SERVICE_ACCOUNT_JSON: el contenido completo del JSON (útil en Render,
#     como variable de entorno de una sola línea).
#   - FIREBASE_SERVICE_ACCOUNT_FILE: ruta a un archivo .json en disco (útil en local).
FIREBASE_SERVICE_ACCOUNT_JSON = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "")
FIREBASE_SERVICE_ACCOUNT_FILE = os.environ.get("FIREBASE_SERVICE_ACCOUNT_FILE", "")

# Ruta dentro de la Realtime Database donde vive todo el estado de la app —
# la misma que usaba el SPA (DB_PATH="eventstock_v2" en js/operations.js).
DB_PATH = os.environ.get("DB_PATH", "eventstock_v2")

# Clave para firmar la cookie de sesión de FastAPI (SessionMiddleware).
# En producción SIEMPRE debe configurarse por variable de entorno.
SESSION_SECRET_KEY = os.environ.get("SESSION_SECRET_KEY", "dev-secret-change-me-in-production")

ENVIRONMENT = os.environ.get("ENVIRONMENT", "development")
