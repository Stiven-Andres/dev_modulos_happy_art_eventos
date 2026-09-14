"""Generación del PDF de contrato (3 páginas: contrato, contenido del
paquete, encuesta de satisfacción), portada de generarPDF() en
legacy/js/main.js. En el original se generaba en el navegador con
html2pdf.js/html2canvas; aquí se renderiza el mismo HTML/CSS con WeasyPrint
del lado del servidor, usando el mismo layout y las mismas condiciones,
nota y medios de pago."""
from pathlib import Path

from weasyprint import HTML

from app.deps import templates
from app.models import PAQUETES, fmt_fecha_contrato

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
HAPPY_LOGO_PATH = (_STATIC_DIR / "img" / "happy_logo.jpg").as_uri()
CONDE_LOGO_PATH = (_STATIC_DIR / "img" / "conde_logo.png").as_uri()

MESES_NOMBRE = [
    "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO",
    "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
]

CONDICIONES = (
    "El cliente deberá realizar el pago del valor estipulado en el contrato antes de dar inicio a la "
    "celebración y/o animación. Una vez el coordinador llegue al lugar del evento, se otorgará un tiempo "
    "máximo de espera de 30 minutos para iniciar la celebración. Después de este tiempo, comenzará a correr "
    "el tiempo contratado, independientemente de si el evento ha iniciado o no. En caso de que el cliente "
    "desee tiempo adicional de animación, este tendrá los siguientes costos: Hora extra diurna: $25.000 por "
    "coordinador. Hora extra nocturna: $50.000 por coordinador. El cliente acepta que las personas que firmen "
    "la presente factura cuentan con autorización para hacerlo y actúan como representantes del contratante, "
    "quien se hace responsable del pago total del servicio. La presente factura se asimila en todos sus "
    "efectos legales a una letra de cambio, conforme a los artículos 774 al 779 del Código de Comercio."
)
NOTA = (
    "Toda celebración que finalice después de las 8:00 p.m. tendrá un recargo adicional de $30.000 por "
    "concepto de transporte y recargo nocturno."
)
MEDIOS_PAGO_HAPPY = "Nequi: 310-407-5240 &nbsp;&nbsp; Daviplata: 310-407-5240 &nbsp;&nbsp; Bancolombia: 567.480.914-11"
MEDIOS_PAGO_CONDE = "Nequi: 312-354-7384 &nbsp;&nbsp; Daviplata: 312-354-7384 &nbsp;&nbsp; Bancolombia: 650.000196-28"


def _titulo_pagina1(c):
    pk = next((p for p in PAQUETES if p["nombre"] == c["paquete"] or p["nombreHappy"] == c["paquete"] or p["nombreConde"] == c["paquete"]), None)
    if not pk:
        return "Paquete de Evento"
    if pk["categoria"] == "baby_shower":
        return "Paquete Baby Shower"
    if pk["categoria"] == "revelacion":
        return "Revelación de Género"
    return "Paquete de Cumpleaños"


def nombre_archivo_pdf(c):
    fecha_partes = c["fecha"].split("-") if c.get("fecha") else ["", "", ""]
    dia_nombre = str(int(fecha_partes[2])) if len(fecha_partes) > 2 and fecha_partes[2] else ""
    mes_nombre = MESES_NOMBRE[int(fecha_partes[1]) - 1] if len(fecha_partes) > 1 and fecha_partes[1] else ""
    nombre_cliente = (c.get("cliente") or "CLIENTE").upper().strip()
    nombre_cliente = " ".join(nombre_cliente.split())
    return f"CONTRATO {dia_nombre} DE {mes_nombre} {nombre_cliente}.pdf"


def generar_pdf_contrato(c) -> bytes:
    es_happy = c["empresa"] == "happy"
    color_empresa = "#e8622a" if es_happy else "#7c5cbf"
    telefonos = " - ".join(filter(None, [c.get("tel1"), c.get("tel2")]))

    fecha_partes = c["fecha"].split("-") if c.get("fecha") else ["", "", ""]
    dia_nombre = str(int(fecha_partes[2])) if len(fecha_partes) > 2 and fecha_partes[2] else ""
    mes_nombre = MESES_NOMBRE[int(fecha_partes[1]) - 1] if len(fecha_partes) > 1 and fecha_partes[1] else ""
    nombre_cliente = (c.get("cliente") or "CLIENTE").upper().strip()

    template = templates.get_template("pdf/contrato.html")
    html_str = template.render({
        "c": c, "es_happy": es_happy, "color_empresa": color_empresa,
        "telefonos": telefonos, "dia_nombre": dia_nombre, "mes_nombre": mes_nombre,
        "nombre_cliente": nombre_cliente, "titulo_pagina1": _titulo_pagina1(c),
        "condiciones": CONDICIONES, "nota": NOTA,
        "medios_pago": MEDIOS_PAGO_HAPPY if es_happy else MEDIOS_PAGO_CONDE,
        "happy_logo_path": HAPPY_LOGO_PATH, "conde_logo_path": CONDE_LOGO_PATH,
    })
    return HTML(string=html_str).write_pdf()
