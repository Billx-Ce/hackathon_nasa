const $=id=>document.getElementById(id);
const fmt=(v,d=3)=>v.toLocaleString('es-PE',{maximumFractionDigits:d});
async function fetchData(url){const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('No se pudo cargar el catálogo calculado.');return response.json();}
try{
  const [catalogue,reference]=await Promise.all([fetchData('/api/terrains'),fetchData('/api/terrains/jezero')]);
  const ordered=[...catalogue.candidates].sort((a,b)=>a.pca_distance-b.pca_distance);
  $('catalogue-best').textContent=`${ordered[0].name} presenta la menor distancia entre los ${ordered.length} candidatos fijos analizados. Jezero tiene un relieve P95−P05 de ${fmt(reference.features.relief_p95_p05_m,1)} m y pendiente media de ${fmt(reference.features.slope_mean_deg,2)}°.`;
  ordered.forEach((candidate,i)=>{
    const card=document.createElement('article');card.className='catalogue-card';
    const h=document.createElement('h3');h.textContent=`${i+1}. ${candidate.name}`;
    const location=document.createElement('p');location.textContent=`${candidate.country} · latitud ${fmt(candidate.latitude,4)}°, longitud ${fmt(candidate.longitude,4)}°`;
    const distance=document.createElement('p');distance.textContent=`Distancia PCA: ${fmt(candidate.pca_distance)} · base: ${fmt(candidate.baseline_distance)}. Menor distancia indica mayor parecido descriptivo.`;
    const physical=document.createElement('p');physical.textContent=`Relieve P95−P05: ${fmt(candidate.features.relief_p95_p05_m,1)} m · pendiente media: ${fmt(candidate.features.slope_mean_deg,2)}°.`;
    const link=document.createElement('a');link.href=`/?candidate=${encodeURIComponent(candidate.id)}#compare`;link.textContent='Comparar este terreno →';
    card.append(h,location,distance,physical,link);$('catalogue-candidates').append(card);
  });
  const e=catalogue.evaluation;
  const table=document.createElement('table');
  const metrics=[['Ventanas de entrenamiento',e.training_windows],['Ventanas de evaluación',e.heldout_windows],['Separación espacial',`${e.buffer_km} km`],['Componentes PCA',e.pca_components],['Varianza de entrenamiento conservada',`${fmt(e.explained_training_variance*100,2)} % (no es precisión)`],['RMSE de reconstrucción reservado',`${fmt(e.heldout_reconstruction_rmse_standardized)} (estandarizado)`],['Correlación de rangos con la base',fmt(e.rank_correlation_with_baseline,4)],['Coincidencia de los primeros cinco con la base',`${fmt(e.top5_overlap_with_baseline*100,0)} % (no es mejora demostrada)`],['Exactitud científica','No disponible: sin etiquetas expertas']];
  const caption=document.createElement('caption');caption.textContent='Evaluación interna del experimento calculado';table.append(caption);
  metrics.forEach(([label,value])=>{const row=document.createElement('tr'),th=document.createElement('th'),td=document.createElement('td');th.scope='row';th.textContent=label;td.textContent=value;row.append(th,td);table.append(row);});$('catalogue-evaluation').append(table);
  const names={relief_p95_p05_m:'relieve P95−P05',laplacian_rms_m:'rugosidad por laplaciano'};
  $('catalogue-extrapolation').textContent=e.reference_outside_training_range.length?`Extrapolación: en Jezero, ${e.reference_outside_training_range.map(key=>names[key]||key).join(' y ')} quedan fuera del rango terrestre de entrenamiento. El modelo está comparando una referencia que no queda cubierta por todos sus ejemplos.`:'No se detectaron variables fuera de los rangos de entrenamiento; eso por sí solo no valida equivalencia.';
  $('catalogue-retrieval').textContent=`MOLA recuperado: ${reference.provenance.retrieved_at}. Análisis calculado: ${catalogue.generated_at}.`;
  $('catalogue-status').textContent='Catálogo cargado a partir de los mismos resultados que utiliza el comparador.';
}catch(error){$('catalogue-status').textContent=error.message;const retry=document.createElement('button');retry.textContent='Reintentar';retry.onclick=()=>location.reload();$('catalogue-status').append(retry);}
