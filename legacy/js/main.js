// ── main.js ───────────────────────────────────────────────────────────────────
// Renderizado DOM, manejadores window.* usados por los onclick/onchange inline del
// HTML, navegación, calendario, generación de PDF, y la orquestación de arranque.
import{getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import{ref,onValue,get}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import{
  state,ROLES,obtenerRol,getProd,telefonoValido,stockStatus,statusBadge,catClass,eventoBadge,
  fmt,fmtDate,fmtFecha,MESES_CORTOS,RECUPERABLES_KEYWORDS,_normRecuperable,isConsumable,
  BUSQUEDA_INVENTARIO_ALIAS,buscarTerminosInventario,ESPECIFICACION_ITEMS_PAQUETE,_buscarEspecificacion,
  PAQUETES,fmtPrecio,fmtFechaContrato,fmtHora,fmtHoraEvento,
  ROLES_PERSONAL,CUENTAS_PAGO,labelRolPersonal,getPersona,estaDisponible,personaAsignadaEnFecha,
  ENCUESTA_CAMPOS,_normEncuestaHeader,DIAS_SEMANA
}from"./models.js";
import{
  app,db,auth,DB_PATH,cargarDatosIniciales,guardarDatos,puedeEditarContrato,calcContabilidadAnio,
  calcStockSeparadoPorFecha,calcDisponibilidadPaqueteFecha,matchInventarioMultiple,matchInventario,
  resolverItemsPaqueteInventario
}from"./operations.js";

window.hacerLogin=async function(){
  const email=document.getElementById('loginEmail').value.trim();
  const pass=document.getElementById('loginPassword').value;
  const btn=document.getElementById('loginBtn');
  const err=document.getElementById('loginError');
  err.style.display='none';
  if(!email||!pass){showErr('Completa correo y contraseña.');return;}
  btn.disabled=true;btn.textContent='Entrando...';
  try{await signInWithEmailAndPassword(auth,email,pass);}
  catch(e){
    btn.disabled=false;btn.textContent='Entrar al inventario';
    const msgs={'auth/user-not-found':'Usuario no encontrado.','auth/wrong-password':'Contraseña incorrecta.','auth/invalid-email':'Correo inválido.','auth/invalid-credential':'Correo o contraseña incorrectos.','auth/too-many-requests':'Demasiados intentos. Espera un momento.'};
    showErr(msgs[e.code]||'Error al iniciar sesión. Intenta de nuevo.');
  }
};

function showErr(msg){const d=document.getElementById('loginError');d.textContent=msg;d.style.display='block';}

window.cerrarSesion=async function(){
  if(!confirm('¿Cerrar sesión?'))return;
  state.productos=[];state.movimientos=[];state.prestamos=[];state.contratos=[];state.contabAjustes={};state.personal=[];state.encuestas=[];
  _prestamoGruposAbiertos=new Set();
  state.nextId=27;state.nextMovId=17;state.nextPrestId=8;state.editId=null;state.esAdmin=false;state.esAsesor=false;
  _realtimeListenerActivo=false;
  // Reset completo del estado del modal de préstamo por pasos (variables + DOM visual)
  loanStep=1;loanPkgId=null;loanReturnItems=[];loanConsumeItems=[];loanExtrasSelected=[];
  document.querySelectorAll('.loan-pkg-card').forEach(c=>c.classList.remove('selected'));
  [1,2,3].forEach(i=>{
    const s=document.getElementById('loan-step-'+i);if(s)s.classList.toggle('active',i===1);
    const d=document.getElementById('sdot-'+i);if(d){d.classList.toggle('active',i===1);d.classList.remove('done');}
    if(i<3){const l=document.getElementById('sline-'+i);if(l)l.classList.remove('done');}
  });
  ['loan_coordinador','loan_cliente','loan_fecha_evento','loan_retorno','loan_nota'].forEach(f=>{const el=document.getElementById(f);if(el)el.value='';});
  // Reset de venta / contratos en edición
  ventaExtrasSelected=[];paqueteSeleccionado=null;ventaEmpresa=null;
  editContratoId=null;window._ecPkSeleccionado=null;
  const ventasFormWrap=document.getElementById('ventas-form-wrap');if(ventasFormWrap)ventasFormWrap.style.display='none';
  const empresaSelector=document.getElementById('ventas-empresa-selector');if(empresaSelector)empresaSelector.style.display='block';
  // Limpiar inputs visibles de login y quitar el foco para evitar que el navegador
  // recuerde/sugiera la sesión del usuario anterior al volver a iniciar sesión
  const loginEmailEl=document.getElementById('loginEmail');
  const loginPassEl=document.getElementById('loginPassword');
  if(loginEmailEl){loginEmailEl.value='';loginEmailEl.blur();}
  if(loginPassEl){loginPassEl.value='';loginPassEl.blur();}
  document.getElementById('loginError').style.display='none';
  await signOut(auth);
};

onAuthStateChanged(auth,user=>{
  if(user){
    document.getElementById('loginScreen').style.display='none';
    document.getElementById('appScreen').style.display='block';
    document.getElementById('user-email').textContent=user.email;
    state.esAdmin=obtenerRol(user.email)==='admin';
    init();
  }else{
    document.getElementById('loginScreen').style.display='flex';
    document.getElementById('appScreen').style.display='none';
    document.getElementById('loginBtn').disabled=false;
    document.getElementById('loginBtn').textContent='Entrar al inventario';
  }
});

window.soloLetras=function(el){
  const pos=el.selectionStart;
  const limpio=el.value.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñÜü\s]/g,'').toUpperCase();
  if(limpio!==el.value){el.value=limpio;try{el.setSelectionRange(pos,pos);}catch(e){}}
  else if(el.value!==el.value.toUpperCase()){el.value=el.value.toUpperCase();try{el.setSelectionRange(pos,pos);}catch(e){}}
};

window.aMayusculas=function(el){
  const pos=el.selectionStart;
  const up=el.value.toUpperCase();
  if(up!==el.value){el.value=up;try{el.setSelectionRange(pos,pos);}catch(e){}}
};

window.soloNumeros=function(el){
  const pos=el.selectionStart;
  const limpio=el.value.replace(/[^0-9\s-]/g,'');
  if(limpio!==el.value){el.value=limpio;try{el.setSelectionRange(pos-1,pos-1);}catch(e){}}
};

// Evita valores negativos en campos numéricos (stock, precios, cantidades, ajustes).
window.noNegativo=function(el){
  if(el.value!==''&&Number(el.value)<0)el.value='0';
};
window.soloDigitosTelefono=function(el){
  const pos=el.selectionStart;
  let limpio=el.value.replace(/[^0-9]/g,'').slice(0,10);
  // Celular colombiano: debe iniciar en 3 — se descarta cualquier dígito inicial distinto.
  while(limpio&&limpio[0]!=='3')limpio=limpio.slice(1);
  if(limpio!==el.value){el.value=limpio;try{el.setSelectionRange(pos,pos);}catch(e){}}
};

function renderDashboard(){
  const total=state.productos.length,valor=state.productos.reduce((s,p)=>s+p.precio*p.stock,0),bajos=state.productos.filter(p=>stockStatus(p)==='low').length,agotados=state.productos.filter(p=>stockStatus(p)==='out').length,prestActivos=state.prestamos.filter(p=>!p.devuelto).length;
  document.getElementById('stats').innerHTML=`<div class="stat-card s-orange"><span class="stat-icon">📦</span><div class="stat-label">Artículos</div><div class="stat-value">${total}</div><div class="stat-sub">en catálogo</div></div><div class="stat-card s-purple"><span class="stat-icon">💰</span><div class="stat-label">Valor en stock</div><div class="stat-value">$${fmt(Math.round(valor))}</div><div class="stat-sub">costo × unidades</div></div><div class="stat-card s-warn"><span class="stat-icon">⚠️</span><div class="stat-label">Stock bajo</div><div class="stat-value">${bajos}</div><div class="stat-sub">requieren reposición</div></div><div class="stat-card s-danger"><span class="stat-icon">❌</span><div class="stat-label">Agotados</div><div class="stat-value">${agotados}</div><div class="stat-sub">sin unidades</div></div><div class="stat-card s-green"><span class="stat-icon">🔄</span><div class="stat-label">Préstamos activos</div><div class="stat-value">${prestActivos}</div><div class="stat-sub">por devolver</div></div>`;
  const ul=[...state.movimientos].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha)).slice(0,6);
  const c=document.getElementById('dash-movs');
  if(!ul.length){c.innerHTML='<div style="padding:32px;text-align:center;color:var(--muted);">Sin actividad reciente</div>';}
  else c.innerHTML=ul.map(m=>{const p=getProd(m.prodId);return`<div class="mov-item"><span class="mov-pill ${m.tipo}">${m.tipo.toUpperCase()}</span><div class="mov-info"><div class="mov-prod">${p?p.nombre:'—'}</div><div class="mov-meta">${fmtFecha(m.fecha)}${m.evento?' · 🎪 '+m.evento:''}${m.nota?' · '+m.nota:''}</div></div><div class="mov-qty ${m.tipo}">${m.qty>0?'+':''}${m.qty}</div></div>`;}).join('');
  renderContabilidad();
  renderEncuestas();
}

function poblarSelectorAnioContab(){
  const sel=document.getElementById('contab-anio');
  if(!sel)return;
  const anioActual=new Date().getFullYear();
  const aniosConDatos=new Set(state.contratos.filter(c=>c.fecha).map(c=>parseInt(c.fecha.split('-')[0])));
  aniosConDatos.add(anioActual);
  const anios=[...aniosConDatos].sort((a,b)=>b-a);
  const valorPrevio=sel.value?parseInt(sel.value):anioActual;
  sel.innerHTML=anios.map(a=>`<option value="${a}" ${a===valorPrevio?'selected':''}>${a}</option>`).join('');
  if(!sel.value)sel.value=String(anioActual);
}

window.renderContabilidad=function(){
  const tbody=document.getElementById('contab-tbody');
  const tfoot=document.getElementById('contab-tfoot');
  if(!tbody||!tfoot)return;
  poblarSelectorAnioContab();
  const anio=parseInt(document.getElementById('contab-anio')?.value)||new Date().getFullYear();
  const{meses,totalAnio}=calcContabilidadAnio(anio);

  const celda=(n,esVal)=>{
    if(esVal)return n>0?`$${fmt(n)}`:'<span class="contab-zero">—</span>';
    return n>0?n:'<span class="contab-zero">0</span>';
  };

  tbody.innerHTML=meses.map((m,i)=>{
    const totalN=m.happyN+m.condeN,totalV=m.happyV+m.condeV;
    const tieneAjuste=!!state.contabAjustes[`${anio}-${i+1}`];
    return`<tr>
      <td class="contab-mes">${MESES_CORTOS[i]} ${anio}${tieneAjuste?' <span title="Incluye ajuste manual" style="font-size:10px;">✎</span>':''}</td>
      <td class="contab-happy">${celda(m.happyN,false)}</td>
      <td class="contab-happy">${celda(m.happyV,true)}</td>
      <td class="contab-conde">${celda(m.condeN,false)}</td>
      <td class="contab-conde">${celda(m.condeV,true)}</td>
      <td>${celda(totalN,false)}</td>
      <td><strong>${celda(totalV,true)}</strong></td>
      <td>${state.esAdmin?`<button class="btn btn-ghost btn-sm" onclick="abrirAjusteContabilidad(${anio},${i+1})" title="Editar valores manuales">✎</button>`:''}</td>
    </tr>`;
  }).join('');

  const totalNAnio=totalAnio.happyN+totalAnio.condeN,totalVAnio=totalAnio.happyV+totalAnio.condeV;
  tfoot.innerHTML=`<tr>
    <td class="contab-mes">TOTAL ${anio}</td>
    <td class="contab-happy">${celda(totalAnio.happyN,false)}</td>
    <td class="contab-happy">${celda(totalAnio.happyV,true)}</td>
    <td class="contab-conde">${celda(totalAnio.condeN,false)}</td>
    <td class="contab-conde">${celda(totalAnio.condeV,true)}</td>
    <td>${celda(totalNAnio,false)}</td>
    <td>${celda(totalVAnio,true)}</td>
    <td></td>
  </tr>`;
};

window.exportarContabilidadCSV=function(){
  const anio=parseInt(document.getElementById('contab-anio')?.value)||new Date().getFullYear();
  const{meses,totalAnio}=calcContabilidadAnio(anio);
  const filas=[['Mes','Happy Art - Eventos','Happy Art - Ventas','Conde Eventos - Eventos','Conde Eventos - Ventas','Total Eventos','Total Ventas']];
  meses.forEach((m,i)=>{
    filas.push([`${MESES_CORTOS[i]} ${anio}`,m.happyN,m.happyV,m.condeN,m.condeV,m.happyN+m.condeN,m.happyV+m.condeV]);
  });
  filas.push([`TOTAL ${anio}`,totalAnio.happyN,totalAnio.happyV,totalAnio.condeN,totalAnio.condeV,totalAnio.happyN+totalAnio.condeN,totalAnio.happyV+totalAnio.condeV]);
  const csv='\uFEFF'+filas.map(f=>f.map(v=>typeof v==='string'&&v.includes(',')?`"${v}"`:v).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`Contabilidad_Ventas_${anio}.csv`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('📊 Archivo CSV descargado — ábrelo con Excel','ok');
};

let _ajusteContabAnio=null,_ajusteContabMes=null;

window.abrirAjusteContabilidad=function(anio,mes){
  if(!state.esAdmin){toast('Solo el administrador puede editar la contabilidad','err');return;}
  _ajusteContabAnio=anio;_ajusteContabMes=mes;
  const actual=state.contabAjustes[`${anio}-${mes}`]||{happyN:0,happyV:0,condeN:0,condeV:0};
  document.getElementById('ac_mes_label').textContent=`${MESES_CORTOS[mes-1]} ${anio}`;
  document.getElementById('ac_happy_n').value=actual.happyN||0;
  document.getElementById('ac_happy_v').value=actual.happyV||0;
  document.getElementById('ac_conde_n').value=actual.condeN||0;
  document.getElementById('ac_conde_v').value=actual.condeV||0;
  document.getElementById('ajusteContabOverlay').classList.add('open');
};

window.cerrarAjusteContabilidad=function(){
  document.getElementById('ajusteContabOverlay').classList.remove('open');
  _ajusteContabAnio=null;_ajusteContabMes=null;
};

window.guardarAjusteContabilidad=async function(){
  if(!state.esAdmin){toast('No tienes permisos para esta acción','err');return;}
  if(!_ajusteContabAnio||!_ajusteContabMes)return;
  const happyN=parseInt(document.getElementById('ac_happy_n').value)||0;
  const happyV=parseInt(document.getElementById('ac_happy_v').value)||0;
  const condeN=parseInt(document.getElementById('ac_conde_n').value)||0;
  const condeV=parseInt(document.getElementById('ac_conde_v').value)||0;
  const key=`${_ajusteContabAnio}-${_ajusteContabMes}`;
  if(!happyN&&!happyV&&!condeN&&!condeV){delete state.contabAjustes[key];}
  else{state.contabAjustes[key]={happyN,happyV,condeN,condeV};}
  cerrarAjusteContabilidad();
  renderContabilidad();
  await guardarDatos();
  toast('✅ Ajuste de contabilidad guardado','ok');
};

window.borrarAjusteContabilidad=async function(){
  if(!state.esAdmin)return;
  if(!_ajusteContabAnio||!_ajusteContabMes)return;
  delete state.contabAjustes[`${_ajusteContabAnio}-${_ajusteContabMes}`];
  cerrarAjusteContabilidad();
  renderContabilidad();
  await guardarDatos();
  toast('🗑 Ajuste eliminado','ok');
};

// ── ENCUESTAS DE SATISFACCIÓN (carga desde plantilla Excel de Microsoft Forms) ──
let encuestaDiasFiltro=new Set([0,1,2,3,4,5,6]);

window.toggleDiaEncuesta=function(dow,checked){
  if(checked)encuestaDiasFiltro.add(dow);else encuestaDiasFiltro.delete(dow);
  renderEncuestas();
};

function _parseFechaEncuesta(v){
  if(v instanceof Date&&!isNaN(v))return v.toISOString().slice(0,10);
  const s=String(v||'').trim();
  if(!s)return'';
  const d=new Date(s);
  if(!isNaN(d))return d.toISOString().slice(0,10);
  return s;
}

window.cargarPlantillaEncuestas=function(file){
  if(!file)return;
  if(typeof XLSX==='undefined'){toast('No se pudo cargar el lector de Excel — revisa tu conexión','err');return;}
  const reader=new FileReader();
  reader.onload=async function(e){
    try{
      const data=new Uint8Array(e.target.result);
      const wb=XLSX.read(data,{type:'array',cellDates:true});
      const sheet=wb.Sheets[wb.SheetNames[0]];
      const filas=XLSX.utils.sheet_to_json(sheet,{defval:''});
      if(!filas.length){toast('El archivo no tiene filas de datos','err');return;}
      const headers=Object.keys(filas[0]);
      const mapa={};
      for(const campo of ENCUESTA_CAMPOS){
        const h=headers.find(hh=>campo.match.some(k=>_normEncuestaHeader(hh).includes(k)));
        if(h)mapa[campo.key]=h;
      }
      if(!mapa.fecha){toast('No se encontró una columna de fecha en el archivo','err');return;}
      let importadas=0;
      for(const fila of filas){
        const val=k=>mapa[k]!==undefined?fila[mapa[k]]:'';
        const fecha=_parseFechaEncuesta(val('fecha'));
        if(!fecha)continue; // fila vacía o basura al final del archivo
        state.encuestas.push({
          id:state.nextEncuestaId++,
          nombreCliente:String(val('nombreCliente')||'').trim(),
          telefono:String(val('telefono')||'').trim(),
          fecha,
          recomendacion:Number(val('recomendacion'))||null,
          satisfaccion:Number(val('satisfaccion'))||null,
          coordinador:Number(val('coordinador'))||null,
          puntualidad:Number(val('puntualidad'))||null,
          sugerencia:String(val('sugerencia')||'').trim(),
          mejora:String(val('mejora')||'').trim(),
          fechaCarga:Date.now()
        });
        importadas++;
      }
      await guardarDatos();
      renderEncuestas();
      toast(`✅ ${importadas} encuesta(s) importada(s)`,'ok');
    }catch(err){
      console.error('Error al leer Excel de encuestas:',err);
      toast('❌ Error al leer el archivo — verifica que sea la plantilla correcta','err');
    }
    document.getElementById('encuestaExcelInput').value='';
  };
  reader.readAsArrayBuffer(file);
};

function renderEncuestas(){
  const tbody=document.getElementById('encuesta-tbody');
  const statsEl=document.getElementById('encuesta-stats');
  if(!tbody)return;
  const filtradas=state.encuestas.filter(e=>e.fecha&&encuestaDiasFiltro.has(new Date(e.fecha+'T12:00:00').getDay()));

  const porFecha={};
  for(const e of filtradas){
    if(!porFecha[e.fecha])porFecha[e.fecha]={n:0,recomendacion:0,nRec:0,satisfaccion:0,nSat:0,coordinador:0,nCoo:0,puntualidad:0,nPun:0};
    const g=porFecha[e.fecha];
    g.n++;
    if(e.recomendacion){g.recomendacion+=e.recomendacion;g.nRec++;}
    if(e.satisfaccion){g.satisfaccion+=e.satisfaccion;g.nSat++;}
    if(e.coordinador){g.coordinador+=e.coordinador;g.nCoo++;}
    if(e.puntualidad){g.puntualidad+=e.puntualidad;g.nPun++;}
  }
  const fechas=Object.keys(porFecha).sort((a,b)=>b.localeCompare(a));
  if(!fechas.length){
    tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);">Sin encuestas cargadas para los días seleccionados</td></tr>';
  }else{
    tbody.innerHTML=fechas.map(f=>{
      const g=porFecha[f];
      const avg=(sum,n)=>n?(sum/n).toFixed(1):'—';
      return`<tr><td>${fmtDate(f+'T12:00:00')} <span style="color:var(--muted);font-size:10px;">(${DIAS_SEMANA[new Date(f+'T12:00:00').getDay()]})</span></td><td>${g.n}</td><td>${avg(g.recomendacion,g.nRec)}</td><td>${avg(g.satisfaccion,g.nSat)}</td><td>${avg(g.coordinador,g.nCoo)}</td><td>${avg(g.puntualidad,g.nPun)}</td></tr>`;
    }).join('');
  }

  const avgTotal=campo=>{
    const vals=filtradas.map(e=>e[campo]).filter(v=>v);
    return vals.length?(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1):'—';
  };
  if(statsEl)statsEl.innerHTML=`
    <div class="stat-card s-purple"><span class="stat-icon">📝</span><div class="stat-label">Encuestas</div><div class="stat-value">${filtradas.length}</div><div class="stat-sub">en el filtro actual</div></div>
    <div class="stat-card s-orange"><span class="stat-icon">👍</span><div class="stat-label">Recomendación</div><div class="stat-value">${avgTotal('recomendacion')}</div><div class="stat-sub">promedio / 5</div></div>
    <div class="stat-card s-green"><span class="stat-icon">😊</span><div class="stat-label">Satisfacción</div><div class="stat-value">${avgTotal('satisfaccion')}</div><div class="stat-sub">promedio / 5</div></div>
    <div class="stat-card s-warn"><span class="stat-icon">🧭</span><div class="stat-label">Coordinador</div><div class="stat-value">${avgTotal('coordinador')}</div><div class="stat-sub">promedio / 5</div></div>
  `;
}
window.renderEncuestas=renderEncuestas;

function renderCatFilter(){const cats=[...new Set(state.productos.map(p=>p.cat))].sort();const sel=document.getElementById('filterCat');const cur=sel?sel.value:'';if(sel)sel.innerHTML='<option value="">Todas las categorías</option>'+cats.map(c=>`<option${c===cur?' selected':''}>${c}</option>`).join('');}

function renderTabla(){
  const q=(document.getElementById('searchInput')?.value||'').toLowerCase();
  const cat=document.getElementById('filterCat')?.value||'';
  const ev=document.getElementById('filterEvento')?.value||'';
  const st=document.getElementById('filterStock')?.value||'';
  const fecha=document.getElementById('invFechaFiltro')?.value||'';

  // Badge de fecha
  const badge=document.getElementById('inv-fecha-badge');
  const clearBtn=document.getElementById('inv-fecha-clear');
  if(badge)badge.style.display=fecha?'inline-flex':'none';
  if(clearBtn)clearBtn.style.display=fecha?'inline-flex':'none';

  // Calcular separados si hay fecha
  const{separado,contratosEnFecha}=calcStockSeparadoPorFecha(fecha);

  // Panel de contratos en la fecha
  const sepPanel=document.getElementById('inv-sep-panel');
  const sepLabel=document.getElementById('inv-sep-fecha-label');
  const sepList=document.getElementById('inv-sep-contratos-list');
  const totalPanel=document.getElementById('inv-total-panel');
  if(fecha){
    if(totalPanel)totalPanel.style.display='none';
    if(sepPanel){
      sepPanel.style.display='block';
      if(sepLabel)sepLabel.textContent=fmtDate(fecha+'T12:00:00');
      if(sepList){
        if(contratosEnFecha.length){
          sepList.innerHTML=contratosEnFecha.map(c=>{
            // Calcular total de materiales del contrato
            const allItems=[...(c.descontadosPaquete||[]),...(c.extras||[])];
            const resumen=allItems.length?`<span style="font-size:11px;background:#f0f0f0;border-radius:5px;padding:2px 7px;margin-left:6px;">${allItems.length} artículo(s)</span>`:'';
            return`<div class="sep-contrato-row">
              <div class="sep-contrato-dot ${c.empresa}"></div>
              <div style="flex:1;"><strong>${c.cliente}</strong> — ${c.paquete}
              ${resumen}
              <span style="font-size:10px;color:var(--muted);margin-left:6px;">Asesor: ${c.asesor||'—'} · ${c.empresa==='happy'?'Happy Art':'Conde Eventos'}</span></div>
              <div style="font-size:11px;color:var(--muted);">${c.extras?.length?`+${c.extras.length} extras`:''}</div>
            </div>`;
          }).join('');
        }else{
          sepList.innerHTML=`<div style="font-size:13px;color:var(--muted);padding:8px 0;">✅ No hay contratos para esta fecha.</div>`;
        }
      }
    }
  }else{
    if(sepPanel)sepPanel.style.display='none';
    if(totalPanel)totalPanel.style.display='block';
  }

  const lista=state.productos.filter(p=>{
    const mq=!q||p.nombre.toLowerCase().includes(q)||p.sku.toLowerCase().includes(q)||p.cat.toLowerCase().includes(q)||(p.proveedor||'').toLowerCase().includes(q);
    if(!mq||(!cat||p.cat===cat)===false||(!ev||p.evento===ev)===false)return false;
    if(!mq)return false;
    if(cat&&p.cat!==cat)return false;
    if(ev&&p.evento!==ev)return false;
    if(st){
      // Para estado, considerar stock real disponible si hay fecha
      const stockDisp=fecha?Math.max(0,p.stock-(separado[p.id]||0)):p.stock;
      const fakeP={...p,stock:stockDisp};
      if(stockStatus(fakeP)!==st)return false;
    }
    return true;
  });

  const cont=document.getElementById('invCards');
  if(!cont)return;
  if(!lista.length){cont.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--muted);"><span style="font-size:36px;display:block;margin-bottom:10px;">🔍</span>Sin resultados — prueba con otra búsqueda</div>`;return;}

  cont.innerHTML=lista.map(p=>{
    const sep=separado[p.id]||0;
    const stockDisp=fecha?Math.max(0,p.stock-sep):p.stock;
    const fakeP={...p,stock:stockDisp};
    const s=stockStatus(fakeP);
    const colorBig=s==='out'?'var(--danger)':s==='low'?'var(--warn)':'var(--success)';
    const sepHtml=fecha&&sep>0?`<div class="inv-card-sep">
      <span style="flex:1;color:var(--muted);">📌 Separado para esa fecha:</span>
      <span class="sep-num">-${sep}</span>
      <span style="margin:0 4px;color:var(--muted);">·</span>
      <span style="font-size:10px;color:var(--muted);">Libre:</span>
      <span class="sep-avail">${stockDisp}</span>
    </div>`:'';
    return`<div class="inv-card">
      <div class="inv-card-name">${p.nombre}</div>
      <div class="inv-card-sku">${p.sku} · <span class="badge-cat ${catClass(p.cat)}">${p.cat}</span></div>
      <div class="inv-card-stock" style="color:${colorBig};">
        <span class="big">${fmt(fecha?p.stock:p.stock)}</span>
        <span class="unit">${p.unidad}</span>
        ${fecha&&sep>0?'<span style="font-size:11px;color:var(--muted);margin-left:4px;">total</span>':''}
      </div>
      ${sepHtml}
      <div class="inv-card-footer">
        ${statusBadge(fakeP)}
        <div style="display:flex;gap:5px;">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="openMovModalProd(${p.id})" title="Movimiento">↕</button>
          ${state.esAdmin?`<button class="btn btn-ghost btn-sm btn-icon" onclick="editProducto(${p.id})" title="Editar">✎</button><button class="btn btn-danger btn-sm btn-icon" onclick="eliminarProducto(${p.id})" title="Eliminar">✕</button>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
}

window.limpiarFechaInventario=function(){
  const el=document.getElementById('invFechaFiltro');
  if(el)el.value='';
  renderTabla();
};

window.irAReporteCalendario=function(){
  const fecha=document.getElementById('invFechaFiltro')?.value||'';
  showView('calendario');
  if(fecha){
    const[y,m]=fecha.split('-').map(Number);
    calMesActual=new Date(y,m-1,1);
    renderCalendario();
    setTimeout(()=>calVerDetalle(fecha),0);
  }
};

window.openModal=function(id=null){
  state.editId=id;document.getElementById('modalTitle').textContent=id?'Editar Artículo':'Nuevo Artículo';
  if(id){const p=getProd(id);document.getElementById('f_sku').value=p.sku;document.getElementById('f_nombre').value=p.nombre;document.getElementById('f_cat').value=p.cat;document.getElementById('f_evento').value=p.evento;document.getElementById('f_precio').value=p.precio;document.getElementById('f_stock').value=p.stock;document.getElementById('f_min').value=p.min;document.getElementById('f_unidad').value=p.unidad;document.getElementById('f_proveedor').value=p.proveedor||'';document.getElementById('f_ubicacion').value=p.ubicacion||'';document.getElementById('f_desc').value=p.desc||'';}
  else{['f_sku','f_nombre','f_precio','f_stock','f_min','f_proveedor','f_ubicacion','f_desc'].forEach(f=>document.getElementById(f).value='');document.getElementById('f_cat').value='';document.getElementById('f_evento').value='Ambos';document.getElementById('f_unidad').value='Unidad';}
  document.getElementById('modalOverlay').classList.add('open');
};

window.closeModal=function(){document.getElementById('modalOverlay').classList.remove('open');state.editId=null;};

window.editProducto=function(id){openModal(id);};

window.guardarProducto=async function(){if(!state.esAdmin){toast('No tienes permisos para esta acción','err');return;}
  const sku=document.getElementById('f_sku').value.trim(),nombre=document.getElementById('f_nombre').value.trim(),cat=document.getElementById('f_cat').value;
  if(!sku||!nombre||!cat){toast('Completa código, nombre y categoría','err');return;}
  const evento=document.getElementById('f_evento').value,precio=parseFloat(document.getElementById('f_precio').value)||0,stock=parseInt(document.getElementById('f_stock').value)||0,min=parseInt(document.getElementById('f_min').value)||0,unidad=document.getElementById('f_unidad').value,proveedor=document.getElementById('f_proveedor').value.trim(),ubicacion=document.getElementById('f_ubicacion').value.trim(),desc=document.getElementById('f_desc').value.trim();
  if(state.editId){const p=getProd(state.editId);const diff=stock-p.stock;Object.assign(p,{sku,nombre,cat,evento,precio,stock,min,unidad,proveedor,ubicacion,desc});if(diff!==0)state.movimientos.push({id:state.nextMovId++,prodId:state.editId,tipo:'ajuste',qty:diff,evento:'',nota:'Edición manual',fecha:Date.now()});toast('¡Artículo actualizado!','ok');}
  else{if(state.productos.find(p=>p.sku===sku)){toast('Ese código ya existe','err');return;}const p={id:state.nextId++,sku,nombre,cat,evento,precio,stock,min,unidad,proveedor,ubicacion,desc};state.productos.push(p);if(stock>0)state.movimientos.push({id:state.nextMovId++,prodId:p.id,tipo:'entrada',qty:stock,evento:'',nota:'Stock inicial',fecha:Date.now()});toast('¡Nuevo artículo creado!','ok');}
  closeModal();renderTabla();renderCatFilter();await guardarDatos();
};

window.eliminarProducto=async function(id){if(!state.esAdmin){toast('No tienes permisos para esta acción','err');return;}if(!confirm('¿Eliminar este artículo?'))return;state.productos=state.productos.filter(p=>p.id!==id);state.movimientos=state.movimientos.filter(m=>m.prodId!==id);renderTabla();renderCatFilter();await guardarDatos();toast('Artículo eliminado','warn');};

window.openMovModal=function(){document.getElementById('m_prod').innerHTML='<option value="">— Seleccionar artículo —</option>'+state.productos.map(p=>`<option value="${p.id}">${p.nombre} · Stock: ${p.stock} ${p.unidad}</option>`).join('');['m_qty','m_nota','m_evento'].forEach(f=>document.getElementById(f).value='');document.getElementById('m_tipo').value='entrada';document.getElementById('movOverlay').classList.add('open');};

window.openMovModalProd=function(id){openMovModal();document.getElementById('m_prod').value=id;};

window.closeMovModal=function(){document.getElementById('movOverlay').classList.remove('open');};

window.guardarMovimiento=async function(){
  const prodId=parseInt(document.getElementById('m_prod').value),tipo=document.getElementById('m_tipo').value,qty=parseInt(document.getElementById('m_qty').value)||0,evento=document.getElementById('m_evento').value.trim(),nota=document.getElementById('m_nota').value.trim();
  if(!prodId){toast('Selecciona un artículo','err');return;}if(qty<=0){toast('La cantidad debe ser mayor a 0','err');return;}
  const p=getProd(prodId);const delta=tipo==='salida'?-qty:qty;
  if(p.stock+delta<0){toast(`Stock insuficiente — disponible: ${p.stock} ${p.unidad}`,'err');return;}
  p.stock+=delta;state.movimientos.push({id:state.nextMovId++,prodId,tipo,qty:delta,evento,nota,fecha:Date.now()});
  closeMovModal();renderTabla();await guardarDatos();toast(`Movimiento registrado · Stock: ${p.stock} ${p.unidad}`,'ok');
};

function renderMovimientos(){const lista=[...state.movimientos].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));const cont=document.getElementById('movList');if(!lista.length){cont.innerHTML='<div style="padding:40px;text-align:center;color:var(--muted);">Sin movimientos registrados</div>';return;}cont.innerHTML=lista.map(m=>{const p=getProd(m.prodId);return`<div class="mov-item"><span class="mov-pill ${m.tipo}">${m.tipo.toUpperCase()}</span><div class="mov-info"><div class="mov-prod">${p?p.nombre:'Artículo eliminado'}</div><div class="mov-meta">${fmtFecha(m.fecha)}${m.evento?' · 🎪 '+m.evento:''}${m.nota?' · '+m.nota:''}</div></div><div class="mov-qty ${m.tipo}">${m.qty>0?'+':''}${m.qty}</div></div>`;}).join('');}

