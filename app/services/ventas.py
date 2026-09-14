"""Lógica del módulo Ventas (registro de contratos), portada de
renderPaquetesGrid()/renderIncluidosList()/_pendientesVariantePaquete()/
detectarLetrasNumero()/registrarVenta() en legacy/js/main.js."""
import re
import time

from app.models import PAQUETES, _buscar_especificacion, fmt_precio, is_consumable, telefono_valido
from app.services.calculos import calc_stock_separado_por_fecha, match_inventario, match_inventario_multiple, \
    resolver_items_paquete_inventario


class ValidationError(Exception):
    pass


CATEGORIAS_PAQUETE = [
    {"id": "cumpleanos", "label": "🎂 Cumpleaños"},
    {"id": "baby_shower", "label": "👶 Baby Shower"},
    {"id": "revelacion", "label": "🎀 Revelación de Género"},
]


def get_paquete(pk_id):
    return next((p for p in PAQUETES if p["id"] == pk_id), None)


def pendientes_variante_paquete(productos, pk):
    if not pk:
        return []
    pendientes = []
    for item_nombre in pk["items"]:
        if is_consumable(item_nombre):
            continue
        spec = _buscar_especificacion(item_nombre)
        if not spec:
            continue
        for req in spec["buscar"]:
            opciones = match_inventario_multiple(productos, req["termino"])
            if req.get("variante") and len(opciones) > 1:
                for n in range(req["qty"]):
                    pendientes.append({
                        "itemNombre": item_nombre, "termino": req["termino"], "idx": n,
                        "opciones": opciones, "obligatorio": bool(req.get("obligatorio")),
                    })
    return pendientes


def incluidos_con_disponibilidad(productos, contratos, pk, fecha):
    separado, _ = calc_stock_separado_por_fecha(contratos, productos, fecha) if fecha else ({}, [])
    filas = []
    for item in pk["items"]:
        estado = None
        if fecha and not is_consumable(item):
            prod = match_inventario(productos, item)
            if prod:
                libre = max(0, prod["stock"] - separado.get(prod["id"], 0))
                if libre <= 0:
                    estado = "sin_stock"
                elif libre <= prod["min"]:
                    estado = "bajo"
        filas.append({"texto": item, "estado": estado})
    return filas


def _norm_letras(s):
    s = (s or "").upper()
    import unicodedata
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^A-Z0-9]", "", s)


def detectar_letras_numero(productos, pk, festejado, anios):
    """Devuelve (extras_auto: [{prodId, qty}], mensajes: [str], faltantes: [str])."""
    if not pk:
        return [], [], []
    extras_auto = {}
    mensajes, faltantes = [], []

    for item_nombre in pk["items"]:
        baja = item_nombre.lower()
        es_nombre = "nombre" in baja
        es_numero = bool(re.search(r"n[uú]mero", baja)) and bool(
            re.search(r"(a cumplir|n[uú]mero luminoso|^n[uú]mero$)", baja))
        es_luminoso = "luminos" in baja
        es_globo = "globo" in baja and not re.search(r"metalizado|aerost[aá]tico", baja)
        if not es_luminoso and not es_globo:
            continue

        if es_nombre and festejado:
            letras = list(_norm_letras(festejado))
            if not letras:
                continue
            cat_sku = "LUMINOSA " if es_luminoso else "LG "
            cat_nombre = "LETRA LUMINOSA" if es_luminoso else "LETRA GLOBO"
            encontradas, no_encontradas = [], []
            for letra in letras:
                prod = next((p for p in productos
                             if p["nombre"].upper().startswith(cat_nombre)
                             and _norm_letras(p["sku"]) == _norm_letras(cat_sku + letra)), None)
                if prod and prod["stock"] > 0:
                    encontradas.append(letra)
                    extras_auto.setdefault(prod["id"], 0)
                    extras_auto[prod["id"]] += 1
                else:
                    no_encontradas.append(letra + (" (sin stock)" if prod else " (no existe)"))
            if encontradas:
                mensajes.append(f'Nombre "{festejado.upper()}" → se agregaron {len(encontradas)} {cat_nombre.lower()} ({"".join(letras)})')
            if no_encontradas:
                faltantes.append(f"{cat_nombre}: {', '.join(no_encontradas)}")

        if es_numero and anios:
            digitos = [c for c in _norm_letras(anios) if c.isdigit()]
            if not digitos:
                continue
            if es_luminoso:
                encontrados, no_encontrados = [], []
                for d in digitos:
                    prod = next((p for p in productos
                                 if p["nombre"].upper().startswith("NUMERO LUMINOSO")
                                 and _norm_letras(p["sku"]) == _norm_letras("LUMINOSO " + d)), None)
                    if prod and prod["stock"] > 0:
                        encontrados.append(d)
                        extras_auto.setdefault(prod["id"], 0)
                        extras_auto[prod["id"]] += 1
                    else:
                        no_encontrados.append(d + (" (sin stock)" if prod else " (no existe)"))
                if encontrados:
                    mensajes.append(f'Número a cumplir "{anios}" → se agregaron {len(encontrados)} número(s) luminoso(s) ({"".join(digitos)})')
                if no_encontrados:
                    faltantes.append(f"NÚMERO LUMINOSO: {', '.join(no_encontrados)}")
            elif es_globo:
                faltantes.append(f"No hay número en globo individual por dígito en inventario — revisar manualmente (años: {anios})")

    extras_list = [{"prodId": pid, "qty": qty} for pid, qty in extras_auto.items()]
    return extras_list, mensajes, faltantes


