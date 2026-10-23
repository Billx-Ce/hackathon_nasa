// Reception age is anchored to server UTC, advanced by a monotonic local timer.
export function createTelemetryPanel(){
  const history=new Map();let active=null,failed=false;
  const panel=document.createElement('div');panel.id='station-receptions';
  document.getElementById('storage').after(panel);
  function draw(){
    panel.replaceChildren();const cached=history.get(active);
    if(!cached){panel.textContent=failed?'Estado de estaciones no disponible: falló la consulta.':'Consultando el estado de las estaciones…';return;}
    if(cached.stations===null){panel.textContent='Historial disponible, pero el servidor no proporcionó el estado horario de las estaciones. Actualiza el servidor.';return;}
    if(!cached.stations.length){panel.textContent=failed?'Última consulta exitosa: sin mediciones. No se pudo comprobar si llegaron nuevas.':'Sin mediciones recibidas';return;}
    for(const station of cached.stations){
      const age=station.elapsed_seconds+(performance.now()-cached.anchor)/1000;
      const card=document.createElement('div');card.className='reception-card';card.dataset.station=station.station_id;
      const label=document.createElement('strong');label.textContent=station.station_id;
      const state=document.createElement('span');state.dataset.state=age<60?'receiving':'stale';
      state.textContent=(failed?'Último estado conocido · ':'')+(age<60?'Recibiendo datos':'Sin datos recientes');
      const time=document.createElement('small');
      const seconds=Math.floor(age),elapsed=seconds<60?`${seconds} s`:`${Math.floor(seconds/60)} min ${seconds%60} s`;
      time.textContent=`Última recepción: ${new Date(station.last_received_at).toISOString().replace('T',' ').replace('Z',' UTC')} · hace ${elapsed}.`;
      card.append(label,state,time);panel.append(card);
    }
  }
  setInterval(draw,1000);
  return {
    loading(site){if(active!==site)failed=false;active=site;draw();return history.get(site)?.readings||null;},
    success(site,data){
      const unique=new Map();for(const row of data.readings)unique.set(row.id??JSON.stringify([row.station_id,row.received_at,row.temperature_c,row.humidity_pct]),row);
      const readings=[...unique.values()];
      const stations=data.stations||(readings.length?null:[]);
      history.set(site,{readings,stations,anchor:performance.now()});active=site;failed=false;draw();return readings;
    },
    failure(site){active=site;failed=true;draw();return history.get(site)?.readings||null;}
  };
}
