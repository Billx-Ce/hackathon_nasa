const $=id=>document.getElementById(id);
const fmt=(v,d=1)=>v.toLocaleString('es-PE',{maximumFractionDigits:d,minimumFractionDigits:d});
const DAY=86400000;
export function validatePeriod(start,end,limits){
  if(!limits)return 'No se pudieron comprobar las fechas admitidas. Recarga la página antes de consultar.';
  const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  if(!valid(start)||!valid(end))return 'Introduce ambas fechas completas y verifica el año (AAAA-MM-DD).';
  if(start<limits.min_date||end>limits.max_date||end<limits.min_date||start>limits.max_date)return `El periodo debe estar entre ${limits.min_date} y ${limits.max_date}. Revisa el año completo; no se corregirá automáticamente.`;
  if(start>end)return 'La fecha inicial no puede ser posterior a la fecha final.';
  if((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/DAY+1>limits.max_days)return `Consulta como máximo ${limits.max_days} días inclusive.`;
  return '';
}
export function showDateValidation(limits){
  const message=validatePeriod($('start').value,$('end').value,limits);
  $('date-error').hidden=!message;$('date-error').textContent=message;
  ['start','end'].forEach(id=>$(id).setAttribute('aria-invalid',String(Boolean(message))));
  return !message;
}
export function clearClimate(message='Consulta un periodo para ver temperatura y humedad históricas.'){
  $('climate-summary').replaceChildren();$('climate-charts').replaceChildren();
  const p=document.createElement('p');p.className='chart-empty';p.textContent=message;$('climate-charts').append(p);
}
function stat(values){return values.length?{mean:values.reduce((sum,v)=>sum+v,0)/values.length,min:Math.min(...values),max:Math.max(...values)}:null;}
const finite=value=>typeof value==='number'&&Number.isFinite(value);
function svgNode(name,attrs,text){const el=document.createElementNS('http://www.w3.org/2000/svg',name);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,String(v)));if(text!==undefined)el.textContent=text;return el;}
export function renderClimate(data,start,end){
  clearClimate();$('climate-charts').replaceChildren();
  const period=document.createElement('p');period.className='period-caption';period.textContent=`Resumen del ${start} al ${end} · promedios diarios terrestres (UTC).`;$('climate-summary').append(period);
  const expected=(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/DAY+1;
  for(const [key,title,unit,tint] of [['temperature_c','Temperatura media diaria','°C','#edb08a'],['humidity_pct','Humedad relativa media diaria','%','#78d6d1']]){
    const valid=data.readings.filter(row=>finite(row[key])),stats=stat(valid.map(row=>row[key]));
    const card=document.createElement('div');card.className='climate-stat';
    const heading=document.createElement('span');heading.textContent=title;
    const value=document.createElement('strong');value.textContent=stats?`${fmt(stats.mean)} ${unit}`:'Sin datos';
    const detail=document.createElement('small');detail.textContent=stats?`Media del periodo · mínimo ${fmt(stats.min)} / máximo ${fmt(stats.max)} ${unit} · ${valid.length}/${expected} días con dato`:`0/${expected} días con dato; no se sustituye por cero.`;
    card.append(heading,value,detail);$('climate-summary').append(card);
    const figure=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=`${title} (${unit})`;figure.append(caption);
    if(!stats){const p=document.createElement('p');p.className='chart-empty';p.textContent='No hay valores disponibles para esta variable en el periodo.';figure.append(p);$('climate-charts').append(figure);continue;}
    const w=480,h=200,left=52,right=18,top=15,bottom=42;
    const min=key==='humidity_pct'?Math.min(0,stats.min):stats.min-Math.max(1,(stats.max-stats.min)*.15);
    const max=key==='humidity_pct'?Math.max(100,stats.max):stats.max+Math.max(1,(stats.max-stats.min)*.15);
    const first=Date.parse(start+'T00:00:00Z'),last=Date.parse(end+'T00:00:00Z');
    const x=date=>left+(last===first?.5:(Date.parse(date+'T00:00:00Z')-first)/(last-first))*(w-left-right);
    const y=value=>top+(max-value)/(max-min)*(h-top-bottom);
    const svg=svgNode('svg',{viewBox:`0 0 ${w} ${h}`,role:'img','aria-label':`${title}, ${start} a ${end}. ${valid.length} de ${expected} días con datos. Los huecos indican valores ausentes.`});
    for(let i=0;i<3;i++){const v=min+(max-min)*i/2;svg.append(svgNode('line',{x1:left,x2:w-right,y1:y(v),y2:y(v),stroke:'#34485b','stroke-width':1}),svgNode('text',{x:left-8,y:y(v)+5,'text-anchor':'end',fill:'#aabccd','font-size':15},fmt(v,0)));}
    const dates=start===end?[start]:[start,end];dates.forEach((date,i)=>svg.append(svgNode('text',{x:x(date),y:h-12,'text-anchor':dates.length===1?'middle':i?'end':'start',fill:'#aabccd','font-size':15},date.split('-').reverse().join('/'))));
    let path='',previous=null;
    for(const row of [...data.readings].sort((a,b)=>a.date.localeCompare(b.date))){
      if(!finite(row[key])){previous=null;continue;}
      const timestamp=Date.parse(row.date+'T00:00:00Z');
      path+=`${previous!==null&&timestamp-previous===DAY?'L':'M'}${x(row.date)},${y(row[key])} `;previous=timestamp;
    }
    svg.append(svgNode('path',{d:path,fill:'none',stroke:tint,'stroke-width':2.5}));
    valid.forEach(row=>{const dot=svgNode('circle',{cx:x(row.date),cy:y(row[key]),r:valid.length>31?2:3.5,fill:tint});dot.append(svgNode('title',{},`${row.date}: ${fmt(row[key])} ${unit}`));svg.append(dot);});
    figure.append(svg);$('climate-charts').append(figure);
  }
}
export function explainComparison(catalogue,reference,selected,labels){
  const best=[...catalogue.candidates].sort((a,b)=>a.pca_distance-b.pca_distance)[0];
  $('best-match').textContent=`Entre los ${catalogue.candidates.length} candidatos fijos analizados, ${best.name} tiene la menor distancia PCA (${fmt(best.pca_distance,3)}) y el mayor parecido descriptivo con Jezero. Esto no es una búsqueda global.`;
  const a=reference.features,b=selected.features;
  const closest=Object.entries(selected.comparison.differences).sort((a,b)=>Math.abs(a[1].standardized_delta)-Math.abs(b[1].standardized_delta))[0];
  const strongest=Object.entries(selected.comparison.differences).sort((a,b)=>Math.abs(b[1].pca_squared_contribution)-Math.abs(a[1].pca_squared_contribution))[0];
  $('selected-explanation').textContent=`En ${selected.name}, el relieve P95−P05 es ${fmt(b.relief_p95_p05_m)} m frente a ${fmt(a.relief_p95_p05_m)} m en Jezero; la pendiente media es ${fmt(b.slope_mean_deg,2)}° frente a ${fmt(a.slope_mean_deg,2)}°. La variable con menor diferencia estandarizada es ${labels[closest[0]][0].toLowerCase()}. El mayor aporte en magnitud a la distancia PCA² procede de ${labels[strongest[0]][0].toLowerCase()}; puede reflejar relaciones entre variables, no una causa física.`;
}
