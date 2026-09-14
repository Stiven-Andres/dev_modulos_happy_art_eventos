// ── operations.js ────────────────────────────────────────────────────────────
// Firebase (bootstrap + persistencia) y lógica de negocio / cálculos (sin DOM).
import{initializeApp}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import{getDatabase,ref,set,get}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import{getAuth}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import{state,isConsumable,_buscarEspecificacion}from"./models.js";

const firebaseConfig={
  apiKey:"AIzaSyAQXPTHj5d03-87vSd-v1B3HTL2yFEU-Mk",
  authDomain:"inventario-4c0fd.firebaseapp.com",
  databaseURL:"https://inventario-4c0fd-default-rtdb.firebaseio.com/",
  projectId:"inventario-4c0fd",
  storageBucket:"inventario-4c0fd.firebasestorage.app",
  messagingSenderId:"262043501485",
  appId:"1:262043501485:web:4133bc3e7e1daec4f91724"
};
export const app=initializeApp(firebaseConfig);
export const db=getDatabase(app);
export const auth=getAuth(app);
export const DB_PATH="eventstock_v2";

export async function cargarDatosIniciales(){
  const snap=await get(ref(db,DB_PATH));
  if(snap.exists()){
    const d=snap.val();
    state.productos=d.productos?Object.values(d.productos):[];
    state.movimientos=d.movimientos?Object.values(d.movimientos):[];
    state.prestamos=d.prestamos?Object.values(d.prestamos):[];
    state.contratos=d.contratos?Object.values(d.contratos):[];
    state.contabAjustes=d.contabAjustes||{};
    state.personal=d.personal?Object.values(d.personal):[];
    state.encuestas=d.encuestas?Object.values(d.encuestas):[];
    state.nextId=d.nextId||state.nextId;state.nextMovId=d.nextMovId||state.nextMovId;state.nextPrestId=d.nextPrestId||state.nextPrestId;
    state.nextContratoId=d.nextContratoId||state.nextContratoId;
    state.nextPersonalId=d.nextPersonalId||state.nextPersonalId;
    state.nextEncuestaId=d.nextEncuestaId||state.nextEncuestaId;
  }
}

export async function guardarDatos(){
  try{
    await set(ref(db,DB_PATH),{productos: state.productos,movimientos: state.movimientos,prestamos: state.prestamos,contratos: state.contratos,nextId: state.nextId,nextMovId: state.nextMovId,nextPrestId: state.nextPrestId,nextContratoId: state.nextContratoId,contabAjustes: state.contabAjustes,personal: state.personal,nextPersonalId: state.nextPersonalId,encuestas: state.encuestas,nextEncuestaId: state.nextEncuestaId});
    document.getElementById('save-indicator').textContent='☁️ Sincronizado con Firebase';
  }catch(e){console.error(e);window.toast('Error al guardar','err');}
}

export function puedeEditarContrato(c){
  if(state.esAdmin)return true;
  const emailActual=(getAuth(app).currentUser?.email||'').toLowerCase();
  return !!c.asesor&&c.asesor.toLowerCase()===emailActual;
}

export function calcContabilidadAnio(anio){
  // Devuelve {meses:[{happyN,happyV,condeN,condeV,totalN,totalV}×12], totalAnio:{...}}
  const meses=Array.from({length:12},()=>({happyN:0,happyV:0,condeN:0,condeV:0}));
  for(const c of state.contratos){
    if(!c.fecha)continue;
    const[y,m]=c.fecha.split('-').map(Number);
    if(y!==anio)continue;
    const idx=m-1;
    if(idx<0||idx>11)continue;
    const valor=Number(c.valor)||0;
    if(c.empresa==='conde'){meses[idx].condeN++;meses[idx].condeV+=valor;}
    else{meses[idx].happyN++;meses[idx].happyV+=valor;}
  }
  // Sumar ajustes manuales del admin (no reemplazan el cálculo automático, se añaden)
  for(let i=0;i<12;i++){
    const ajuste=state.contabAjustes[`${anio}-${i+1}`];
    if(!ajuste)continue;
    meses[i].happyN+=Number(ajuste.happyN)||0;
    meses[i].happyV+=Number(ajuste.happyV)||0;
    meses[i].condeN+=Number(ajuste.condeN)||0;
    meses[i].condeV+=Number(ajuste.condeV)||0;
  }
  const totalAnio=meses.reduce((acc,m)=>({
    happyN:acc.happyN+m.happyN,happyV:acc.happyV+m.happyV,
    condeN:acc.condeN+m.condeN,condeV:acc.condeV+m.condeV
  }),{happyN:0,happyV:0,condeN:0,condeV:0});
  return{meses,totalAnio};
}

export function calcStockSeparadoPorFecha(fecha){
  // Retorna {prodId: cantidad_separada, ...} y lista de contratos que caen en esa fecha
  const separado={};
  const contratosEnFecha=[];
  if(!fecha)return{separado,contratosEnFecha};
  const fechaStr=fecha; // 'YYYY-MM-DD'
  for(const c of state.contratos){
    if(c.fecha===fechaStr){
      contratosEnFecha.push(c);
      // Los items que se descontaron del inventario (descontadosPaquete + extras)
      const allItems=[...(c.descontadosPaquete||[]),...(c.extras||[])];
      for(const nombre of allItems){
        const prod=state.productos.find(p=>p.nombre===nombre);
        if(prod){separado[prod.id]=(separado[prod.id]||0)+1;}
      }
    }
  }
  return{separado,contratosEnFecha};
}

