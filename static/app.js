import {createViewers} from './viewers.js';
import {createTelemetryPanel} from './telemetry.js';
import {showDateValidation,clearClimate,renderClimate,explainComparison} from './experience.js';
const $=id=>document.getElementById(id);
const number=(v,d=2)=>Number(v).toLocaleString('es-PE',{minimumFractionDigits:d,maximumFractionDigits:d});
const coordinates=data=>`${number(Math.abs(data.latitude),4)}° ${data.latitude<0?'S':'N'} · ${number(Math.abs(data.longitude),4)}° ${data.longitude<0?'O':'E'}`;
const featureLabels={relief_p95_p05_m:['Relieve P95−P05','m'],elevation_std_m:['Dispersión vertical','m'],slope_mean_deg:['Pendiente media','°'],slope_p90_deg:['Pendiente P90','°'],slope_std_deg:['Dispersión de pendiente','°'],laplacian_rms_m:['Rugosidad (laplaciano discreto)','m'],detrended_rms_m:['Rugosidad sin tendencia','m']};
let catalogue,reference,selected,viewers,map,markers={},footprints={},grids=new Map(),epoch=0;
let telemetryPending=false;
let telemetryRequest=0,limits=null;
const receptionPanel=createTelemetryPanel();
$('auto-refresh').checked=true;
function telemetryRows(data,empty){rows($('telemetry'),data.map(r=>[r.received_at,r.station_id,number(r.temperature_c,1),number(r.humidity_pct,1)]),empty);}
async function request(url){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
  try{const response=await fetch(url,{signal:controller.signal,cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'Revisa los datos de la consulta.');return data;}
  catch(error){if(error.name==='AbortError')throw Error('La consulta agotó el tiempo de espera. Intenta de nuevo.');throw error;}
  finally{clearTimeout(timer);}
}
function rows(target,data,empty){target.replaceChildren();if(!data.length)data=[[empty]];data.forEach(values=>{const tr=document.createElement('tr');values.forEach(value=>{const td=document.createElement('td');td.textContent=value??'Sin dato';tr.append(td);});target.append(tr);});}
function updateColors(){
  if(!selected||!viewers)return;
  const mode=$('color-mode').value;
  const key=mode==='slope'?'slope_deg':'relative_elevation_m';
  const values=[...reference[key].flat(),...selected[key].flat()];
  const extent=Math.max(...values.map(Math.abs));
  const min=mode==='slope'?0:-extent,max=extent||1;
  viewers.update({mode,min,max,exaggeration:Number($('exaggeration').value)});
  $('legend-min').textContent=number(min,1);$('legend-max').textContent=number(max,1);
  $('legend-title').textContent=mode==='slope'?'Pendiente del DEM científico (°)':'Elevación respecto a la media de cada ventana (m)';
  $('legend-gradient').style.background=mode==='slope'?'linear-gradient(90deg,#14364a,#71cfc5,#ed9e67)':'linear-gradient(90deg,#253e58,#789b9d,#e4b485)';
  $('exaggeration-value').textContent=`×${$('exaggeration').value}`;
  $('vertical-scale').textContent=viewers.isFallback()?'Vista 2D: 10 km de lado · sin escala vertical':`Horizontal: km · alturas relativas: m · exageración vertical ×${$('exaggeration').value}`;
}
function selectCandidate(id){
  if(!grids.has(id))return;
  selected=grids.get(id);epoch++;
  $('candidate').value=id;$('earth-name').textContent=selected.name;$('earth-location').textContent=coordinates(selected);
  $('earth-source').href='/catalogue#sources-earth';$('download-grid').href=`/api/terrains/${id}`;
  $('station-id').textContent=`site_id para Wokwi: ${id} · lecturas siempre simuladas`;
  viewers.setData('earth',selected);updateColors();viewers.reset();
  const a=reference.features,b=selected.features;
  $('relief-value').textContent=`${number(a.relief_p95_p05_m,1)} / ${number(b.relief_p95_p05_m,1)} m`;
  $('relief-detail').textContent=`Marte / Tierra · Δ ${number(b.relief_p95_p05_m-a.relief_p95_p05_m,1)} m`;
  $('slope-value').textContent=`${number(a.slope_mean_deg)} / ${number(b.slope_mean_deg)}°`;
  $('slope-detail').textContent=`Marte / Tierra · Δ ${number(b.slope_mean_deg-a.slope_mean_deg)}°`;
  $('distance-value').textContent=number(selected.comparison.pca_distance,3);
  explainComparison(catalogue,reference,selected,featureLabels);
  $('resolution-detail').textContent=`Resolución de cuadrícula original registrada: MOLA ${reference.provenance.native_resolution.map(v=>number(v,2)).join(' × ')} m (en el ecuador); mosaico terrestre ${selected.provenance.native_resolution.map(v=>number(v,7)).join(' × ')} grados. Ambas se agregaron a 500 m por celda en proyecciones métricas locales. El tamaño en metros de una celda angular depende de la latitud.`;
  rows($('differences'),Object.entries(selected.comparison.differences).map(([key,d])=>[
    featureLabels[key][0],`${number(d.mars)} ${featureLabels[key][1]}`,`${number(d.earth)} ${featureLabels[key][1]}`,
    `${d.delta>=0?'+':''}${number(d.delta)} ${featureLabels[key][1]}`,number(d.pca_squared_contribution,4)
  ]),'No hay descriptores calculados.');
  document.querySelectorAll('.rank-item').forEach(button=>{const active=button.dataset.id===id;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
  for(const [markerId,marker] of Object.entries(markers)){marker.setStyle({radius:markerId===id?8:5,color:markerId===id?'#e9bd99':'#7dd6ce',fillColor:markerId===id?'#e9bd99':'#7dd6ce'});footprints[markerId]?.setStyle({weight:markerId===id?2:1,opacity:markerId===id?1:.4});}
  if(map)map.panTo([selected.latitude,selected.longitude],{animate:false});
  $('source').hidden=true;$('message').textContent='Consulta opcional a NASA POWER, en las coordenadas de este candidato.';
  $('climate-location').textContent=`Ubicación consultada: ${selected.name} · ${coordinates(selected)}. Fuente: NASA POWER.`;
  clearClimate();$('storage').textContent='Comprobando el historial en el servidor actual…';$('storage').dataset.state='loading';
  rows($('climate'),[],'Sin consulta para este candidato.');rows($('telemetry'),[],'Consultando historial simulado…');
  loadTelemetry();
  $('app-status').textContent=`Datos preparados · ${selected.name} frente a Jezero · recuperados ${new Date(selected.provenance.retrieved_at).toLocaleDateString('es-PE',{timeZone:'America/Lima'})}. Sin validación externa.`;
}
function buildRanking(){
  $('ranking').replaceChildren();
  catalogue.candidates.forEach((c,i)=>{
    const button=document.createElement('button');button.className='rank-item';button.dataset.id=c.id;
    const rank=document.createElement('span');rank.className='rank-number';rank.textContent=String(i+1).padStart(2,'0');
    const info=document.createElement('span'),name=document.createElement('span'),location=document.createElement('span');name.className='rank-name';name.textContent=c.name;location.className='rank-location';location.textContent=`${c.country} · ${coordinates(c)}`;info.append(name,location);
    const distance=document.createElement('span');distance.className='rank-distance';distance.textContent=number(c.pca_distance,3);const caption=document.createElement('small');caption.textContent=`BASE ${number(c.baseline_distance,3)}`;distance.append(caption);
    button.append(rank,info,distance);button.addEventListener('click',()=>selectCandidate(c.id));$('ranking').append(button);
  });
}
async function buildMap(){
  if(!window.L){$('earth-map').textContent='El mapa no pudo cargarse. Las coordenadas están en la lista de candidatos.';return;}
  map=L.map('earth-map',{center:[-20,-71],zoom:5,scrollWheelZoom:false,zoomControl:true,maxZoom:13,minZoom:3});map.attributionControl.setPrefix('Leaflet');
  try{const world=await request('/static/vendor/world.geojson');L.geoJSON(world,{style:{color:'#496276',weight:1,fillColor:'#253c4c',fillOpacity:.75},interactive:false,attribution:'Natural Earth · dominio público'}).addTo(map);}
  catch{$('earth-map').insertAdjacentText('afterend','Cartografía no disponible. Se muestran posiciones de los candidatos.');}
  catalogue.candidates.forEach(c=>{
    const grid=grids.get(c.id);
    footprints[c.id]=L.polygon(grid.corners.map(([lon,lat])=>[lat,lon]),{color:'#78d6d1',weight:1,fillOpacity:.1}).addTo(map);
    markers[c.id]=L.circleMarker([c.latitude,c.longitude],{radius:6,color:'#78d6d1',fillColor:'#78d6d1',fillOpacity:1,weight:2}).addTo(map).bindTooltip(c.name,{direction:'top'}).on('click',()=>selectCandidate(c.id));
    const element=markers[c.id].getElement();element.setAttribute('role','button');element.setAttribute('tabindex','0');element.setAttribute('aria-label',`Ver terreno ${c.name}`);
    element.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectCandidate(c.id);}});
    footprints[c.id].on('click',()=>selectCandidate(c.id));
  });
  fitMap();markers[selected.id]?.setStyle({radius:8,color:'#e9bd99',fillColor:'#e9bd99'});
  new ResizeObserver(()=>map.invalidateSize()).observe($('earth-map'));
}
function fitMap(){if(map&&catalogue)map.fitBounds(catalogue.candidates.map(c=>[c.latitude,c.longitude]),{padding:[45,35],maxZoom:7,animate:false});}
async function loadTelemetry(){
  if(!selected)return;
  const id=selected.id,version=epoch,requestId=++telemetryRequest;
  $('refresh').disabled=true;telemetryPending=true;
  const cached=receptionPanel.loading(id);if(cached)telemetryRows(cached,'Sin mediciones recibidas');
  $('storage').textContent='Consultando el almacenamiento del servidor actual…';$('storage').dataset.state='loading';
  try{const data=await request(`/api/telemetry?site_id=${encodeURIComponent(id)}`);if(version!==epoch||requestId!==telemetryRequest)return;
    const connected=data.storage==='supabase';
    $('storage').dataset.state=connected?(data.readings.length?'connected-with-readings':'connected-empty'):'unconfigured';
    $('storage').textContent=connected?(data.readings.length?`Supabase: consulta exitosa · ${data.readings.length} lecturas simuladas para este sitio.`:'Supabase: consulta exitosa, sin lecturas para este sitio. La conexión funciona.'):'Este servidor informa que Supabase no está configurado; el historial está en memoria temporal. Si actualizaste .env, reinicia el servidor para cargarlo.';
    telemetryRows(receptionPanel.success(id,data),'Sin mediciones recibidas');
  }catch(error){if(version===epoch&&requestId===telemetryRequest){$('storage').dataset.state='failed';$('storage').textContent=`Consulta fallida: ${error.message} El historial visible corresponde a la última consulta exitosa y no está actualizado. No se generan lecturas de reemplazo.`;const cached=receptionPanel.failure(id);telemetryRows(cached||[],cached?'Sin mediciones en la última consulta exitosa.':'No se pudo cargar el historial.');}}
  finally{if(requestId===telemetryRequest){telemetryPending=false;$('refresh').disabled=false;}}
}
$('candidate').addEventListener('change',event=>selectCandidate(event.target.value));
$('color-mode').addEventListener('change',updateColors);
$('exaggeration').addEventListener('input',()=>{updateColors();viewers?.reset();});
$('height-reset').addEventListener('click',()=>{$('exaggeration').value='1';updateColors();viewers?.reset();});
$('sync').addEventListener('change',event=>viewers?.sync(event.target.checked));
document.querySelectorAll('.viewer-controls button').forEach(button=>button.addEventListener('click',()=>viewers?.action(button.closest('.viewer-controls').dataset.view,button.dataset.action)));
$('map-fit').addEventListener('click',fitMap);$('refresh').addEventListener('click',loadTelemetry);
setInterval(()=>{if($('auto-refresh').checked&&!telemetryPending&&!document.hidden)loadTelemetry();},10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&$('auto-refresh').checked&&!telemetryPending)loadTelemetry();});
$('climate-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!selected)return;
  if(!showDateValidation(limits))return;
  const start=$('start').value,end=$('end').value;
  const id=selected.id,version=epoch;$('load').disabled=true;$('source').hidden=true;$('message').textContent='Consultando NASA POWER…';rows($('climate'),[],'Consulta en curso…');
  clearClimate('Consultando NASA POWER; no hay datos nuevos confirmados todavía.');
  try{const query=new URLSearchParams({start,end});const data=await request(`/api/climate/${id}?${query}`);if(version!==epoch)return;
    renderClimate(data,start,end);
    rows($('climate'),data.readings.map(r=>[r.date,r.temperature_c===null?null:number(r.temperature_c,1),r.humidity_pct===null?null:number(r.humidity_pct,1)]),'Sin datos disponibles.');
    $('message').textContent=`${data.notice} ${data.readings.length} días · recuperado ${data.retrieved_at}.`;$('source').href=data.source_url;$('source').hidden=false;
  }catch(error){if(version===epoch){$('message').textContent=error.message;clearClimate('La consulta no se completó. No se muestran datos de sustitución.');rows($('climate'),[],'Consulta no completada.');}}
  finally{$('load').disabled=false;}
});
async function initialize(){
  try{
    [catalogue,reference]=await Promise.all([request('/api/terrains'),request('/api/terrains/jezero')]);
    const datasets=await Promise.all(catalogue.candidates.map(c=>request(`/api/terrains/${c.id}`)));datasets.forEach(d=>grids.set(d.id,d));
    viewers=await createViewers(reason=>{$('webgl-notice').hidden=false;$('webgl-notice').textContent=reason;$('exaggeration').disabled=true;$('height-reset').disabled=true;});viewers.setData('mars',reference);
    $('mars-name').textContent=reference.name;$('mars-location').textContent=coordinates(reference);$('mars-source').href='/catalogue#sources-mars';
    $('candidate').replaceChildren();catalogue.candidates.forEach(c=>{const option=document.createElement('option');option.value=c.id;option.textContent=c.name;$('candidate').append(option);});$('candidate').disabled=false;
    buildRanking();const e=catalogue.evaluation;
    $('evaluation').textContent=`${e.training_windows} ventanas de entrenamiento y ${e.heldout_windows} de evaluación; separación de ${e.buffer_km} km. PCA conserva ${number(e.explained_training_variance*100)}% de la varianza con ${e.pca_components} componentes. RMSE de reconstrucción reservado: ${number(e.heldout_reconstruction_rmse_standardized,3)} (estandarizado). Correlación de rangos con la base: ${number(e.rank_correlation_with_baseline,4)}. Coincidencia del top 5: ${number(e.top5_overlap_with_baseline*100,0)}%. Estos son indicadores internos, no exactitud científica.`;
    $('extrapolation').textContent=e.reference_outside_training_range.length?`Extrapolación: ${e.reference_outside_training_range.map(key=>featureLabels[key][0]).join(' y ')} de Jezero están fuera del rango de entrenamiento.`:'La referencia está dentro de los rangos de características del entrenamiento; eso no valida equivalencia.';
    const initialCandidate=new URLSearchParams(location.search).get('candidate');
    selectCandidate(grids.has(initialCandidate)?initialCandidate:catalogue.candidates[0].id);buildMap();
  }catch(error){$('app-status').classList.add('error');$('app-status').textContent=`No se pudo preparar el comparador: ${error.message} `;
    const retry=document.createElement('button');retry.textContent='Reintentar';retry.addEventListener('click',()=>location.reload());$('app-status').append(retry);
    ['mars-view','earth-view'].forEach(id=>{$(id).textContent='Relieve no disponible. Revisa los datos preparados e intenta de nuevo.';});
  }
}
async function initializeDates(){
  $('load').disabled=true;
  try{limits=await request('/api/climate-limits');for(const id of ['start','end']){$(id).min=limits.min_date;$(id).max=limits.max_date;}
    $('date-help').textContent=`Fechas completas entre ${limits.min_date} y ${limits.max_date} · máximo ${limits.max_days} días inclusive · UTC. Los datos recientes pueden no estar disponibles aún.`;
    showDateValidation(limits);
    $('load').disabled=false;
  }catch{$('date-error').hidden=false;$('date-error').textContent='No se pudieron comprobar las fechas admitidas. Recarga la página para volver a intentarlo.';}
}
for(const id of ['start','end'])for(const event of ['input','change'])$(id).addEventListener(event,()=>showDateValidation(limits));
initializeDates();
initialize();