window.openPrestamoModal=function(){document.getElementById('p_prod').innerHTML='<option value="">— Seleccionar artículo —</option>'+state.productos.filter(p=>p.stock>0).map(p=>`<option value="${p.id}">${p.nombre} · Disponible: ${p.stock} ${p.unidad}</option>`).join('');['p_qty','p_cliente','p_nota'].forEach(f=>document.getElementById(f).value='');const d=new Date();d.setDate(d.getDate()+7);document.getElementById('p_retorno').value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;document.getElementById('prestamoOverlay').classList.add('open');};

window.closePrestamoModal=function(){document.getElementById('prestamoOverlay').classList.remove('open');};

window.guardarPrestamo=async function(){
  const prodId=parseInt(document.getElementById('p_prod').value),qty=parseInt(document.getElementById('p_qty').value)||0,cliente=document.getElementById('p_cliente').value.trim(),retorno=document.getElementById('p_retorno').value,nota=document.getElementById('p_nota').value.trim();
  if(!prodId||!cliente){toast('Selecciona artículo e ingresa el cliente','err');return;}if(qty<=0){toast('Cantidad debe ser mayor a 0','err');return;}
  const p=getProd(prodId);if(p.stock<qty){toast(`Stock insuficiente — disponible: ${p.stock} ${p.unidad}`,'err');return;}
  p.stock-=qty;state.prestamos.push({id:state.nextPrestId++,prodId,qty,cliente,salida:Date.now(),retorno:retorno?new Date(retorno).getTime():null,devuelto:false,nota});
  state.movimientos.push({id:state.nextMovId++,prodId,tipo:'prestamo',qty:-qty,evento:cliente,nota:'Préstamo registrado',fecha:Date.now()});
  closePrestamoModal();renderTabla();renderPrestamos();await guardarDatos();toast(`Préstamo confirmado para ${cliente}`,'ok');
};

window.devolverPrestamo=async function(id){const pr=state.prestamos.find(p=>p.id===id);if(!pr||pr.devuelto)return;const p=getProd(pr.prodId);if(p)p.stock+=pr.qty;pr.devuelto=true;state.movimientos.push({id:state.nextMovId++,prodId:pr.prodId,tipo:'devolucion',qty:pr.qty,evento:pr.cliente,nota:'Devolución de préstamo',fecha:Date.now()});renderPrestamos();renderTabla();await guardarDatos();toast('¡Devolución registrada!','ok');};

function _prestamoGroupKey(pr){
  const minuto=Math.floor(pr.salida/60000); // agrupa préstamos hechos en el mismo minuto
  return `${pr.coordinador||''}|||${pr.cliente||''}|||${minuto}`;
}

let _prestamoGruposAbiertos=new Set();

window.togglePrestamoGrupo=function(encodedKey){
  const key=decodeURIComponent(encodedKey);
  if(_prestamoGruposAbiertos.has(key))_prestamoGruposAbiertos.delete(key);
  else _prestamoGruposAbiertos.add(key);
  renderPrestamos();
};

function renderPrestamos(){
  const cont=document.getElementById('prestamosGroupList');
  if(!cont)return;
  if(!state.prestamos.length){cont.innerHTML='<div style="padding:40px;text-align:center;color:var(--muted);"><span class="empty-icon">🔄</span><br>Sin préstamos registrados</div>';renderLoanPkgGrid();return;}

  // Agrupar préstamos por coordinador/evento (misma operación)
  const grupos=new Map();
  for(const pr of state.prestamos){
    const key=_prestamoGroupKey(pr);
    if(!grupos.has(key))grupos.set(key,{coordinador:pr.coordinador||'',cliente:pr.cliente||'—',paquete:pr.paquete||'',salida:pr.salida,retorno:pr.retorno,items:[]});
    const g=grupos.get(key);
    g.items.push(pr);
    if(pr.salida<g.salida)g.salida=pr.salida;
  }
  const listaGrupos=[...grupos.entries()].sort((a,b)=>new Date(b[1].salida)-new Date(a[1].salida));

  cont.innerHTML=listaGrupos.map(([key,g])=>{
    const totalItems=g.items.length;
    const pendientes=g.items.filter(it=>!it.devuelto).length;
    const vencidoGrupo=g.items.some(it=>!it.devuelto&&it.retorno&&new Date(it.retorno)<new Date());
    let estadoGrupo;
    if(pendientes===0)estadoGrupo='<span class="badge badge-ok">✅ Todo devuelto</span>';
    else if(vencidoGrupo)estadoGrupo=`<span class="badge badge-out">❌ Vencido · ${pendientes} pend.</span>`;
    else estadoGrupo=`<span class="badge badge-low">⏳ ${pendientes} pendiente${pendientes>1?'s':''}</span>`;
    const abierto=_prestamoGruposAbiertos.has(key);
    const encodedKey=encodeURIComponent(key);

    const itemsHtml=g.items.slice().sort((a,b)=>(a.nota||'').localeCompare(b.nota||'')).map(pr=>{
      const p=getProd(pr.prodId);
      const vencido=!pr.devuelto&&pr.retorno&&new Date(pr.retorno)<new Date();
      const estado=pr.devuelto?'<span class="badge badge-ok">✅ Devuelto</span>':vencido?'<span class="badge badge-out">❌ Vencido</span>':'<span class="badge badge-low">⏳ Activo</span>';
      // Mostrar el código (SKU) como dato principal — es lo que identifica la
      // unidad física exacta en bodega (ej. "PR BESTIA" en vez de "PERSONAJE").
      const nombrePrincipal=p?(p.sku||p.nombre):'Artículo eliminado';
      const nombreSecundario=p?.sku&&p.nombre?` <span style="color:var(--muted);font-weight:600;">· ${p.nombre}</span>`:'';
      return `<div class="loan-detail-row">
        <div class="loan-detail-main">
          <div class="loan-detail-name">${nombrePrincipal}${nombreSecundario}</div>
          <div class="loan-detail-meta">Cantidad: <strong>${pr.qty}</strong>${pr.nota?` · ${pr.nota}`:''}</div>
        </div>
        <div class="loan-detail-status">${estado}</div>
        <div class="loan-detail-action">${!pr.devuelto?`<button class="btn btn-purple btn-sm" onclick="devolverPrestamo(${pr.id})">↩ Devolver</button>`:''}</div>
      </div>`;
    }).join('');

    return `<div class="loan-group-card ${abierto?'open':''}">
      <div class="loan-group-header" onclick="togglePrestamoGrupo('${encodedKey}')">
        <div class="loan-group-toggle">${abierto?'▾':'▸'}</div>
        <div class="loan-group-info">
          <div class="loan-group-title">👤 ${g.coordinador||'Sin coordinador'} <span style="color:var(--muted);font-weight:600;">· 🎪 ${g.cliente}</span></div>
          <div class="loan-group-sub">${g.paquete?`📦 ${g.paquete} · `:''}${totalItems} artículo${totalItems>1?'s':''} · Salida: ${fmtDate(g.salida)}${g.retorno?` · Retorno: ${fmtDate(g.retorno)}`:''}</div>
        </div>
        <div class="loan-group-state">${estadoGrupo}</div>
      </div>
      <div class="loan-group-body" style="display:${abierto?'block':'none'};">${itemsHtml}</div>
    </div>`;
  }).join('');

  renderLoanPkgGrid();
}

let loanStep=1;

let loanPkgId=null;

let loanReturnItems=[];   // [{prod, name, qty, fromInventory}]

let loanConsumeItems=[];  // [name, ...]

let loanExtrasSelected=[]; // [{prod, qty}]

function renderLoanPkgGrid(){
  const grid=document.getElementById('loan-pkg-grid');
  if(!grid)return;
  const cats=[
    {id:'cumpleanos',label:'🎂 Cumpleaños'},
    {id:'baby_shower',label:'👶 Baby Shower'},
    {id:'revelacion',label:'🎀 Revelación de Género'}
  ];
  let html='';
  for(const cat of cats){
    const pkgs=PAQUETES.filter(p=>p.categoria===cat.id);
    if(!pkgs.length)continue;
    html+=`<div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin:12px 0 6px;">${cat.label}</div>`;
    html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;">';
    for(const p of pkgs){
      html+=`<div class="loan-pkg-card" id="lpk-${p.id}" onclick="loanSelectPkg('${p.id}')">
        <div class="pk-name">${p.nombreHappy}</div>
        <div style="font-size:10px;color:var(--muted);">${p.nombreConde}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px;">${p.items.length} ítems</div>
      </div>`;
    }
    html+='</div>';
  }
  grid.innerHTML=html;
}

window.loanSelectPkg=function(pkId){
  loanPkgId=pkId;
  document.querySelectorAll('.loan-pkg-card').forEach(c=>c.classList.remove('selected'));
  const card=document.getElementById('lpk-'+pkId);
  if(card)card.classList.add('selected');
  // Separar ítems en recuperables y consumibles
  const pk=PAQUETES.find(p=>p.id===pkId);
  loanReturnItems=[];
  loanConsumeItems=[];
  for(const itemName of pk.items){
    if(isConsumable(itemName)){
      loanConsumeItems.push(itemName);
    }else{
      // Buscar TODAS las variantes en inventario con el mismo nombre (ej: 6 "LUCES" de distinto
      // tipo — Luz 6 en 1, Luz 5 en 1, Láser, Parled, Robóticas — o 7 "TAPETE DE PELUCHE" de
      // distinto color). Si hay más de una, el asesor/bodeguero elige manualmente cuál(es)
      // unidad(es) específica(s) se presta — puede elegir una o varias variantes distintas
      // para cubrir el mismo ítem del paquete (ej: 1 Luz 6 en 1 + 1 Luz rítmica).
      // Algunos ítems (ver BUSQUEDA_INVENTARIO_ALIAS) cubren más de un objeto físico
      // a la vez (ej. "Show de títeres" = títeres + teatrino): se genera una línea de
      // retorno por cada término de búsqueda, todas con el mismo nombre visible del ítem.
      const terminos=buscarTerminosInventario(itemName);
      for(const termino of terminos){
        const todasVariantes=matchInventarioMultiple(termino); // incluye agotadas, para mostrar el selector aunque stock=0
        const necesitaVariante=todasVariantes.length>1;
        const prod=necesitaVariante?null:(todasVariantes.find(p=>p.stock>0)||todasVariantes[0]||null);
        loanReturnItems.push({
          prod,
          name:itemName,
          qty:prod?1:0,
          fromInventory:!!prod||necesitaVariante,
          necesitaVariante,
          variantesDisponibles:necesitaVariante?todasVariantes:[],
          prodId:prod?prod.id:null,
          // Para ítems con varias variantes: lista de líneas elegidas, cada una {prodId, qty}
          seleccionesVariante:necesitaVariante?[{prodId:null,qty:1}]:[]
        });
      }
    }
  }
  // No resetear loanExtrasSelected aquí — se conservan los extras ya seleccionados
  loanGoStep(2);
};

window.loanGoStep=function(step){
  loanStep=step;
  [1,2,3].forEach(i=>{
    const s=document.getElementById('loan-step-'+i);
    if(s)s.classList.toggle('active',i===step);
    const d=document.getElementById('sdot-'+i);
    if(d){d.classList.toggle('active',i===step);d.classList.toggle('done',i<step);}
    if(i<3){const l=document.getElementById('sline-'+i);if(l)l.classList.toggle('done',i<step);}
  });
  if(step===2)renderLoanStep2();
  if(step===3)renderLoanStep3();
};

function renderLoanStep2(){
  const pk=PAQUETES.find(p=>p.id===loanPkgId);
  const lbl=document.getElementById('loan-pkg-label');
  if(lbl)lbl.textContent=pk?pk.nombre:'';

  const retList=document.getElementById('loan-return-list');
  const conList=document.getElementById('loan-consume-list');
  if(!retList||!conList)return;

  retList.innerHTML=loanReturnItems.map((item,i)=>{
    const stockVal=item.prod?item.prod.stock:0;
    const stockClass=stockVal===0?'out':stockVal<=item.prod?.min?'low':'ok';

    if(item.necesitaVariante){
      const lineasHtml=item.seleccionesVariante.map((linea,li)=>{
        const prodLinea=linea.prodId?getProd(linea.prodId):null;
        return`<div style="display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap;">
          <select onchange="loanSetVarianteLinea(${i},${li},this.value)" style="padding:6px 9px;font-size:12px;border:1.5px solid var(--accent2);border-radius:7px;width:200px;max-width:100%;">
            <option value="">— Elegir tipo específico —</option>
            ${item.variantesDisponibles.map(p=>`<option value="${p.id}" ${linea.prodId===p.id?'selected':''} ${p.stock<=0?'disabled':''}>${p.sku}${p.desc?' · '+p.desc:''} — ${p.stock} disp.${p.stock<=0?' (agotado)':''}</option>`).join('')}
          </select>
          <input type="number" min="1" max="${prodLinea?prodLinea.stock:99}" value="${linea.qty}" onchange="loanSetCantidadLinea(${i},${li},parseInt(this.value)||1)" style="width:56px;padding:6px 7px;text-align:center;border:1.5px solid var(--border);border-radius:7px;font-size:12px;font-weight:700;">
          ${prodLinea?`<span class="q-stock ${prodLinea.stock===0?'out':prodLinea.stock<=prodLinea.min?'low':'ok'}" style="font-size:11px;">${prodLinea.stock} disp.</span>`:''}
          ${item.seleccionesVariante.length>1?`<button onclick="loanQuitarLineaVariante(${i},${li})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;padding:2px 6px;">✕</button>`:''}
        </div>`;
      }).join('');
      return`<div class="loan-item-row must-return" style="align-items:flex-start;">
        <span class="loan-item-icon">🔵</span>
        <div class="loan-item-info" style="flex:1;">
          <div class="loan-item-name">${item.name}</div>
          <span class="loan-item-tag" style="background:#fff3e0;color:#a05a00;">⚠️ Hay ${item.variantesDisponibles.length} tipos — elige uno o varios · Stock total: ${item.variantesDisponibles.reduce((s,p)=>s+p.stock,0)} unid.</span>
          ${lineasHtml}
          <button onclick="loanAgregarLineaVariante(${i})" style="margin-top:6px;background:none;border:1.5px dashed var(--accent2);color:var(--accent2);border-radius:7px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;">+ Agregar otro tipo</button>
        </div>
      </div>`;
    }

    return`<div class="loan-item-row must-return">
      <span class="loan-item-icon">🔵</span>
      <div class="loan-item-info">
        <div class="loan-item-name">${item.name}</div>
        ${item.fromInventory&&item.prod?`<span class="loan-item-tag tag-return">En inventario · ${item.prod.nombre}${item.prod.sku?' ('+item.prod.sku+')':''}</span>`:'<span class="loan-item-tag" style="background:#f0f0f0;color:#888;">Sin coincidencia en inventario</span>'}
      </div>
      ${item.fromInventory&&item.prod?`<div class="loan-item-qty">
        <input type="number" min="0" max="${stockVal}" value="${item.qty}" id="lri-${i}" onchange="loanReturnItems[${i}].qty=parseInt(this.value)||0">
        <span class="q-unit">${item.prod.unidad}</span>
        <span class="q-stock ${stockClass}">${stockVal} disp.</span>
      </div>`:'<span style="font-size:11px;color:var(--muted);">Manual</span>'}
    </div>`;
  }).join('')||'<div style="font-size:12px;color:var(--muted);padding:8px;">Ningún material recuperable en este paquete</div>';

  conList.innerHTML=loanConsumeItems.map(name=>`
    <div class="loan-item-row consumable">
      <span class="loan-item-icon">🟠</span>
      <div class="loan-item-info">
        <div class="loan-item-name">${name}</div>
        <span class="loan-item-tag tag-consume">Se consume — no regresa</span>
      </div>
    </div>`).join('')||'<div style="font-size:12px;color:var(--muted);padding:8px;">Ningún consumible en este paquete</div>';

  // Refrescar chips SIN resetear la selección — solo re-renderizar lo que ya hay
  renderLoanExtrasChips();
  // Limpiar el campo de búsqueda pero no la lista de seleccionados
  const si=document.getElementById('loan-extras-search');
  if(si)si.value='';
  const dd=document.getElementById('loan-extras-dropdown');
  if(dd){dd.innerHTML='';dd.classList.remove('open');}
}

function renderLoanStep3(){
  const today=new Date();
  const ret=new Date(today);ret.setDate(ret.getDate()+1);
  const el=document.getElementById('loan_retorno');
  if(el)el.value=`${ret.getFullYear()}-${String(ret.getMonth()+1).padStart(2,'0')}-${String(ret.getDate()).padStart(2,'0')}`;
}

window.loanSetVarianteLinea=function(i,li,prodIdStr){
  const item=loanReturnItems[i];
  if(!item)return;
  const prodId=prodIdStr?parseInt(prodIdStr):null;
  item.seleccionesVariante[li].prodId=prodId;
  renderLoanStep2();
};

window.loanSetCantidadLinea=function(i,li,qty){
  const item=loanReturnItems[i];
  if(!item)return;
  item.seleccionesVariante[li].qty=Math.max(1,qty||1);
};

window.loanAgregarLineaVariante=function(i){
  const item=loanReturnItems[i];
  if(!item)return;
  item.seleccionesVariante.push({prodId:null,qty:1});
  renderLoanStep2();
};

window.loanQuitarLineaVariante=function(i,li){
  const item=loanReturnItems[i];
  if(!item||item.seleccionesVariante.length<=1)return;
  item.seleccionesVariante.splice(li,1);
  renderLoanStep2();
};

let loanExtrasHighlight=-1;

window.loanExtrasSearch=function(q){
  const dd=document.getElementById('loan-extras-dropdown');
  if(!dd)return;
  if(!q.trim()){dd.innerHTML='';dd.classList.remove('open');return;}
  const norm=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const nq=norm(q);
  const ya=new Set(loanExtrasSelected.map(e=>e.prod.id));
  const results=state.productos.filter(p=>!ya.has(p.id)&&(norm(p.nombre).includes(nq)||norm(p.cat).includes(nq)||norm(p.sku).includes(nq))).slice(0,8);
  loanExtrasHighlight=-1;
  if(!results.length){dd.innerHTML='<div style="padding:10px 14px;font-size:12px;color:var(--muted);">Sin resultados</div>';dd.classList.add('open');return;}
  dd.innerHTML=results.map((p,i)=>{const s=stockStatus(p);return`<div class="extras-dd-item" data-idx="${i}" data-id="${p.id}" onclick="loanExtrasAdd(${p.id})"><div><div class="dd-name">${p.nombre}</div><div class="dd-cat">${p.cat} · ${p.sku}</div></div><span class="dd-stock ${s}">${p.stock} ${p.unidad}</span></div>`;}).join('');
  dd.classList.add('open');
};

window.loanExtrasKeydown=function(e){
  const dd=document.getElementById('loan-extras-dropdown');
  const items=dd?.querySelectorAll('.extras-dd-item');
  if(!items?.length)return;
  if(e.key==='ArrowDown'){loanExtrasHighlight=Math.min(loanExtrasHighlight+1,items.length-1);}
  else if(e.key==='ArrowUp'){loanExtrasHighlight=Math.max(loanExtrasHighlight-1,0);}
  else if(e.key==='Enter'&&loanExtrasHighlight>=0){items[loanExtrasHighlight].click();return;}
  else if(e.key==='Escape'){dd.classList.remove('open');return;}
  items.forEach((it,i)=>it.classList.toggle('highlighted',i===loanExtrasHighlight));
};

window.loanExtrasAdd=function(prodId){
  const p=getProd(prodId);if(!p)return;
  if(!loanExtrasSelected.find(e=>e.prod.id===prodId)){loanExtrasSelected.push({prod:p,qty:1});}
  const si=document.getElementById('loan-extras-search');
  if(si){si.value='';const dd=document.getElementById('loan-extras-dropdown');if(dd){dd.innerHTML='';dd.classList.remove('open');}}
  renderLoanExtrasChips();
};

window.loanExtrasRemove=function(prodId){loanExtrasSelected=loanExtrasSelected.filter(e=>e.prod.id!==prodId);renderLoanExtrasChips();};

function renderLoanExtrasChips(){
  const cont=document.getElementById('loan-extras-chips');if(!cont)return;
  cont.innerHTML=loanExtrasSelected.map(e=>`
    <div class="extra-chip valid">
      <span class="extra-chip-name">${e.prod.nombre} <span style="font-weight:400;color:var(--muted);font-size:11px;">(disp: ${e.prod.stock})</span></span>
      <div class="extra-chip-qty">
        <input type="number" min="1" max="${e.prod.stock}" value="${e.qty}" onchange="loanExtrasSetQty(${e.prod.id},parseInt(this.value)||1)">
        <span style="font-size:11px;color:var(--muted);">${e.prod.unidad}</span>
      </div>
      <button class="extra-chip-remove" onclick="loanExtrasRemove(${e.prod.id})">✕</button>
    </div>`).join('');
}

window.loanExtrasSetQty=function(prodId,qty){const e=loanExtrasSelected.find(x=>x.prod.id===prodId);if(e)e.qty=qty;};

