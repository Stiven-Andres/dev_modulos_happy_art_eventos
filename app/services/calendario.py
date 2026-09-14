"""Cálculos del módulo Calendario, portados de renderCalendario()/
calVerDetalle()/renderReporteMaterialesFecha() en legacy/js/main.js."""
import calendar as _cal
from datetime import date


def contar_por_fecha(contratos):
    mapa = {}
    for c in contratos:
        fecha = c.get("fecha")
        if not fecha:
            continue
        mapa.setdefault(fecha, {"happy": 0, "conde": 0})
        if c.get("empresa") == "conde":
            mapa[fecha]["conde"] += 1
        else:
            mapa[fecha]["happy"] += 1
    return mapa


def semanas_mes(anio, mes):
    """Devuelve una lista de semanas; cada semana es lista de (dia_o_None, fecha_str_o_None)."""
    cal = _cal.Calendar(firstweekday=6)  # domingo primero, como Date.getDay()===0
    semanas = []
    for semana in cal.monthdayscalendar(anio, mes):
        fila = []
        for dia in semana:
            if dia == 0:
                fila.append((None, None))
            else:
                fila.append((dia, f"{anio:04d}-{mes:02d}-{dia:02d}"))
        semanas.append(fila)
    return semanas


def reporte_materiales_fecha(productos, eventos_dia):
    """Devuelve (resumen: [{etiqueta, no_en_inventario, qty, stock_total, libre, agotado}], detalle_por_contrato)."""
    totales = {}
    for c in eventos_dia:
        all_items = list(c.get("descontadosPaquete") or []) + list(c.get("extras") or [])
        for nombre in all_items:
            totales[nombre] = totales.get(nombre, 0) + 1

    def _fila(nombre, qty, totales_ref):
        partes = nombre.split(" · ")
        nombre_base = partes[0]
        sku_esp = partes[1] if len(partes) > 1 else None
        if sku_esp:
            prods = [p for p in productos if p["nombre"] == nombre_base and p.get("sku") == sku_esp]
        else:
            prods = [p for p in productos if p["nombre"] == nombre]
        if not prods:
            prods = [p for p in productos if p["nombre"] == nombre_base]
        prod = prods[0] if prods else None
        stock_total = sum(p["stock"] for p in prods)
        libre = stock_total - qty
        etiqueta = f"{sku_esp} · {nombre_base}" if sku_esp else nombre
        return {
            "etiqueta": etiqueta, "sku": sku_esp, "nombre_base": nombre_base,
            "no_en_inventario": prod is None, "qty": qty, "stock_total": stock_total,
            "libre": libre, "agotado": libre < 0,
        }

    resumen = [
        _fila(nombre, qty, totales)
        for nombre, qty in sorted(totales.items(), key=lambda kv: -kv[1])
    ]

    detalle = []
    for c in eventos_dia:
        all_items = list(c.get("descontadosPaquete") or []) + list(c.get("extras") or [])
        freq = {}
        for nombre in all_items:
            freq[nombre] = freq.get(nombre, 0) + 1
        filas = [_fila(nombre, qty, totales) for nombre, qty in freq.items()]
        detalle.append({"contrato": c, "filas": filas})

    return resumen, detalle
