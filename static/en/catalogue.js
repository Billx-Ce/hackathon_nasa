import {translateData} from '/static/translate-data.js';
const $=id=>document.getElementById(id);
const fmt=(v,d=3)=>v.toLocaleString('en-US',{maximumFractionDigits:d});
async function fetchData(url){const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('Could not load the computed catalogue.');return translateData(await response.json());}
try{
  const [catalogue,reference]=await Promise.all([fetchData('/api/terrains'),fetchData('/api/terrains/jezero')]);
  const ordered=[...catalogue.candidates].sort((a,b)=>a.pca_distance-b.pca_distance);
  $('catalogue-best').textContent=`${ordered[0].name} has the lowest distance among the ${ordered.length} fixed candidates analyzed. Jezero has P95−P05 relief of ${fmt(reference.features.relief_p95_p05_m,1)} m and mean slope of ${fmt(reference.features.slope_mean_deg,2)}°.`;
  ordered.forEach((candidate,i)=>{
    const card=document.createElement('article');card.className='catalogue-card';
    const h=document.createElement('h3');h.textContent=`${i+1}. ${candidate.name}`;
    const location=document.createElement('p');location.textContent=`${candidate.country} · latitud ${fmt(candidate.latitude,4)}°, longitud ${fmt(candidate.longitude,4)}°`;
    const distance=document.createElement('p');distance.textContent=`PCA distance: ${fmt(candidate.pca_distance)} · baseline: ${fmt(candidate.baseline_distance)}. Lower distance indicates greater descriptive similarity.`;
    const physical=document.createElement('p');physical.textContent=`P95−P05 relief: ${fmt(candidate.features.relief_p95_p05_m,1)} m · mean slope: ${fmt(candidate.features.slope_mean_deg,2)}°.`;
    const link=document.createElement('a');link.href=`/?lang=en&candidate=${encodeURIComponent(candidate.id)}#compare`;link.textContent='Compare this terrain →';
    card.append(h,location,distance,physical,link);$('catalogue-candidates').append(card);
  });
  const e=catalogue.evaluation;
  const table=document.createElement('table');
  const metrics=[['Training windows',e.training_windows],['Evaluation windows',e.heldout_windows],['Spatial buffer',`${e.buffer_km} km`],['PCA components',e.pca_components],['Training variance retained',`${fmt(e.explained_training_variance*100,2)} % (not accuracy)`],['Held-out reconstruction RMSE',`${fmt(e.heldout_reconstruction_rmse_standardized)} (standardized)`],['Rank correlation with baseline',fmt(e.rank_correlation_with_baseline,4)],['Top-five overlap with baseline',`${fmt(e.top5_overlap_with_baseline*100,0)} % (not demonstrated improvement)`],['Scientific accuracy','Unavailable: no expert labels']];
  const caption=document.createElement('caption');caption.textContent='Internal evaluation of the computed experiment';table.append(caption);
  metrics.forEach(([label,value])=>{const row=document.createElement('tr'),th=document.createElement('th'),td=document.createElement('td');th.scope='row';th.textContent=label;td.textContent=value;row.append(th,td);table.append(row);});$('catalogue-evaluation').append(table);
  const names={relief_p95_p05_m:'P95−P05 relief',laplacian_rms_m:'Laplacian roughness'};
  $('catalogue-extrapolation').textContent=e.reference_outside_training_range.length?`Extrapolation: in Jezero, ${e.reference_outside_training_range.map(key=>names[key]||key).join(' and ')} fall outside the Earth training range. The reference is not covered by all the training examples.`:'No variables were detected outside the training ranges; this alone does not validate equivalence.';
  $('catalogue-retrieval').textContent=`MOLA retrieved: ${reference.provenance.retrieved_at}. Analysis computed: ${catalogue.generated_at}.`;
  $('catalogue-status').textContent='Catalogue loaded from the same results used by the comparator.';
}catch(error){$('catalogue-status').textContent=error.message;const retry=document.createElement('button');retry.textContent='Retry';retry.onclick=()=>location.reload();$('catalogue-status').append(retry);}