window.confirmarPrestamoPaquete=async function(){
  const coordinador=document.getElementById('loan_coordinador')?.value.trim()||'';
  const cliente=document.getElementById('loan_cliente')?.value.trim()||'';
  const fechaEvento=document.getElementById('loan_fecha_evento')?.value||'';
  const retorno=document.getElementById('loan_retorno')?.value||'';
  const nota=document.getElementById('loan_nota')?.value.trim()||'';
  if(!cliente){toast('Ingresa el nombre del cliente / evento','err');return;}

  // Validar que todo ítem con varios tipos disponibles (ej. Luces: Luz 6 en 1, Luz rítmica...)
  // tenga al menos una línea con tipo elegido antes de confirmar
  const pendientes=loanReturnItems.filter(it=>it.necesitaVariante&&!it.seleccionesVariante.some(l=>l.prodId));
  if(pendientes.length){
    toast(`⚠️ Falta elegir el tipo específico de: ${pendientes.map(p=>p.name).slice(0,3).join(', ')}`,'err');
    return;
  }

  const pk=PAQUETES.find(p=>p.id===loanPkgId);
  const eventoRef=`${pk?.nombre||'Evento'} · ${cliente}`;
  const retornoTs=retorno?new Date(retorno).getTime():null;

  // Refresco fresco de Firebase
  try{const snap=await get(ref(db,DB_PATH));if(snap.exists()){const d=snap.val();state.productos=d.productos?Object.values(d.productos):state.productos;state.movimientos=d.movimientos?Object.values(d.movimientos):state.movimientos;state.nextMovId=d.nextMovId||state.nextMovId;}}catch(e){console.warn('No se pudo refrescar inventario');}

  let registrados=0,sinStock=[];

  // Préstamo de ítems recuperables que están en inventario
  for(const item of loanReturnItems){
    if(!item.fromInventory)continue;

    if(item.necesitaVariante){
      // Ítem con varias variantes: puede tener 1 o más líneas elegidas (ej. 1 Luz 6 en 1 + 1 Luz rítmica)
      for(const linea of item.seleccionesVariante){
        if(!linea.prodId||linea.qty<=0)continue;
        const p=getProd(linea.prodId);
        if(!p)continue;
        if(p.stock<linea.qty){sinStock.push(p.nombre+(p.sku?' ('+p.sku+')':''));continue;}
        p.stock-=linea.qty;
        const notaVariante=` (${item.name}: ${p.sku}${p.desc?' — '+p.desc:''})`;
        state.prestamos.push({id:state.nextPrestId++,prodId:p.id,qty:linea.qty,cliente:eventoRef,coordinador,paquete:pk?.nombre,salida:Date.now(),retorno:retornoTs,devuelto:false,nota:nota+notaVariante,tipoItem:'recuperable'});
        state.movimientos.push({id:state.nextMovId++,prodId:p.id,tipo:'prestamo',qty:-linea.qty,evento:eventoRef,nota:`Préstamo paquete ${pk?.nombre}${notaVariante}`,fecha:Date.now()});
        registrados++;
      }
    }else{
      if(item.qty<=0||!item.prodId)continue;
      const p=getProd(item.prodId);
      if(!p)continue;
      if(p.stock<item.qty){sinStock.push(p.nombre+(p.sku?' ('+p.sku+')':''));continue;}
      p.stock-=item.qty;
      state.prestamos.push({id:state.nextPrestId++,prodId:p.id,qty:item.qty,cliente:eventoRef,coordinador,paquete:pk?.nombre,salida:Date.now(),retorno:retornoTs,devuelto:false,nota,tipoItem:'recuperable'});
      state.movimientos.push({id:state.nextMovId++,prodId:p.id,tipo:'prestamo',qty:-item.qty,evento:eventoRef,nota:`Préstamo paquete ${pk?.nombre}`,fecha:Date.now()});
      registrados++;
    }
  }

  // Extras adicionales
  for(const extra of loanExtrasSelected){
    const p=getProd(extra.prod.id);
    if(!p||p.stock<extra.qty){sinStock.push(extra.prod.nombre);continue;}
    p.stock-=extra.qty;
    state.prestamos.push({id:state.nextPrestId++,prodId:p.id,qty:extra.qty,cliente:eventoRef,coordinador,paquete:pk?.nombre,salida:Date.now(),retorno:retornoTs,devuelto:false,nota:'Extra de préstamo',tipoItem:'recuperable'});
    state.movimientos.push({id:state.nextMovId++,prodId:p.id,tipo:'prestamo',qty:-extra.qty,evento:eventoRef,nota:`Extra préstamo ${pk?.nombre}`,fecha:Date.now()});
    registrados++;
  }

  await guardarDatos();
  if(sinStock.length)toast(`⚠️ Sin stock: ${sinStock.slice(0,3).join(', ')}${sinStock.length>3?'...':''}. Resto confirmado.`,'warn');
  else toast(`✅ Préstamo confirmado · ${registrados} artículo(s) registrado(s) para ${eventoRef}`,'ok');

  // Reset
  loanStep=1;loanPkgId=null;loanReturnItems=[];loanConsumeItems=[];loanExtrasSelected=[];
  loanGoStep(1);
  renderPrestamos();
};

