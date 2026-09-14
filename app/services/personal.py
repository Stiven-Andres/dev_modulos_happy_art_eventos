"""CRUD de personal y disponibilidad por fecha, portado de
guardarPersonal/eliminarPersonal/agregarFechaNoDisponible/quitarFechaNoDisponible
en legacy/js/main.js."""
from app.models import ROLES_PERSONAL, telefono_valido


class ValidationError(Exception):
    pass


def crear_personal(state, data):
    nombre = data["nombre"].strip()
    if not nombre:
        raise ValidationError("Ingresa el nombre del empleado")
    telefono = (data.get("telefono") or "").strip()
    if telefono and not telefono_valido(telefono):
        raise ValidationError("Teléfono inválido — debe iniciar en 3 y tener 10 dígitos")
    edad = int(data["edad"]) if data.get("edad") else None
    p = {
        "id": state["nextPersonalId"], "nombre": nombre, "rol": data.get("rol") or "logistico",
        "edad": edad, "telefono": telefono, "cuentaTipo": data.get("cuentaTipo") or "Nequi",
        "direccion": (data.get("direccion") or "").strip(), "noDisponibleFechas": [],
    }
    state["nextPersonalId"] += 1
    state["personal"].append(p)
    return p


def editar_personal(state, id_, data):
    p = next((x for x in state["personal"] if x["id"] == id_), None)
    if not p:
        raise ValidationError("Empleado no encontrado")
    nombre = data["nombre"].strip()
    if not nombre:
        raise ValidationError("Ingresa el nombre del empleado")
    telefono = (data.get("telefono") or "").strip()
    if telefono and not telefono_valido(telefono):
        raise ValidationError("Teléfono inválido — debe iniciar en 3 y tener 10 dígitos")
    edad = int(data["edad"]) if data.get("edad") else None
    p.update({
        "nombre": nombre, "rol": data.get("rol") or "logistico", "edad": edad,
        "telefono": telefono, "cuentaTipo": data.get("cuentaTipo") or "Nequi",
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


def agregar_fecha_no_disponible(state, id_, fecha):
    p = next((x for x in state["personal"] if x["id"] == id_), None)
    if not p:
        raise ValidationError("Empleado no encontrado")
    p.setdefault("noDisponibleFechas", [])
    if fecha not in p["noDisponibleFechas"]:
        p["noDisponibleFechas"].append(fecha)


def quitar_fecha_no_disponible(state, id_, fecha):
    p = next((x for x in state["personal"] if x["id"] == id_), None)
    if not p:
        return
    p["noDisponibleFechas"] = [f for f in (p.get("noDisponibleFechas") or []) if f != fecha]
