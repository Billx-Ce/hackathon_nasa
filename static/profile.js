// Sample rows from the original grids. Camera and exaggeration never enter this chart.
const NS='http://www.w3.org/2000/svg';
function node(tag,attributes={},text){
  const element=document.createElementNS(NS,tag);
  for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));
  if(text!==undefined)element.textContent=text;
  return element;
}
export function renderProfile(reference,selected,row){
  const english=document.documentElement.lang==='en',locale=english?'en-US':'es-PE';
  const host=document.getElementById('terrain-profile');host.replaceChildren();
  const series=[{name:'Jezero',color:'#edb08a',values:reference.relative_elevation_m[row]},
    {name:selected.name,color:'#78d6d1',values:selected.relative_elevation_m[row]}];
  // Fixed extent over both complete windows keeps row-to-row comparisons honest.
  const extent=Math.max(1,...reference.relative_elevation_m.flat().map(Math.abs),...selected.relative_elevation_m.flat().map(Math.abs));
  const limit=Math.ceil(extent/10)*10;
  const width=Math.max(440,Math.min(900,host.clientWidth)),height=260,left=75,right=25,top=25,bottom=45;
  const x=i=>left+i/19*(width-left-right);
  const y=value=>top+(limit-value)/(2*limit)*(height-top-bottom);
  const svg=node('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':english?'West to east terrain cross section, relative elevation in meters':'Corte del terreno de oeste a este, elevación relativa en metros'});
  for(const value of [-limit,0,limit]){
    svg.append(node('line',{x1:left,x2:width-right,y1:y(value),y2:y(value),stroke:value===0?'#607c8e':'#253447','stroke-dasharray':value===0?'5 5':'none'}));
    svg.append(node('text',{x:left-10,y:y(value)+4,fill:'#adc0d0','text-anchor':'end','font-size':12},`${value.toLocaleString(locale)} m`));
  }
  for(const i of [0,4,8,12,16,19]){
    svg.append(node('text',{x:x(i),y:height-20,fill:'#adc0d0','text-anchor':'middle','font-size':12},`${(.25+i*.5).toLocaleString(locale)} km`));
  }
  const key=document.createElement('div');key.className='profile-key';
  for(const item of series){
    svg.append(node('path',{d:item.values.map((value,i)=>`${i?'L':'M'}${x(i)},${y(value)}`).join(' '),fill:'none',stroke:item.color,'stroke-width':2.5}));
    item.values.forEach((value,i)=>{
      const point=node('circle',{cx:x(i),cy:y(value),r:3,fill:item.color});
      point.append(node('title',{},`${item.name} · ${(.25+i*.5).toLocaleString(locale)} km · ${value.toLocaleString(locale,{maximumFractionDigits:1})} m`));svg.append(point);
    });
    const label=document.createElement('span');label.style.setProperty('--profile-color',item.color);label.textContent=item.name;key.append(label);
  }
  host.append(key,svg);
  const northKm=10-(row+.5)*.5;
  document.getElementById('profile-caption').textContent=english
    ?`Row ${row+1} of 20 · ${northKm.toLocaleString(locale)} km north of the southern window edge. The same relative row is sampled in both windows, not a shared geographic transect.`
    :`Fila ${row+1} de 20 · ${northKm.toLocaleString(locale)} km al norte del borde sur de cada ventana. Se compara la misma fila relativa de ambos recortes, no un transecto geográfico compartido.`;
}
