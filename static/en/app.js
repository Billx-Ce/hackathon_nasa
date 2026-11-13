import {translateData} from '/static/translate-data.js';
import {renderProfile} from '/static/profile.js';
import {createViewers} from './viewers.js';
import {createTelemetryPanel} from './telemetry.js';
import {showDateValidation,clearClimate,renderClimate,explainComparison} from './experience.js';
const $=id=>document.getElementById(id);
const number=(v,d=2)=>Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const coordinates=data=>`${number(Math.abs(data.latitude),4)}° ${data.latitude<0?'S':'N'} · ${number(Math.abs(data.longitude),4)}° ${data.longitude<0?'O':'E'}`;
const featureLabels={relief_p95_p05_m:['P95−P05 relief','m'],elevation_std_m:['Elevation spread','m'],slope_mean_deg:['Mean slope','°'],slope_p90_deg:['P90 slope','°'],slope_std_deg:['Slope spread','°'],laplacian_rms_m:['Roughness (discrete Laplacian)','m'],detrended_rms_m:['Detrended roughness','m']};
let catalogue,reference,selected,viewers,map,markers={},footprints={},grids=new Map(),epoch=0;
let telemetryPending=false;
let telemetryRequest=0,limits=null;
const receptionPanel=createTelemetryPanel();
$('auto-refresh').checked=true;
function telemetryRows(data,empty){rows($('telemetry'),data.map(r=>[r.received_at,r.station_id,number(r.temperature_c,1),number(r.humidity_pct,1)]),empty);}
async function request(url){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
  try{const response=await fetch(url,{signal:controller.signal,cache:'no-store'});const data=translateData(await response.json());if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'Check the query parameters.');return data;}
  catch(error){if(error.name==='AbortError')throw Error('The query timed out. Try again.');throw error;}
  finally{clearTimeout(timer);}
}
function rows(target,data,empty){target.replaceChildren();if(!data.length)data=[[empty]];data.forEach(values=>{const tr=document.createElement('tr');values.forEach(value=>{const td=document.createElement('td');td.textContent=value??'No data';tr.append(td);});target.append(tr);});}
function updateColors(){
  if(!selected||!viewers)return;
  const mode=$('color-mode').value;
  const key=mode==='slope'?'slope_deg':'relative_elevation_m';
  const values=[...reference[key].flat(),...selected[key].flat()];
  const extent=Math.max(...values.map(Math.abs));
  const min=mode==='slope'?0:-extent,max=extent||1;
  viewers.update({mode,min,max,exaggeration:Number($('exaggeration').value)});
  $('legend-min').textContent=number(min,1);$('legend-max').textContent=number(max,1);
  $('legend-title').textContent=mode==='slope'?'Scientific DEM slope (°)':'Elevation relative to each window mean (m)';
  $('legend-gradient').style.background=mode==='slope'?'linear-gradient(90deg,#14364a,#71cfc5,#ed9e67)':'linear-gradient(90deg,#253e58,#789b9d,#e4b485)';
  $('exaggeration-value').textContent=`×${$('exaggeration').value}`;
  $('vertical-scale').textContent=viewers.isFallback()?'2D view: 10 km per side · no vertical scale':`Horizontal: km · relative heights: m · vertical exaggeration ×${$('exaggeration').value}`;
}
function selectCandidate(id){
  if(!grids.has(id))return;
  selected=grids.get(id);epoch++;
  $('candidate').value=id;$('earth-name').textContent=selected.name;$('earth-location').textContent=coordinates(selected);
  $('earth-source').href='/catalogue?lang=en#sources-earth';$('download-grid').href=`/api/terrains/${id}`;
  $('station-id').textContent=`site_id for Wokwi: ${id} · readings are always simulated`;
  viewers.setData('earth',selected);updateColors();viewers.reset();
  const a=reference.features,b=selected.features;
  $('relief-value').textContent=`${number(a.relief_p95_p05_m,1)} / ${number(b.relief_p95_p05_m,1)} m`;
  $('relief-detail').textContent=`Mars / Earth · Δ ${number(b.relief_p95_p05_m-a.relief_p95_p05_m,1)} m`;
  $('slope-value').textContent=`${number(a.slope_mean_deg)} / ${number(b.slope_mean_deg)}°`;
  $('slope-detail').textContent=`Mars / Earth · Δ ${number(b.slope_mean_deg-a.slope_mean_deg)}°`;
  $('distance-value').textContent=number(selected.comparison.pca_distance,3);
  explainComparison(catalogue,reference,selected,featureLabels);
  updateProfile();
  $('resolution-detail').textContent=`Recorded original grid resolution: MOLA ${reference.provenance.native_resolution.map(v=>number(v,2)).join(' × ')} m (at the equator); Earth mosaic ${selected.provenance.native_resolution.map(v=>number(v,7)).join(' × ')} degrees. Both were aggregated to 500 m cells in local metric projections. The physical size of an angular cell depends on latitude.`;
  rows($('differences'),Object.entries(selected.comparison.differences).map(([key,d])=>[
    featureLabels[key][0],`${number(d.mars)} ${featureLabels[key][1]}`,`${number(d.earth)} ${featureLabels[key][1]}`,
    `${d.delta>=0?'+':''}${number(d.delta)} ${featureLabels[key][1]}`,number(d.pca_squared_contribution,4)
  ]),'No hay descriptores calculados.');
  document.querySelectorAll('.rank-item').forEach(button=>{const active=button.dataset.id===id;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
  for(const [markerId,marker] of Object.entries(markers)){marker.setStyle({radius:markerId===id?8:5,color:markerId===id?'#e9bd99':'#7dd6ce',fillColor:markerId===id?'#e9bd99':'#7dd6ce'});footprints[markerId]?.setStyle({weight:markerId===id?2:1,opacity:markerId===id?1:.4});}
  if(map)map.panTo([selected.latitude,selected.longitude],{animate:false});
  $('source').hidden=true;$('message').textContent='Optional NASA POWER query at this candidate’s coordinates.';
  $('climate-location').textContent=`Query location: ${selected.name} · ${coordinates(selected)}. Source: NASA POWER.`;
  clearClimate();$('storage').textContent='Checking history on the current server…';$('storage').dataset.state='loading';
  rows($('climate'),[],'No query for this candidate yet.');rows($('telemetry'),[],'Loading simulated history…');
  loadTelemetry();
  $('app-status').textContent=`Prepared data · ${selected.name} compared with Jezero · retrieved ${new Date(selected.provenance.retrieved_at).toLocaleDateString('en-US',{timeZone:'America/Lima'})}. No external validation.`;
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
  if(!window.L){$('earth-map').textContent='The map could not load. Coordinates are listed with the candidates.';return;}
  map=L.map('earth-map',{center:[-20,-71],zoom:5,scrollWheelZoom:false,zoomControl:true,maxZoom:13,minZoom:3});map.attributionControl.setPrefix('Leaflet');
  try{const world=await request('/static/vendor/world.geojson');L.geoJSON(world,{style:{color:'#496276',weight:1,fillColor:'#253c4c',fillOpacity:.75},interactive:false,attribution:'Natural Earth · public domain'}).addTo(map);}
  catch{$('earth-map').insertAdjacentText('afterend','Map unavailable. Candidate positions are shown.');}
  catalogue.candidates.forEach(c=>{
    const grid=grids.get(c.id);
    footprints[c.id]=L.polygon(grid.corners.map(([lon,lat])=>[lat,lon]),{color:'#78d6d1',weight:1,fillOpacity:.1}).addTo(map);
    markers[c.id]=L.circleMarker([c.latitude,c.longitude],{radius:6,color:'#78d6d1',fillColor:'#78d6d1',fillOpacity:1,weight:2}).addTo(map).bindTooltip(c.name,{direction:'top'}).on('click',()=>selectCandidate(c.id));
    const element=markers[c.id].getElement();element.setAttribute('role','button');element.setAttribute('tabindex','0');element.setAttribute('aria-label',`View terrain ${c.name}`);
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
  const cached=receptionPanel.loading(id);if(cached)telemetryRows(cached,'No readings received');
  $('storage').textContent='Querying storage on the current server…';$('storage').dataset.state='loading';
  try{const data=await request(`/api/telemetry?site_id=${encodeURIComponent(id)}`);if(version!==epoch||requestId!==telemetryRequest)return;
    const connected=data.storage==='supabase';
    $('storage').dataset.state=connected?(data.readings.length?'connected-with-readings':'connected-empty'):'unconfigured';
    $('storage').textContent=connected?(data.readings.length?`Supabase: query successful · ${data.readings.length} simulated readings for this site.`:'Supabase: query successful, no readings for this site. The connection is working.'):'This server reports that Supabase is not configured; history is in temporary memory. If you updated .env, restart the server to load it.';
    telemetryRows(receptionPanel.success(id,data),'No readings received');
  }catch(error){if(version===epoch&&requestId===telemetryRequest){$('storage').dataset.state='failed';$('storage').textContent=`Query failed: ${error.message} Visible history is from the last successful query and is not up to date. No replacement readings are generated.`;const cached=receptionPanel.failure(id);telemetryRows(cached||[],cached?'No readings in the last successful query.':'Could not load history.');}}
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
  const id=selected.id,version=epoch;$('load').disabled=true;$('source').hidden=true;$('message').textContent='Querying NASA POWER…';rows($('climate'),[],'Query in progress…');
  clearClimate('Querying NASA POWER; no new data confirmed yet.');
  try{const query=new URLSearchParams({start,end});const data=await request(`/api/climate/${id}?${query}`);if(version!==epoch)return;
    renderClimate(data,start,end);
    rows($('climate'),data.readings.map(r=>[r.date,r.temperature_c===null?null:number(r.temperature_c,1),r.humidity_pct===null?null:number(r.humidity_pct,1)]),'No data disponibles.');
    $('message').textContent=`${data.notice} ${data.readings.length} days · retrieved ${data.retrieved_at}.`;$('source').href=data.source_url;$('source').hidden=false;
  }catch(error){if(version===epoch){$('message').textContent=error.message;clearClimate('The query did not complete. No substitute data is shown.');rows($('climate'),[],'Query incomplete.');}}
  finally{$('load').disabled=false;}
});
async function initialize(){
  try{
    [catalogue,reference]=await Promise.all([request('/api/terrains'),request('/api/terrains/jezero')]);
    const datasets=await Promise.all(catalogue.candidates.map(c=>request(`/api/terrains/${c.id}`)));datasets.forEach(d=>grids.set(d.id,d));
    viewers=await createViewers(reason=>{$('webgl-notice').hidden=false;$('webgl-notice').textContent=reason;$('exaggeration').disabled=true;$('height-reset').disabled=true;});viewers.setData('mars',reference);
    $('mars-name').textContent=reference.name;$('mars-location').textContent=coordinates(reference);$('mars-source').href='/catalogue?lang=en#sources-mars';
    $('candidate').replaceChildren();catalogue.candidates.forEach(c=>{const option=document.createElement('option');option.value=c.id;option.textContent=c.name;$('candidate').append(option);});$('candidate').disabled=false;
    buildRanking();const e=catalogue.evaluation;
    $('evaluation').textContent=`${e.training_windows} training windows and ${e.heldout_windows} evaluation windows; buffer of ${e.buffer_km} km. PCA retains ${number(e.explained_training_variance*100)}% of the variance with ${e.pca_components} components. Held-out reconstruction RMSE: ${number(e.heldout_reconstruction_rmse_standardized,3)} (standardized). Rank correlation with baseline: ${number(e.rank_correlation_with_baseline,4)}. Top-five overlap: ${number(e.top5_overlap_with_baseline*100,0)}%. These are internal indicators, not scientific accuracy.`;
    $('extrapolation').textContent=e.reference_outside_training_range.length?`Extrapolation: ${e.reference_outside_training_range.map(key=>featureLabels[key][0]).join(' and ')} for Jezero fall outside the training range.`:'The reference lies within the training feature ranges; this does not validate equivalence.';
    const initialCandidate=new URLSearchParams(location.search).get('candidate');
    selectCandidate(grids.has(initialCandidate)?initialCandidate:catalogue.candidates[0].id);buildMap();
  }catch(error){$('app-status').classList.add('error');$('app-status').textContent=`Could not initialize the comparator: ${error.message} `;
    const retry=document.createElement('button');retry.textContent='Retry';retry.addEventListener('click',()=>location.reload());$('app-status').append(retry);
    ['mars-view','earth-view'].forEach(id=>{$(id).textContent='Terrain unavailable. Check the prepared data and try again.';});
  }
}
async function initializeDates(){
  $('load').disabled=true;
  try{limits=await request('/api/climate-limits');for(const id of ['start','end']){$(id).min=limits.min_date;$(id).max=limits.max_date;}
    $('date-help').textContent=`Full dates between ${limits.min_date} and ${limits.max_date} · maximum ${limits.max_days} days inclusive · UTC. Recent data may not be available yet.`;
    showDateValidation(limits);
    $('load').disabled=false;
  }catch{$('date-error').hidden=false;$('date-error').textContent='Could not check supported dates. Reload the page to try again.';}
}
for(const id of ['start','end'])for(const event of ['input','change'])$(id).addEventListener(event,()=>showDateValidation(limits));
initializeDates();
initialize();

function updateProfile(){
  if(!reference||!selected)return;
  const row=Number($('profile-row').value);
  $('profile-row-value').textContent=`${row+1} / 20`;
  renderProfile(reference,selected,row);
}
$('view-preset').addEventListener('change',event=>viewers?.preset(event.target.value));
$('show-grid').addEventListener('change',event=>viewers?.update({grid:event.target.checked}));
$('show-wireframe').addEventListener('change',event=>viewers?.update({wireframe:event.target.checked}));
$('profile-row').addEventListener('input',updateProfile);
let profileWidth=0;
new ResizeObserver(entries=>{
  const width=Math.round(entries[0].contentRect.width);
  if(width!==profileWidth){profileWidth=width;updateProfile();}
}).observe($('terrain-profile'));
