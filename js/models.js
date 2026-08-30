// ── models.js ─────────────────────────────────────────────────────────────
// Estado compartido de la aplicación y helpers puros de dominio (sin DOM ni Firebase).

export const state = {
  productos: [],
  movimientos: [],
  prestamos: [],
  nextId: 27,
  nextMovId: 17,
  nextPrestId: 8,
  editId: null,
  esAdmin: false,
  esAsesor: false,
  contratos: [],
  nextContratoId: 1,
  contabAjustes: {},
};

export const ROLES={
  ADMIN_EMAILS:[
    'admin@happyarteventos.com'
  ],
  ASESOR_EMAILS:[
    'asesor@test.com',
    'brayang@asesoreventos.com',
    'eduardv@asesoreventos.com'
  ],
  BODEGA_EMAILS:[
    'jennyer@happyarteventos.com'
  ]
};

export function obtenerRol(email){
  const e=(email||'').toLowerCase().trim();
  if(!e)return null;
  if(ROLES.ADMIN_EMAILS.includes(e))return'admin';
  if(ROLES.ASESOR_EMAILS.includes(e))return'asesor';
  if(ROLES.BODEGA_EMAILS.includes(e))return'bodega';
  return null;
}

export function getProd(id){return state.productos.find(p=>p.id===id);}

export function telefonoValido(valor){
  if(!valor)return true;
  return /^[0-9]{10}$/.test(valor);
};

export function stockStatus(p){if(p.stock===0)return'out';if(p.stock<=p.min)return'low';return'ok';}

export function statusBadge(p){const s=stockStatus(p);if(s==='out')return'<span class="badge badge-out">❌ Agotado</span>';if(s==='low')return'<span class="badge badge-low">⚠️ Stock bajo</span>';return'<span class="badge badge-ok">✅ Disponible</span>';}

export function catClass(cat){return'bc-'+cat.toLowerCase().replace(/\s*\/\s*/g,'---').replace(/\s+/g,'-');}

export function eventoBadge(ev){if(ev==='Social')return'<span class="badge-ev bev-social">🎊 Social</span>';if(ev==='Empresarial')return'<span class="badge-ev bev-empresarial">💼 Empresarial</span>';return'<span class="badge-ev bev-ambos">✨ Ambos</span>';}

export function fmt(n){return Number(n).toLocaleString('es-CO');}

