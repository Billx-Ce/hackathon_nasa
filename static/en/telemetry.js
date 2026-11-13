// Reception age is anchored to server UTC, advanced by a monotonic local timer.
export function createTelemetryPanel(){
  const history=new Map();let active=null,failed=false;
  const panel=document.createElement('div');panel.id='station-receptions';
  document.getElementById('storage').after(panel);
  function draw(){
    panel.replaceChildren();const cached=history.get(active);
    if(!cached){panel.textContent=failed?'Station status unavailable: query failed.':'Querying station status…';return;}
    if(cached.stations===null){panel.textContent='History is available, but the server did not provide station reception times. Update the server.';return;}
    if(!cached.stations.length){panel.textContent=failed?'Last successful query: no readings. Could not check for new arrivals.':'No readings received';return;}
    for(const station of cached.stations){
      const age=station.elapsed_seconds+(performance.now()-cached.anchor)/1000;
      const card=document.createElement('div');card.className='reception-card';card.dataset.station=station.station_id;
      const label=document.createElement('strong');label.textContent=station.station_id;
      const state=document.createElement('span');state.dataset.state=age<60?'receiving':'stale';
      state.textContent=(failed?'Last known status · ':'')+(age<60?'Receiving data':'No recent data');
      const time=document.createElement('small');
      const seconds=Math.floor(age),elapsed=seconds<60?`${seconds} s`:`${Math.floor(seconds/60)} min ${seconds%60} s`;
      time.textContent=`Last reception: ${new Date(station.last_received_at).toISOString().replace('T',' ').replace('Z',' UTC')} · elapsed ${elapsed}.`;
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
