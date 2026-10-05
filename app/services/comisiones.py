"""Cálculo de comisiones de asesores, portado de la sección COMISIONES DE
ASESORES en legacy/js/operations.js y legacy/js/main.js. No hay persistencia
propia: todo se recalcula desde state["contratos"] en cada request, así que
crear/editar/borrar un contrato se refleja solo, sin tocar este módulo."""
import datetime

from app.models import (
    ROLES,
    MESES_CORTOS,
    comision_contrato,
    evento_realizado,
    fecha_evento_contrato,
    fecha_venta_contrato,
    quincena_de_fecha,
    usuario_asesor,
)

_MESES_LARGOS = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]


def _email_norm(e):
    return str(e or "").lower().strip()


def _correos_excluidos():
    return {_email_norm(e) for e in ROLES["ADMIN_EMAILS"] + ROLES["BODEGA_EMAILS"]}


def _es_contrato_de_asesor(c):
    e = _email_norm(c.get("asesor"))
    return bool(e) and e not in _correos_excluidos()


def lista_asesores(state):
    """Correos de asesores: los definidos en ROLES + cualquier otro correo que
    aparezca en contratos (así un asesor nuevo entra a la tabla sin tocar nada
    más). Se excluyen admin y bodega."""
    excluidos = _correos_excluidos()
    asesores = {_email_norm(e) for e in ROLES["ASESOR_EMAILS"]}
    for c in state["contratos"]:
        e = _email_norm(c.get("asesor"))
        if e and e not in excluidos:
            asesores.add(e)
    return list(asesores)


def clave_mes(d):
    return f"{d.year}-{d.month:02d}"


def clave_dia(d):
    return f"{d.year}-{d.month:02d}-{d.day:02d}"


def inicio_semana(d):
    """Lunes de la semana que contiene d (semana de lunes a domingo)."""
    return d - datetime.timedelta(days=d.weekday())


def rotulo_mes(clave):
    y, m = clave.split("-")
    return f"{_MESES_LARGOS[int(m) - 1]} {y}"


def rotulo_semana(ini, fin):
    a, b = ini.day, fin.day
    if ini.month == fin.month:
        return f"{a} – {b} {MESES_CORTOS[fin.month - 1]} {fin.year}"
    return f"{a} {MESES_CORTOS[ini.month - 1]} – {b} {MESES_CORTOS[fin.month - 1]} {fin.year}"


def meses_con_ventas(state):
    """Meses (YYYY-MM) en los que hay eventos de algún asesor (según la fecha
    del evento, no la de venta), más el mes actual. Más reciente primero."""
    meses = {clave_mes(datetime.date.today())}
    for c in state["contratos"]:
        if not _es_contrato_de_asesor(c):
            continue
        f = fecha_evento_contrato(c)
        if f:
            meses.add(clave_mes(f))
    return sorted(meses, reverse=True)


def calc_comisiones_semanales(state, email):
    """Tabla personal: comisión por semana de UN asesor (el que tiene la
    sesión iniciada)."""
    mio = _email_norm(email)
    semanas = {}

    def asegurar_semana(fecha):
        ini = inicio_semana(fecha)
        k = clave_dia(ini)
        if k not in semanas:
            fin = ini + datetime.timedelta(days=6)
            semanas[k] = {
                "clave": k, "inicio": ini, "fin": fin,
                "n": 0, "ventas": 0, "comision": 0, "contratos": [],
            }
        return semanas[k]

    asegurar_semana(datetime.date.today())  # la semana actual siempre aparece
    if mio and mio not in _correos_excluidos():
        for c in state["contratos"]:
            if _email_norm(c.get("asesor")) != mio:
                continue
            f = fecha_venta_contrato(c)
            if not f:
                continue
            sem = asegurar_semana(f)
            com = comision_contrato(c)
            sem["n"] += 1
            sem["ventas"] += float(c.get("valor") or 0)
            sem["comision"] += com
            sem["contratos"].append({
                "id": c.get("id"), "cliente": c.get("cliente"), "paquete": c.get("paquete"),
                "valor": float(c.get("valor") or 0), "comision": com, "fechaVenta": f,
            })

    lista = sorted(semanas.values(), key=lambda s: s["inicio"], reverse=True)
    for s in lista:
        s["contratos"].sort(key=lambda k: k["fechaVenta"], reverse=True)
    return lista


def calc_ranking_mes(state, clave_del_mes):
    """Tabla competitiva: todos los asesores en un mes (YYYY-MM), agrupados
    por la fecha DEL EVENTO, con el desglose por quincena de los eventos ya
    realizados (lo que efectivamente se paga)."""
    filas = {
        e: {
            "email": e, "usuario": usuario_asesor(e), "n": 0, "comision": 0,
            "q1n": 0, "q1comision": 0, "q2n": 0, "q2comision": 0,
        }
        for e in lista_asesores(state)
    }
    for c in state["contratos"]:
        if not _es_contrato_de_asesor(c):
            continue
        f = fecha_evento_contrato(c)
        if not f or clave_mes(f) != clave_del_mes:
            continue
        fila = filas.get(_email_norm(c.get("asesor")))
        if not fila:
            continue
        com = comision_contrato(c)
        fila["n"] += 1
        fila["comision"] += com
        if evento_realizado(c):
            if quincena_de_fecha(f) == 1:
                fila["q1n"] += 1
                fila["q1comision"] += com
            else:
                fila["q2n"] += 1
                fila["q2comision"] += com
    return sorted(filas.values(), key=lambda r: (-r["comision"], -r["n"], r["usuario"]))


def calc_validacion_quincenas(state, clave_del_mes):
    """Solo para admin: junta los eventos de TODOS los asesores del mes,
    quincena por quincena, para revisar rápido qué comisiones ya se pueden
    pagar (evento ya realizado según la fecha de hoy)."""
    q1, q2 = [], []
    for c in state["contratos"]:
        if not _es_contrato_de_asesor(c):
            continue
        f = fecha_evento_contrato(c)
        if not f or clave_mes(f) != clave_del_mes:
            continue
        item = {
            "id": c.get("id"), "cliente": c.get("cliente"), "asesor": usuario_asesor(c.get("asesor")),
            "fecha": f, "valor": float(c.get("valor") or 0), "comision": comision_contrato(c),
            "realizado": evento_realizado(c),
        }
        (q1 if quincena_de_fecha(f) == 1 else q2).append(item)
    q1.sort(key=lambda x: x["fecha"])
    q2.sort(key=lambda x: x["fecha"])

    def resumen(lista):
        realizados = sum(1 for x in lista if x["realizado"])
        return {"total": len(lista), "realizados": realizados, "pendientes": len(lista) - realizados}

    return {"q1": q1, "q2": q2, "resumenQ1": resumen(q1), "resumenQ2": resumen(q2)}
