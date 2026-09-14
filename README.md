# EventStock — FastAPI + Jinja2 + Bootstrap

Sistema de inventario, ventas/contratos y gestión de personal para Happy Art
Eventos / Conde Eventos.

Esta es la versión reconstruida en **FastAPI** (backend Python) + **Jinja2**
(plantillas renderizadas en el servidor) + **Bootstrap 5** (frontend), que
reemplaza a la SPA original en JavaScript/Firebase (conservada en
[`legacy/`](legacy/) como referencia). La funcionalidad es la misma; lo que
cambia es la arquitectura:

- **Antes**: SPA 100% en el navegador, un único `state` en memoria
  sincronizado en vivo con Firebase Realtime Database (`onValue`).
- **Ahora**: cada página se renderiza en el servidor. Cada request lee el
  estado completo desde Firebase (`firebase.get_state()`) y, si hay cambios,
  los vuelve a guardar completos (`firebase.save_state()`) — el mismo patrón
  de "leer todo / escribir todo" que ya tenía el original (ver RNF3 en los
  requerimientos no funcionales), solo que ahora ocurre en el servidor en
  vez del navegador.

## Qué se mantiene y qué cambia

- ✅ **Se mantiene Firebase Realtime Database** como almacén de datos —
  accedido desde el servidor con el SDK de administrador
  (`firebase_admin`), no desde el navegador.
- ✅ **Se mantiene Firebase Authentication** para el login — las
  credenciales se verifican en el servidor contra la API REST de Identity
  Toolkit (el SDK de administrador no puede verificar contraseñas
  directamente, solo tokens ya emitidos).
- ⚠️ **Se pierde la sincronización en tiempo real entre usuarios.** Antes,
  si dos personas tenían la app abierta, los cambios de una aparecían
  instantáneamente en la pantalla de la otra. Ahora cada quien ve los
  cambios de los demás al recargar o navegar a otra página. No hay
  WebSockets ni actualización automática en segundo plano.
- 🎨 El diseño visual cambia a Bootstrap 5 (ya no es un calco pixel-perfect
  del original) — la funcionalidad es la misma, el aspecto es distinto.

## Estructura del proyecto

```
app/
  main.py          — punto de entrada FastAPI, registra todos los routers
  config.py        — configuración leída de variables de entorno
  firebase.py       — acceso a Realtime Database + verificación de login
  models.py         — helpers de dominio puros (portados de legacy/js/models.js)
  deps.py           — plantillas Jinja2 + control de acceso por sesión
  data/catalog.json — catálogos (paquetes, roles, etc.) extraídos del original
  routers/          — un router por módulo (auth, dashboard, inventario, ventas, ...)
  services/         — lógica de negocio de cada módulo (sin FastAPI ni Jinja2)
  templates/        — plantillas Jinja2 (con Bootstrap 5 + htmx para partes interactivas)
  static/           — CSS propio, logos usados en el PDF de contrato
legacy/              — la SPA original completa, conservada como referencia
requirements.txt
```

## Desarrollo local

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Variables de entorno necesarias (ver `app/config.py` para la lista completa
y sus valores por defecto):

- `FIREBASE_SERVICE_ACCOUNT_JSON` (o `FIREBASE_SERVICE_ACCOUNT_FILE`) —
  **obligatoria**. Ver la sección siguiente para generarla.
- `SESSION_SECRET_KEY` — clave para firmar la cookie de sesión. En local
  puede omitirse (usa un valor de desarrollo), pero **debe** configurarse en
  producción.
- El resto (`FIREBASE_API_KEY`, `FIREBASE_DATABASE_URL`, etc.) ya tienen el
  valor del proyecto Firebase original como valor por defecto — normalmente
  no hace falta tocarlas a menos que se use otro proyecto de Firebase.

```bash
uvicorn app.main:app --reload
```

Abrir `http://localhost:8000`.

### Cómo generar la cuenta de servicio de Firebase

Este paso **debe hacerlo un administrador del proyecto de Firebase** — no es
algo que se pueda generar automáticamente:

1. Entrar a la [consola de Firebase](https://console.firebase.google.com/),
   abrir el proyecto (`inventario-4c0fd`).
2. **Configuración del proyecto** (ícono de engranaje) → pestaña **Cuentas
   de servicio**.
3. Click en **Generar nueva clave privada** → confirma → se descarga un
   archivo `.json`.
4. En local: guardarlo en el proyecto (fuera de git) y apuntar
   `FIREBASE_SERVICE_ACCOUNT_FILE` a esa ruta.
5. En Render (o cualquier hosting): pegar el **contenido completo** de ese
   archivo `.json` como valor de la variable de entorno
   `FIREBASE_SERVICE_ACCOUNT_JSON` (una sola línea).

⚠️ Este archivo es secreto — nunca debe subirse al repositorio.

## Despliegue en Render (plan gratuito)

1. Crear un **Web Service** nuevo en Render, apuntando a este repositorio.
2. **Build command**: `pip install -r requirements.txt`
3. **Start command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Variables de entorno a configurar en Render (pestaña *Environment*):
   - `FIREBASE_SERVICE_ACCOUNT_JSON` — el contenido del JSON de la cuenta de
     servicio (ver arriba).
   - `SESSION_SECRET_KEY` — un valor aleatorio largo (por ejemplo,
     `python3 -c "import secrets;print(secrets.token_hex(32))"`).
   - `ENVIRONMENT=production`
5. Render detecta el `$PORT` automáticamente; no hace falta configurarlo a
   mano, solo usarlo en el start command como arriba.

### Limitaciones del plan gratuito a tener en cuenta

- El servicio se "duerme" tras ~15 minutos sin tráfico y la primera
  petición después de eso tarda varios segundos en responder (cold start).
- Sigue aplicando la limitación ya mencionada de que **no hay
  sincronización en tiempo real** entre usuarios — cada quien ve los
  cambios de los demás al recargar.

## Pruebas

No hay una base de datos Firebase real disponible en este entorno de
desarrollo — para probar los flujos completos (login, CRUD, generación de
PDF, etc.) sin depender de credenciales reales, se puede sustituir
`app.firebase.get_state`/`save_state`/`sign_in_with_password`/
`verify_id_token` por versiones en memoria, como se hizo durante el
desarrollo de este puerto. La lógica de negocio pura vive en `app/services/`
y `app/models.py`, sin dependencias de FastAPI ni Firebase, por lo que
también se puede probar de forma aislada.