export function fmtDate(d){return new Date(d).toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'});}

export function fmtFecha(d){return new Date(d).toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}

export const MESES_CORTOS=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

export const RECUPERABLES_KEYWORDS=[
  'taller de payaso',                  // por el traje de payaso
  'musica via bluetooth',              // por la cabina de sonido
  'show de titeres',                   // por los títeres y teatrino
  'personaje gigante',
  'pintucaritas neon',
  'pistola de burbujas',
  'cabina de sonido',
  'luces ritmicas',
  'camara de humo',
  'inflable 2x2',
  'inflable edades maximo 5 anos',
  'backing con fondo a escoger',
  '3 cilindros color tematica',
  '2 estructuras metalicas',
  'nombre del nino luminoso',
  'numero luminoso',
  'figura mdf tematica',
  'tapete de peluche',
  'backing con fondo a escoger neon',
  '3 cilindros neon',
  'obsequio: personaje gigante tematico',
  'estructura y paneles 3d',
  'happy birthday luminoso',
  '2 imagenes de fondo',
  'tropezon imagen tematica',          // validar también "mdf", es lo mismo
  'mdf',
  'microfono inalambrico',
  'la puesta de panal',
  'cubos baby',
  'nombre del bebe luminoso',
  'cubos abc madera',
  'globo aerostatico para regalos',
  'canon ventury',
  'caja tnt',
  'letras oh baby de un metro con luz',
  '2 estructura con fondo personalizada o velo',
  'backing ovalado con fondo',
  'letrero oh baby luminoso',
  'letras baby de un metro luminosas',
  'caja de regalos o globo aerostatico',
  'oso de peluche',
  'magia comica'
];

export function _normRecuperable(s){return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}

export function isConsumable(itemName){
  const n=_normRecuperable(itemName);
  const esRecuperable=RECUPERABLES_KEYWORDS.some(kw=>{const k=_normRecuperable(kw);return n.includes(k)||k.includes(n);});
  return !esRecuperable;
}

export const BUSQUEDA_INVENTARIO_ALIAS=[
  {match:'musica via bluetooth',buscar:['sonido']},
  {match:'show de titeres',buscar:['titeres','teatrino']}
  // 'Taller de payaso' no tiene alias: no existe aún un producto de traje de
  // payaso en bodega. Cuando se cree, agregar aquí: {match:'taller de payaso',buscar:['payaso']}
];

export function buscarTerminosInventario(itemName){
  const n=_normRecuperable(itemName);
  const alias=BUSQUEDA_INVENTARIO_ALIAS.find(a=>n.includes(_normRecuperable(a.match)));
  return alias?alias.buscar:[itemName];
}

export const ESPECIFICACION_ITEMS_PAQUETE=[
  {match:'personaje gigante',buscar:[{termino:'disfraz_o_gigante',qty:1,variante:true,obligatorio:true}]},
  {match:'show de titeres',buscar:[{termino:'titeres',qty:2,variante:false,obligatorio:false},{termino:'teatrino',qty:1,variante:false}]},
  {match:'musica via bluetooth',buscar:[{termino:'sonido',qty:1,variante:false,obligatorio:false}]},
  {match:'cabina de sonido',buscar:[{termino:'sonido',qty:1,variante:true,obligatorio:false}]},
  {match:'luces ritmicas',buscar:[{termino:'luces',qty:1,variante:true,obligatorio:false}]},
  {match:'camara de humo',buscar:[{termino:'camara de humo',qty:1,variante:true,obligatorio:false}]},
  {match:'pistola de burbujas',buscar:[{termino:'pitola burbijas',qty:1,variante:false}]},
  {match:'figura mdf tematica',buscar:[{termino:'tematica',qty:1,variante:true,obligatorio:false}]},
  {match:'tapete de peluche',buscar:[{termino:'tapete peluche',qty:1,variante:true,obligatorio:false}]},
  {match:'numero luminoso',buscar:[{termino:'numero luminoso',qty:1,variante:true,obligatorio:false}]},
  {match:'oso de peluche',buscar:[{termino:'peluche',qty:1,variante:true,obligatorio:false}]}
  // Ítems sin producto creado aún en bodega (3 cilindros, 2 estructuras metálicas,
  // micrófono inalámbrico, globo aerostático, cañón ventury, caja TNT, etc.) no
  // tienen entrada aquí a propósito: no existe con qué descontarlos todavía. Cuando
  // se cree el producto en Inventario, agregar su entrada siguiendo este mismo patrón.
];

export function _buscarEspecificacion(itemName){
  const n=_normRecuperable(itemName);
  return ESPECIFICACION_ITEMS_PAQUETE.find(e=>n.includes(_normRecuperable(e.match)));
}

export const PAQUETES=[
  // ── CUMPLEAÑOS ──
  {id:'happy_day',categoria:'cumpleanos',nombre:'Happy Day',nombreHappy:'Happy Day',nombreConde:'Conde Básico',precio:120000,items:['1 recreador de alto nivel','Recreación dirigida','Rompe hielos','Integración de padres','Pintucaritas','Globoflexia máx. 25 niños','Juegos de competencia','AM FM, Gordo más gordo, Capitán, Agua de limón','Taller de payaso','Chiqui zumba','Juego de luz verde con espuma','Juego de la silla musical','Protocolo cumpleaños y piñata','Música vía Bluetooth (no incluye cabina de sonido)','3 horas de animación']},
  {id:'happy_basica',categoria:'cumpleanos',nombre:'Happy Básica',nombreHappy:'Happy Básica',nombreConde:'A Jugar',precio:179000,items:['2 recreadores de alto nivel','Recreación dirigida','Rompe hielos','Integración de padres','Pintucaritas','Globoflexia máx. 25 niños','Juegos de competencia','AM FM, Gordo más gordo, Capitán, Agua de limón','Taller de payasos','Show de títeres','Chiqui zumba','Juego de luz verde con espuma','Juego de la silla musical','Protocolo cumpleaños y piñata','Música vía Bluetooth (no incluye cabina de sonido)','3 horas de animación']},
  {id:'happy_personaje',categoria:'cumpleanos',nombre:'Happy Personaje',nombreHappy:'Happy Personaje',nombreConde:'Encanto',precio:229000,items:['2 recreadores de alto nivel','Recreación dirigida','Personaje gigante','Integración de padres','Pintucaritas','Globoflexia máx. 25 niños','Juegos de competencia','AM FM, Gordo más gordo, Capitán, Agua de limón','Taller de payasos','Show de títeres','Chiqui zumba','Juego de luz verde con espuma','Juego de la silla musical','Protocolo cumpleaños y piñata','Música vía Bluetooth (no incluye cabina de sonido)','3 horas de animación']},
  {id:'happy_chiquiteka',categoria:'cumpleanos',nombre:'Happy Chiquiteka',nombreHappy:'Happy Chiquiteka',nombreConde:'Super Chiquiteka',precio:290000,items:['2 recreadores de alto nivel','Recreación dirigida','Rompe hielo','Integración de padres','Pintucaritas NEÓN','Pitos y manillas','Globoflexia máx. 25 niños','Concurso fuerza','Concurso licuadora','AM FM, Gordo más gordo, Capitán, Agua de limón','Chiqui zumba','Juego de luz verde con espuma','Pistola de burbujas','Juego de la silla musical','Protocolo cumpleaños','Protocolo piñata','Mini hora loca niños','Cabina de sonido','Luces rítmicas','Cámara de humo','3 horas de animación']},
  {id:'happy_inflable',categoria:'cumpleanos',nombre:'Happy Inflable',nombreHappy:'Happy Inflable',nombreConde:'Conde Inflable',precio:329000,items:['2 recreadores de alto nivel','Recreación dirigida','Rompe hielos','Integración de padres','Pintucaritas','Globoflexia máx. 25 niños','Juegos de competencia','AM FM, Gordo más gordo, Capitán, Agua de limón','Taller de payasos','Show de títeres','Chiqui zumba','Juego de luz verde con espuma','Juego de la silla musical','Protocolo cumpleaños y piñata','Música vía Bluetooth (no incluye cabina de sonido)','Inflable 2x2','3 horas de animación']},
  {id:'pequenos_saltos',categoria:'cumpleanos',nombre:'Pequeños Saltos',nombreHappy:'Pequeños Saltos',nombreConde:'Diversión Total',precio:395000,items:['Inflable edades máximo 5 años','1 recreador de alto nivel','1 recreador logístico','Personaje gigante','Recreación dirigida','Rompe hielo','Integración de padres','Pintucaritas','Globo Flexia máximo 25 niños','Show de payasos','Show de títeres','Chiqui Zumba con espuma','Juego de la silla musical','Protocolo cumpleaños','Protocolo piñata','Mini hora loca niños','Cabina de sonido','3 horas de diversión']},
  {id:'magico',categoria:'cumpleanos',nombre:'Mágico',nombreHappy:'Mágico',nombreConde:'Felicidad',precio:379000,items:['2 cortinas metalizadas','Decoración del salón en globos','Banderín temático','Mantel temático','Nombre del niño en globos','Número metalizado en globo','Figura metalizada temática','Arco con globos colores a escoger','3 horas de decoración antes del evento','2 recreadores de alto nivel','Recreación dirigida','Rompe hielos','Integración de padres','Pintucaritas','Globoflexia máx. 25 niños','Juegos de competencia','AM FM, Gordo más gordo, Capitán, Agua de limón','Taller de payasos','Show de títeres','Chiqui zumba','Juego de luz verde con espuma','Juego de la silla musical','Protocolo cumpleaños y piñata','Música vía Bluetooth (no incluye cabina de sonido)','3 horas de animación']},
  {id:'encantado',categoria:'cumpleanos',nombre:'Encantado',nombreHappy:'Encantado',nombreConde:'Fantasía',precio:490000,items:['Backing con fondo a escoger','3 cilindros color temática','Arco con globos colores a escoger','Decoración del salón en globos','Banderín temático','Mantel temático','Nombre del niño en globos','Número metalizado en globo','Figura metalizada temática','3 horas de decoración antes del evento','2 recreadores de alto nivel','Recreación dirigida','Rompe hielos','Integración de padres','Pintucaritas','Globoflexia máx. 25 niños','Juegos de competencia','AM FM, Gordo más gordo, Capitán, Agua de limón','Taller de payasos','Show de títeres','Chiqui zumba','Juego de luz verde con espuma','Juego de la silla musical','Protocolo cumpleaños y piñata','Música vía Bluetooth (no incluye cabina de sonido)','3 horas de animación']},
  {id:'ensueno',categoria:'cumpleanos',nombre:'Ensueño',nombreHappy:'Ensueño',nombreConde:'Aventura',precio:599000,items:['Backing con imagen de fondo a escoger','2 Estructuras metálicas','3 cilindros color temática','Arco con globos colores a escoger','Decoración del salón en globos','Banderín temático','Mantel temático','Nombre del niño luminoso','Número Luminoso','Figura mdf temática','Tapete de peluche','Obsequio: personaje gigante temático y peluche para el cumpleañero','2 recreadores de alto nivel','Recreación dirigida','Rompe hielos','Integración de padres','Pintucaritas','Globoflexia máx. 25 niños','Juegos de competencia','AM FM, Gordo más gordo, Capitán, Agua de limón','Taller de payasos','Show de títeres','Chiqui zumba','Juego de luz verde con espuma','Juego de la silla musical','Protocolo cumpleaños y piñata','Música vía Bluetooth (no incluye cabina de sonido)','3 horas de animación']},
  {id:'fiesta_neon',categoria:'cumpleanos',nombre:'Fiesta Total Neón',nombreHappy:'Fiesta Total Neón',nombreConde:'Party Neón',precio:620000,items:['Arco en globos neón','Backing con fondo a escoger neón','3 cilindros neón','Decoración al rededor del salón en globos','Barlerín neón','Nombre del cumpleañero luminoso','Número a cumplir luminoso','3 horas de decoración antes del evento','2 recreadores de alto nivel','Recreación dirigida','Rompe hielo','Integración de padres','Pintucaritas NEON','Pitos y manillas','Globoflexia máx. 25 niños','AM FM, Gordo más gordo, Capitán, Agua de limón','Chiqui zumba','Juego de luz verde con espuma','Pistola de burbujas','Juego de la silla musical','Protocolo cumpleaños','Protocolo piñata','Cabina de sonido','Luces rítmicas','Cámara de humo','3 horas de animación']},
  {id:'fantasia_magica',categoria:'cumpleanos',nombre:'Fantasía Mágica',nombreHappy:'Fantasía Mágica',nombreConde:'Plan Imperial',precio:760000,items:['Backing con imagen de fondo a escoger','2 Estructuras metálicas','3 cilindros color temática','Arco con globos colores a escoger','Decoración del salón en globos','Banderín temático','Mantel temático','Nombre del niño luminoso','Número Luminoso','Figura mdf temática','Tapete de peluche','Obsequio: personaje gigante temático y peluche para el cumpleañero','2 recreadores de alto nivel','Recreación dirigida','Rompe hielos','Integración de padres','Pintucaritas','Globoflexia máx. 25 niños','Juegos de competencia','AM FM, Gordo más gordo, Capitán, Agua de limón','Taller de payasos','Show de títeres','Chiqui zumba','Juego de luz verde con espuma','Juego de la silla musical','Protocolo cumpleaños y piñata','Música vía Bluetooth (no incluye cabina de sonido)','3 horas de animación','Inflable 2x2']},
  {id:'experiencia_happy',categoria:'cumpleanos',nombre:'Experiencia Happy',nombreHappy:'Experiencia Happy',nombreConde:'Experiencia Conde',precio:799000,items:['Backing con imagen de fondo a escoger','2 Estructuras metálicas','3 cilindros color temática','Arco con globos colores a escoger','Decoración del salón en globos','Banderín temático','Mantel temático','Nombre luminoso','Número Luminoso','Figura mdf temática','Tapete de peluche','Obsequio: personaje gigante temático y peluche para el cumpleañero','2 recreadores de alto nivel','Recreación dirigida','Integración de padres','Pintucaritas','Globoflexia máx. 25 niños','Juegos de competencia','Taller de payasos','Show de títeres','Chiqui zumba','Juego de luz verde con espuma','Juego de la silla musical','Protocolo cumpleaños y piñata música vía Bluetooth (no incluye cabina de sonido)','3 horas de animación','25 unidades hot dogs o hamburguesa','Caja de jugo']},
  {id:'ritmo_diseno',categoria:'cumpleanos',nombre:'Ritmo y Diseño',nombreHappy:'Ritmo y Diseño',nombreConde:'Sintonía Fiestera',precio:590000,items:['Arco en globos','Número 50 en globo','Nombre de la cumpleañera en globos','Mantel premium para mesa del salón','Decoración por el salón en globos','Banderín de cumpleaños','DJ','Cámara de humo','Cabina de sonido profesional','Luces rítmicas','Hora loca','Protocolo de cumpleaños','3 horas antes para decoración','6 horas de animación']},
  {id:'fiesta_brillo',categoria:'cumpleanos',nombre:'Fiesta y Brillo',nombreHappy:'Fiesta y Brillo',nombreConde:'Noche Premium',precio:790000,items:['Arco en globos','Estructura y Paneles 3D','3 cilindros para pasabocas o ponque','Decoración alrededor del salón','Número luminoso','Happy Birthday luminoso','Tapete de peluche','Banderín cumpleaños','Estrellas 6 puntas','Mantel temático','DJ','Protocolo cumpleaños','Cabina de sonido','Cámara de humo','Luces rítmicas','Pitos','Manillas Neón','Hora loca','6 horas de duración animación']},
  {id:'plan_todo_incluido',categoria:'cumpleanos',nombre:'Fiesta Total',nombreHappy:'Fiesta Total',nombreConde:'Todo Incluido',precio:970000,items:['2 imágenes de fondo','Arco en globos','Decoración del salón en globos','Banderín temático','3 cilindros con temática','Nombre del niño en letras luminosas','Tropezón imagen temática','Tapete peluche','Número luminoso','Inflable edades máximo 5 años','1 recreador de alto nivel','1 animador logístico','Recreación dirigida','Rompe hielo','Integración de padres','Pintucaritas','Globo Flexia máximo 25 niños','Show de payasos','Show de títeres','Chiqui Zumba con espuma','Juego de la silla musical','Protocolo cumpleaños','Protocolo piñata','Mini hora loca niños','Personaje gigante','Peluche obsequio al cumpleañero','Cabina de sonido','USB con música','3 horas de decoración antes del evento','3 horas de animación','25 perros calientes preparados','Cajita de jugo']},
  {id:'happy_rumba_dj',categoria:'cumpleanos',nombre:'Happy Rumba DJ',nombreHappy:'Happy Rumba DJ',nombreConde:'Rumba DJ',precio:390000,items:['DJ profesional','Luces rítmicas','Micrófono inalámbrico','Cámara de humo','Pitos, manillas y neón para todos los invitados','Hora loca','6 horas de rumba']},

  // ── BABY SHOWER ──
  {id:'baby_amor',categoria:'baby_shower',nombre:'Baby Amor',nombreHappy:'Baby Amor',nombreConde:'Animación Baby',precio:145000,items:['1 coordinador de alto nivel','Recreación dirigida','Rompe hielos','Integración de padres y invitados','Pintar barriguita de la mamá o Pintucaritas niños','Show de biberón','La puesta de pañal','Cambio de sexo','Pintar al papá','Guerra de sexo','Concurso licuadora mujeres','Concurso de fuerza hombres','Opcional concurso para niños','Mucha música (no incluye sonido)','3 horas de animación','Incluye el material para las actividades']},
  {id:'baby_rumba',categoria:'baby_shower',nombre:'Baby Rumba',nombreHappy:'Baby Rumba',nombreConde:'Baby Rumba',precio:255000,items:['1 coordinador de alto nivel','Recreación dirigida','Rompe hielos','Integración de padres y invitados','Pintar barriguita de la mamá o Pintucaritas niños','Show de biberón','La puesta de pañal','Cambio de sexo','Pintar al papá','Guerra de sexo','Concurso licuadora mujeres','Concurso de fuerza hombres','Opcional concurso para niños','Mucha música','Cabina de sonido','Luces rítmicas','Cámara de humo','Pañales','Cervezas','Pitos','Manillas neón','3 horas de animación','Incluye el material para las actividades']},
  {id:'dulce_espera_bs',categoria:'baby_shower',nombre:'Dulce Espera',nombreHappy:'Dulce Espera',nombreConde:'Especial',precio:339000,items:['Arco en globos color (preferencia del cliente)','2 cortinas metalizadas','Globos alrededor del salón','Banderín temático','4 chupos alrededor del salón','1 mantel temático baby Shower','Nombre del bebé en globos','1 coordinador de alto nivel','Recreación dirigida','Rompe hielos','Integración de padres y invitados','Pintar barriguita de la mamá o Pintucaritas niños','Show de biberón','La puesta de pañal','Cambio de sexo','Pintar al papá','Guerra de sexo','Concurso licuadora mujeres','Concurso de fuerza hombres','Opcional concurso para niños','Mucha música (no incluye sonido)','3 horas antes de la celebración para decoración','3 horas de animación']},
  {id:'nube_algodon',categoria:'baby_shower',nombre:'Nube de Algodón',nombreHappy:'Nube de Algodón',nombreConde:'Ternura',precio:439000,items:['Arco en globos color (preferencia del cliente)','1 estructura fondo personalizado','3 cilindros color temática','Globos alrededor del salón','Banderín temático','4 chupos alrededor del salón','1 mantel temático baby Shower','Nombre del bebé en globos','1 coordinador de alto nivel','Recreación dirigida','Rompe hielos','Integración de padres y invitados','Pintar barriguita de la mamá o Pintucaritas niños','Show de biberón','La puesta de pañal','Cambio de sexo','Pintar al papá','Guerra de sexos','Concurso licuadora mujeres','Concurso de fuerza hombres','Opcional concurso para niños','Mucha música (no incluye sonido)','3 horas antes de la celebración para decoración','3 horas de animación']},
  {id:'primeros_suenos',categoria:'baby_shower',nombre:'Primeros Sueños',nombreHappy:'Primeros Sueños',nombreConde:'Amor',precio:550000,items:['Arco en globos color (preferencia del cliente)','1 estructura fondo personalizado','3 cilindros color temática','Globos y 4 chupos alrededor del salón','Banderín temático','Tapete de peluche','1 mantel temático baby Shower','Nombre del bebé luminoso','Cubos BABY','1 coordinador de alto nivel','Recreación dirigida','Rompe hielos','Integración de padres y invitados','Pintar barriguita de la mamá o Pintucaritas niños','Show de biberón','La puesta de pañal','Cambio de sexo','Pintar al papá','Guerra de sexos','Concurso licuadora mujeres','Concurso de fuerza hombres','Opcional concurso para niños','Mucha música (no incluye sonido)','3 horas antes de la celebración para decoración','3 horas de animación']},
  {id:'sueno_bebe',categoria:'baby_shower',nombre:'Sueño de Bebé',nombreHappy:'Sueño de Bebé',nombreConde:'Alegría',precio:670000,items:['Arco en globos color (preferencia del cliente)','2 estructura fondo personalizado','3 cilindros color temática','Globos alrededor del salón','4 chupos alrededor del salón','Banderín temático','Tapete de peluche','1 mantel temático baby Shower','Nombre del bebé luminoso','Cubos ABC madera','Globo aerostático para regalos','Peluche temática en alquiler','1 coordinador de alto nivel','Recreación dirigida','Rompe hielos','Integración de padres y invitados','Pintar barriguita de la mamá o Pintucaritas niños','Show de biberón','La puesta de pañal','Cambio de sexo','Pintar al papá','Guerra de sexo','Concurso licuadora mujeres','Concurso de fuerza hombres','Opcional concurso para niños','Mucha música (no incluye sonido)','3 horas antes de la celebración para decoración','3 horas de animación']},

  // ── REVELACIÓN DE GÉNERO ──
  {id:'batalla_colores',categoria:'revelacion',nombre:'Batalla de Colores',nombreHappy:'Batalla de Colores',nombreConde:'La Revelación',precio:155000,items:['1 coordinador de alto nivel','Recreación dirigida','Rompe hielos','Integración de invitados','Volcán de color o confeti','Cartelera de bienvenida','Cambio de género','Guerra de sexo','Música Bluetooth (no incluye sonido)','3 horas de animación']},
  {id:'loca_bienvenida',categoria:'revelacion',nombre:'Loca Bienvenida',nombreHappy:'Loca Bienvenida',nombreConde:'Misterio Dulce',precio:320000,items:['1 coordinador de alto nivel','Recreación dirigida','Rompe hielos','Integración de padres y invitados','Cartelera posibles nombres','Adivina género','Cambio de género','Guerra de sexos','Opcional concurso para niños','Música Bluetooth (no incluye sonido)','Cañón ventury','Caja TNT','3 horas de animación']},
  {id:'nube_amor',categoria:'revelacion',nombre:'Nube de Amor',nombreHappy:'Nube de Amor',nombreConde:'Color del Amor',precio:365000,items:['Arco en globos rosado azul','2 cortinas metalizadas','Letras en globos niño o niña','Mantel de revelación','Banderín revelación','Decoración alrededor del salón','1 coordinador de alto nivel','Explosión de confeti o humo de revelación','Recreación dirigida','Rompe hielos','Integración de padres y invitados','Cartelera posibles nombres','Cartelera de bienvenida','Guerra de sexo','Opcional concurso para niños','Música vía Bluetooth (no incluye sonido)','3 horas de animación']},
  {id:'sorpresa_magica',categoria:'revelacion',nombre:'Sorpresa Mágica',nombreHappy:'Sorpresa Mágica',nombreConde:'Estrella en Camino',precio:465000,items:['Arco en globos','Estructura con fondo personalizado o velo','3 Cilindros color temática','Decoración alrededor del salón','Banderín temático revelación de género','4 chupos alrededor del salón','1 mantel temático baby Shower','Tapete de peluche','1 coordinador de alto nivel','Recreación dirigida','Rompe hielos','Integración de padres y invitados','Volcán de color o confeti','Protocolo de revelación','Cartelera de bienvenida','Cambio de género','Guerra de sexo','Música vía Bluetooth (no incluye sonido)','3 horas de animación']},
  {id:'revelacion_ensueno',categoria:'revelacion',nombre:'Revelación de Ensueño',nombreHappy:'Revelación de Ensueño',nombreConde:'Gran Sorpresa',precio:670000,items:['Letras oh baby de un metro con luz','Arco en globos','Decoración alrededor del salón','3 cilindros temáticos','Tapete de peluche','Banderín de revelación','Caja TNT','Volcán chispa','Cañón ventury exposición de confeti','1 coordinador de alto nivel','Recreación dirigida','Integración de padres y invitados','Cartelera posibles nombres','Guerra de sexos','Opcional concurso para niños','Música Bluetooth (no incluye sonido)','3 horas de decoración antes del evento','3 horas de animación']},
  {id:'principe_princesa',categoria:'revelacion',nombre:'Príncipe o Princesa',nombreHappy:'Príncipe o Princesa',nombreConde:'Secreto de Cigüeña',precio:650000,items:['Arco en globos','2 Estructura con fondo personalizada o velo','3 Cilindros color temática','Decoración alrededor del salón','Banderín temático revelación de género','4 chupos alrededor del salón','1 mantel temático baby Shower','Globos metalizados girl o boy','2 tapete de peluche','Globo aerostático para regalos','Cubos ABC','1 coordinador de alto nivel','Recreación dirigida','Rompe hielos','Integración de adultos','Volcán de color o confeti','Cartelera de bienvenida','Cambio de género','Guerra de sexo','Música Bluetooth (no incluye sonido)','3 horas de decoración antes del evento','3 horas de animación']},
  {id:'sorpresa_corazon',categoria:'revelacion',nombre:'Sorpresa de Corazón',nombreHappy:'Sorpresa de Corazón',nombreConde:'Color de Felicidad',precio:699000,items:['Backing ovalado con fondo','2 Arcos en globos','Letrero oh baby luminoso','Letras BABY de un metro luminosas','Decoración alrededor en globos','Banderín temático revelación','Caja de regalos o globo aerostático','Oso de peluche','1 coordinador de alto nivel','Recreación dirigida','Rompe hielos','Integración de invitados','Volcán de color o confeti','Cartelera de bienvenida','Cambio de género','Guerra de sexo','Música Bluetooth (no incluye sonido)','3 horas de decoración antes del evento','3 horas de animación']}
];

export function fmtPrecio(n){return'$'+Number(n).toLocaleString('es-CO');}

export function fmtFechaContrato(dateStr){
  if(!dateStr)return'';
  const meses=['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const [y,m,d]=dateStr.split('-');
  return`${parseInt(d)} DE ${meses[parseInt(m)-1]} ${y}`;
}

export function fmtHora(timeStr){
  if(!timeStr)return'';
  const [h,min]=timeStr.split(':');
  const hr=parseInt(h);
  return`${hr>12?hr-12:hr}:${min} ${hr>=12?'PM':'AM'}`;
}

export function fmtHoraEvento(c){
  const horaInicio=c?.hora?fmtHora(c.hora):'';
  const horaDeco=c?.horaDecoracion?fmtHora(c.horaDecoracion):'';
  if(!horaInicio&&!horaDeco)return'';
  if(horaDeco&&horaInicio)return`${horaDeco} decoración · ${horaInicio} recreación`;
  return horaInicio||`${horaDeco} decoración`;
}
