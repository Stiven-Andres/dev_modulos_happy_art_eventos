"""CRUD de personal y disponibilidad por fecha, portado de
guardarPersonal/eliminarPersonal/marcarNoDisponible/quitarNoDisponible del
Happy Art.zip (sprint 3): incluye el rol "asesor" (se registra como staff,
aunque no se programa por evento), número de cuenta de pago, y el campo de
disponibilidad renombrado a noDisponible."""
import time

from app.models import ROLES_PERSONAL, telefono_valido


class ValidationError(Exception):
    pass


def crear_personal(state, data):
    nombre = data["nombre"].strip()
    if not nombre:
        raise ValidationError("Ingresa el nombre completo")
    telefono = (data.get("telefono") or "").strip()
    if telefono and not telefono_valido(telefono):
        raise ValidationError("El teléfono debe tener 10 dígitos")
    edad = int(data["edad"]) if data.get("edad") else None
    p = {
        "id": state["nextPersonalId"], "nombre": nombre, "rol": data.get("rol") or "logistico",
        "edad": edad, "telefono": telefono, "cuentaTipo": data.get("cuentaTipo") or "nequi",
        "cuentaNumero": (data.get("cuentaNumero") or "").strip(),
        "direccion": (data.get("direccion") or "").strip(), "noDisponible": [],
        "fechaRegistro": int(time.time() * 1000),
    }
    state["nextPersonalId"] += 1
    state["personal"].append(p)
    return p


def editar_personal(state, id_, data):
    p = next((x for x in state["personal"] if x["id"] == id_), None)
    if not p:
        raise ValidationError("Personal no encontrado")
    nombre = data["nombre"].strip()
    if not nombre:
        raise ValidationError("Ingresa el nombre completo")
    telefono = (data.get("telefono") or "").strip()
    if telefono and not telefono_valido(telefono):
        raise ValidationError("El teléfono debe tener 10 dígitos")
    edad = int(data["edad"]) if data.get("edad") else None
    p.update({
        "nombre": nombre, "rol": data.get("rol") or "logistico", "edad": edad,
        "telefono": telefono, "cuentaTipo": data.get("cuentaTipo") or "nequi",
        "cuentaNumero": (data.get("cuentaNumero") or "").strip(),
        "direccion": (data.get("direccion") or "").strip(),
    })
    return p


def eliminar_personal(state, id_):
    state["personal"] = [p for p in state["personal"] if p["id"] != id_]
    for c in state["contratos"]:
        asign = c.get("personalAsignado")
        if not asign:
            continue
        for rol in ROLES_PERSONAL:
            if asign.get(rol["id"]):
                asign[rol["id"]] = [pid for pid in asign[rol["id"]] if pid != id_]


def marcar_no_disponible(state, id_, fecha):
    p = next((x for x in state["personal"] if x["id"] == id_), None)
    if not p:
        raise ValidationError("Personal no encontrado")
    p.setdefault("noDisponible", [])
    if fecha not in p["noDisponible"]:
        p["noDisponible"].append(fecha)


def quitar_no_disponible(state, id_, fecha):
    p = next((x for x in state["personal"] if x["id"] == id_), None)
    if not p:
        return
    p["noDisponible"] = [f for f in (p.get("noDisponible") or []) if f != fecha]