def registrar_contrato(state, empresa, pk_id, form, variantes_sel, extras_sel, asesor_email):
    fecha = form.get("fecha") or ""
    cliente = (form.get("cliente") or "").strip()
    tel1 = (form.get("tel1") or "").strip()
    tel2 = (form.get("tel2") or "").strip()
    if not fecha or not cliente or not tel1 or not pk_id:
        raise ValidationError("Completa fecha, cliente, teléfono y paquete")
    if not telefono_valido(tel1):
        raise ValidationError("El teléfono 1 debe tener exactamente 10 dígitos (ej: 3102112655)")
    if not telefono_valido(tel2):
        raise ValidationError("El teléfono 2 debe tener exactamente 10 dígitos (ej: 3102112655)")

    pk = get_paquete(pk_id)
    if not pk:
        raise ValidationError("Paquete no encontrado")

    productos = state["productos"]
    descontados_paquete, faltan_variante = resolver_items_paquete_inventario(productos, pk, variantes_sel)
    if faltan_variante:
        raise ValidationError(f"Falta especificar: {', '.join(faltan_variante)}")

    extras_nombres = []
    for sel in extras_sel:
        prod = next((p for p in productos if p["id"] == sel["prodId"]), None)
        if not prod:
            continue
        qty = sel.get("qty") or 1
        nombre_up = prod["nombre"].strip().upper()
        es_variante_identificable = nombre_up.startswith("LETRA LUMINOSA") or nombre_up.startswith("LETRA GLOBO") or nombre_up.startswith("NUMERO LUMINOSO")
        etiqueta = f"{prod['nombre']} ({prod['sku']})" if (es_variante_identificable and prod.get("sku")) else prod["nombre"]
        extras_nombres.extend([etiqueta] * qty)

    valor_input = form.get("valorPaquete") or ""
    valor_input_num = int(re.sub(r"[^0-9]", "", valor_input) or 0)
    valor_final = valor_input_num if valor_input_num > 0 else pk["precio"]

    requerimientos_personal = {
        "logistico": int(form.get("pers_logistico") or 0),
        "recreador": int(form.get("pers_recreador") or 0),
        "coordinador": int(form.get("pers_coordinador") or 0),
        "operario": int(form.get("pers_operario") or 0),
    }

    contrato = {
        "id": state["nextContratoId"], "empresa": empresa, "fecha": fecha,
        "hora": form.get("hora") or "", "horaDecoracion": form.get("horaDecoracion") or "",
        "cliente": cliente, "tel1": tel1, "tel2": tel2,
        "direccion": (form.get("direccion") or "").strip(), "barrio": (form.get("barrio") or "").strip(),
        "localidad": (form.get("localidad") or "").strip(), "festejado": (form.get("festejado") or "").strip(),
        "paquete": pk["nombre"], "valor": valor_final, "valorCatalogo": pk["precio"],
        "items": pk["items"] + extras_nombres, "extras": extras_nombres,
        "descontadosPaquete": descontados_paquete, "fechaRegistro": int(time.time() * 1000),
        "asesor": asesor_email, "requerimientosPersonal": requerimientos_personal,
        "personalAsignado": {"logistico": [], "recreador": [], "coordinador": [], "operario": []},
    }
    state["nextContratoId"] += 1
    state["contratos"].append(contrato)
    return contrato