export function calcDisponibilidadPaqueteFecha(pk,fecha){
  if(!pk||!fecha)return null;
  const{separado}=calcStockSeparadoPorFecha(fecha);
  let agotados=0,bajos=0,total=0;
  for(const itemNombre of pk.items){
    if(isConsumable(itemNombre))continue;
    const prod=matchInventario(itemNombre);
    if(!prod)continue;
    total++;
    const sep=separado[prod.id]||0;
    const libre=Math.max(0,prod.stock-sep);
    if(libre<=0)agotados++;
    else if(libre<=prod.min)bajos++;
  }
  return{agotados,bajos,total};
}

function _normTxt(s){return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,'').trim();}

export function matchInventarioMultiple(itemNombre){
  // Special compound term: return union of DISFRAZ and PERSONAJE GIGANTE items.
  // En inventario, los personajes gigantes están guardados con nombre exacto
  // "PERSONAJE" (ej. SKU "PR PLIMPLIM", "PR OSO", "PR BESTIA"...), por eso se
  // incluye esa palabra además de "gigante"/"personaje gigante".
  if(itemNombre==='disfraz_o_gigante'){
    const disfraces=state.productos.filter(p=>_normTxt(p.nombre).includes('disfraz'));
    const gigantes=state.productos.filter(p=>{
      const n=_normTxt(p.nombre);
      return n.includes('gigante')||n.includes('personaje');
    });
    const vistos=new Set();
    const union=[];
    for(const p of [...disfraces,...gigantes]){
      if(!vistos.has(p.id)){vistos.add(p.id);union.push(p);}
    }
    return union.length?union:[];
  }
  const palabrasItem=_normTxt(itemNombre).split(/\s+/).filter(w=>w.length>3);
  if(!palabrasItem.length)return[];
  let mejorScore=0;
  const candidatos=[];
  for(const p of state.productos){
    const normProd=_normTxt(p.nombre);
    const score=palabrasItem.filter(w=>normProd.includes(w)).length;
    if(score>0&&score/palabrasItem.length>=0.5){
      candidatos.push({prod:p,score});
      if(score>mejorScore)mejorScore=score;
    }
  }
  if(!candidatos.length)return[];
  // Solo los que igualan el mejor score, agrupados por el mismo nombre exacto que el mejor match
  const mejores=candidatos.filter(c=>c.score===mejorScore);
  const nombreRef=mejores[0].prod.nombre;
  const mismosNombre=mejores.filter(c=>c.prod.nombre===nombreRef).map(c=>c.prod);
  return mismosNombre.length?mismosNombre:[mejores[0].prod];
}

export function matchInventario(itemNombre){
  const palabrasItem=_normTxt(itemNombre).split(/\s+/).filter(w=>w.length>3);
  if(!palabrasItem.length)return null;
  let mejorMatch=null,mejorScore=0;
  for(const p of state.productos){
    const normProd=_normTxt(p.nombre);
    let score=palabrasItem.filter(w=>normProd.includes(w)).length;
    if(score>0&&score/palabrasItem.length>=0.5&&score>mejorScore){
      mejorScore=score;mejorMatch=p;
    }
  }
  return mejorMatch;
}

export function resolverItemsPaqueteInventario(pk,seleccionesVariante){
  const sel=seleccionesVariante||{};
  const resueltos=[];
  const faltanVariante=[];
  for(const itemNombre of pk.items){
    if(isConsumable(itemNombre))continue; // decoración fija / servicio, no es material recuperable
    const spec=_buscarEspecificacion(itemNombre);
    if(spec){
      for(const req of spec.buscar){
        const opciones=matchInventarioMultiple(req.termino);
        if(!opciones.length)continue;
        for(let n=0;n<req.qty;n++){
          if(req.variante&&opciones.length>1){
            const key=`${itemNombre}::${req.termino}::${n}`;
            const prodId=sel[key];
            const elegido=prodId?opciones.find(o=>o.id===prodId):null;
            if(elegido){
              // Store SKU-specific name for report clarity (e.g. "DISFRAZ · SUPERMAN")
              resueltos.push(elegido.sku?elegido.nombre+' · '+elegido.sku:elegido.nombre);
            }else if(req.obligatorio){
              faltanVariante.push(opciones.length>1&&req.qty>1?`${itemNombre} #${n+1}`:itemNombre);
            }
            // No obligatorio y sin elegir: se omite silenciosamente, no bloquea.
          }else{
            const elegido=opciones.find(p=>p.stock>0)||opciones[0];
            resueltos.push(elegido.nombre);
          }
        }
      }
    }else{
      // Sin especificación explícita: conservar el comportamiento anterior como
      // último recurso, para no perder cobertura de ítems aún no catalogados arriba.
      const prod=matchInventario(itemNombre);
      if(prod)resueltos.push(prod.nombre);
    }
  }
  return{resueltos,faltanVariante};
}