function renderAlertas(){const lista=state.productos.filter(p=>stockStatus(p)!=='ok').sort((a,b)=>a.stock-b.stock);const grid=document.getElementById('alertGrid');if(!lista.length){grid.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:56px;color:var(--muted);"><div style="font-size:48px;margin-bottom:12px;">🎉</div><div style="font-family:var(--font-head);font-size:18px;font-weight:800;color:var(--text);margin-bottom:6px;">¡Todo en orden!</div>Sin artículos con stock bajo o agotado</div>`;return;}grid.innerHTML=lista.map(p=>{const s=stockStatus(p);return`<div class="alert-card ${s}"><div class="alert-name">${p.nombre}</div><div class="alert-meta">${p.sku} · <span class="badge-cat ${catClass(p.cat)}">${p.cat}</span></div><div class="alert-stocks"><div class="alert-si"><div class="alert-num ${s==='out'?'danger':'warn'}">${p.stock}</div><div class="alert-lbl">Stock actual</div></div><div class="alert-si"><div class="alert-num muted">${p.min}</div><div class="alert-lbl">Mínimo</div></div>${p.proveedor?`<div class="alert-si"><div style="font-size:12px;font-weight:700;color:var(--text);margin-top:6px;">${p.proveedor}</div><div class="alert-lbl">Proveedor</div></div>`:''}</div><button class="btn btn-primary btn-sm" style="width:100%;" onclick="openMovModalProd(${p.id});showView('movimientos');">📥 Registrar entrada</button></div>`;}).join('');}

let _tt;

let calMesActual=new Date();calMesActual.setDate(1);

function calContarPorFecha(){
  // {'YYYY-MM-DD': {happy:n, conde:n}}
  const mapa={};
  for(const c of state.contratos){
    if(!c.fecha)continue;
    if(!mapa[c.fecha])mapa[c.fecha]={happy:0,conde:0};
    if(c.empresa==='conde')mapa[c.fecha].conde++;
    else mapa[c.fecha].happy++;
  }
  return mapa;
}

function renderCalendario(){
  const grid=document.getElementById('cal-grid');
  const label=document.getElementById('cal-mes-label');
  if(!grid||!label)return;

  const mesesNombre=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const anio=calMesActual.getFullYear(),mes=calMesActual.getMonth();
  label.textContent=`${mesesNombre[mes]} ${anio}`;

  const primerDiaSemana=new Date(anio,mes,1).getDay(); // 0=domingo
  const diasEnMes=new Date(anio,mes+1,0).getDate();
  const conteos=calContarPorFecha();
  const _hoy=new Date();
  const hoyStr=`${_hoy.getFullYear()}-${String(_hoy.getMonth()+1).padStart(2,'0')}-${String(_hoy.getDate()).padStart(2,'0')}`;

  let html='';
  for(let i=0;i<primerDiaSemana;i++){
    html+='<div class="cal-day cal-empty"></div>';
  }
  for(let dia=1;dia<=diasEnMes;dia++){
    const fechaStr=`${anio}-${String(mes+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
    const c=conteos[fechaStr]||{happy:0,conde:0};
    const total=c.happy+c.conde;
    const esHoy=fechaStr===hoyStr;
    html+=`<div class="cal-day${esHoy?' cal-today':''}" onclick="calVerDetalle('${fechaStr}')">
      <div class="cal-day-num">${dia}</div>
      <div class="cal-day-bars">
        ${c.happy>0?`<div class="cal-bar cal-bar-happy">🎪 ${c.happy}</div>`:''}
        ${c.conde>0?`<div class="cal-bar cal-bar-conde">🎭 ${c.conde}</div>`:''}
      </div>
      ${total>0?`<div class="cal-day-total">${total} evento${total===1?'':'s'}</div>`:''}
    </div>`;
  }
  // Completar última semana con celdas vacías
  const totalCeldas=primerDiaSemana+diasEnMes;
  const sobrante=(7-(totalCeldas%7))%7;
  for(let i=0;i<sobrante;i++){
    html+='<div class="cal-day cal-empty"></div>';
  }
  grid.innerHTML=html;
}

window.calCambiarMes=function(delta){
  calMesActual.setMonth(calMesActual.getMonth()+delta);
  renderCalendario();
  const panel=document.getElementById('cal-detalle-panel');
  if(panel)panel.style.display='none';
};

window.calIrHoy=function(){
  calMesActual=new Date();calMesActual.setDate(1);
  renderCalendario();
  const panel=document.getElementById('cal-detalle-panel');
  if(panel)panel.style.display='none';
};

window.calVerDetalle=function(fechaStr){
  const panel=document.getElementById('cal-detalle-panel');
  const label=document.getElementById('cal-detalle-fecha-label');
  const lista=document.getElementById('cal-detalle-lista');
  const reporteCont=document.getElementById('cal-reporte-materiales');
  if(!panel||!label||!lista)return;
  const eventosDia=state.contratos.filter(c=>c.fecha===fechaStr).sort((a,b)=>(a.hora||'').localeCompare(b.hora||''));
  if(!eventosDia.length){
    panel.style.display='none';
    toast('Sin eventos registrados para ese día','warn');
    return;
  }
  label.textContent=fmtDate(fechaStr+'T12:00:00');
  lista.innerHTML=eventosDia.map(c=>`
    <div class="sep-contrato-row">
      <div class="sep-contrato-dot ${c.empresa}"></div>
      <div style="flex:1;">
        <strong>${c.cliente}</strong> — ${c.paquete}
        <span style="font-size:10px;color:var(--muted);margin-left:6px;">${c.empresa==='conde'?'🎭 Conde Eventos':'🎪 Happy Art Eventos'} · ${fmtHoraEvento(c)}</span>
        <span style="font-size:10px;color:var(--muted);margin-left:6px;">Asesor: ${c.asesor||'—'}</span>
      </div>
      <div style="font-size:11px;color:var(--muted);">Festejado: ${c.festejado||'—'}</div>
    </div>`).join('');
  panel.style.display='block';
  // Reporte de materiales necesarios para esta fecha: cuánto hay, cuánto se
  // necesita y cuánto queda libre / si está agotado. El inventario es estático
  // (no se descuenta al crear el contrato), así que "Stock total" es siempre el
  // número real disponible en bodega — este reporte solo informa, no reserva nada.
  if(reporteCont)renderReporteMaterialesFecha(fechaStr,eventosDia,reporteCont);
};

function renderReporteMaterialesFecha(fechaStr,eventosDia,cont){
  // Resumen consolidado de todos los materiales comprometidos ese día
  const totales={};
  for(const c of eventosDia){
    const allItems=[...(c.descontadosPaquete||[]),...(c.extras||[])];
    for(const nombre of allItems){totales[nombre]=(totales[nombre]||0)+1;}
  }
  if(!Object.keys(totales).length){
    cont.innerHTML=`<div style="font-size:12px;color:var(--muted);padding:8px 0;">Sin materiales de inventario asociados a los eventos de este día.</div>`;
    return;
  }
  const resumenFilas=Object.entries(totales).sort((a,b)=>b[1]-a[1]).map(([nombre,qty])=>{
    // Buscar por "NOMBRE · SKU" o por nombre genérico
    const partes=nombre.split(' · ');
    const nombreBase=partes[0];
    const skuEsp=partes[1]||null;
    const prodsConNombre=skuEsp
      ? state.productos.filter(p=>p.nombre===nombreBase&&p.sku===skuEsp)
      : state.productos.filter(p=>p.nombre===nombre);
    // Si no hay resultado exacto, buscar por nombre base
    const prodsEfectivos=prodsConNombre.length?prodsConNombre:state.productos.filter(p=>p.nombre===nombreBase);
    const prod=prodsEfectivos[0]||null;
    const stockTotal=prodsEfectivos.reduce((s,p)=>s+p.stock,0);
    const libre=stockTotal-qty;
    const agotado=libre<0;
    const alerta=agotado?'🔴':libre===0?'🟡':'🟢';
    const libreTxt=agotado?`Faltan ${Math.abs(libre)}`:libre;
    // Mostrar el código (SKU) como dato principal — identifica la unidad
    // física exacta en bodega (ej. "PR BESTIA" en vez de "PERSONAJE").
    const etiqueta=skuEsp?`${skuEsp} <span style="color:var(--muted);font-weight:400;">· ${nombreBase}</span>`:nombre;
    return`<tr>
      <td style="padding:6px 10px;font-size:12px;font-weight:600;">${alerta} ${etiqueta}${!prod?' <span style="color:var(--muted);font-weight:400;">(no está en inventario)</span>':''}</td>
      <td style="padding:6px 10px;font-size:12px;text-align:center;font-weight:800;color:var(--accent);">${qty}</td>
      <td style="padding:6px 10px;font-size:12px;text-align:center;">${stockTotal}</td>
      <td style="padding:6px 10px;font-size:12px;text-align:center;font-weight:700;color:${agotado?'var(--danger)':libre===0?'var(--warn)':'var(--success)'};">${libreTxt}</td>
    </tr>`;
  }).join('');

  // Detalle por contrato
  const detalleHtml=eventosDia.map(c=>{
    const allItems=[...(c.descontadosPaquete||[]),...(c.extras||[])];
    const freq={};
    for(const nombre of allItems){freq[nombre]=(freq[nombre]||0)+1;}
    const filas=Object.entries(freq).map(([nombre,qty])=>{
      // Buscar por "NOMBRE · SKU" o por nombre genérico
      const partes2=nombre.split(' · ');
      const nombreBase2=partes2[0];
      const skuEsp2=partes2[1]||null;
      const prodsConNombre2=skuEsp2
        ? state.productos.filter(p=>p.nombre===nombreBase2&&p.sku===skuEsp2)
        : state.productos.filter(p=>p.nombre===nombre);
      const prodsEfectivos2=prodsConNombre2.length?prodsConNombre2:state.productos.filter(p=>p.nombre===nombreBase2);
      const prod=prodsEfectivos2[0]||null;
      const stockTotal=prodsEfectivos2.reduce((s,p)=>s+p.stock,0);
      const libre=stockTotal-(totales[nombre]||0);
      const agotado=libre<0;
      // Mostrar el código (SKU) como dato principal en vez del nombre genérico.
      const etiqueta2=skuEsp2?`${skuEsp2} <span style="color:var(--muted);font-weight:400;">· ${nombreBase2}</span>`:nombre;
      return`<tr>
        <td style="padding:6px 10px;font-size:12px;font-weight:600;">${etiqueta2}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:center;font-weight:700;color:var(--accent);">${qty}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:center;color:var(--muted);">${stockTotal}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:center;font-weight:700;color:${agotado?'var(--danger)':libre===0?'var(--warn)':'var(--success)'};">${agotado?`Faltan ${Math.abs(libre)}`:libre}</td>
      </tr>`;
    }).join('');
    const empColor=c.empresa==='happy'?'var(--accent)':'var(--accent2)';
    const empNom=c.empresa==='happy'?'Happy Art Eventos':'Conde Eventos';
    return`<div style="margin-bottom:14px;background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;overflow:hidden;">
      <div style="padding:10px 14px;background:var(--surface);border-bottom:1.5px solid var(--border);display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="width:10px;height:10px;border-radius:50%;background:${empColor};display:inline-block;"></span>
        <strong style="font-size:13px;">${c.cliente}</strong>
        <span style="font-size:11px;color:var(--muted);">— ${c.paquete} · ${empNom}</span>
        <span style="font-size:11px;color:var(--muted);margin-left:auto;">Asesor: ${c.asesor||'—'}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#eef1f5;">
          <th style="padding:6px 10px;font-size:10px;text-align:left;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted);">Material</th>
          <th style="padding:6px 10px;font-size:10px;text-align:center;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted);">Cant. usada</th>
          <th style="padding:6px 10px;font-size:10px;text-align:center;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted);">Stock total</th>
          <th style="padding:6px 10px;font-size:10px;text-align:center;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted);">Libre ese día</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
  }).join('');

  cont.innerHTML=`
    <div style="font-size:13px;font-weight:800;margin-bottom:8px;">📦 Reporte de materiales para esta fecha</div>
    <div style="margin-bottom:14px;background:#fff8f0;border:1.5px solid #ffe0b2;border-radius:10px;overflow:hidden;">
      <div style="padding:10px 14px;background:#fff3e0;border-bottom:1.5px solid #ffe0b2;"><strong style="font-size:13px;">📊 Resumen consolidado — todos los eventos del día</strong></div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#fff3e0;">
          <th style="padding:6px 10px;font-size:10px;text-align:left;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted);">Material</th>
          <th style="padding:6px 10px;font-size:10px;text-align:center;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted);">Total necesario</th>
          <th style="padding:6px 10px;font-size:10px;text-align:center;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted);">Stock total</th>
          <th style="padding:6px 10px;font-size:10px;text-align:center;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted);">Libre / faltante</th>
        </tr></thead>
        <tbody>${resumenFilas}</tbody>
      </table>
    </div>
    <div style="font-size:12px;color:var(--muted);font-weight:700;letter-spacing:0.5px;margin-bottom:10px;">DETALLE POR EVENTO</div>
    ${detalleHtml}
  `;
}

let ventaEmpresa=null; // 'happy' | 'conde'

let paqueteSeleccionado=null;

async function init(){
  try{
    await cargarDatosIniciales();
    document.querySelectorAll('.view').forEach(e=>e.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(e=>e.classList.remove('active'));
    // Detectar rol según las listas centralizadas en ROLES (ver inicio del archivo)
    const emailActual=getAuth(app).currentUser?.email||'';
    const rolActual=obtenerRol(emailActual);
    state.esAdmin=rolActual==='admin';
    state.esAsesor=rolActual==='asesor';
    if(rolActual===null){
      // Email autenticado en Firebase pero no registrado en ninguna lista de rol:
      // no se asume ningún rol por defecto. Se avisa y se cierra la sesión para
      // evitar que alguien sin rol asignado quede con acceso parcial silencioso.
      toast('Tu cuenta ('+emailActual+') no tiene un rol asignado. Contacta al administrador para que te agregue a ROLES en el código.','err');
      await signOut(auth);
      return;
    }
    aplicarRol();
    activarListenerTiempoReal();
    if(state.esAsesor){
      document.getElementById('view-ventas').classList.add('active');
      document.getElementById('nav-ventas').classList.add('active');
      renderVentasView();
    }else if(state.esAdmin){
      document.getElementById('view-dashboard').classList.add('active');
      document.getElementById('nav-dashboard').classList.add('active');
      renderDashboard();
    }else{
    // Bodeguero: ver inventario + movimientos + préstamos + alertas
      document.getElementById('view-productos').classList.add('active');
      document.getElementById('nav-productos').classList.add('active');
      renderCatFilter();renderTabla();
      setTimeout(()=>{
        const si=document.getElementById('searchInput');const fc=document.getElementById('filterCat');
        const fe=document.getElementById('filterEvento');const fs=document.getElementById('filterStock');
        if(si){si.oninput=()=>renderTabla();si.value='';}
        if(fc){fc.onchange=()=>renderTabla();fc.value='';}
        if(fe){fe.onchange=()=>renderTabla();fe.value='';}
        if(fs){fs.onchange=()=>renderTabla();fs.value='';}
      },100);
    }
  }catch(e){console.error('Error Firebase:',e);toast('Error al cargar datos','err');}
}

window.restaurarRespaldo=async function(){
  if(!state.esAdmin){toast('Solo el administrador puede restaurar el respaldo','err');return;}
  if(!confirm('¿Restaurar inventario desde el respaldo del 26 de junio?\nEsto sobreescribirá todos los datos actuales en Firebase.'))return;
  const respaldo={"productos":[{"cat":"Catering","desc":"","evento":"Ambos","id":23,"min":0,"nombre":"Crispeteras","precio":1200000,"proveedor":"Happy snacks","sku":"OB01","stock":4,"ubicacion":"Cuarto 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":25,"min":0,"nombre":"Pañales","precio":6000,"proveedor":"Happy Art","sku":"PAÑAL ADULTO","stock":18,"ubicacion":"Sala","unidad":"Unidad"},{"cat":"Catering","desc":"","evento":"Ambos","id":27,"min":0,"nombre":"Algodonera","precio":1300000,"proveedor":"Happy Snacks","sku":"OB05","stock":2,"ubicacion":"Cuarto 2","unidad":"Unidad"},{"cat":"Catering","desc":"","evento":"Ambos","id":28,"min":0,"nombre":"Asador de Salchichas","precio":1300000,"proveedor":"Happy Snacks","sku":"OB06","stock":2,"ubicacion":"Cuarto  2","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA A 3 BUENAS Y 4 PARTIDAS","evento":"Ambos","id":29,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA A","stock":7,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA B 2 BUENAS 1 PARTIDA","evento":"Ambos","id":30,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA B","stock":3,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA C 2 BUENAS 1 PARTIDA","evento":"Ambos","id":31,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA C","stock":3,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA D 2 BUENAS 1 PARTIDA","evento":"Ambos","id":32,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA D","stock":3,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA E 4 BUENAS","evento":"Ambos","id":33,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA E","stock":4,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA F 1 EN  BUENA","evento":"Ambos","id":34,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA F","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA 1 BUENA","evento":"Ambos","id":35,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA G","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA H 1 BUENA","evento":"Ambos","id":36,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA H","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA I 7 BUENAS","evento":"Ambos","id":37,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA I","stock":7,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA J  2 BUENAS","evento":"Ambos","id":38,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA J","stock":2,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA K  4 BUENAS","evento":"Ambos","id":39,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA K","stock":4,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA L 4 BUENAS","evento":"Ambos","id":40,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA L","stock":4,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA M 3 BUENAS","evento":"Ambos","id":41,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA M","stock":3,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":42,"min":0,"nombre":"LETRA LUMINOSA 6","precio":18000,"proveedor":"J.O","sku":"LUMINOSA N","stock":6,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA O 4 BUENAS","evento":"Ambos","id":43,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA O","stock":4,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA P 5 BUENAS","evento":"Ambos","id":44,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA P","stock":5,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA 3 BUENAS","evento":"Ambos","id":45,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA Q","stock":3,"ubicacion":"CUARTO 1  ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA R 3 BUENAS","evento":"Ambos","id":46,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA R","stock":3,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA S 3 BUENAS 1 PARTIDA","evento":"Ambos","id":47,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA S","stock":4,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA T 7 BUENAS","evento":"Ambos","id":48,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA T","stock":7,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA U 4 BUENAS","evento":"Ambos","id":49,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA U","stock":4,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA V 2 BUENAS","evento":"Ambos","id":50,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA V","stock":2,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA W 2 BUENAS","evento":"Ambos","id":51,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA W","stock":2,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA X 3 BUENAS","evento":"Ambos","id":52,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA X","stock":3,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA Y 2 BUENAS 1 PARTIDA","evento":"Ambos","id":53,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA Y","stock":3,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"LETRA LUMINOSA Z 2 BUENAS","evento":"Ambos","id":54,"min":0,"nombre":"LETRA LUMINOSA","precio":18000,"proveedor":"J.O","sku":"LUMINOSA Z","stock":2,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":55,"min":0,"nombre":"TAPETE PELUCHE","precio":70000,"proveedor":"MAYORISTA","sku":"TAPETE PALO DE ROSA","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":56,"min":0,"nombre":"TAPETE PELUCHE","precio":70000,"proveedor":"MAYORISTA","sku":"TAPETE NEGRO","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":57,"min":0,"nombre":"TAPETE DE PELUCHE","precio":70000,"proveedor":"MAYORISTA","sku":"TAPETE AZUL REY","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":58,"min":0,"nombre":"TAPETE DE PELUCHE","precio":70000,"proveedor":"MAYORISTA","sku":"TAPETE ROSADO","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":59,"min":0,"nombre":"TAPETE DE PELUCHE","precio":70000,"proveedor":"MAYORISTA","sku":"TAPETE ROJO","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":60,"min":0,"nombre":"TAPETE PELUCHE","precio":18000,"proveedor":"MAYORISTA","sku":"TAPETE BLANCO","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":61,"min":0,"nombre":"TAPETE PELUCHE","precio":18000,"proveedor":"MAYORISTA","sku":"TAPETE BEIGE","stock":2,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":62,"min":0,"nombre":"PITOLA BURBIJAS","precio":45000,"proveedor":"KBOOM","sku":"BURBUJAS","stock":6,"ubicacion":"CUARTO 1 ESTANTE","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":63,"min":0,"nombre":"BOLSA MAGICA","precio":30000,"proveedor":"HAPPY ART","sku":"MAGIA","stock":7,"ubicacion":"CUARTO 1 CAJONERA","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":64,"min":0,"nombre":"INFLADOR ELECTRICO","precio":60000,"proveedor":"J.O","sku":"INFLADOR ELECTRICO","stock":8,"ubicacion":"CUARTO 1 ESTANTE","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":65,"min":0,"nombre":"PELUCHE","precio":100000,"proveedor":"J.O","sku":"P ELEFANTE NIÑO","stock":2,"ubicacion":"CUARTO 1 ESTANTERIA","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":66,"min":0,"nombre":"PELUCHE","precio":100000,"proveedor":"J.O","sku":"P ELEFANTE NIÑA","stock":1,"ubicacion":"CUARTO 1 ESTANTERIA","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":67,"min":0,"nombre":"PELUCHE","precio":60000,"proveedor":"J.O","sku":"P TIGRE","stock":1,"ubicacion":"CUARTO 1 ESTANTERIA","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":68,"min":0,"nombre":"PELUCHE","precio":90000,"proveedor":"J.O","sku":"P OSO NIÑA","stock":1,"ubicacion":"CUARTO 1 ESTANTE","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":69,"min":0,"nombre":"PELUCHE","precio":90000,"proveedor":"J.O","sku":"P OSO NIÑO","stock":1,"ubicacion":"CUARTO 1 ESTANTE","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":70,"min":0,"nombre":"PELUCHE","precio":230000,"proveedor":"J.O","sku":"P MONO","stock":1,"ubicacion":"SALA","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":71,"min":0,"nombre":"MOTOR INFLABLE","precio":500000,"proveedor":"VARIOS","sku":"MOTOR","stock":5,"ubicacion":"CUARTO 2 ESTANTE","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":72,"min":0,"nombre":"INFLABLE","precio":1500000,"proveedor":"VARIOS","sku":"INFLABLE PAYASITO","stock":1,"ubicacion":"CUARTO 2 ESTANTE","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":73,"min":0,"nombre":"INFLABLE","precio":1500000,"proveedor":"VARIOS","sku":"INFLABLE CASTILLO","stock":1,"ubicacion":"CUARTO 2 ESTANTE","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":74,"min":0,"nombre":"INFLABLE","precio":2500000,"proveedor":"VARIOS","sku":"INFLABLE RODADERO","stock":1,"ubicacion":"CUARTO 2 ESTANTE","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":75,"min":0,"nombre":"TEATRINOS","precio":200000,"proveedor":"HAPPY ART","sku":"TEATRINO","stock":8,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":76,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"SUPERMAN","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":77,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"K-POP","stock":3,"ubicacion":"CUARTO 1 ARMARIIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":78,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"ARGENTINA","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":79,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"MINNIE ROJA","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":80,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"MINNIE ROSA","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":81,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"RAPUNZEL AZUL","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":82,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"LULI PAMPIN","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":83,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"REAL MADRID","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":84,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"LADY BUG","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":85,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"BARCELONA","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":86,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"MOHANA","stock":1,"ubicacion":"CUARTOO 1 ARMARIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":87,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"SIRENITA","stock":2,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":88,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"ENCANTO","stock":2,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":89,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"RAPUNZEL VERDE","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":90,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"REINA","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":91,"min":0,"nombre":"DISFRAZ","precio":150000,"proveedor":"VARIOS","sku":"HARRY POTTER","stock":1,"ubicacion":"CUARTO 1 ARMARIO","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":92,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR JEFE EN PAÑALES","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":93,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC SIMPSONS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":94,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC OSITA ROSA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":95,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC ANTIFAZ","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":96,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC POKEMON","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":97,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC SIRENITA BEBE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":98,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC PLAZA SESAMO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":99,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC LEO EL TRACTOR","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":100,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC WINNIE POOH PAISAJE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":101,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC GATA MARY","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":102,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC INTENSAMENTE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":103,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC GOKU SAGA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":104,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC SPIDERMAN","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":105,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC ARCOIRIS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":106,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC MUJER MARAVILLA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":107,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC NALA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":108,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC DINOSAURIO ANIMADO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":109,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"","sku":"TC HARRY POTTER","stock":1,"ubicacion":"","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":110,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC CASTILLO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":111,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC AVENGERS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":112,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC GRANJA ZENON NIÑO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":113,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC WINNIE PAISAJE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":114,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC WINNIE ABRAZO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":115,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC TABLON MADERA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":116,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC ELEFANTE ANIMADO NIÑO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":117,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC ELEFANTE ANIMADA NIÑA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":118,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC ELEFANTE ACUARELA NIÑA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":119,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC GOKU ESPACIO","stock":1,"ubicacion":"72000","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":120,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC GOKU CIELO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":121,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC PRINCESA Y EL SAPO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":122,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC REVELACION JEFE EN PAÑALES","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":123,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC PAW PATROL","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":124,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC GRANJA ZENON NIÑA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":125,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC TOY STORY","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":126,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC ALICIA EN EL PAIS DE LAS MARAVILLAS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":127,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC PITCH","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":128,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC MARIPOSAS ORO ROSA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":129,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC BARBIE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":130,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC OSOS NEON","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":131,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC HOT WHEELS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":132,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC BEEPER","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":133,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC BLUEY","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":134,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC KUROMY","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":135,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC AVENGERS BABYS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":136,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC MOHANA BEBE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":137,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC PRINCESAS DISNEY","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":138,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC MI GRADO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":139,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC FROZEN","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":140,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC RODOLFO EL RENO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":141,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC MASHA Y EL OSO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":142,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC HELLO KITTY","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":143,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC MONSTER INC","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":144,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC SING CANTA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":145,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC LOONEY TONS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":146,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC MICKEY SAFARI","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":147,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC LEGO NINGA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":148,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC VACA LOLA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":149,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC PLIN PLIN","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":150,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC OSITA REINA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":151,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC LEON ACUARELA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":152,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC OSITO REY CIELO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":153,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC REVELACION OSITOS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":154,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC ZAFARI NIÑA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":155,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC ZAFARI NIÑO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":156,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC JEFE EN PAÑALES","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":157,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC FONDO MAR","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":158,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC SELVA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":159,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC HARRY POTTER ANIMADO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":160,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"TEMATICA CUADRADA","sku":"TC CABALLO BABY SHOWER","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":161,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC ZOOTOPIA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":162,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC DINOSAURIO REAL","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":163,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC MINNIE BEBE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":164,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC AVENGER","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":165,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC LILO Y STITCH","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":166,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC NEON","stock":2,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":167,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC GRIS BRILLANTE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":168,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO NEGRO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":169,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO DEISY BEBE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":170,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO OSITA NUBE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":171,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO ENCANTO","stock":3,"ubicacion":"CUARTO2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":172,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO RIELES MUERTOS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":173,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO PRINCESA ROJA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":174,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO SKYPE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":175,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO TORRE ICFEL","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":176,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO PRI COMUNION NIÑO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":177,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO BELLA Y LA BESTIA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":178,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO GALLETA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":179,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO SONIC","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":180,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO PAW PATROL","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":181,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO MINNIE AZUL","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":182,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO BARCELONA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":183,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO WOODY","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":184,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO MICKEY ASTRONAUTA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":185,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO MUÑECAS DE LA MAFIA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":186,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO RAISING","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":187,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO PR COMUNION NIÑA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":188,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO PRINCESA AZUL OSCURO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":189,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO CONEJITA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":190,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO  CARS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":191,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO MINNIOS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":192,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO MELODY","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":193,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO BARBIE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":194,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO MILE MORALES","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":195,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO CASTILLO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":196,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO AZUL CELESTE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":197,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO FUCSIA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":198,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO ANIMAL PRINT","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":199,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO LILA","stock":2,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":200,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO VERDE MENTA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":201,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO BLANCO","stock":2,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":202,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO MANCHAS VACA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":203,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO ROJO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":204,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO LENTEJUELA ROJO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":205,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO ORO ROSA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":206,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO MARIO BROS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":207,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO ROSADO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":208,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO LULI PAMPIN","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":209,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO MESSI","stock":2,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":210,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO ERLIN HAALAND","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":211,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO ONE PIECES","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":212,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO AZUL NOCHE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":213,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO MICKEY REY","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":214,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO CANCHA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":215,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO JACK JACK","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":216,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO PEBLES","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":217,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO PRINCESA VERDE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":218,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO ROSAS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":219,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO PLN PLN SAFARI","stock":2,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":220,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO CRISTIANO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":221,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO AMARILLO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":222,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO MINECRAF","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":223,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO CIELO PIES","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":224,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO JIRAFA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":225,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO CAQUIE","stock":2,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":226,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO MINNIE BEBE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":227,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO K-POP","stock":3,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":228,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO MINNIE HADA ROSA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":229,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO PRINCESA ROSADA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":230,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO GOKU NIÑO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":231,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO REVELACION ROSA Y AZUL","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":232,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO VERDE SATIN","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":233,"min":0,"nombre":"TEMATICA OVALADO","precio":72000,"proveedor":"JM","sku":"TO BEIGE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":234,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR GOKU NIÑO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":235,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR GOKU BEBE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":236,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR BATMAN","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":237,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR VEGETA BEBE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":238,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR LEON REY","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":239,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR ZOOTOPIA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":240,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR MARIO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":241,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR SAFARI NIÑO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":242,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR MICKEY ASTRONAUTA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":243,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR PAW PATROL","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":244,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR LONNEY TUNES","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":245,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR OSITA REINA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":246,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR MINNIE ROSA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":247,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR FROZEN","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":248,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR MINNIOS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":249,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR MILLONARIOS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":250,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR FREE FIRE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":251,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR DIGITAL CIRCUS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":252,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR ZEBRA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":253,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR ELEFANTE ACUARELA NIÑA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":254,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR CARA MINNIE ROSA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":255,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR BRA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":256,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR BALONDE FUTBOL","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":257,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR MERLINA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":258,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR PR COMUNION NIÑA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":259,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR MAESTRO ROCHIE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":260,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR ASTRONAUTA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":261,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR ELEFANTE ANIMADO BLANCO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":262,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR ELEFANTE ANIMADO ROSA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":263,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR PAN","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":264,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR UNICORNIO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":265,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR OSO REY AZUL","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":266,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR ELEFANTE ACUARELA NIÑO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":267,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR SKYPE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":268,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR SONIC","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":269,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR MICKEY MOUSE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":270,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR PRINCESITA SOFIA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":271,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR OSITA BAILARINA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":272,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR REY LEON","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":273,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR MONSTER INC","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":274,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR SHEN LONG","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":275,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR OSITO CAFE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":276,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR SIRENITA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":277,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR MINNIE ROJA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":278,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR ELEFANTE ANIMADO NIÑO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":279,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR AMONGUS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":280,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR SAILOR MOON","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":281,"min":0,"nombre":"TEMATICA REDONDA","precio":72000,"proveedor":"JM","sku":"TR BLANCO","stock":2,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":282,"min":0,"nombre":"TEMATICA CUADRADA","precio":72000,"proveedor":"JM","sku":"TC OSITA BAILARINA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":283,"min":0,"nombre":"TEMATICA CUADRADO","precio":72000,"proveedor":"JM","sku":"TC SIMBA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":284,"min":0,"nombre":"TEMATICA CUADRADO","precio":72000,"proveedor":"JM","sku":"TC OSITO REY VERDE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":285,"min":0,"nombre":"SILLA TRONO","precio":1200000,"proveedor":"VARIOS","sku":"SILLA PLATA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":286,"min":0,"nombre":"SILLA TRONO","precio":1200000,"proveedor":"VARIOS","sku":"SILLA DORADA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":287,"min":0,"nombre":"SILLA TRONO","precio":600000,"proveedor":"VARIOS","sku":"SILLA NIÑO DORADA","stock":1,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Audio / Video","desc":"","evento":"Ambos","id":288,"min":0,"nombre":"TRIPODES","precio":150000,"proveedor":"PRO DJ","sku":"TRIPODE LUZ","stock":3,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Audio / Video","desc":"","evento":"Ambos","id":289,"min":0,"nombre":"TRIPODES","precio":80000,"proveedor":"PRO DJ","sku":"TRIPODE SONIDO","stock":4,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Audio / Video","desc":"","evento":"Ambos","id":290,"min":0,"nombre":"LUCES","precio":300000,"proveedor":"PRO DJ","sku":"DOBLE FACE","stock":4,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Audio / Video","desc":"","evento":"Ambos","id":291,"min":0,"nombre":"LUCES","precio":280000,"proveedor":"PRO DJ","sku":"LUZ 6 EN 1","stock":6,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Audio / Video","desc":"","evento":"Ambos","id":292,"min":0,"nombre":"LUCES","precio":400000,"proveedor":"PRO DJ","sku":"LUZ 5 EN 1","stock":1,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Audio / Video","desc":"","evento":"Ambos","id":293,"min":0,"nombre":"LUCES","precio":250000,"proveedor":"PRO DJ","sku":"LASER","stock":1,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Audio / Video","desc":"","evento":"Ambos","id":294,"min":0,"nombre":"LUCES","precio":250000,"proveedor":"PRO DJ","sku":"PARLED","stock":1,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Audio / Video","desc":"","evento":"Ambos","id":295,"min":0,"nombre":"CAMARA DE HUMO","precio":145000,"proveedor":"PRO DJ","sku":"CH PEQUEÑA","stock":4,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Audio / Video","desc":"","evento":"Ambos","id":296,"min":0,"nombre":"CAMARA DE HUMO","precio":350000,"proveedor":"PRO DJ","sku":"CH GRANDE","stock":2,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Audio / Video","desc":"","evento":"Ambos","id":297,"min":0,"nombre":"LUCES","precio":350000,"proveedor":"PRO DJ","sku":"ROBOTICAS","stock":2,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Audio / Video","desc":"","evento":"Ambos","id":298,"min":0,"nombre":"SONIDO","precio":600000,"proveedor":"PRO DJ","sku":"CS GRANDE","stock":4,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Audio / Video","desc":"","evento":"Ambos","id":299,"min":0,"nombre":"SONIDO","precio":350000,"proveedor":"PRO DJ","sku":"CS PEQUEÑA","stock":6,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Iluminación","desc":"","evento":"Ambos","id":300,"min":0,"nombre":"NUMERO LUMINOSO","precio":160000,"proveedor":"VARIOS","sku":"LUMINOSO 1","stock":2,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Iluminación","desc":"","evento":"Ambos","id":301,"min":0,"nombre":"NUMERO LUMINOSO","precio":160000,"proveedor":"VARIOS","sku":"LUMINOSO 2","stock":1,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Mobiliario","desc":"","evento":"Ambos","id":302,"min":0,"nombre":"NUMERO LUMINOSO","precio":160000,"proveedor":"VARIOA","sku":"LUMINOSO 3","stock":1,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Iluminación","desc":"","evento":"Ambos","id":303,"min":0,"nombre":"NUMERO LUMINOSO","precio":160000,"proveedor":"VARIOS","sku":"LUMINOSO 4","stock":1,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Iluminación","desc":"","evento":"Ambos","id":304,"min":0,"nombre":"NUMERO LUMINOSO","precio":160000,"proveedor":"VARIOS","sku":"LUMINOSO 5","stock":2,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Iluminación","desc":"","evento":"Ambos","id":305,"min":0,"nombre":"NUMERO LUMINOSO","precio":160000,"proveedor":"VARIOS","sku":"LUMINOSO 6","stock":1,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Iluminación","desc":"","evento":"Ambos","id":306,"min":0,"nombre":"NUMERO LUMINOSO","precio":160000,"proveedor":"VARIOS","sku":"LUMINOSO 7","stock":1,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Iluminación","desc":"","evento":"Ambos","id":307,"min":0,"nombre":"NUMERO LUMINOSO","precio":160000,"proveedor":"VARIOS","sku":"LUMINOSO 8","stock":1,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Iluminación","desc":"","evento":"Ambos","id":308,"min":0,"nombre":"NUMERO LUMINOSO","precio":160000,"proveedor":"VARIOS","sku":"LUMINOSO 9","stock":1,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Iluminación","desc":"","evento":"Ambos","id":309,"min":0,"nombre":"NUMERO LUMINOSO","precio":160000,"proveedor":"VARIOS","sku":"LUMINOSO 0","stock":1,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Iluminación","desc":"","evento":"Ambos","id":310,"min":0,"nombre":"LETRERO LUMINOSO","precio":150000,"proveedor":"WB","sku":"LUMINOSO HAPPY BIRTHDAY","stock":2,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Iluminación","desc":"","evento":"Ambos","id":311,"min":0,"nombre":"LETRERO LUMINOSO","precio":150000,"proveedor":"WB","sku":"LUMINOSO FELIZ CUMPLEAÑOS","stock":1,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Iluminación","desc":"","evento":"Ambos","id":312,"min":0,"nombre":"LETRERO LUMINOSO","precio":150000,"proveedor":"WB","sku":"LUMINOSO MI BAUTIZO","stock":1,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Iluminación","desc":"","evento":"Ambos","id":313,"min":0,"nombre":"LETRERO LUMINOSO","precio":150000,"proveedor":"WB","sku":"LUMINOSO OH BABY","stock":2,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":314,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"RUGRATS CARLITOS","stock":2,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":315,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"RUGRATS ANGELICA","stock":2,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":316,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"COME GALLETAS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":317,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"LOLA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":318,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"RANA RENE","stock":1,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":319,"min":0,"nombre":"TITERES","precio":80000,"proveedor":"VARIOS","sku":"BUHO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":320,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"SOLDADO","stock":2,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":321,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"MOUNSTRO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":322,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"SULLIVAN","stock":2,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":323,"min":0,"nombre":"TITETES","precio":40000,"proveedor":"VARIOS","sku":"BATMAN","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":324,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"ELMO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":325,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"VAMPIROS","stock":2,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":326,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"MALUMA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":327,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"KAROL G","stock":1,"ubicacion":"CUARTO","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":328,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"GALLINA PINTAITA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":329,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"AURELIO","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":330,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"ABEJITA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":331,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"PIQUIÑA","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":332,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"CARLITOS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":333,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"HAPPY","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":334,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"ESPANTA PAJAROS","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Logística","desc":"","evento":"Ambos","id":335,"min":0,"nombre":"TITERES","precio":40000,"proveedor":"VARIOS","sku":"PRINCIPE","stock":1,"ubicacion":"CUARTO 2","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":336,"min":10,"nombre":"LETRA GLOBO","precio":2000,"proveedor":"VARIOS","sku":"LG A","stock":8,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":337,"min":10,"nombre":"LETRA GLOBO","precio":2000,"proveedor":"VARIOS","sku":"LG B","stock":11,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":338,"min":10,"nombre":"LETRA GLOBO","precio":2000,"proveedor":"","sku":"LG C","stock":10,"ubicacion":"","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":339,"min":10,"nombre":"LETRA GLOBO","precio":2000,"proveedor":"VARIOS","sku":"LG D","stock":34,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":340,"min":10,"nombre":"LETRA GLOBO","precio":2000,"proveedor":"VARIOS","sku":"LG E","stock":4,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":341,"min":10,"nombre":"LETRA GLOBO","precio":2000,"proveedor":"VARIOS","sku":"LG F","stock":31,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":342,"min":10,"nombre":"LETRA GLOBO","precio":2000,"proveedor":"LETRA GLOBO","sku":"LG G","stock":9,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":343,"min":10,"nombre":"LETRA GLOBO","precio":2000,"proveedor":"VARIOS","sku":"LG H","stock":7,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":344,"min":10,"nombre":"LETRA GLOBO","precio":2000,"proveedor":"VARIOS","sku":"LG I","stock":0,"ubicacion":"CUARTO 1","unidad":"Unidad"},{"cat":"Decoración","desc":"","evento":"Ambos","id":345,"min":10,"nombre":"LETRA GLOBO","precio":2000,"proveedor":"VARIOS","sku":"LG J","stock":18,"ubicacion":"CUARTO 1","unidad":"Unidad"}],"movimientos":[{"evento":"","fecha":1776371407410,"id":6,"nota":"Stock inicial","prodId":23,"qty":3,"tipo":"entrada"},{"evento":"Diana Garcia","fecha":1776371482391,"id":7,"nota":"Préstamo registrado","prodId":23,"qty":-3,"tipo":"prestamo"},{"evento":"Boda González","fecha":1776371536170,"id":8,"nota":"Devolución de préstamo","prodId":6,"qty":40,"tipo":"devolucion"},{"evento":"Diana Garcia","fecha":1776531972084,"id":9,"nota":"Devolución de préstamo","prodId":23,"qty":3,"tipo":"devolucion"},{"evento":"","fecha":1776532580480,"id":12,"nota":"Stock inicial","prodId":25,"qty":18,"tipo":"entrada"},{"evento":"Maria Paula","fecha":1776532616788,"id":13,"nota":"Préstamo registrado","prodId":25,"qty":-3,"tipo":"prestamo"},{"evento":"Bryan Garcia","fecha":1776567840745,"id":16,"nota":"Préstamo registrado","prodId":23,"qty":-1,"tipo":"prestamo"},{"evento":"","fecha":1779805324064,"id":17,"nota":"Edición manual","prodId":23,"qty":1,"tipo":"ajuste"},{"evento":"","fecha":1779805617807,"id":18,"nota":"Stock inicial","prodId":27,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1779805881351,"id":19,"nota":"Stock inicial","prodId":28,"qty":2,"tipo":"entrada"},{"evento":"Maria Paula","fecha":1779841039142,"id":21,"nota":"Devolución de préstamo","prodId":25,"qty":3,"tipo":"devolucion"},{"evento":"Bryan Garcia","fecha":1779844252325,"id":23,"nota":"Devolución de préstamo","prodId":23,"qty":1,"tipo":"devolucion"},{"evento":"Sofia - Xiomara","fecha":1781138254380,"id":34,"nota":"Préstamo registrado","prodId":25,"qty":-3,"tipo":"prestamo"},{"evento":"","fecha":1781200096119,"id":35,"nota":"Stock inicial","prodId":29,"qty":7,"tipo":"entrada"},{"evento":"","fecha":1781201214511,"id":36,"nota":"Stock inicial","prodId":30,"qty":3,"tipo":"entrada"},{"evento":"","fecha":1781201596113,"id":37,"nota":"Stock inicial","prodId":31,"qty":3,"tipo":"entrada"},{"evento":"","fecha":1781201738364,"id":38,"nota":"Stock inicial","prodId":32,"qty":3,"tipo":"entrada"},{"evento":"","fecha":1781201935812,"id":39,"nota":"Stock inicial","prodId":33,"qty":4,"tipo":"entrada"},{"evento":"","fecha":1781202019500,"id":40,"nota":"Stock inicial","prodId":34,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781202137413,"id":41,"nota":"Stock inicial","prodId":35,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781202244708,"id":42,"nota":"Stock inicial","prodId":36,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781202378208,"id":43,"nota":"Stock inicial","prodId":37,"qty":7,"tipo":"entrada"},{"evento":"","fecha":1781202864093,"id":44,"nota":"Stock inicial","prodId":38,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781202991644,"id":45,"nota":"Stock inicial","prodId":39,"qty":4,"tipo":"entrada"},{"evento":"","fecha":1781203098701,"id":46,"nota":"Stock inicial","prodId":40,"qty":4,"tipo":"entrada"},{"evento":"","fecha":1781203262443,"id":47,"nota":"Stock inicial","prodId":41,"qty":3,"tipo":"entrada"},{"evento":"","fecha":1781203332360,"id":48,"nota":"Stock inicial","prodId":42,"qty":6,"tipo":"entrada"},{"evento":"","fecha":1781205163693,"id":49,"nota":"Stock inicial","prodId":43,"qty":4,"tipo":"entrada"},{"evento":"","fecha":1781205274344,"id":50,"nota":"Stock inicial","prodId":44,"qty":5,"tipo":"entrada"},{"evento":"","fecha":1781205380114,"id":51,"nota":"Stock inicial","prodId":45,"qty":3,"tipo":"entrada"},{"evento":"","fecha":1781205548118,"id":52,"nota":"Stock inicial","prodId":46,"qty":3,"tipo":"entrada"},{"evento":"","fecha":1781205972900,"id":53,"nota":"Stock inicial","prodId":47,"qty":4,"tipo":"entrada"},{"evento":"","fecha":1781206590057,"id":54,"nota":"Stock inicial","prodId":48,"qty":7,"tipo":"entrada"},{"evento":"","fecha":1781206709297,"id":55,"nota":"Edición manual","prodId":25,"qty":3,"tipo":"ajuste"},{"evento":"","fecha":1781206804326,"id":56,"nota":"Stock inicial","prodId":49,"qty":4,"tipo":"entrada"},{"evento":"","fecha":1781206859041,"id":57,"nota":"Stock inicial","prodId":50,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781206949754,"id":58,"nota":"Stock inicial","prodId":51,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781207001386,"id":59,"nota":"Stock inicial","prodId":52,"qty":3,"tipo":"entrada"},{"evento":"","fecha":1781207102655,"id":60,"nota":"Stock inicial","prodId":53,"qty":3,"tipo":"entrada"},{"evento":"","fecha":1781207164126,"id":61,"nota":"Stock inicial","prodId":54,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781207379740,"id":62,"nota":"Stock inicial","prodId":55,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781207459126,"id":63,"nota":"Stock inicial","prodId":56,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781207508826,"id":64,"nota":"Stock inicial","prodId":57,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781207556769,"id":65,"nota":"Stock inicial","prodId":58,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781207606467,"id":66,"nota":"Stock inicial","prodId":59,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781207683682,"id":67,"nota":"Stock inicial","prodId":60,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781207783478,"id":68,"nota":"Stock inicial","prodId":61,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781207937766,"id":69,"nota":"Stock inicial","prodId":62,"qty":6,"tipo":"entrada"},{"evento":"","fecha":1781208020438,"id":70,"nota":"Stock inicial","prodId":63,"qty":7,"tipo":"entrada"},{"evento":"","fecha":1781208127231,"id":71,"nota":"Stock inicial","prodId":64,"qty":8,"tipo":"entrada"},{"evento":"","fecha":1781208261088,"id":72,"nota":"Stock inicial","prodId":65,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781208301344,"id":73,"nota":"Stock inicial","prodId":66,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781208357654,"id":74,"nota":"Stock inicial","prodId":67,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781208409051,"id":75,"nota":"Stock inicial","prodId":68,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781208468324,"id":76,"nota":"Stock inicial","prodId":69,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781208584351,"id":77,"nota":"Stock inicial","prodId":70,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781208687944,"id":78,"nota":"Stock inicial","prodId":71,"qty":5,"tipo":"entrada"},{"evento":"","fecha":1781208764507,"id":79,"nota":"Stock inicial","prodId":72,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781208826701,"id":80,"nota":"Stock inicial","prodId":73,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781209162785,"id":81,"nota":"Stock inicial","prodId":74,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781209772392,"id":82,"nota":"Stock inicial","prodId":75,"qty":8,"tipo":"entrada"},{"evento":"","fecha":1781209957283,"id":83,"nota":"Stock inicial","prodId":76,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781210000219,"id":84,"nota":"Stock inicial","prodId":77,"qty":3,"tipo":"entrada"},{"evento":"","fecha":1781210102602,"id":85,"nota":"Stock inicial","prodId":78,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781210764074,"id":86,"nota":"Stock inicial","prodId":79,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781210825712,"id":87,"nota":"Stock inicial","prodId":80,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781211169178,"id":88,"nota":"Stock inicial","prodId":81,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781211376117,"id":89,"nota":"Stock inicial","prodId":82,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781211424795,"id":90,"nota":"Stock inicial","prodId":83,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781211632804,"id":91,"nota":"Stock inicial","prodId":84,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781211734116,"id":92,"nota":"Stock inicial","prodId":85,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781211789953,"id":93,"nota":"Stock inicial","prodId":86,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781211836158,"id":94,"nota":"Stock inicial","prodId":87,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781212017887,"id":95,"nota":"Stock inicial","prodId":88,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781212115822,"id":96,"nota":"Stock inicial","prodId":89,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781212157843,"id":97,"nota":"Stock inicial","prodId":90,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781212259069,"id":98,"nota":"Stock inicial","prodId":91,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781212937558,"id":99,"nota":"Stock inicial","prodId":92,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781213249686,"id":100,"nota":"Stock inicial","prodId":93,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781213308614,"id":101,"nota":"Stock inicial","prodId":94,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781213341825,"id":102,"nota":"Stock inicial","prodId":95,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781213379269,"id":103,"nota":"Stock inicial","prodId":96,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781213423569,"id":104,"nota":"Stock inicial","prodId":97,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781213521927,"id":105,"nota":"Stock inicial","prodId":98,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781213583391,"id":106,"nota":"Stock inicial","prodId":99,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781214234028,"id":107,"nota":"Stock inicial","prodId":100,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781214283777,"id":108,"nota":"Stock inicial","prodId":101,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781214314783,"id":109,"nota":"Stock inicial","prodId":102,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781214385602,"id":110,"nota":"Stock inicial","prodId":103,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781214419551,"id":111,"nota":"Stock inicial","prodId":104,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781214456925,"id":112,"nota":"Stock inicial","prodId":105,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781214533677,"id":113,"nota":"Stock inicial","prodId":106,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781214565965,"id":114,"nota":"Stock inicial","prodId":107,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781214655605,"id":115,"nota":"Stock inicial","prodId":108,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781214863726,"id":116,"nota":"Stock inicial","prodId":109,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781215257351,"id":117,"nota":"Stock inicial","prodId":110,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781215294045,"id":118,"nota":"Stock inicial","prodId":111,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781215355278,"id":119,"nota":"Stock inicial","prodId":112,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781216746148,"id":120,"nota":"Stock inicial","prodId":113,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781216785471,"id":121,"nota":"Stock inicial","prodId":114,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781216849582,"id":122,"nota":"Stock inicial","prodId":115,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781216962735,"id":123,"nota":"Stock inicial","prodId":116,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781217028120,"id":124,"nota":"Stock inicial","prodId":117,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781217090627,"id":125,"nota":"Stock inicial","prodId":118,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781217146563,"id":126,"nota":"Stock inicial","prodId":119,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781217411961,"id":127,"nota":"Stock inicial","prodId":120,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781217454609,"id":128,"nota":"Stock inicial","prodId":121,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781217652526,"id":129,"nota":"Stock inicial","prodId":122,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781217840564,"id":130,"nota":"Stock inicial","prodId":123,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781217883295,"id":131,"nota":"Stock inicial","prodId":124,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781217944381,"id":132,"nota":"Stock inicial","prodId":125,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781218011089,"id":133,"nota":"Stock inicial","prodId":126,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781218046540,"id":134,"nota":"Stock inicial","prodId":127,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781218096466,"id":135,"nota":"Stock inicial","prodId":128,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781218149350,"id":136,"nota":"Stock inicial","prodId":129,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781218199296,"id":137,"nota":"Stock inicial","prodId":130,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781218246698,"id":138,"nota":"Stock inicial","prodId":131,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781218277343,"id":139,"nota":"Stock inicial","prodId":132,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781218392231,"id":140,"nota":"Stock inicial","prodId":133,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781218452576,"id":141,"nota":"Stock inicial","prodId":134,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781218600670,"id":142,"nota":"Stock inicial","prodId":135,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781218799777,"id":143,"nota":"Stock inicial","prodId":136,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781218857294,"id":144,"nota":"Stock inicial","prodId":137,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781218920193,"id":145,"nota":"Stock inicial","prodId":138,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781218982880,"id":146,"nota":"Stock inicial","prodId":139,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781219054156,"id":147,"nota":"Stock inicial","prodId":140,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781219128347,"id":148,"nota":"Stock inicial","prodId":141,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781219176839,"id":149,"nota":"Stock inicial","prodId":142,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781219261990,"id":150,"nota":"Stock inicial","prodId":143,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781219382847,"id":151,"nota":"Stock inicial","prodId":144,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781219477380,"id":152,"nota":"Stock inicial","prodId":145,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781219566684,"id":153,"nota":"Stock inicial","prodId":146,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781219618632,"id":154,"nota":"Stock inicial","prodId":147,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781219693458,"id":155,"nota":"Stock inicial","prodId":148,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781219725835,"id":156,"nota":"Stock inicial","prodId":149,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781219786203,"id":157,"nota":"Stock inicial","prodId":150,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781219849947,"id":158,"nota":"Stock inicial","prodId":151,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781220101936,"id":159,"nota":"Stock inicial","prodId":152,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781220152841,"id":160,"nota":"Stock inicial","prodId":153,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781220221736,"id":161,"nota":"Stock inicial","prodId":154,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781220261571,"id":162,"nota":"Stock inicial","prodId":155,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781220388709,"id":163,"nota":"Stock inicial","prodId":156,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781220453622,"id":164,"nota":"Stock inicial","prodId":157,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781220498160,"id":165,"nota":"Stock inicial","prodId":158,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781220735399,"id":166,"nota":"Stock inicial","prodId":159,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781220801664,"id":167,"nota":"Stock inicial","prodId":160,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781220865850,"id":168,"nota":"Stock inicial","prodId":161,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781220920469,"id":169,"nota":"Stock inicial","prodId":162,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781220963816,"id":170,"nota":"Stock inicial","prodId":163,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781220996731,"id":171,"nota":"Stock inicial","prodId":164,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781221070409,"id":172,"nota":"Stock inicial","prodId":165,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781221115274,"id":173,"nota":"Stock inicial","prodId":166,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781221228415,"id":174,"nota":"Stock inicial","prodId":167,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781221674591,"id":175,"nota":"Stock inicial","prodId":168,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781221761312,"id":176,"nota":"Stock inicial","prodId":169,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781221802566,"id":177,"nota":"Stock inicial","prodId":170,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781221912720,"id":178,"nota":"Stock inicial","prodId":171,"qty":3,"tipo":"entrada"},{"evento":"","fecha":1781222054888,"id":179,"nota":"Stock inicial","prodId":172,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781222137585,"id":180,"nota":"Stock inicial","prodId":173,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781222178922,"id":181,"nota":"Stock inicial","prodId":174,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781222228311,"id":182,"nota":"Stock inicial","prodId":175,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781222300456,"id":183,"nota":"Stock inicial","prodId":176,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781222341986,"id":184,"nota":"Stock inicial","prodId":177,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781222391469,"id":185,"nota":"Stock inicial","prodId":178,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781222450517,"id":186,"nota":"Stock inicial","prodId":179,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781222513358,"id":187,"nota":"Stock inicial","prodId":180,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781222559456,"id":188,"nota":"Stock inicial","prodId":181,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781222605391,"id":189,"nota":"Stock inicial","prodId":182,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781222658189,"id":190,"nota":"Stock inicial","prodId":183,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781222706734,"id":191,"nota":"Stock inicial","prodId":184,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781222765159,"id":192,"nota":"Stock inicial","prodId":185,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781222877625,"id":193,"nota":"Stock inicial","prodId":186,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781222931480,"id":194,"nota":"Stock inicial","prodId":187,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781223146351,"id":195,"nota":"Stock inicial","prodId":188,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781223358306,"id":196,"nota":"Stock inicial","prodId":189,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781223427660,"id":197,"nota":"Stock inicial","prodId":190,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781223475679,"id":198,"nota":"Stock inicial","prodId":191,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781223549326,"id":199,"nota":"Stock inicial","prodId":192,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781223834137,"id":200,"nota":"Stock inicial","prodId":193,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781223949497,"id":201,"nota":"Stock inicial","prodId":194,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781224083623,"id":202,"nota":"Stock inicial","prodId":195,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781224135795,"id":203,"nota":"Stock inicial","prodId":196,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781224175195,"id":204,"nota":"Stock inicial","prodId":197,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781224229129,"id":205,"nota":"Stock inicial","prodId":198,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781224319555,"id":206,"nota":"Stock inicial","prodId":199,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781225179136,"id":207,"nota":"Stock inicial","prodId":200,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781225456095,"id":208,"nota":"Stock inicial","prodId":201,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781225583250,"id":209,"nota":"Stock inicial","prodId":202,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781225617172,"id":210,"nota":"Stock inicial","prodId":203,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781226233254,"id":211,"nota":"Stock inicial","prodId":204,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781226262266,"id":212,"nota":"Edición manual","prodId":204,"qty":-1,"tipo":"ajuste"},{"evento":"","fecha":1781226309906,"id":213,"nota":"Stock inicial","prodId":205,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781226408733,"id":214,"nota":"Stock inicial","prodId":206,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781226435899,"id":215,"nota":"Stock inicial","prodId":207,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781226468251,"id":216,"nota":"Stock inicial","prodId":208,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781226504281,"id":217,"nota":"Stock inicial","prodId":209,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781226619194,"id":218,"nota":"Stock inicial","prodId":210,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781226665891,"id":219,"nota":"Stock inicial","prodId":211,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781226701425,"id":220,"nota":"Stock inicial","prodId":212,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781226741719,"id":221,"nota":"Stock inicial","prodId":213,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781226777512,"id":222,"nota":"Stock inicial","prodId":214,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781226806917,"id":223,"nota":"Edición manual","prodId":209,"qty":1,"tipo":"ajuste"},{"evento":"","fecha":1781226855491,"id":224,"nota":"Stock inicial","prodId":215,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781226899533,"id":225,"nota":"Stock inicial","prodId":216,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781226959070,"id":226,"nota":"Stock inicial","prodId":217,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781226995716,"id":227,"nota":"Stock inicial","prodId":218,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781227049203,"id":228,"nota":"Stock inicial","prodId":219,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781227107980,"id":229,"nota":"Stock inicial","prodId":220,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781227149421,"id":230,"nota":"Stock inicial","prodId":221,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781227181022,"id":231,"nota":"Edición manual","prodId":201,"qty":1,"tipo":"ajuste"},{"evento":"","fecha":1781227188673,"id":232,"nota":"Edición manual","prodId":199,"qty":1,"tipo":"ajuste"},{"evento":"","fecha":1781227249776,"id":233,"nota":"Stock inicial","prodId":222,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781227281848,"id":234,"nota":"Stock inicial","prodId":223,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781227333837,"id":235,"nota":"Stock inicial","prodId":224,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781227417139,"id":236,"nota":"Stock inicial","prodId":225,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781227834763,"id":237,"nota":"Stock inicial","prodId":226,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781227888909,"id":238,"nota":"Stock inicial","prodId":227,"qty":3,"tipo":"entrada"},{"evento":"","fecha":1781227953100,"id":239,"nota":"Stock inicial","prodId":228,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228005806,"id":240,"nota":"Stock inicial","prodId":229,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228061141,"id":241,"nota":"Stock inicial","prodId":230,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228108479,"id":242,"nota":"Stock inicial","prodId":231,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228147103,"id":243,"nota":"Stock inicial","prodId":232,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228256062,"id":244,"nota":"Stock inicial","prodId":233,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228345230,"id":245,"nota":"Stock inicial","prodId":234,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228388729,"id":246,"nota":"Stock inicial","prodId":235,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228425321,"id":247,"nota":"Stock inicial","prodId":236,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228461098,"id":248,"nota":"Stock inicial","prodId":237,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228507795,"id":249,"nota":"Stock inicial","prodId":238,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228554907,"id":250,"nota":"Stock inicial","prodId":239,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228637840,"id":251,"nota":"Stock inicial","prodId":240,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228695291,"id":252,"nota":"Stock inicial","prodId":241,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228759950,"id":253,"nota":"Stock inicial","prodId":242,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228804498,"id":254,"nota":"Stock inicial","prodId":243,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228850172,"id":255,"nota":"Stock inicial","prodId":244,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228905375,"id":256,"nota":"Stock inicial","prodId":245,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228935951,"id":257,"nota":"Stock inicial","prodId":246,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781228975286,"id":258,"nota":"Stock inicial","prodId":247,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229008326,"id":259,"nota":"Stock inicial","prodId":248,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229046874,"id":260,"nota":"Stock inicial","prodId":249,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229085826,"id":261,"nota":"Stock inicial","prodId":250,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229125960,"id":262,"nota":"Stock inicial","prodId":251,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229160377,"id":263,"nota":"Stock inicial","prodId":252,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229207281,"id":264,"nota":"Stock inicial","prodId":253,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229512461,"id":265,"nota":"Stock inicial","prodId":254,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229542693,"id":266,"nota":"Stock inicial","prodId":255,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229592036,"id":267,"nota":"Stock inicial","prodId":256,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229645588,"id":268,"nota":"Stock inicial","prodId":257,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229696500,"id":269,"nota":"Stock inicial","prodId":258,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229734327,"id":270,"nota":"Stock inicial","prodId":259,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229771538,"id":271,"nota":"Stock inicial","prodId":260,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229824635,"id":272,"nota":"Stock inicial","prodId":261,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229881050,"id":273,"nota":"Stock inicial","prodId":262,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229914071,"id":274,"nota":"Stock inicial","prodId":263,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781229990616,"id":275,"nota":"Stock inicial","prodId":264,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230022647,"id":276,"nota":"Stock inicial","prodId":265,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230073122,"id":277,"nota":"Stock inicial","prodId":266,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230118915,"id":278,"nota":"Stock inicial","prodId":267,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230170982,"id":279,"nota":"Stock inicial","prodId":268,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230211733,"id":280,"nota":"Stock inicial","prodId":269,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230285577,"id":281,"nota":"Stock inicial","prodId":270,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230514758,"id":282,"nota":"Stock inicial","prodId":271,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230569344,"id":283,"nota":"Stock inicial","prodId":272,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230610317,"id":284,"nota":"Stock inicial","prodId":273,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230654130,"id":285,"nota":"Stock inicial","prodId":274,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230699371,"id":286,"nota":"Stock inicial","prodId":275,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230730946,"id":287,"nota":"Stock inicial","prodId":276,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230788164,"id":288,"nota":"Stock inicial","prodId":277,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230822586,"id":289,"nota":"Stock inicial","prodId":278,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230859202,"id":290,"nota":"Stock inicial","prodId":279,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230926920,"id":291,"nota":"Stock inicial","prodId":280,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781230982631,"id":292,"nota":"Stock inicial","prodId":281,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781231144613,"id":293,"nota":"Stock inicial","prodId":282,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781231196266,"id":294,"nota":"Stock inicial","prodId":283,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781231251872,"id":295,"nota":"Stock inicial","prodId":284,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781231370239,"id":296,"nota":"Stock inicial","prodId":285,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781231411748,"id":297,"nota":"Stock inicial","prodId":286,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781231455900,"id":298,"nota":"Stock inicial","prodId":287,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781231534504,"id":299,"nota":"Stock inicial","prodId":288,"qty":3,"tipo":"entrada"},{"evento":"","fecha":1781231577972,"id":300,"nota":"Stock inicial","prodId":289,"qty":4,"tipo":"entrada"},{"evento":"","fecha":1781231694214,"id":301,"nota":"Stock inicial","prodId":290,"qty":4,"tipo":"entrada"},{"evento":"","fecha":1781231739206,"id":302,"nota":"Stock inicial","prodId":291,"qty":6,"tipo":"entrada"},{"evento":"","fecha":1781231793301,"id":303,"nota":"Stock inicial","prodId":292,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781231829555,"id":304,"nota":"Stock inicial","prodId":293,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781231906343,"id":305,"nota":"Stock inicial","prodId":294,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781231987180,"id":306,"nota":"Stock inicial","prodId":295,"qty":4,"tipo":"entrada"},{"evento":"","fecha":1781232021185,"id":307,"nota":"Stock inicial","prodId":296,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781232062122,"id":308,"nota":"Stock inicial","prodId":297,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781232121920,"id":309,"nota":"Stock inicial","prodId":298,"qty":4,"tipo":"entrada"},{"evento":"","fecha":1781232165863,"id":310,"nota":"Stock inicial","prodId":299,"qty":6,"tipo":"entrada"},{"evento":"","fecha":1781232240032,"id":311,"nota":"Stock inicial","prodId":300,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781232270089,"id":312,"nota":"Stock inicial","prodId":301,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781232299423,"id":313,"nota":"Stock inicial","prodId":302,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781232395510,"id":314,"nota":"Stock inicial","prodId":303,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781232438768,"id":315,"nota":"Stock inicial","prodId":304,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781232479538,"id":316,"nota":"Stock inicial","prodId":305,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781232536694,"id":317,"nota":"Stock inicial","prodId":306,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781232605155,"id":318,"nota":"Stock inicial","prodId":307,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781232675004,"id":319,"nota":"Stock inicial","prodId":308,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781232713310,"id":320,"nota":"Stock inicial","prodId":309,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781232738370,"id":321,"nota":"Edición manual","prodId":304,"qty":1,"tipo":"ajuste"},{"evento":"","fecha":1781232848927,"id":322,"nota":"Stock inicial","prodId":310,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781232887168,"id":323,"nota":"Stock inicial","prodId":311,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781232930497,"id":324,"nota":"Stock inicial","prodId":312,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781232967222,"id":325,"nota":"Stock inicial","prodId":313,"qty":2,"tipo":"entrada"},{"evento":"Sofia - Xiomara","fecha":1781382577154,"id":326,"nota":"Devolución de préstamo","prodId":25,"qty":3,"tipo":"devolucion"},{"evento":"","fecha":1781382722949,"id":327,"nota":"Edición manual","prodId":25,"qty":-3,"tipo":"ajuste"},{"evento":"","fecha":1781978716643,"id":328,"nota":"Stock inicial","prodId":314,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781978768658,"id":329,"nota":"Stock inicial","prodId":315,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781978813392,"id":330,"nota":"Stock inicial","prodId":316,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781978835823,"id":331,"nota":"Stock inicial","prodId":317,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781978961111,"id":332,"nota":"Stock inicial","prodId":318,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781979033589,"id":333,"nota":"Stock inicial","prodId":319,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781979075507,"id":334,"nota":"Stock inicial","prodId":320,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781979217607,"id":335,"nota":"Stock inicial","prodId":321,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781979266280,"id":336,"nota":"Stock inicial","prodId":322,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781979322183,"id":337,"nota":"Stock inicial","prodId":323,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781979352516,"id":338,"nota":"Stock inicial","prodId":324,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781979405639,"id":339,"nota":"Stock inicial","prodId":325,"qty":2,"tipo":"entrada"},{"evento":"","fecha":1781979451246,"id":340,"nota":"Stock inicial","prodId":326,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781979543363,"id":341,"nota":"Stock inicial","prodId":327,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781979613320,"id":342,"nota":"Stock inicial","prodId":328,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781979646553,"id":343,"nota":"Stock inicial","prodId":329,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781979718513,"id":344,"nota":"Stock inicial","prodId":330,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781979752581,"id":345,"nota":"Stock inicial","prodId":331,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781979812026,"id":346,"nota":"Stock inicial","prodId":332,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781979860480,"id":347,"nota":"Stock inicial","prodId":333,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781979933162,"id":348,"nota":"Stock inicial","prodId":334,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781979995425,"id":349,"nota":"Stock inicial","prodId":335,"qty":1,"tipo":"entrada"},{"evento":"","fecha":1781981698771,"id":350,"nota":"Stock inicial","prodId":336,"qty":8,"tipo":"entrada"},{"evento":"","fecha":1781981742013,"id":351,"nota":"Stock inicial","prodId":337,"qty":11,"tipo":"entrada"},{"evento":"","fecha":1781981783817,"id":352,"nota":"Stock inicial","prodId":338,"qty":10,"tipo":"entrada"},{"evento":"","fecha":1781981876131,"id":353,"nota":"Stock inicial","prodId":339,"qty":34,"tipo":"entrada"},{"evento":"","fecha":1781981914051,"id":354,"nota":"Stock inicial","prodId":340,"qty":4,"tipo":"entrada"},{"evento":"","fecha":1781981967498,"id":355,"nota":"Stock inicial","prodId":341,"qty":31,"tipo":"entrada"},{"evento":"","fecha":1781982004857,"id":356,"nota":"Stock inicial","prodId":342,"qty":9,"tipo":"entrada"},{"evento":"","fecha":1781982187649,"id":357,"nota":"Stock inicial","prodId":343,"qty":7,"tipo":"entrada"},{"evento":"","fecha":1781984789433,"id":358,"nota":"Stock inicial","prodId":345,"qty":18,"tipo":"entrada"}],"prestamos":[{"cliente":"Boda González","devuelto":true,"id":1,"nota":"Contacto: 310-555-0001","prodId":6,"qty":40,"retorno":1776292898093,"salida":1776033698093},{"cliente":"TechCorp S.A.","devuelto":true,"id":2,"nota":"Devuelto en buen estado","prodId":10,"qty":2,"retorno":1776120098093,"salida":1775774498093},{"cliente":"Diana Garcia","devuelto":true,"id":3,"nota":"","prodId":23,"qty":3,"retorno":1776384000000,"salida":1776371482391},{"cliente":"Maria Paula","devuelto":true,"id":4,"nota":"","prodId":24,"qty":1,"retorno":1776556800000,"salida":1776532501894},{"cliente":"Maria Paula","devuelto":true,"id":5,"nota":"","prodId":25,"qty":3,"retorno":1776556800000,"salida":1776532616788},{"cliente":"Maria Paula","devuelto":true,"id":6,"nota":"","prodId":26,"qty":2,"retorno":1776556800000,"salida":1776532761076},{"cliente":"Bryan Garcia","devuelto":true,"id":7,"nota":"","prodId":23,"qty":1,"retorno":1777075200000,"salida":1776567840745},{"cliente":"Laura","devuelto":true,"id":8,"nota":"","prodId":26,"qty":2,"retorno":1780185600000,"salida":1780200262902},{"cliente":"Sofia - Xiomara","devuelto":true,"id":9,"nota":"","prodId":25,"qty":3,"retorno":1781136000000,"salida":1781138254380}],"contratos":[{"asesor":"asesor@test.com","barrio":"Villa Javier","cliente":"Diana Garcia","descontadosPaquete":["Figuras MDF","Pintucaritas"],"direccion":"Calle 77","empresa":"happy","extras":["Figuras MDF"],"fecha":"2026-06-13","fechaRegistro":1781131307589,"festejado":"Santiago","hora":"15:00","id":1,"items":["Backing con imagen de fondo a escoger","2 Estructuras metálicas","3 cilindros color temática","Arco con globos colores a escoger","Decoración del salón en globos","Banderín temático","Mantel temático","Nombre del niño luminoso","Número Luminoso","Figura mdf temática","Tapete de peluche","Obsequio: personaje gigante temático y peluche para el cumpleañero","2 recreadores de alto nivel","Recreación dirigida","Rompe hielos","Integración de padres","Pintucaritas","Globoflexia máx. 25 niños","Juegos de competencia","AM FM, Gordo más gordo, Capitán, Agua de limón","Taller de payasos","Show de títeres","Chiqui zumba","Juego de luz verde con espuma","Juego de la silla musical","Protocolo cumpleaños y piñata","Música vía Bluetooth (no incluye cabina de sonido)","3 horas de animación","Figuras MDF"],"localidad":"Bosa","paquete":"Ensueño","tel1":"3104075240","tel2":"3123547384","valor":599000},{"asesor":"asesor@test.com","barrio":"dfgdfgd","cliente":"Jhon Vergara","direccion":"dkjvndflkjndlkjfg","empresa":"happy","extras":["Figuras MDF"],"fecha":"2026-06-13","fechaRegistro":1781137647859,"festejado":"martin","hora":"15:30","id":8,"items":["Backing con fondo a escoger","3 cilindros color temática","Arco con globos colores a escoger","Decoración del salón en globos","Banderín temático","Mantel temático","Nombre del niño en globos","Número metalizado en globo","Figura metalizada temática","3 horas de decoración antes del evento","2 recreadores de alto nivel","Recreación dirigida","Rompe hielos","Integración de padres","Pintucaritas","Globoflexia máx. 25 niños","Juegos de competencia","AM FM, Gordo más gordo, Capitán, Agua de limón","Taller de payasos","Show de títeres","Chiqui zumba","Juego de luz verde con espuma","Juego de la silla musical","Protocolo cumpleaños y piñata","Música vía Bluetooth (no incluye cabina de sonido)","3 horas de animación","Figuras MDF"],"localidad":"fddgdffgh","paquete":"Encantado","tel1":"1234567895","tel2":"1234567890","valor":490000}],"nextId":346,"nextMovId":359,"nextPrestId":10,"nextContratoId":9};
  try{
    state.productos=[...respaldo.productos];
    state.movimientos=[...respaldo.movimientos];
    state.prestamos=[...respaldo.prestamos];
    state.contratos=[...respaldo.contratos];
    state.nextId=respaldo.nextId;
    state.nextMovId=respaldo.nextMovId;
    state.nextPrestId=respaldo.nextPrestId;
    state.nextContratoId=respaldo.nextContratoId;
    await guardarDatos();
    renderDashboard();renderTabla();renderCatFilter();renderMovimientos();renderPrestamos();renderContratos();renderAlertas();
    toast('✅ Respaldo restaurado correctamente (' + state.productos.length + ' artículos)','ok');
  }catch(e){console.error(e);toast('❌ Error al restaurar: '+e.message,'err');}
};

function aplicarRol(){
  if(state.esAdmin){
    // Admin: ve todo — dashboard, inventario, calendario, movimientos, préstamos, alertas, ventas, contratos
    document.querySelectorAll('.admin-only').forEach(e=>e.style.display='');
    document.getElementById('nav-dashboard').style.display='';
    document.getElementById('nav-productos').style.display='';
    document.getElementById('nav-calendario').style.display='';
    document.getElementById('nav-movimientos').style.display='';
    document.getElementById('nav-prestamos').style.display='';
    document.getElementById('nav-alertas').style.display='';
    document.querySelectorAll('.asesor-nav').forEach(e=>e.style.display='');
    document.getElementById('user-role-badge').innerHTML='<span style="background:var(--accent);color:#fff;font-size:9px;padding:2px 7px;border-radius:10px;font-weight:800;letter-spacing:0.5px;">ADMIN</span>';
  }else if(state.esAsesor){
    // Asesor: ventas, contratos y calendario (el calendario es visible para todos los roles)
    document.querySelectorAll('.admin-only').forEach(e=>e.style.display='none');
    document.getElementById('nav-dashboard').style.display='none';
    document.getElementById('nav-productos').style.display='none';
    document.getElementById('nav-calendario').style.display='';
    document.getElementById('nav-movimientos').style.display='none';
    document.getElementById('nav-prestamos').style.display='none';
    document.getElementById('nav-alertas').style.display='none';
    document.querySelectorAll('.asesor-nav').forEach(e=>e.style.display='');
    document.getElementById('user-role-badge').innerHTML='<span style="background:#2a5abf;color:#fff;font-size:9px;padding:2px 7px;border-radius:10px;font-weight:800;letter-spacing:0.5px;">ASESOR</span>';
  }else{
    // Bodeguero: inventario, calendario, movimientos, préstamos (NO dashboard, NO alertas admin, NO ventas/contratos)
    document.querySelectorAll('.admin-only').forEach(e=>e.style.display='none');
    document.getElementById('nav-dashboard').style.display='none';
    document.getElementById('nav-productos').style.display='';
    document.getElementById('nav-calendario').style.display='';
    document.getElementById('nav-movimientos').style.display='';
    document.getElementById('nav-prestamos').style.display='';
    document.getElementById('nav-alertas').style.display='';
    document.querySelectorAll('.asesor-nav').forEach(e=>e.style.display='none');
    document.getElementById('user-role-badge').innerHTML='<span style="background:#3a5a3a;color:#7dbd7d;font-size:9px;padding:2px 7px;border-radius:10px;font-weight:800;letter-spacing:0.5px;">BODEGA</span>';
  }
}

// ── PERSONAL (logísticos, recreadores, coordinadores, operarios) ────────────
let editPersonalId=null;
let dispPersonalId=null;

function renderPersonal(){
  const cont=document.getElementById('personalCards');
  if(!cont)return;
  const filtro=document.getElementById('filterRolPersonal')?.value||'';
  const lista=state.personal.filter(p=>!filtro||p.rol===filtro);
  if(!lista.length){cont.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--muted);"><span style="font-size:36px;display:block;margin-bottom:10px;">👥</span>Sin personal registrado</div>';return;}
  const rolInfo=r=>ROLES_PERSONAL.find(x=>x.id===r)||{label:r,icon:'👤'};
  cont.innerHTML=lista.map(p=>{
    const r=rolInfo(p.rol);
    const noDisp=(p.noDisponibleFechas||[]).length;
    return`<div class="inv-card">
      <div class="inv-card-name">${r.icon} ${p.nombre}</div>
      <div class="inv-card-sku">${r.label}${p.edad?' · '+p.edad+' años':''}</div>
      <div style="font-size:12px;color:var(--muted);margin:6px 0;">
        📞 ${p.telefono||'—'}<br>
        💳 ${p.cuentaTipo||'—'}<br>
        🏠 ${p.direccion||'—'}
      </div>
      ${noDisp?`<div style="font-size:11px;color:var(--danger);font-weight:700;margin-bottom:6px;">🚫 ${noDisp} fecha(s) no disponible</div>`:''}
      <div class="inv-card-footer">
        <span></span>
        <div style="display:flex;gap:5px;">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="openDisponibilidadModal(${p.id})" title="Disponibilidad">📅</button>
          <button class="btn btn-ghost btn-sm btn-icon" onclick="openPersonalModal(${p.id})" title="Editar">✎</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="eliminarPersonal(${p.id})" title="Eliminar">✕</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
window.renderPersonal=renderPersonal;

window.openPersonalModal=function(id=null){
  editPersonalId=id;
  document.getElementById('personalModalTitle').textContent=id?'Editar empleado':'Nuevo empleado';
  if(id){
    const p=getPersona(id);
    document.getElementById('pe_nombre').value=p.nombre;
    document.getElementById('pe_rol').value=p.rol;
    document.getElementById('pe_edad').value=p.edad||'';
    document.getElementById('pe_telefono').value=p.telefono||'';
    document.getElementById('pe_cuenta_tipo').value=p.cuentaTipo||'Nequi';
    document.getElementById('pe_direccion').value=p.direccion||'';
  }else{
    ['pe_nombre','pe_edad','pe_telefono','pe_direccion'].forEach(f=>document.getElementById(f).value='');
    document.getElementById('pe_rol').value='logistico';
    document.getElementById('pe_cuenta_tipo').value='Nequi';
  }
  document.getElementById('personalOverlay').classList.add('open');
};
window.closePersonalModal=function(){document.getElementById('personalOverlay').classList.remove('open');editPersonalId=null;};

window.guardarPersonal=async function(){
  const nombre=document.getElementById('pe_nombre').value.trim();
  const rol=document.getElementById('pe_rol').value;
  const edad=parseInt(document.getElementById('pe_edad').value)||null;
  const telefono=document.getElementById('pe_telefono').value.trim();
  const cuentaTipo=document.getElementById('pe_cuenta_tipo').value;
  const direccion=document.getElementById('pe_direccion').value.trim();
  if(!nombre){toast('Ingresa el nombre del empleado','err');return;}
  if(telefono&&!telefonoValido(telefono)){toast('Teléfono inválido — debe iniciar en 3 y tener 10 dígitos','err');return;}
  if(editPersonalId){
    const p=getPersona(editPersonalId);
    Object.assign(p,{nombre,rol,edad,telefono,cuentaTipo,direccion});
    toast('✅ Empleado actualizado','ok');
  }else{
    state.personal.push({id:state.nextPersonalId++,nombre,rol,edad,telefono,cuentaTipo,direccion,noDisponibleFechas:[]});
    toast('✅ Empleado registrado','ok');
  }
  closePersonalModal();renderPersonal();await guardarDatos();
};

window.eliminarPersonal=async function(id){
  if(!confirm('¿Eliminar este empleado? También se quitará de cualquier evento donde esté programado.'))return;
  state.personal=state.personal.filter(p=>p.id!==id);
  // Quitar cualquier asignación de este empleado en contratos existentes
  for(const c of state.contratos){
    if(!c.personalAsignado)continue;
    for(const rol of ROLES_PERSONAL){
      if(c.personalAsignado[rol.id])c.personalAsignado[rol.id]=c.personalAsignado[rol.id].filter(pid=>pid!==id);
    }
  }
  renderPersonal();await guardarDatos();toast('Empleado eliminado','warn');
};

window.openDisponibilidadModal=function(id){
  dispPersonalId=id;
  const p=getPersona(id);
  document.getElementById('disp_nombre_label').textContent=p.nombre;
  document.getElementById('disp_fecha').value='';
  renderListaFechasNoDisponibles();
  document.getElementById('disponibilidadOverlay').classList.add('open');
};
window.closeDisponibilidadModal=function(){document.getElementById('disponibilidadOverlay').classList.remove('open');dispPersonalId=null;renderPersonal();};

function renderListaFechasNoDisponibles(){
  const p=getPersona(dispPersonalId);
  const cont=document.getElementById('disp_lista_fechas');
  if(!p||!cont)return;
  const fechas=[...(p.noDisponibleFechas||[])].sort();
  if(!fechas.length){cont.innerHTML='<div style="color:var(--muted);">Disponible en todas las fechas.</div>';return;}
  cont.innerHTML=fechas.map(f=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#fff3f3;border-radius:7px;margin-bottom:5px;">
    <span>🚫 ${fmtDate(f+'T12:00:00')}</span>
    <button onclick="quitarFechaNoDisponible('${f}')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-weight:800;">✕</button>
  </div>`).join('');
}

window.agregarFechaNoDisponible=async function(){
  const fecha=document.getElementById('disp_fecha').value;
  if(!fecha){toast('Selecciona una fecha','err');return;}
  const p=getPersona(dispPersonalId);
  if(!p)return;
  if(!p.noDisponibleFechas)p.noDisponibleFechas=[];
  if(!p.noDisponibleFechas.includes(fecha))p.noDisponibleFechas.push(fecha);
  document.getElementById('disp_fecha').value='';
  renderListaFechasNoDisponibles();
  await guardarDatos();
};

window.quitarFechaNoDisponible=async function(fecha){
  const p=getPersona(dispPersonalId);
  if(!p)return;
  p.noDisponibleFechas=(p.noDisponibleFechas||[]).filter(f=>f!==fecha);
  renderListaFechasNoDisponibles();
  await guardarDatos();
};

function renderVentasView(){
  ventaEmpresa=null;paqueteSeleccionado=null;
  window._ventaVariantesSel={};
  document.getElementById('ventas-empresa-selector').style.display='block';
  document.getElementById('ventas-form-wrap').style.display='none';
}

window.seleccionarEmpresa=function(empresa){
  ventaEmpresa=empresa;
  window._ventaVariantesSel={};
  document.getElementById('ventas-empresa-selector').style.display='none';
  document.getElementById('ventas-form-wrap').style.display='block';
  const header=document.getElementById('empresa-header-venta');
  const icon=document.getElementById('eh-icon');
  const name=document.getElementById('eh-name');
  const btn=document.getElementById('btn-registrar-venta');
  if(empresa==='happy'){
    header.className='empresa-header eh-happy';
    icon.textContent='🎪';name.textContent='Happy Art Eventos';
    btn.style.background='var(--accent)';
  }else{
    header.className='empresa-header eh-conde';
    icon.textContent='🎭';name.textContent='Conde Eventos';
    btn.style.background='var(--accent2)';
  }
  renderPaquetesGrid();
  renderExtrasGrid();
  // Limpiar campos
  ['v_fecha','v_hora','v_hora_decoracion','v_cliente','v_tel1','v_tel2','v_direccion','v_barrio','v_localidad','v_festejado','v_anios','v_valor_paquete'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  ['v_pers_logistico','v_pers_recreador','v_pers_coordinador','v_pers_operario'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='0';});
  // Limpiar selección de variantes (personaje gigante, títeres, etc.)
  window._ventaVariantesSel={};
  paqueteSeleccionado=null;
  // Limpiar el wrap de variantes
  const vvw2=document.getElementById('venta-variantes-wrap');
  if(vvw2){vvw2.style.display='none';vvw2.innerHTML='';}
  // Limpiar paquete seleccionado
  document.querySelectorAll('.paquete-card').forEach(el=>el.classList.remove('selected','selected-conde'));
  const incWrap=document.getElementById('incluidos-wrap');
  if(incWrap)incWrap.style.display='none';
  const valWrap=document.getElementById('valor-paquete-wrap');
  if(valWrap)valWrap.style.display='none';
  ventaExtrasSelected=[];
  renderVentaExtrasChips&&renderVentaExtrasChips();
};

window.cambiarEmpresa=function(){
  ventaEmpresa=null;paqueteSeleccionado=null;
  window._ventaVariantesSel={};
  document.getElementById('ventas-empresa-selector').style.display='block';
  document.getElementById('ventas-form-wrap').style.display='none';
  document.getElementById('incluidos-wrap').style.display='none';
  document.getElementById('extras-section').style.display='none';
  const vvw=document.getElementById('venta-variantes-wrap');
  if(vvw){vvw.style.display='none';vvw.innerHTML='';}
  const ldw=document.getElementById('letras-detectadas-wrap');
  if(ldw)ldw.style.display='none';
  const vpw=document.getElementById('valor-paquete-wrap');
  if(vpw)vpw.style.display='none';
};

function renderPaquetesGrid(){
  const wrap=document.getElementById('paquetes-grid-wrap');
  const isCondePurple=ventaEmpresa==='conde';
  const fecha=document.getElementById('v_fecha')?.value||'';
  const cats=[
    {id:'cumpleanos',label:'🎂 Cumpleaños'},
    {id:'baby_shower',label:'👶 Baby Shower'},
    {id:'revelacion',label:'🎀 Revelación de Género'}
  ];
  let html='';
  for(const cat of cats){
    const pkgs=PAQUETES.filter(p=>p.categoria===cat.id);
    if(!pkgs.length)continue;
    html+=`<div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin:14px 0 8px;">${cat.label}</div>`;
    html+='<div class="paquete-grid">';
    for(const p of pkgs){
      const nombreVisible=ventaEmpresa==='conde'?p.nombreConde:p.nombreHappy;
      const duoLabel=ventaEmpresa==='conde'
        ?`<div style="font-size:10px;color:var(--muted);font-weight:600;">${p.nombreHappy}</div>`
        :`<div style="font-size:10px;color:var(--muted);font-weight:600;">${p.nombreConde}</div>`;
      const dispBadge=`<div class="pk-disp-badge pk-disp-ok">✅ Disponible para esta fecha</div>`;
      html+=`<div class="paquete-card" id="pk-${p.id}" onclick="selectPaquete('${p.id}')">
        <div class="pk-name">${nombreVisible}</div>
        ${duoLabel}
        <div class="pk-price${isCondePurple?' conde':''}">${fmtPrecio(p.precio)}</div>
        ${dispBadge}
      </div>`;
    }
    html+='</div>';
  }
  wrap.innerHTML=html;
}

window.onFechaVentaChange=function(){
  renderPaquetesGrid();
  // Si ya hay paquete seleccionado, re-marcar la selección visual y refrescar disponibilidad
  if(paqueteSeleccionado){
    const card=document.getElementById('pk-'+paqueteSeleccionado);
    if(card)card.classList.add(ventaEmpresa==='conde'?'selected-conde':'selected');
    const pk=PAQUETES.find(p=>p.id===paqueteSeleccionado);
    renderIncluidosList(pk);
  }
  renderVentaExtrasChips();
};

let ventaVariantesPaquete=[];

function renderIncluidosList(pk){
  const list=document.getElementById('incluidos-list');
  if(!list||!pk)return;
  const fecha=document.getElementById('v_fecha')?.value||'';
  const{separado}=fecha?calcStockSeparadoPorFecha(fecha):{separado:{}};
  list.innerHTML=pk.items.map(i=>{
    if(!fecha||isConsumable(i))return`<li>${i}</li>`;
    const prod=matchInventario(i);
    if(!prod)return`<li>${i}</li>`;
    const sep=separado[prod.id]||0;
    const libre=Math.max(0,prod.stock-sep);
    if(libre<=0)return`<li>${i} <span style="color:var(--danger);font-weight:700;font-size:11px;">⚠️ sin stock esa fecha</span></li>`;
    if(libre<=prod.min)return`<li>${i} <span style="color:var(--warn);font-weight:700;font-size:11px;">⚠️ stock bajo (${libre} libre)</span></li>`;
    return`<li>${i}</li>`;
  }).join('');
  renderVariantesPaqueteWrap(pk,'venta-variantes-wrap','ventaVariantesSetProd',window._ventaVariantesSel);
}

function _pendientesVariantePaquete(pk){
  if(!pk)return[];
  const pendientes=[];
  for(const itemNombre of pk.items){
    if(isConsumable(itemNombre))continue;
    const spec=_buscarEspecificacion(itemNombre);
    if(!spec)continue;
    for(const req of spec.buscar){
      const opciones=matchInventarioMultiple(req.termino);
      if(req.variante&&opciones.length>1){
        for(let n=0;n<req.qty;n++){
          pendientes.push({itemNombre,termino:req.termino,idx:n,opciones,obligatorio:!!req.obligatorio});
        }
      }
    }
  }
  return pendientes;
}

function _precargarVariantesDesdeContrato(pk,descontadosPaquete){
  const sel={};
  const disponibles=[...(descontadosPaquete||[])];
  const pendientes=_pendientesVariantePaquete(pk);
  for(const p of pendientes){
    const key=`${p.itemNombre}::${p.termino}::${p.idx}`;
    const idxMatch=disponibles.findIndex(nombre=>{
      // Match by compound "NOMBRE · SKU" or by nombre alone
      const partes=nombre.split(' · ');
      const nomBase=partes[0];
      const skuPart=partes[1]||null;
      return p.opciones.some(o=>skuPart?o.nombre===nomBase&&o.sku===skuPart:o.nombre===nomBase);
    });
    if(idxMatch>=0){
      const nombreGuardado=disponibles[idxMatch];
      const partes=nombreGuardado.split(' · ');
      const nomBase=partes[0];
      const skuPart=partes[1]||null;
      const prod=p.opciones.find(o=>skuPart?o.nombre===nomBase&&o.sku===skuPart:o.nombre===nomBase);
      if(prod)sel[key]=prod.id;
      disponibles.splice(idxMatch,1);
    }
  }
  return sel;
}

function renderVariantesPaqueteWrap(pk,wrapId,setterName,seleccionInicial){
  const wrap=document.getElementById(wrapId);
  if(!wrap)return;
  const pendientes=_pendientesVariantePaquete(pk);
  if(!pendientes.length){wrap.style.display='none';wrap.innerHTML='';return;}
  const seleccion=seleccionInicial||{};
  wrap.style.display='block';
  wrap.innerHTML=`<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin:14px 0 8px;">🎭 Especifica cuál necesita el cliente</div>`+
    pendientes.map((p,i)=>{
      const key=`${p.itemNombre}::${p.termino}::${p.idx}`;
      const elegido=seleccion[key];
      const opts=p.opciones.map(o=>`<option value="${o.id}" ${elegido===o.id?'selected':''}>${o.sku||o.nombre}${o.stock<=0?' (sin stock)':''}</option>`).join('');
      const etiqueta=p.opciones.length>1&&pendientes.filter(x=>x.itemNombre===p.itemNombre&&x.termino===p.termino).length>1
        ?`${p.itemNombre} #${p.idx+1}`:p.itemNombre;
      const requeridoTag=p.obligatorio
        ?`<span style="color:var(--danger);font-weight:800;">*</span>`
        :`<span style="font-weight:400;font-size:11px;color:var(--muted);">(opcional)</span>`;
      return`<div class="field" style="margin-bottom:8px;">
        <label>${etiqueta} ${requeridoTag}</label>
        <select onchange="${setterName}('${encodeURIComponent(key)}',this.value)" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font-body);font-size:13px;font-weight:600;">
          <option value="">— Selecciona —</option>
          ${opts}
        </select>
      </div>`;
    }).join('');
}

window.ventaVariantesSetProd=function(encodedKey,prodId){
  const key=decodeURIComponent(encodedKey);
  if(!window._ventaVariantesSel)window._ventaVariantesSel={};
  if(prodId)window._ventaVariantesSel[key]=Number(prodId);
  else delete window._ventaVariantesSel[key];
};

window.selectPaquete=function(pkId){
  paqueteSeleccionado=pkId;
  const pk=PAQUETES.find(p=>p.id===pkId);
  // Resaltar seleccionado
  document.querySelectorAll('.paquete-card').forEach(el=>{
    el.classList.remove('selected','selected-conde');
  });
  const card=document.getElementById('pk-'+pkId);
  if(ventaEmpresa==='happy') card.classList.add('selected');
  else card.classList.add('selected-conde');
  // Mostrar campo de valor del paquete (editable, para reflejar descuentos especiales)
  window._valorPaqueteOriginal=pk.precio;
  const valorWrap=document.getElementById('valor-paquete-wrap');
  const valorInput=document.getElementById('v_valor_paquete');
  if(valorWrap)valorWrap.style.display='block';
  if(valorInput)valorInput.value=fmt(pk.precio);
  actualizarBadgeValorPaquete('v_valor_paquete','valor-paquete-badge',pk.precio);
  // Mostrar incluidos (con disponibilidad para la fecha del evento, si ya está digitada)
  const wrap=document.getElementById('incluidos-wrap');
  window._ventaVariantesSel={};
  renderIncluidosList(pk);
  wrap.style.display='block';
  document.getElementById('extras-section').style.display='';
  // Resetear extras
  ventaExtrasSelected=[];
  renderExtrasGrid();
  detectarLetrasNumero();
};

function parsePrecioInput(str){
  const limpio=(str||'').replace(/[^0-9]/g,'');
  return limpio?parseInt(limpio):0;
}

function actualizarBadgeValorPaquete(inputId,badgeId,precioOriginal){
  const input=document.getElementById(inputId);
  const badge=document.getElementById(badgeId);
  if(!input||!badge)return;
  const actual=parsePrecioInput(input.value);
  if(actual>0&&actual!==precioOriginal){
    badge.style.display='block';
    badge.textContent=actual<precioOriginal
      ?`✨ Precio especial — valor de catálogo: ${fmtPrecio(precioOriginal)}`
      :`⚠️ Valor por encima del catálogo (${fmtPrecio(precioOriginal)})`;
  }else{
    badge.style.display='none';
  }
}

window.onValorPaqueteInput=function(){
  const input=document.getElementById('v_valor_paquete');
  if(!input)return;
  const num=parsePrecioInput(input.value);
  input.value=num?fmt(num):'';
  actualizarBadgeValorPaquete('v_valor_paquete','valor-paquete-badge',window._valorPaqueteOriginal||0);
};

window.onValorPaqueteEcInput=function(){
  const input=document.getElementById('ec_valor_paquete');
  if(!input)return;
  const num=parsePrecioInput(input.value);
  input.value=num?fmt(num):'';
  actualizarBadgeValorPaquete('ec_valor_paquete','ec-valor-paquete-badge',window._ecValorPaqueteOriginal||0);
};

let ventaExtrasSelected=[];

let ventaExtrasHighlight=-1;

function renderExtrasGrid(){
  // Show the search container when a package is selected
  const cont=document.getElementById('extras-search-container');
  if(cont)cont.style.display='block';
  ventaExtrasSelected=[];
  renderVentaExtrasChips();
  const si=document.getElementById('venta-extras-search');if(si)si.value='';
  const dd=document.getElementById('venta-extras-dropdown');if(dd){dd.innerHTML='';dd.classList.remove('open');}
}

window.ventaExtrasSearch=function(q){
  const dd=document.getElementById('venta-extras-dropdown');if(!dd)return;
  if(!q.trim()){dd.innerHTML='';dd.classList.remove('open');return;}
  const norm=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const nq=norm(q);
  const ya=new Set(ventaExtrasSelected.map(e=>e.prod.id));
  const fecha=document.getElementById('v_fecha')?.value||'';
  const{separado}=fecha?calcStockSeparadoPorFecha(fecha):{separado:{}};
  const results=state.productos.filter(p=>p.stock>0&&!ya.has(p.id)&&(norm(p.nombre).includes(nq)||norm(p.cat).includes(nq)||norm(p.sku).includes(nq))).slice(0,8);
  ventaExtrasHighlight=-1;
  if(!results.length){dd.innerHTML='<div style="padding:10px 14px;font-size:12px;color:var(--muted);">Sin resultados</div>';dd.classList.add('open');return;}
  dd.innerHTML=results.map((p,i)=>{
    const sep=separado[p.id]||0;
    const libre=fecha?Math.max(0,p.stock-sep):p.stock;
    const fakeP=fecha?{...p,stock:libre}:p;
    const s=stockStatus(fakeP);
    const etiqueta=fecha&&sep>0?`${libre} libre / ${p.stock} total`:`${p.stock} ${p.unidad}`;
    return`<div class="extras-dd-item" data-idx="${i}" data-id="${p.id}" onclick="ventaExtrasAdd(${p.id})"><div><div class="dd-name">${p.nombre}</div><div class="dd-cat">${p.cat} · ${p.sku}</div></div><span class="dd-stock ${s}">${etiqueta}</span></div>`;
  }).join('');
  dd.classList.add('open');
};

window.ventaExtrasKeydown=function(e){
  const dd=document.getElementById('venta-extras-dropdown');
  const items=dd?.querySelectorAll('.extras-dd-item');
  if(!items?.length)return;
  if(e.key==='ArrowDown')ventaExtrasHighlight=Math.min(ventaExtrasHighlight+1,items.length-1);
  else if(e.key==='ArrowUp')ventaExtrasHighlight=Math.max(ventaExtrasHighlight-1,0);
  else if(e.key==='Enter'&&ventaExtrasHighlight>=0){items[ventaExtrasHighlight].click();return;}
  else if(e.key==='Escape'){dd.classList.remove('open');return;}
  items.forEach((it,i)=>it.classList.toggle('highlighted',i===ventaExtrasHighlight));
};

window.ventaExtrasAdd=function(prodId){
  const p=getProd(prodId);if(!p)return;
  if(!ventaExtrasSelected.find(e=>e.prod.id===prodId))ventaExtrasSelected.push({prod:p,qty:1});
  const si=document.getElementById('venta-extras-search');if(si){si.value='';const dd=document.getElementById('venta-extras-dropdown');if(dd){dd.innerHTML='';dd.classList.remove('open');}}
  renderVentaExtrasChips();
};

window.ventaExtrasRemove=function(prodId){ventaExtrasSelected=ventaExtrasSelected.filter(e=>e.prod.id!==prodId);renderVentaExtrasChips();};

window.ventaExtrasSetQty=function(prodId,qty){const e=ventaExtrasSelected.find(x=>x.prod.id===prodId);if(e)e.qty=qty;};

function renderVentaExtrasChips(){
  const cont=document.getElementById('venta-extras-chips');if(!cont)return;
  const fecha=document.getElementById('v_fecha')?.value||'';
  const{separado}=fecha?calcStockSeparadoPorFecha(fecha):{separado:{}};
  cont.innerHTML=ventaExtrasSelected.map(e=>{
    const sep=separado[e.prod.id]||0;
    const libre=fecha?Math.max(0,e.prod.stock-sep):e.prod.stock;
    const dispTxt=fecha&&sep>0?`(libre: ${libre} / total: ${e.prod.stock})`:`(disp: ${e.prod.stock})`;
    const sinStockFecha=fecha&&libre<e.qty;
    return`
    <div class="extra-chip valid${e.auto?' extra-chip-auto':''}${sinStockFecha?' extra-chip-warn':''}">
      <span class="extra-chip-name">${e.auto?'✨ ':''}${e.prod.nombre}${e.prod.sku?' · '+e.prod.sku:''} <span style="font-weight:400;color:${sinStockFecha?'var(--danger)':'var(--muted)'};font-size:11px;">${dispTxt}${sinStockFecha?' ⚠️ sin stock para esa fecha':''}</span></span>
      <div class="extra-chip-qty">
        <input type="number" min="1" max="${e.prod.stock}" value="${e.qty}" onchange="ventaExtrasSetQty(${e.prod.id},parseInt(this.value)||1)">
        <span style="font-size:11px;color:var(--muted);">${e.prod.unidad}</span>
      </div>
      <button class="extra-chip-remove" onclick="ventaExtrasRemove(${e.prod.id})">✕</button>
    </div>`;
  }).join('');
}

function _normLetras(s){
  return (s||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
}

window.detectarLetrasNumero=function(){
  const wrap=document.getElementById('letras-detectadas-wrap');
  const msgEl=document.getElementById('letras-detectadas-msg');
  // Limpiar extras automáticos previos (se recalculan desde cero cada vez)
  ventaExtrasSelected=ventaExtrasSelected.filter(e=>!e.auto);

  const pk=PAQUETES.find(p=>p.id===paqueteSeleccionado);
  if(!pk){if(wrap)wrap.style.display='none';renderVentaExtrasChips();return;}

  const festejado=document.getElementById('v_festejado')?.value.trim()||'';
  const anios=document.getElementById('v_anios')?.value.trim()||'';

  const mensajes=[];
  const faltantes=[];

  for(const itemNombre of pk.items){
    const baja=itemNombre.toLowerCase();
    const esNombre=/nombre/.test(baja);
    const esNumero=/n[uú]mero/.test(baja)&&/(a cumplir|n[uú]mero luminoso|^n[uú]mero$)/.test(baja);
    const esLuminoso=/luminos/.test(baja);
    const esGlobo=/globo/.test(baja)&&!/metalizado|aerost[aá]tico/.test(baja); // "metalizado en globo" no es letra de globoflexia
    if(!esLuminoso&&!esGlobo)continue;

    if(esNombre&&festejado){
      const letras=_normLetras(festejado).split('');
      if(!letras.length)continue;
      const catSku=esLuminoso?'LUMINOSA ':'LG ';
      const catNombre=esLuminoso?'LETRA LUMINOSA':'LETRA GLOBO';
      const encontradas=[],noEncontradas=[];
      for(const letra of letras){
        const prod=state.productos.find(p=>p.nombre.toUpperCase().startsWith(catNombre)&&_normLetras(p.sku)===_normLetras(catSku+letra));
        if(prod&&prod.stock>0){
          encontradas.push(letra);
          const existente=ventaExtrasSelected.find(e=>e.prod.id===prod.id);
          if(existente)existente.qty+=1;
          else ventaExtrasSelected.push({prod,qty:1,auto:true,autoTipo:'letra'});
        }else{
          noEncontradas.push(letra+(prod?' (sin stock)':' (no existe)'));
        }
      }
      if(encontradas.length)mensajes.push(`Nombre "${festejado.toUpperCase()}" → se agregaron ${encontradas.length} ${catNombre.toLowerCase()} (${letras.join('')})`);
      if(noEncontradas.length)faltantes.push(`${catNombre}: ${noEncontradas.join(', ')}`);
    }

    if(esNumero&&anios){
      const digitos=_normLetras(anios).split('').filter(c=>/[0-9]/.test(c));
      if(!digitos.length)continue;
      // Solo existe versión luminosa de número en inventario actualmente
      if(esLuminoso){
        const encontrados=[],noEncontrados=[];
        for(const d of digitos){
          const prod=state.productos.find(p=>p.nombre.toUpperCase().startsWith('NUMERO LUMINOSO')&&_normLetras(p.sku)===_normLetras('LUMINOSO '+d));
          if(prod&&prod.stock>0){
            encontrados.push(d);
            const existente=ventaExtrasSelected.find(e=>e.prod.id===prod.id);
            if(existente)existente.qty+=1;
            else ventaExtrasSelected.push({prod,qty:1,auto:true,autoTipo:'numero'});
          }else{
            noEncontrados.push(d+(prod?' (sin stock)':' (no existe)'));
          }
        }
        if(encontrados.length)mensajes.push(`Número a cumplir "${anios}" → se agregaron ${encontrados.length} número(s) luminoso(s) (${digitos.join('')})`);
        if(noEncontrados.length)faltantes.push(`NÚMERO LUMINOSO: ${noEncontrados.join(', ')}`);
      }else if(esGlobo){
        faltantes.push(`No hay número en globo individual por dígito en inventario — revisar manualmente (años: ${anios})`);
      }
    }
  }

  if(wrap&&msgEl){
    if(mensajes.length||faltantes.length){
      wrap.style.display='block';
      msgEl.innerHTML=[...mensajes,...faltantes.map(f=>`⚠️ ${f}`)].join('<br>');
    }else{
      wrap.style.display='none';
    }
  }
  renderVentaExtrasChips();
};

let _realtimeListenerActivo=false;

function activarListenerTiempoReal(){
  if(_realtimeListenerActivo)return;
  _realtimeListenerActivo=true;
  onValue(ref(db,DB_PATH),(snap)=>{
    if(!snap.exists())return;
    const d=snap.val();
    // Actualizar datos en memoria
    const nuevosProd=d.productos?Object.values(d.productos):[];
    const nuevosMovs=d.movimientos?Object.values(d.movimientos):[];
    const nuevosPrest=d.prestamos?Object.values(d.prestamos):[];
    const nuevosContr=d.contratos?Object.values(d.contratos):[];
    const nuevosAjustes=d.contabAjustes||{};
    // Solo re-renderizar si algo cambió (evitar loops al guardar nosotros mismos)
    const prodCambiaron=JSON.stringify(nuevosProd)!==JSON.stringify(state.productos);
    const contrCambiaron=JSON.stringify(nuevosContr)!==JSON.stringify(state.contratos);
    const prestCambiaron=JSON.stringify(nuevosPrest)!==JSON.stringify(state.prestamos);
    const ajustesCambiaron=JSON.stringify(nuevosAjustes)!==JSON.stringify(state.contabAjustes);
    state.productos=nuevosProd;
    state.movimientos=nuevosMovs;
    state.prestamos=nuevosPrest;
    state.contratos=nuevosContr;
    state.contabAjustes=nuevosAjustes;
    state.nextId=d.nextId||state.nextId;
    state.nextMovId=d.nextMovId||state.nextMovId;
    state.nextPrestId=d.nextPrestId||state.nextPrestId;
    state.nextContratoId=d.nextContratoId||state.nextContratoId;
    // Re-renderizar la vista activa si el inventario, préstamos, contratos o ajustes cambiaron
    if(prodCambiaron||contrCambiaron||prestCambiaron||ajustesCambiaron){
      const vistaActiva=document.querySelector('.view.active');
      if(vistaActiva){
        const vid=vistaActiva.id.replace('view-','');
        if(vid==='dashboard'&&(prodCambiaron||contrCambiaron||ajustesCambiaron))renderDashboard();
        else if(vid==='productos'&&prodCambiaron){renderTabla();renderCatFilter();}
        else if(vid==='alertas'&&prodCambiaron)renderAlertas();
        else if(vid==='movimientos'&&prodCambiaron)renderMovimientos();
        else if(vid==='prestamos'&&(prodCambiaron||prestCambiaron)){renderPrestamos();}
        else if(vid==='contratos'&&contrCambiaron)renderContratos();
        else if(vid==='calendario'&&contrCambiaron)renderCalendario();
        else if(vid==='ventas'&&prodCambiaron){renderExtrasGrid();detectarLetrasNumero();} // Actualizar lista de extras disponibles
      }
      document.getElementById('save-indicator').textContent='☁️ Sincronizado con Firebase';
    }
  });
}

window.registrarVenta=async function(){
  const fecha=document.getElementById('v_fecha').value;
  const hora=document.getElementById('v_hora').value;
  const horaDecoracion=document.getElementById('v_hora_decoracion').value;
  const cliente=document.getElementById('v_cliente').value.trim();
  const tel1=document.getElementById('v_tel1').value.trim();
  const tel2=document.getElementById('v_tel2').value.trim();
  const direccion=document.getElementById('v_direccion').value.trim();
  const barrio=document.getElementById('v_barrio').value.trim();
  const localidad=document.getElementById('v_localidad').value.trim();
  const festejado=document.getElementById('v_festejado').value.trim();
  if(!fecha||!cliente||!tel1||!paqueteSeleccionado){
    toast('Completa fecha, cliente, teléfono y paquete','err');return;
  }
  if(!telefonoValido(tel1)){
    toast('El teléfono 1 debe tener exactamente 10 dígitos (ej: 3102112655)','err');return;
  }
  if(!telefonoValido(tel2)){
    toast('El teléfono 2 debe tener exactamente 10 dígitos (ej: 3102112655)','err');return;
  }
  const pk=PAQUETES.find(p=>p.id===paqueteSeleccionado);
  const eventoRef=`${pk.nombre} · ${cliente}`;

  // ── Recargar inventario fresco desde Firebase ──
  // El inventario es estático para la venta (no se descuenta), pero se refresca
  // para que matchInventario use los nombres/SKUs más recientes del catálogo.
  try{
    const snapFresh=await get(ref(db,DB_PATH));
    if(snapFresh.exists()){
      const d=snapFresh.val();
      state.productos=d.productos?Object.values(d.productos):state.productos;
      state.movimientos=d.movimientos?Object.values(d.movimientos):state.movimientos;
      state.nextMovId=d.nextMovId||state.nextMovId;
    }
  }catch(e){console.warn('No se pudo refrescar inventario, usando datos locales');}

  // ── 1. Registrar ítems del paquete según la especificación exacta de
  // cantidad/producto (ESPECIFICACION_ITEMS_PAQUETE) — ver resolverItemsPaqueteInventario.
  // NOTA: el inventario es ESTÁTICO al registrar la venta — esto NO descuenta
  // stock real. Solo se guarda qué materiales pide el contrato, para que el
  // reporte por fecha (en el Calendario) calcule disponibilidad sin afectar el
  // número real en bodega. El stock físico solo se mueve en el módulo de
  // Préstamo a Coordinadores, que es la salida real de materiales el día del evento.
  const{resueltos:descontadosPaquete,faltanVariante}=resolverItemsPaqueteInventario(pk,window._ventaVariantesSel);
  if(faltanVariante.length){
    toast(`Falta especificar: ${faltanVariante.join(', ')}`,'err');return;
  }

  // ── 2. Extras seleccionados manualmente — se registran igual, sin descontar stock ──
  const extrasIds=ventaExtrasSelected.map(e=>e.prod.id);
  const extrasNombres=[];
  for(const sel of ventaExtrasSelected){
    const prod=getProd(sel.prod.id);
    const qty=sel.qty||1;
    if(prod){
      // Si el producto es una variante específica (ej: LETRA LUMINOSA "LUMINOSA D",
      // NUMERO LUMINOSO "LUMINOSO 5"), guardar también el SKU para saber exactamente
      // cuál letra/número es — no solo el nombre genérico del artículo.
      const nombreUp=prod.nombre.trim().toUpperCase();
      const esVarianteIdentificable=nombreUp.startsWith('LETRA LUMINOSA')||nombreUp.startsWith('LETRA GLOBO')||nombreUp.startsWith('NUMERO LUMINOSO');
      const etiqueta=esVarianteIdentificable&&prod.sku?`${prod.nombre} (${prod.sku})`:prod.nombre;
      for(let n=0;n<qty;n++)extrasNombres.push(etiqueta);
    }
  }

  // Valor del paquete: por defecto el de catálogo, pero el asesor puede haberlo
  // editado (ej. descuento especial al cliente) — se respeta lo que esté en el campo.
  const valorPaqueteInput=parsePrecioInput(document.getElementById('v_valor_paquete')?.value||'');
  const valorFinal=valorPaqueteInput>0?valorPaqueteInput:pk.precio;

  const requerimientosPersonal={
    logistico:parseInt(document.getElementById('v_pers_logistico')?.value)||0,
    recreador:parseInt(document.getElementById('v_pers_recreador')?.value)||0,
    coordinador:parseInt(document.getElementById('v_pers_coordinador')?.value)||0,
    operario:parseInt(document.getElementById('v_pers_operario')?.value)||0
  };

  const contrato={
    id:state.nextContratoId++,empresa:ventaEmpresa,fecha,hora,horaDecoracion,cliente,tel1,tel2,
    direccion,barrio,localidad,festejado,paquete:pk.nombre,valor:valorFinal,valorCatalogo:pk.precio,
    items:[...pk.items,...extrasNombres],extras:extrasNombres,
    descontadosPaquete,fechaRegistro:Date.now(),
    asesor:getAuth(app).currentUser?.email||'',
    requerimientosPersonal,
    personalAsignado:{logistico:[],recreador:[],coordinador:[],operario:[]}
  };
  state.contratos.push(contrato);
  await guardarDatos();

  const totalArt=descontadosPaquete.length+extrasNombres.length;
  toast(`✅ Venta registrada · contrato creado con ${totalArt} artículo(s)`,'ok');
  generarPDF(contrato);
  window._ventaVariantesSel={};
  setTimeout(()=>{paqueteSeleccionado=null;renderVentasView();},1800);
};

function renderContratos(){
  const fechaFiltro=document.getElementById('contrato-fecha-filtro')?.value||'';
  let lista=[...state.contratos].sort((a,b)=>b.fechaRegistro-a.fechaRegistro);
  if(fechaFiltro){
    lista=lista.filter(c=>c.fecha===fechaFiltro);
    const btnDesc=document.getElementById('btn-descargar-todos-contratos');
    const infoEl=document.getElementById('contrato-fecha-info');
    if(btnDesc)btnDesc.style.display=lista.length?'inline-flex':'none';
    if(infoEl){infoEl.style.display='block';infoEl.textContent=lista.length?`${lista.length} contrato(s) para el ${fmtFechaContrato(fechaFiltro)}`:`Sin contratos para el ${fmtFechaContrato(fechaFiltro)}`;}
  }else{
    const btnDesc=document.getElementById('btn-descargar-todos-contratos');
    const infoEl=document.getElementById('contrato-fecha-info');
    if(btnDesc)btnDesc.style.display='none';
    if(infoEl)infoEl.style.display='none';
  }
  const cont=document.getElementById('contratos-list');
  if(!lista.length){
    cont.innerHTML='<div style="padding:48px;text-align:center;color:var(--muted);"><div style="font-size:40px;margin-bottom:12px;">📄</div><div style="font-weight:800;font-size:16px;color:var(--text);margin-bottom:6px;">Sin contratos aún</div>Registra una venta para generar el primer contrato</div>';
    return;
  }
  cont.innerHTML=lista.map(c=>{
    const autorizado=puedeEditarContrato(c);
    return`
    <div class="contrato-card">
      <div class="contrato-empresa ${c.empresa==='happy'?'ce-happy':'ce-conde'}"></div>
      <div class="contrato-info">
        <div class="contrato-cliente">${c.cliente} <span class="contrato-empresa-badge ${c.empresa==='happy'?'ceb-happy':'ceb-conde'}">${c.empresa==='happy'?'Happy Art':'Conde Eventos'}</span></div>
        <div class="contrato-meta">📅 ${fmtFechaContrato(c.fecha)} · ⏰ ${fmtHoraEvento(c)} · 🎉 ${c.paquete} · ${fmtPrecio(c.valor)}${(c.valorCatalogo&&c.valorCatalogo!==c.valor)?' <span style="color:var(--accent2);font-weight:700;">✨ precio especial</span>':''}</div>
        <div class="contrato-meta" style="margin-top:2px;">📍 ${c.barrio}, ${c.localidad} · Festejado: ${c.festejado||'—'}</div>
      </div>
      ${state.esAdmin?renderResumenPersonalContrato(c):''}
      <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">
        ${autorizado?`
        <button class="btn btn-ghost btn-sm" onclick="editarContrato(${c.id})" title="Editar contrato">✏️ Editar</button>
        <button class="btn btn-${c.empresa==='happy'?'primary':'purple'} btn-sm" onclick="descargarContratoPDF(${c.id})">⬇ PDF</button>
        <button class="btn btn-danger btn-sm" onclick="borrarContrato(${c.id})">🗑 Borrar</button>
        `:`<span style="font-size:11px;color:var(--muted);font-weight:700;white-space:nowrap;" title="Solo el asesor que registró este contrato puede editarlo, descargarlo o borrarlo">🔒 Solo el asesor titular</span>`}
        ${state.esAdmin?`<button class="btn btn-purple btn-sm" onclick="abrirProgramarPersonal(${c.id})">📋 Programar personal</button>`:''}
      </div>
    </div>`;}).join('');
}

// Pequeño resumen "X/Y asignados" por rol, visible solo para el admin en la lista de Contratos.
function renderResumenPersonalContrato(c){
  const req=c.requerimientosPersonal;
  if(!req)return'';
  const asign=c.personalAsignado||{};
  const partes=ROLES_PERSONAL.filter(r=>req[r.id]>0).map(r=>{
    const asignados=(asign[r.id]||[]).length;
    const completo=asignados>=req[r.id];
    return`<span style="${completo?'color:var(--success);':'color:var(--warn);'}font-weight:700;">${r.icon} ${asignados}/${req[r.id]}</span>`;
  });
  if(!partes.length)return'<div style="font-size:11px;color:var(--muted);margin:4px 0;">Sin personal solicitado para este evento</div>';
  return`<div style="font-size:11px;display:flex;gap:10px;flex-wrap:wrap;margin:4px 0;">${partes.join('')}</div>`;
}

// ── PROGRAMACIÓN DE PERSONAL POR CONTRATO (solo admin) ──────────────────────
let programarPersonalContratoId=null;
let programarPersonalSel=null; // {logistico:[id|null,...], recreador:[...], ...} — copia de trabajo

window.abrirProgramarPersonal=function(id){
  const c=state.contratos.find(x=>x.id===id);
  if(!c)return;
  programarPersonalContratoId=id;
  const req=c.requerimientosPersonal||{logistico:0,recreador:0,coordinador:0,operario:0};
  const asign=c.personalAsignado||{};
  programarPersonalSel={};
  for(const rol of ROLES_PERSONAL){
    const cupos=req[rol.id]||0;
    const previos=asign[rol.id]||[];
    programarPersonalSel[rol.id]=Array.from({length:cupos},(_,i)=>previos[i]??null);
  }
  document.getElementById('pp_resumen').innerHTML=`<strong>${c.cliente}</strong> — 📅 ${fmtFechaContrato(c.fecha)} · 🎉 ${c.paquete}`;
  renderProgramarPersonalBody();
  document.getElementById('programarPersonalOverlay').classList.add('open');
};

window.closeProgramarPersonal=function(){
  document.getElementById('programarPersonalOverlay').classList.remove('open');
  programarPersonalContratoId=null;programarPersonalSel=null;
};

function renderProgramarPersonalBody(){
  const cont=document.getElementById('pp_body');
  if(!cont||!programarPersonalSel)return;
  const c=state.contratos.find(x=>x.id===programarPersonalContratoId);
  if(!c)return;
  const fecha=c.fecha;
  // ids ya elegidos en CUALQUIER rol de este mismo formulario, para no repetir a la misma persona en dos cupos
  const yaElegidos=new Set(Object.values(programarPersonalSel).flat().filter(Boolean));
  let html='';
  for(const rol of ROLES_PERSONAL){
    const slots=programarPersonalSel[rol.id];
    if(!slots.length)continue;
    html+=`<div style="margin-bottom:14px;"><div style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">${rol.icon} ${rol.label} (${slots.length})</div>`;
    slots.forEach((seleccionadoId,idx)=>{
      const candidatos=state.personal.filter(p=>p.rol===rol.id);
      const opciones=candidatos.map(p=>{
        const noDisponible=!estaDisponible(p,fecha);
        const ocupadoOtroEvento=personaAsignadaEnFecha(p.id,fecha,c.id);
        const elegidoEnOtroCupo=yaElegidos.has(p.id)&&seleccionadoId!==p.id;
        const deshabilitado=noDisponible||ocupadoOtroEvento||elegidoEnOtroCupo;
        let etiqueta=p.nombre;
        if(noDisponible)etiqueta+=' — 🚫 no disponible esta fecha';
        else if(ocupadoOtroEvento)etiqueta+=' — ⚠️ ya asignado a otro evento este día';
        else if(elegidoEnOtroCupo)etiqueta+=' — ya elegido arriba';
        return`<option value="${p.id}" ${seleccionadoId===p.id?'selected':''} ${deshabilitado?'disabled':''}>${etiqueta}</option>`;
      }).join('');
      html+=`<select onchange="onCambioSlotPersonal('${rol.id}',${idx},this.value)" style="margin-bottom:6px;width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font-body);font-size:13px;">
        <option value="">— Cupo ${idx+1}: sin asignar —</option>
        ${opciones}
      </select>`;
    });
    html+='</div>';
  }
  if(!html)html='<div style="color:var(--muted);font-size:13px;">Este contrato no solicitó personal.</div>';
  cont.innerHTML=html;
}

window.onCambioSlotPersonal=function(rolId,idx,valor){
  programarPersonalSel[rolId][idx]=valor?parseInt(valor):null;
  renderProgramarPersonalBody();
};

window.guardarProgramacionPersonal=async function(){
  const c=state.contratos.find(x=>x.id===programarPersonalContratoId);
  if(!c||!programarPersonalSel)return;
  // Verificación final anti-duplicados (por si acaso) antes de guardar.
  const todos=Object.values(programarPersonalSel).flat().filter(Boolean);
  if(new Set(todos).size!==todos.length){toast('No puedes asignar la misma persona en dos cupos del mismo evento','err');return;}
  if(!c.personalAsignado)c.personalAsignado={};
  for(const rol of ROLES_PERSONAL){
    c.personalAsignado[rol.id]=programarPersonalSel[rol.id].filter(Boolean);
  }
  await guardarDatos();
  closeProgramarPersonal();
  renderContratos();
  toast('✅ Personal programado','ok');
};

window.filtrarContratosFecha=function(){
  const fecha=document.getElementById('contrato-fecha-filtro')?.value||'';
  const clearBtn=document.getElementById('contrato-fecha-clear');
  if(clearBtn)clearBtn.style.display=fecha?'inline-flex':'none';
  renderContratos();
};

window.limpiarFiltroContratos=function(){
  const inp=document.getElementById('contrato-fecha-filtro');
  if(inp)inp.value='';
  const clearBtn=document.getElementById('contrato-fecha-clear');
  if(clearBtn)clearBtn.style.display='none';
  renderContratos();
};

window.descargarTodosContratosFecha=async function(){
  const fechaFiltro=document.getElementById('contrato-fecha-filtro')?.value||'';
  if(!fechaFiltro){toast('Selecciona una fecha primero','err');return;}
  const lista=state.contratos.filter(c=>c.fecha===fechaFiltro);
  if(!lista.length){toast('No hay contratos para esta fecha','err');return;}
  toast(`Generando ${lista.length} PDF(s)...`,'ok');
  for(let i=0;i<lista.length;i++){
    await new Promise(res=>setTimeout(res,i*600));
    generarPDF(lista[i]);
  }
};

let editContratoId=null;

let ecExtrasSelected=[]; // [{prod,qty}] — artículos NUEVOS que se agregan al editar el contrato

let ecExtrasHighlight=-1;

function renderEcExtrasChips(){
  const cont=document.getElementById('ec-extras-chips');if(!cont)return;
  cont.innerHTML=ecExtrasSelected.map(e=>`
    <div class="extra-chip valid">
      <span class="extra-chip-name">${e.prod.nombre}${e.prod.sku?' · '+e.prod.sku:''} <span style="font-weight:400;color:var(--muted);font-size:11px;">(disp: ${e.prod.stock})</span></span>
      <div class="extra-chip-qty">
        <input type="number" min="1" max="${e.prod.stock}" value="${e.qty}" onchange="ecExtrasSetQty(${e.prod.id},parseInt(this.value)||1)">
        <span style="font-size:11px;color:var(--muted);">${e.prod.unidad}</span>
      </div>
      <button class="extra-chip-remove" onclick="ecExtrasRemove(${e.prod.id})">✕</button>
    </div>`).join('');
}

window.ecExtrasSearch=function(q){
  const dd=document.getElementById('ec-extras-dropdown');if(!dd)return;
  if(!q.trim()){dd.innerHTML='';dd.classList.remove('open');return;}
  const norm=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const nq=norm(q);
  const ya=new Set(ecExtrasSelected.map(e=>e.prod.id));
  const results=state.productos.filter(p=>p.stock>0&&!ya.has(p.id)&&(norm(p.nombre).includes(nq)||norm(p.cat).includes(nq)||norm(p.sku).includes(nq))).slice(0,8);
  ecExtrasHighlight=-1;
  if(!results.length){dd.innerHTML='<div style="padding:10px 14px;font-size:12px;color:var(--muted);">Sin resultados</div>';dd.classList.add('open');return;}
  dd.innerHTML=results.map((p,i)=>{const s=stockStatus(p);return`<div class="extras-dd-item" data-idx="${i}" data-id="${p.id}" onclick="ecExtrasAdd(${p.id})"><div><div class="dd-name">${p.nombre}</div><div class="dd-cat">${p.cat} · ${p.sku}</div></div><span class="dd-stock ${s}">${p.stock} ${p.unidad}</span></div>`;}).join('');
  dd.classList.add('open');
};

window.ecExtrasKeydown=function(e){
  const dd=document.getElementById('ec-extras-dropdown');
  const items=dd?.querySelectorAll('.extras-dd-item');
  if(!items?.length)return;
  if(e.key==='ArrowDown'){ecExtrasHighlight=Math.min(ecExtrasHighlight+1,items.length-1);}
  else if(e.key==='ArrowUp'){ecExtrasHighlight=Math.max(ecExtrasHighlight-1,0);}
  else if(e.key==='Enter'&&ecExtrasHighlight>=0){items[ecExtrasHighlight].click();return;}
  else if(e.key==='Escape'){dd.classList.remove('open');return;}
  items.forEach((it,i)=>it.classList.toggle('highlighted',i===ecExtrasHighlight));
};

window.ecExtrasAdd=function(prodId){
  const p=getProd(prodId);if(!p)return;
  if(!ecExtrasSelected.find(e=>e.prod.id===prodId)){ecExtrasSelected.push({prod:p,qty:1});}
  const si=document.getElementById('ec-extras-search');
  if(si){si.value='';const dd=document.getElementById('ec-extras-dropdown');if(dd){dd.innerHTML='';dd.classList.remove('open');}}
  renderEcExtrasChips();
};

window.ecExtrasRemove=function(prodId){
  ecExtrasSelected=ecExtrasSelected.filter(e=>e.prod.id!==prodId);
  renderEcExtrasChips();
};

window.ecExtrasSetQty=function(prodId,qty){
  const e=ecExtrasSelected.find(e=>e.prod.id===prodId);
  if(e)e.qty=Math.max(1,Math.min(qty,e.prod.stock));
  renderEcExtrasChips();
};

window.editarContrato=function(id){
  const c=state.contratos.find(x=>x.id===id);
  if(!c){toast('Contrato no encontrado','err');return;}
  if(!puedeEditarContrato(c)){toast('Solo el asesor que creó este contrato puede editarlo','err');return;}
  editContratoId=id;
  document.getElementById('ec_fecha').value=c.fecha||'';
  document.getElementById('ec_hora').value=c.hora||'';
  document.getElementById('ec_hora_decoracion').value=c.horaDecoracion||'';
  document.getElementById('ec_cliente').value=c.cliente||'';
  document.getElementById('ec_tel1').value=c.tel1||'';
  document.getElementById('ec_tel2').value=c.tel2||'';
  document.getElementById('ec_direccion').value=c.direccion||'';
  document.getElementById('ec_barrio').value=c.barrio||'';
  document.getElementById('ec_localidad').value=c.localidad||'';
  document.getElementById('ec_festejado').value=c.festejado||'';
  const ecReq=c.requerimientosPersonal||{logistico:0,recreador:0,coordinador:0,operario:0};
  document.getElementById('ec_pers_logistico').value=ecReq.logistico||0;
  document.getElementById('ec_pers_recreador').value=ecReq.recreador||0;
  document.getElementById('ec_pers_coordinador').value=ecReq.coordinador||0;
  document.getElementById('ec_pers_operario').value=ecReq.operario||0;
  // Renderizar selector de paquetes en el modal
  const wrap=document.getElementById('ec_paquetes_wrap');
  const isCondePurple=c.empresa==='conde';
  const ecCats=[
    {id:'cumpleanos',label:'🎂 Cumpleaños'},
    {id:'baby_shower',label:'👶 Baby Shower'},
    {id:'revelacion',label:'🎀 Revelación de Género'}
  ];
  let ecHtml='';
  for(const cat of ecCats){
    const pkgs=PAQUETES.filter(p=>p.categoria===cat.id);
    if(!pkgs.length)continue;
    ecHtml+=`<div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin:12px 0 6px;">${cat.label}</div>`;
    ecHtml+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;">';
    for(const p of pkgs){
      const sel=p.nombre===c.paquete;
      const nombreVisible=c.empresa==='conde'?p.nombreConde:p.nombreHappy;
      const duoLabel=c.empresa==='conde'
        ?`<div style="font-size:10px;color:var(--muted);font-weight:600;">${p.nombreHappy}</div>`
        :`<div style="font-size:10px;color:var(--muted);font-weight:600;">${p.nombreConde}</div>`;
      ecHtml+=`<div class="paquete-card${sel?(isCondePurple?' selected-conde':' selected'):''}" id="ecpk-${p.id}" onclick="ecSelectPaquete('${p.id}','${c.empresa}')">
        <div class="pk-name">${nombreVisible}</div>
        ${duoLabel}
        <div class="pk-price${isCondePurple?' conde':''}">${fmtPrecio(p.precio)}</div>
      </div>`;
    }
    ecHtml+='</div>';
  }
  wrap.innerHTML=ecHtml;
  // Marcar paquete actual
  const pkActual=PAQUETES.find(p=>p.nombre===c.paquete);
  if(pkActual)window._ecPkSeleccionado=pkActual.id;
  else window._ecPkSeleccionado=null;
  // Selección de variantes específicas (ej. cuál disfraz/figura): se precarga a
  // partir de lo que ya quedó guardado en c.descontadosPaquete, emparejando por
  // nombre de producto con las opciones de cada pendiente — así, si el asesor
  // solo edita otro campo (teléfono, dirección, etc.) sin tocar el paquete, no
  // se le exige reconfirmar variantes que ya estaban correctamente elegidas.
  window._ecVariantesSel=pkActual?_precargarVariantesDesdeContrato(pkActual,c.descontadosPaquete||[]):{};
  window._ecDescontadosOriginal=c.descontadosPaquete||[];
  if(pkActual)renderVariantesPaqueteWrap(pkActual,'ec-variantes-wrap','ecVariantesSetProd',window._ecVariantesSel);
  // Precargar valor del paquete: se muestra el valor real del contrato (puede ya
  // tener un descuento aplicado), y se guarda el precio de catálogo del paquete
  // actual como referencia para saber si difiere (mostrar el aviso de precio especial).
  window._ecValorPaqueteOriginal=pkActual?pkActual.precio:(c.valor||0);
  const ecValorInput=document.getElementById('ec_valor_paquete');
  if(ecValorInput)ecValorInput.value=fmt(c.valor||(pkActual?pkActual.precio:0));
  actualizarBadgeValorPaquete('ec_valor_paquete','ec-valor-paquete-badge',window._ecValorPaqueteOriginal);
  // Reiniciar selector de artículos adicionales NUEVOS
  ecExtrasSelected=[];
  renderEcExtrasChips();
  const ecSearchInput=document.getElementById('ec-extras-search');
  if(ecSearchInput)ecSearchInput.value='';
  // Mostrar los extras ya guardados del contrato para que el usuario pueda eliminarlos
  const extrasActualesDiv=document.getElementById('ec-extras-actuales');
  if(extrasActualesDiv){
    const extrasGuardados=c.extras||[];
    if(extrasGuardados.length){
      extrasActualesDiv.innerHTML=`<div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin:10px 0 6px;">Adicionales ya en el contrato</div>`+
        extrasGuardados.map((nombre,idx)=>`<div class="extra-chip" style="background:#f3f0eb;border:1.5px solid #e8e2d9;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-radius:8px;">
          <span style="font-size:13px;font-weight:600;">${nombre}</span>
          <button class="extra-chip-remove" onclick="borrarExtraExistente(${c.id},${idx})" title="Eliminar este adicional" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:14px;font-weight:800;line-height:1;">✕</button>
        </div>`).join('');
    }else{
      extrasActualesDiv.innerHTML='<div style="font-size:12px;color:var(--muted);padding:6px 0;">Sin adicionales registrados en este contrato.</div>';
    }
  }
  document.getElementById('editContratoOverlay').classList.add('open');
};

window.ecSelectPaquete=function(pkId,empresa){
  window._ecPkSeleccionado=pkId;
  document.querySelectorAll('[id^="ecpk-"]').forEach(el=>{el.classList.remove('selected','selected-conde');});
  const card=document.getElementById('ecpk-'+pkId);
  if(card)card.classList.add(empresa==='conde'?'selected-conde':'selected');
  // Al cambiar de paquete, el valor por defecto pasa a ser el precio de catálogo
  // del nuevo paquete (el asesor puede volver a editarlo si aplica descuento)
  const nuevoPk=PAQUETES.find(p=>p.id===pkId);
  if(nuevoPk){
    window._ecValorPaqueteOriginal=nuevoPk.precio;
    const ecValorInput=document.getElementById('ec_valor_paquete');
    if(ecValorInput)ecValorInput.value=fmt(nuevoPk.precio);
    actualizarBadgeValorPaquete('ec_valor_paquete','ec-valor-paquete-badge',nuevoPk.precio);
    window._ecVariantesSel={};
    renderVariantesPaqueteWrap(nuevoPk,'ec-variantes-wrap','ecVariantesSetProd');
  }
};

window.ecVariantesSetProd=function(encodedKey,prodId){
  const key=decodeURIComponent(encodedKey);
  if(!window._ecVariantesSel)window._ecVariantesSel={};
  if(prodId)window._ecVariantesSel[key]=Number(prodId);
  else delete window._ecVariantesSel[key];
};

window.closeEditContrato=function(){document.getElementById('editContratoOverlay').classList.remove('open');editContratoId=null;window._ecPkSeleccionado=null;window._ecVariantesSel={};};

window.borrarExtraExistente=function(contratoId,idx){
  const c=state.contratos.find(x=>x.id===contratoId);
  if(!c)return;
  const nombre=c.extras?.[idx];
  if(!nombre)return;
  if(!confirm(`¿Eliminar el adicional "${nombre}" de este contrato?`))return;
  c.extras.splice(idx,1);
  // También quitarlo de items si estaba ahí
  const itemIdx=c.items?c.items.lastIndexOf(nombre):-1;
  if(itemIdx>=0)c.items.splice(itemIdx,1);
  // Refrescar la lista de extras actuales en el modal
  const extrasActualesDiv=document.getElementById('ec-extras-actuales');
  if(extrasActualesDiv){
    const extrasGuardados=c.extras||[];
    if(extrasGuardados.length){
      extrasActualesDiv.innerHTML=`<div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin:10px 0 6px;">Adicionales ya en el contrato</div>`+
        extrasGuardados.map((n,i)=>`<div class="extra-chip" style="background:#f3f0eb;border:1.5px solid #e8e2d9;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-radius:8px;">
          <span style="font-size:13px;font-weight:600;">${n}</span>
          <button class="extra-chip-remove" onclick="borrarExtraExistente(${contratoId},${i})" title="Eliminar este adicional" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:14px;font-weight:800;line-height:1;">✕</button>
        </div>`).join('');
    }else{
      extrasActualesDiv.innerHTML='<div style="font-size:12px;color:var(--muted);padding:6px 0;">Sin adicionales registrados en este contrato.</div>';
    }
  }
};

window.guardarEdicionContrato=async function(){
  const c=state.contratos.find(x=>x.id===editContratoId);
  if(!c)return;
  if(!puedeEditarContrato(c)){toast('Solo el asesor que creó este contrato puede editarlo','err');return;}
  const ecTel1=document.getElementById('ec_tel1').value.trim();
  const ecTel2=document.getElementById('ec_tel2').value.trim();
  if(!telefonoValido(ecTel1)){
    toast('El teléfono 1 debe tener exactamente 10 dígitos (ej: 3102112655)','err');return;
  }
  if(!telefonoValido(ecTel2)){
    toast('El teléfono 2 debe tener exactamente 10 dígitos (ej: 3102112655)','err');return;
  }
  c.fecha=document.getElementById('ec_fecha').value;
  c.hora=document.getElementById('ec_hora').value;
  c.horaDecoracion=document.getElementById('ec_hora_decoracion').value;
  c.cliente=document.getElementById('ec_cliente').value.trim()||c.cliente;
  c.tel1=ecTel1;
  c.tel2=ecTel2;
  c.direccion=document.getElementById('ec_direccion').value.trim();
  c.barrio=document.getElementById('ec_barrio').value.trim();
  c.localidad=document.getElementById('ec_localidad').value.trim();
  c.festejado=document.getElementById('ec_festejado').value.trim();
  const nuevoReq={
    logistico:parseInt(document.getElementById('ec_pers_logistico')?.value)||0,
    recreador:parseInt(document.getElementById('ec_pers_recreador')?.value)||0,
    coordinador:parseInt(document.getElementById('ec_pers_coordinador')?.value)||0,
    operario:parseInt(document.getElementById('ec_pers_operario')?.value)||0
  };
  c.requerimientosPersonal=nuevoReq;
  if(!c.personalAsignado)c.personalAsignado={logistico:[],recreador:[],coordinador:[],operario:[]};
  // Si el asesor bajó la cantidad requerida por debajo de lo ya programado por
  // el admin, se recorta el sobrante para que la programación nunca quede por
  // encima del nuevo límite.
  let recorte=false;
  for(const rol of ROLES_PERSONAL){
    const asignados=c.personalAsignado[rol.id]||[];
    if(asignados.length>nuevoReq[rol.id]){
      c.personalAsignado[rol.id]=asignados.slice(0,nuevoReq[rol.id]);
      recorte=true;
    }
  }
  if(recorte)toast('⚠️ Se ajustó el personal ya programado al nuevo límite solicitado','warn');
  // Actualizar paquete si cambió
  let pkRef=PAQUETES.find(p=>p.nombre===c.paquete);
  if(window._ecPkSeleccionado){
    const pk=PAQUETES.find(p=>p.id===window._ecPkSeleccionado);
    if(pk){
      c.paquete=pk.nombre;
      c.items=pk.items;
      pkRef=pk;
      // Recalcular qué materiales del nuevo paquete coinciden con inventario,
      // respetando cantidades exactas y variantes específicas elegidas por el
      // asesor (ver ESPECIFICACION_ITEMS_PAQUETE / resolverItemsPaqueteInventario),
      // para que el reporte por fecha (Calendario) siga siendo preciso tras el cambio.
      const{resueltos,faltanVariante}=resolverItemsPaqueteInventario(pk,window._ecVariantesSel);
      if(faltanVariante.length){
        toast(`Falta especificar: ${faltanVariante.join(', ')}`,'err');return;
      }
      c.descontadosPaquete=resueltos;
    }
  }
  // Valor del paquete: se respeta lo que haya en el campo (puede ser el precio de
  // catálogo o un valor especial con descuento que el asesor haya colocado)
  const valorEcInput=parsePrecioInput(document.getElementById('ec_valor_paquete')?.value||'');
  if(valorEcInput>0){
    c.valor=valorEcInput;
    c.valorCatalogo=pkRef?pkRef.precio:c.valorCatalogo;
  }
  // Artículos adicionales nuevos pedidos por el cliente al editar el contrato
  // (ej: "ahora también quiero una crispetera") — se registran igual que un
  // extra de venta normal, pero el inventario es ESTÁTICO: no se descuenta stock.
  const nuevosExtrasNombres=[];
  for(const sel of ecExtrasSelected){
    const prod=getProd(sel.prod.id);
    const qty=sel.qty||1;
    if(!prod)continue;
    const nombreUp=prod.nombre.trim().toUpperCase();
    const esVarianteIdentificable=nombreUp.startsWith('LETRA LUMINOSA')||nombreUp.startsWith('LETRA GLOBO')||nombreUp.startsWith('NUMERO LUMINOSO');
    const etiqueta=esVarianteIdentificable&&prod.sku?`${prod.nombre} (${prod.sku})`:prod.nombre;
    for(let n=0;n<qty;n++)nuevosExtrasNombres.push(etiqueta);
  }
  if(nuevosExtrasNombres.length){
    c.items=[...(c.items||[]),...nuevosExtrasNombres];
    c.extras=[...(c.extras||[]),...nuevosExtrasNombres];
  }
  await guardarDatos();
  closeEditContrato();
  renderContratos();
  renderTabla();
  toast('Contrato actualizado ✅ — descargando PDF actualizado...','ok');
  // El contrato editado es el mismo que se le envía al cliente, así que se
  // vuelve a descargar automáticamente con los cambios ya aplicados.
  generarPDF(c);
};

window.borrarContrato=async function(id){
  const c=state.contratos.find(x=>x.id===id);
  if(!c){toast('Contrato no encontrado','err');return;}
  if(!puedeEditarContrato(c)){toast('Solo el asesor que creó este contrato puede borrarlo','err');return;}
  if(!confirm('¿Seguro que quieres borrar este contrato? Esta acción no se puede deshacer.'))return;
  state.contratos=state.contratos.filter(x=>x.id!==id);
  await guardarDatos();
  renderContratos();
  toast('🗑 Contrato eliminado','ok');
};

function generarPDF(c){
  const esHappy=c.empresa==='happy';
  const colorEmpresa=esHappy?'#e8622a':'#7c5cbf';
  const nombreEmpresa=esHappy?'HAPPY ART EVENTOS':'CONDE EVENTOS';
  const nitHappy='NIT - 901757930';
  const mediosPagoHappy='Nequi: 310-407-5240 &nbsp;&nbsp; Daviplata: 310-407-5240 &nbsp;&nbsp; Bancolombia: 567.480.914-11';
  const mediosPagoConde='Nequi: 312-354-7384 &nbsp;&nbsp; Daviplata: 312-354-7384 &nbsp;&nbsp; Bancolombia: 650.000196-28';
  const condiciones=`El cliente deberá realizar el pago del valor estipulado en el contrato antes de dar inicio a la celebración y/o animación. Una vez el coordinador llegue al lugar del evento, se otorgará un tiempo máximo de espera de 30 minutos para iniciar la celebración. Después de este tiempo, comenzará a correr el tiempo contratado, independientemente de si el evento ha iniciado o no. En caso de que el cliente desee tiempo adicional de animación, este tendrá los siguientes costos: Hora extra diurna: $25.000 por coordinador. Hora extra nocturna: $50.000 por coordinador. El cliente acepta que las personas que firmen la presente factura cuentan con autorización para hacerlo y actúan como representantes del contratante, quien se hace responsable del pago total del servicio. La presente factura se asimila en todos sus efectos legales a una letra de cambio, conforme a los artículos 774 al 779 del Código de Comercio.`;
  const nota='Toda celebración que finalice después de las 8:00 p.m. tendrá un recargo adicional de $30.000 por concepto de transporte y recargo nocturno.';
  const telefonos=[c.tel1,c.tel2].filter(Boolean).join(' - ');
  const itemsHTML=(c.items||[]).map(i=>`<li><span class="chk">✔</span><span>${i}</span></li>`).join('');

  const fechaPartes=c.fecha?c.fecha.split('-'):['','',''];
  const mesesNombre=['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const diaNombre=fechaPartes[2]?parseInt(fechaPartes[2]).toString():'';
  const mesNombre=fechaPartes[1]?mesesNombre[parseInt(fechaPartes[1])-1]:'';
  const nombreCliente=(c.cliente||'CLIENTE').toUpperCase().replace(/\s+/g,' ').trim();
  const nombreArchivo=`CONTRATO ${diaNombre} DE ${mesNombre} ${nombreCliente}.pdf`;

  // Logos en base64
  const HAPPY_LOGO_B64='data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAB4BQADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKA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kHqDS0UAIAFGAAB6CloooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAayK/3lVvqM1DBY2ltI8kFrBE7/AHmjjClvqR1qxRQAUUUUAFFFFABSYGelLRQAUUUUAFFFFABRRRQAUUUUAFU7vStOv123dhbXA/6axK38xVyigDlbj4d+G5yWSye3Y94JWX9M4rGvfhZC4zYaxcxf7M6LIPzG0/zr0OipcYvdCaTOU8F+EpPDEd41zPFPcXDr88akAKo4HPuTXV0UU0rDCiiimAUUUUAFFFFABRRRQAUUUUAQzWtvcrtngilHpIgb+dUx4f0UNvGkWAbrn7Mmf5VpUUAMjijiXbGioo7KMCn0UUAFFFFABTWjR/vIrfUU6igCL7NBnPkx59dopwijU5WNR9AKfRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQBgjwb4d+1SXT6TbSTSOXYyrvBJOTweK17eztrSPy7a3hhT+7GgUfkKKKVkBPRRRTAKKKKACiiigCte2dvqNnLZ3UYkglXa6E9RWbaeEfD1kQYdHsww6M8Qcj8WzRRRYDYRERQqKqgDAAGMU+iigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9k=';
  const HAPPY_BG_B64='data:image/jpeg;base64,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';
  const CONDE_LOGO_B64='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAACxIAAAsSAdLdfvwAAP+lSURBVHhe7F0FeFbH2oTg7u7u7lIoVqSluNOWllKgToWWAsXd3R0SCCEhCXESggV3iltxKrhEd/55N9/mfs0PLVTube/deZ559uiePbI7s3v27EliYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFh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KBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQ/Ldwyy3/B7iSVClvE4abAAAAAElFTkSuQmCC';

  const headerHTML=esHappy
    ?`<div style="text-align:center;margin-bottom:16px;padding-bottom:10px;border-bottom:3px solid ${colorEmpresa};">
        <img src="${HAPPY_LOGO_B64}" style="max-height:60px;width:auto;display:block;margin:0 auto 6px;" alt="Happy Art Eventos">
        <div style="font-size:10pt;color:#555;font-weight:700;">NIT - 901757930</div>
      </div>`
    :`<div style="text-align:center;margin-bottom:16px;padding-bottom:10px;border-bottom:3px solid ${colorEmpresa};">
        <img src="${CONDE_LOGO_B64}" style="max-height:80px;width:auto;display:block;margin:0 auto;" alt="Conde Eventos">
      </div>`;

  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>CONTRATO ${diaNombre} DE ${mesNombre} ${nombreCliente}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    @page{size:letter;margin:14mm 16mm 14mm 16mm;}
    html,body{width:816px;}
    /* El centrado real del contenido lo provee el wrapper interno
       (width:744px;margin:0 auto) justo después de <body>, que es más
       confiable que depender de @page (ignorado por html2canvas) o de
       padding en el body. Esto evita que el contenido quede pegado al
       borde izquierdo de la captura usada para generar el PDF. */
    body{font-family:Arial,sans-serif;font-size:10.5pt;color:#222;line-height:1.5;background:#fff;padding:0 36px;}

    /* ── HEADER ── */
    .header{text-align:center;padding-bottom:10px;margin-bottom:14px;border-bottom:3px solid ${colorEmpresa};}
    .header img{max-height:65px;width:auto;display:block;margin:0 auto 4px;}
    .header .nit{font-size:9.5pt;color:#555;font-weight:700;margin-top:4px;}

    /* ── TÍTULO SECCIÓN ── */
    .titulo{font-size:12.5pt;font-weight:900;text-align:center;background:${colorEmpresa};color:#fff;
             padding:7px 12px;border-radius:6px;margin:12px 0 0;letter-spacing:0.5px;text-transform:uppercase;}

    /* ── TABLA INFO CLIENTE ── */
    .info-header{background:${colorEmpresa};color:#fff;font-weight:800;font-size:9.5pt;
                  text-align:center;padding:5px 10px;margin-bottom:0;}
    table.info-table{width:100%;border-collapse:collapse;margin-bottom:12px;margin-top:0;}
    table.info-table td{padding:5px 10px;border:1px solid #ccc;font-size:10pt;vertical-align:middle;}
    table.info-table tr td:first-child{font-weight:800;width:40%;background:#f5f5f5;color:#444;font-size:9.5pt;text-transform:uppercase;}
    table.info-table tr:last-child td{border-bottom:1px solid #ccc;}

    /* ── CONDICIONES ── */
    .cond-box{border:1.5px solid ${colorEmpresa};border-radius:6px;padding:9px 13px;margin:10px 0;
               font-size:8.8pt;background:#fafafa;line-height:1.55;}
    .cond-title{font-weight:900;color:${colorEmpresa};margin-bottom:6px;font-size:9.5pt;display:block;}
    .nota-box{border:1.5px solid #d4ac00;background:#fffce6;border-radius:6px;
               padding:7px 12px;margin:8px 0;font-size:8.8pt;}

    /* ── FIRMAS ── */
    .firmas{display:flex;justify-content:space-around;align-items:flex-end;
             margin:24px 0 14px;text-align:center;}
    .firma-bloque{text-align:center;}
    .firma-linea{border-top:1.5px solid #333;width:200px;margin:0 auto;padding-top:6px;
                  font-size:9pt;color:#444;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;}

    /* ── MEDIOS DE PAGO ── */
    .medios{text-align:center;margin-top:10px;padding:8px 12px;background:#f3f3f3;
             border-radius:6px;font-size:9pt;color:#333;}
    .medios b{color:${colorEmpresa};}

    /* ── SALTO DE PÁGINA ── */
    .page-break{padding-top:14px;}

    /* ── EVITAR CORTES EN TABLAS E IMÁGENES ── */
    table{width:100%;border-collapse:collapse;page-break-inside:avoid;}
    tr{page-break-inside:avoid;}
    td{page-break-inside:avoid;}
    img{max-width:100%;display:block;page-break-inside:avoid;}

    /* ── LISTA PAQUETE ── */
    .pk-intro{font-size:9.5pt;color:#555;margin:8px 0 12px;}
    .paquete-items{list-style:none;padding:0;margin:0;}
    .paquete-items li{display:flex;align-items:flex-start;gap:9px;padding:5px 8px;
                       border-bottom:1px solid #eee;font-size:9.8pt;}
    .paquete-items li:last-child{border-bottom:none;}
    .paquete-items li:nth-child(even){background:#f9f9f9;}
    .paquete-items li{page-break-inside:avoid;break-inside:avoid;}
    .chk{color:#22a55a;font-size:13pt;line-height:1.1;flex-shrink:0;font-weight:900;}

    /* ── ENCUESTA ── */
    .enc-intro{font-size:9pt;color:#555;margin:8px 0 10px;}
    table.enc-table{width:100%;border-collapse:collapse;border:1.5px solid #ddd;border-radius:6px;overflow:hidden;}
    .enc-table thead tr{background:${colorEmpresa};}
    .enc-table thead td{color:#fff;font-weight:800;font-size:9pt;padding:7px 12px;}
    .enc-table tbody tr:nth-child(even){background:#f7f7f7;}
    .enc-table tbody td{padding:6px 12px;border-bottom:1px solid #eee;font-size:9.3pt;vertical-align:middle;}
    .enc-table tbody tr:last-child td{border-bottom:none;}
    .enc-nums{display:flex;gap:5px;justify-content:flex-end;flex-shrink:0;}
    .enc-num{width:24px;height:24px;border:1.5px solid #bbb;border-radius:4px;display:inline-flex;
              align-items:center;justify-content:center;font-size:8.5pt;font-weight:800;color:#666;}
    .enc-open-line{border-bottom:1.5px solid #aaa;margin-top:20px;width:100%;}
    .enc-asesor{font-size:9pt;padding-top:6px;}
  </style></head><body>

  <!-- PÁGINA 1: CONTRATO -->
  ${headerHTML}
  <div class="titulo">${(()=>{const pk=PAQUETES.find(x=>x.nombre===c.paquete||x.nombreHappy===c.paquete||x.nombreConde===c.paquete);if(!pk)return'Paquete de Evento';if(pk.categoria==='baby_shower')return'Paquete Baby Shower';if(pk.categoria==='revelacion')return'Revelación de Género';return'Paquete de Cumpleaños';})()}</div>
  <div class="info-header">INFORMACIÓN DEL CLIENTE</div>
  <table class="info-table">
    <tr><td>Fecha del Evento</td><td>${fmtFechaContrato(c.fecha)}</td></tr>
    <tr><td>Hora del Evento</td><td>${fmtHoraEvento(c)}</td></tr>
    <tr><td>Cliente</td><td><strong>${c.cliente.toUpperCase()}</strong></td></tr>
    <tr><td>Festejado</td><td><strong>${(c.festejado||'—').toUpperCase()}</strong></td></tr>
    <tr><td>Teléfono</td><td>${telefonos}</td></tr>
    <tr><td>Dirección</td><td>${c.direccion}</td></tr>
    <tr><td>Barrio</td><td>${c.barrio}</td></tr>
    <tr><td>Localidad</td><td>${c.localidad}</td></tr>
    <tr><td>Tipo de Paquete</td><td><strong>${c.paquete}</strong></td></tr>
    <tr><td>Valor del Paquete</td><td><strong style="color:${colorEmpresa};font-size:12pt;">${fmtPrecio(c.valor)}</strong>${(c.valorCatalogo&&c.valorCatalogo!==c.valor)?` <span style="font-size:9pt;color:#888;">(precio de catálogo: ${fmtPrecio(c.valorCatalogo)})</span>`:''}</td></tr>
    <tr><td>Asesor</td><td>${c.asesor||'—'}</td></tr>
  </table>

  <div class="cond-box">
    <span class="cond-title">📌 Condiciones del Servicio</span>
    ${condiciones}
  </div>
  <div class="nota-box"><strong>📌 Nota:</strong> ${nota}</div>

  <div class="firmas">
    <div class="firma-bloque"><div class="firma-linea">Firma Coordinador</div></div>
    <div class="firma-bloque"><div class="firma-linea">Firma Cliente</div></div>
  </div>
  <div class="medios"><b>Medios de pago:</b> ${esHappy?mediosPagoHappy:mediosPagoConde}</div>

  <!-- PÁGINA 2: CONTENIDO DEL PAQUETE -->
  <div class="page-break" id="pdf-page-2">
    ${headerHTML}
    <div class="titulo">Contenido del Paquete: ${c.paquete}</div>
    <p class="pk-intro">Para mayor seguridad de su paquete contratado y que todo salga bien, le informamos el contenido del paquete seleccionado:</p>
    <ul class="paquete-items">${itemsHTML}</ul>
  </div>

  <!-- PÁGINA 3: ENCUESTA -->
  <div class="page-break" id="pdf-page-3">
    ${headerHTML}
    <div class="titulo">Encuesta de Satisfacción</div>
    <p class="enc-intro">Al finalizar el evento, te invitamos a calificar tu experiencia de <strong>1 a 5</strong>, siendo 1 la puntuación más baja y 5 la más alta. ¡Tu opinión es muy importante para nosotros!</p>
    <table class="enc-table">
      <thead><tr>
        <td style="width:65%;">Pregunta</td>
        <td style="text-align:right;width:35%;">Calificación</td>
      </tr></thead>
      <tbody>
        <tr><td>¿Qué tan probable es que recomiende nuestros servicios?</td><td><div class="enc-nums"><span class="enc-num">1</span><span class="enc-num">2</span><span class="enc-num">3</span><span class="enc-num">4</span><span class="enc-num">5</span></div></td></tr>
        <tr><td>¿Qué tan satisfecho se siente con el servicio?</td><td><div class="enc-nums"><span class="enc-num">1</span><span class="enc-num">2</span><span class="enc-num">3</span><span class="enc-num">4</span><span class="enc-num">5</span></div></td></tr>
        <tr><td>¿Cómo califica el desempeño del coordinador?</td><td><div class="enc-nums"><span class="enc-num">1</span><span class="enc-num">2</span><span class="enc-num">3</span><span class="enc-num">4</span><span class="enc-num">5</span></div></td></tr>
        <tr><td>¿El coordinador fue puntual?</td><td><div class="enc-nums"><span class="enc-num">1</span><span class="enc-num">2</span><span class="enc-num">3</span><span class="enc-num">4</span><span class="enc-num">5</span></div></td></tr>
        <tr><td colspan="2">
          <strong>¿Te gustaría algo diferente en tu próxima ocasión? ¡Cuéntanos!</strong>
          <div class="enc-open-line"></div>
        </td></tr>
        <tr><td colspan="2">
          <strong>¿Qué cree que podemos mejorar para ofrecer un buen servicio?</strong>
          <div class="enc-open-line"></div>
        </td></tr>
        <tr><td colspan="2" class="enc-asesor"><strong>Asesor:</strong> ${c.asesor||'—'}</td></tr>
      </tbody>
    </table>
    <div class="medios" style="margin-top:14px;"><b>Medios de pago:</b> ${esHappy?mediosPagoHappy:mediosPagoConde}</div>
  </div>

  </body></html>`;

  // ── Generar PDF usando DIV oculto (más estable que iframe) ──
  toast('⏳ Generando PDF...','ok');

  const overlay=document.createElement('div');
  // Fondo 100% opaco (no rgba): el contenedor real del PDF se renderiza a la
  // vista (ver más abajo) para que html2canvas lo capture de forma confiable,
  // así que este overlay tiene que taparlo por completo — con transparencia
  // se alcanzaba a ver un parpadeo del contenido sin estilos por debajo.
  overlay.style.cssText='position:fixed;inset:0;background:#000000;z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML='<div style="background:#fff;border-radius:12px;padding:28px 36px;text-align:center;font-family:Nunito,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.2);"><div style="font-size:32px;margin-bottom:10px;">📄</div><div style="font-weight:800;font-size:15px;margin-bottom:6px;">Generando PDF...</div><div style="color:#888;font-size:13px;">Por favor espera un momento</div></div>';
  document.body.appendChild(overlay);

  // Crear DIV temporal EN PANTALLA (0,0), tapado por el overlay opaco de
  // arriba — no usar left:-9999px ni visibility:hidden:
  // 1) visibility:hidden es un bug conocido de html2canvas: captura el
  //    canvas en blanco cuando el elemento o un ancestro lo tiene.
  // 2) left:-9999px (posición fuera del viewport) resultó poco confiable en
  //    producción: según el tamaño/zoom real del navegador del usuario,
  //    html2canvas terminaba capturando solo una franja del contenido
  //    (contrato "cortado a la mitad"), aunque en las pruebas locales con
  //    varios tamaños de viewport no se logró reproducir siempre. Renderizar
  //    en (0,0) real, sin trasladar coordenadas, es el patrón más robusto.
  // IMPORTANTE: el elemento que se le pasa a html2pdf/html2canvas (contenedor)
  // NO puede tener position:absolute/fixed con altura automática — html2canvas
  // lo mide como altura 0 dentro de su clon interno y el PDF sale en blanco.
  // Por eso el position:fixed va en un wrapper EXTERNO (que solo tapa/ubica en
  // pantalla) y contenedor, el que realmente se captura, queda en flujo
  // normal (position:static) dentro de ese wrapper.
  const wrapperVisual=document.createElement('div');
  wrapperVisual.style.cssText='position:fixed;left:0;top:0;width:816px;z-index:9998;pointer-events:none;';
  const contenedor=document.createElement('div');
  contenedor.innerHTML=html;
  wrapperVisual.appendChild(contenedor);
  document.body.appendChild(wrapperVisual);

  (async()=>{
    try{
      const el=contenedor;

      // 1. Esperar dos frames de animación
      await new Promise(r=>requestAnimationFrame(r));
      await new Promise(r=>requestAnimationFrame(r));
      // 2. Esperar que carguen imágenes
      const imagenes=[...el.querySelectorAll('img')];
      await Promise.all(imagenes.map(img=>{
        if(img.complete)return Promise.resolve();
        return new Promise(resolve=>{img.onload=resolve;img.onerror=resolve;});
      }));
      // 3. Esperar fuentes
      if(document.fonts&&document.fonts.ready)await document.fonts.ready;
      // 4. Pequeña pausa extra para asegurar renderizado
      await new Promise(r=>setTimeout(r,500));

      const MARGEN_MM=4;
      const opt={
        margin:[MARGEN_MM,MARGEN_MM,MARGEN_MM,MARGEN_MM],
        filename:nombreArchivo,
        image:{type:'jpeg',quality:0.97},
        // Sin scrollX/scrollY/windowWidth/windowHeight: con el contenedor
        // en (0,0) real (ver más arriba) html2canvas ya calcula solo el
        // recorte correcto a partir de la posición real en pantalla —
        // forzar esos valores fue lo que causaba el corte horizontal.
        html2canvas:{
          scale:2,
          useCORS:true,
          letterRendering:true,
          logging:false
        },
        jsPDF:{unit:'mm',format:'letter',orientation:'portrait'},
        // 'avoid-all' trata contenedores completos (como la lista de ítems del
        // paquete) como un bloque indivisible y los manda enteros a la página
        // siguiente si no caben — con paquetes grandes eso deja páginas casi
        // vacías. before:[...] fuerza el salto exacto antes de cada sección
        // (Contenido del Paquete / Encuesta); page-break-inside:avoid en los
        // <li> ya evita que se corte un ítem individual a la mitad.
        pagebreak:{mode:['css'],before:['#pdf-page-2','#pdf-page-3']}
      };

      await html2pdf().set(opt).from(el).save();
      document.body.removeChild(wrapperVisual);
      document.body.removeChild(overlay);
      toast('✅ PDF descargado correctamente','ok');
    }catch(err){
      console.error('Error PDF:',err);
      if(document.body.contains(wrapperVisual))document.body.removeChild(wrapperVisual);
      document.body.removeChild(overlay);
      toast('❌ Error al generar PDF','err');
    }
  })();
}

window.generarPDF=generarPDF;
// Wrapper expuesto en window: el botón de "PDF" en Contratos dispara este onclick
// desde HTML insertado por innerHTML, que corre en el scope global del navegador,
// no dentro de este módulo — por eso no puede referenciar state.contratos
// directamente y necesita esta función intermedia que sí vive en el módulo.
window.descargarContratoPDF=function(id){
  const c=state.contratos.find(x=>x.id===id);
  if(c)generarPDF(c);
};

window.showView=function(v){
  document.querySelectorAll('.view').forEach(e=>e.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(e=>e.classList.remove('active'));
  const vEl=document.getElementById('view-'+v);
  const nEl=document.getElementById('nav-'+v);
  if(vEl)vEl.classList.add('active');
  if(nEl)nEl.classList.add('active');
  const handlers={
    dashboard:renderDashboard,
    productos:()=>{
      const si=document.getElementById('searchInput');const fe=document.getElementById('filterEvento');const fs=document.getElementById('filterStock');
      if(si)si.value='';if(fe)fe.value='';if(fs)fs.value='';
      // NO resetear invFechaFiltro — se mantiene para que el usuario no tenga que volver a ponerla
      renderCatFilter();renderTabla();
      setTimeout(()=>{
        const s=document.getElementById('searchInput');const c=document.getElementById('filterCat');
        const ev=document.getElementById('filterEvento');const st=document.getElementById('filterStock');
        const fd=document.getElementById('invFechaFiltro');
        if(s)s.oninput=()=>renderTabla();if(c)c.onchange=()=>renderTabla();
        if(ev)ev.onchange=()=>renderTabla();if(st)st.onchange=()=>renderTabla();
        // Re-enganchar evento de fecha para garantizar disparo inmediato
        if(fd){fd.onchange=()=>renderTabla();fd.oninput=()=>renderTabla();}
      },50);
    },
    movimientos:renderMovimientos,
    prestamos:()=>{renderPrestamos();},
    alertas:renderAlertas,
    ventas:renderVentasView,
    contratos:renderContratos,
    calendario:renderCalendario,
    personal:renderPersonal
  };
  if(handlers[v])handlers[v]();
  closeSidebar();
};

window.toggleSidebar=function(){
  const sb=document.querySelector('.sidebar');
  const ov=document.getElementById('sidebarOverlay');
  sb.classList.toggle('open');
  ov.classList.toggle('open');
};

window.closeSidebar=function(){
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
};

window.toast=function(msg,type='ok'){const icons={ok:'✅',warn:'⚠️',err:'❌'};document.getElementById('toast-icon').textContent=icons[type]||'✅';document.getElementById('toast-msg').textContent=msg;const el=document.getElementById('toast');el.className='show';clearTimeout(_tt);_tt=setTimeout(()=>el.className='',3500);};
