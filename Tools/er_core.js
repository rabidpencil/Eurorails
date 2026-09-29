// ---- Eurorails planning core (forked from the Empire Builder core.js) ----
// Changes from EB: edges carry a kind (0 normal, 1 ferry, 2 chunnel, 3 inside a major city);
// ferries cost extra movement (stop at the port, next turn from the far port at half speed);
// the chunnel is closed to an un-upgraded Freight (the digital game enforces this);
// the circus is optional and configurable.
function makeCore(G, CARDS, CITIES){
  const N=G.cells.length, COST=G.cost;
  const adj=Array.from({length:N},()=>[]);
  const ekey=(u,v)=>u<v?u+'_'+v:v+'_'+u;
  for(const [u,v,s,k] of G.edges){ adj[u].push([v,s,k||0]); adj[v].push([u,s,k||0]); }
  const KIND={}; for(const [u,v,s,k] of G.edges) if(k) KIND[ekey(u,v)]=k;
  // options set by the app before planning
  const OPT={speed:9, loads:2, circusMod:0, circusReplaces:false, circusHome:['kaliningrad','paris']};
  function setOptions(o){ Object.assign(OPT,o||{}); }
  const chunnelOK=()=>!(OPT.speed===9&&OPT.loads===2);   // Freight may not build or ride the chunnel
  // Expected movement a ferry crossing costs: the rest of the turn you arrive at the
  // port (on average (speed-1)/2) plus what half speed loses on the next turn.
  const ferryMoves=()=>Math.round((OPT.speed-1)/2 + OPT.speed - Math.floor((OPT.speed+1)/2));
  function mw(k){ return k===1?ferryMoves() : k===2?(chunnelOK()?1:Infinity) : 1; }
  const norm=s=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const NAME={}, SRC={};
  for(const c of CITIES){ NAME[c.key]=c.name;
    for(const l of c.loads){ const k=l.toLowerCase(); (SRC[k]=SRC[k]||[]).push(c.key); } }
  const CITY=G.city;

  // How attractive a city is to be connected to, from the cards themselves:
  // how often it is a destination (and for how much), plus how much demand its
  // goods can feed, divided by how many rival cities also produce them.
  const VALUE=(()=>{
    const demN={},demP={},loadN={},loadP={},prod={};
    for(const k in CARDS) for(const d of CARDS[k]){
      const c=norm(d.city); demN[c]=(demN[c]||0)+1; demP[c]=(demP[c]||0)+d.payout;
      const l=d.load.toLowerCase(); loadN[l]=(loadN[l]||0)+1; loadP[l]=(loadP[l]||0)+d.payout;
    }
    for(const c of CITIES) for(const l of c.loads){ const k=l.toLowerCase(); (prod[k]=prod[k]||[]).push(c.key); }
    const v={};
    for(const c of CITIES){
      let sup=0;
      for(const l of c.loads){ const k=l.toLowerCase();
        if(loadN[k]) sup += loadN[k]*(loadP[k]/loadN[k])/Math.max((prod[k]||[]).length,1); }
      v[c.key]=(demP[c.key]||0)+sup;
    }
    const mx=Math.max(...Object.values(v));
    for(const k in v) v[k]=Math.round(100*v[k]/mx);
    return v;
  })();
  const NODE2CITY={}; for(const k in CITY) NODE2CITY[CITY[k]]=k;

  class PQ{ constructor(){this.a=[];}
    push(x){const a=this.a;a.push(x);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p][0]<=a[i][0])break;[a[p],a[i]]=[a[i],a[p]];i=p;}}
    pop(){const a=this.a,t=a[0],l=a.pop();if(a.length){a[0]=l;let i=0;for(;;){const x=2*i+1,y=x+1;let m=i;
      if(x<a.length&&a[x][0]<a[m][0])m=x; if(y<a.length&&a[y][0]<a[m][0])m=y; if(m===i)break;[a[m],a[i]]=[a[i],a[m]];i=m;}}return t;}
    get size(){return this.a.length;} }

  // build weight of entering v across edge (u,v): free if that track is already owned
  function w(u,v,s,owned,k){ if(k===2&&!chunnelOK()) return Infinity;
    return owned.has(ekey(u,v))?0:COST[v]+s; }

  function dijkstra(src,owned){
    const d=new Float64Array(N).fill(Infinity); d[src]=0;
    const pq=new PQ(); pq.push([0,src]);
    while(pq.size){ const [c,u]=pq.pop(); if(c>d[u])continue;
      for(const [v,s,k] of adj[u]){ const nc=c+w(u,v,s,owned,k); if(nc<d[v]){d[v]=nc;pq.push([nc,v]);} } }
    return d;
  }

  function steiner(terms,owned,wf){
    const W=wf||((u,v,sg,k)=>w(u,v,sg,owned,k));
    const t=[...new Set(terms)], k=t.length;
    if(k===1) return {cost:0,nodes:new Set([t[0]])};
    const F=1<<k, dp=[], par=[];
    for(let m=0;m<F;m++){ dp.push(new Float64Array(N).fill(Infinity)); par.push(new Array(N).fill(null)); }
    t.forEach((v,i)=>dp[1<<i][v]=0);
    for(let m=1;m<F;m++){
      const row=dp[m];
      for(let sub=(m-1)&m; sub; sub=(sub-1)&m){ const o=m^sub; if(sub>o)continue;
        const a=dp[sub],b=dp[o];
        for(let v=0;v<N;v++){ const s=a[v]+b[v]; if(s<row[v]){row[v]=s;par[m][v]=['m',sub,o];} } }
      const pq=new PQ();
      for(let v=0;v<N;v++) if(row[v]<Infinity) pq.push([row[v],v]);
      while(pq.size){ const [c,u]=pq.pop(); if(c>row[u])continue;
        for(const [v,sg,k] of adj[u]){ const nc=c+W(u,v,sg,k); if(nc<row[v]){row[v]=nc;par[m][v]=['e',u];pq.push([nc,v]);} } }
    }
    const full=F-1; let root=0;
    for(let v=1;v<N;v++) if(dp[full][v]<dp[full][root]) root=v;
    const nodes=new Set(), tedges=new Set(), st=[[full,root]];
    while(st.length){ const [m,v]=st.pop(); nodes.add(v); const p=par[m][v];
      if(!p)continue;
      if(p[0]==='m'){st.push([p[1],v]);st.push([p[2],v]);}
      else { tedges.add(ekey(p[1],v)); st.push([m,p[1]]); } }
    return {cost:dp[full][root],nodes,edges:tedges};
  }

  function tourMoves(nodes,stops,owned,start,tedges){
    const ok=e=>owned.has(e)||(tedges&&tedges.has(e));
    const sub=new Set(nodes);
    for(const e of owned){ const [a,b]=e.split('_').map(Number); sub.add(a); sub.add(b); }
    const bfs=s=>{ const d=new Map([[s,0]]); const pq=new PQ(); pq.push([0,s]);
      while(pq.size){ const [c,u]=pq.pop(); if(c>d.get(u)) continue;
        for(const [v,,k] of adj[u]){ if(!ok(ekey(u,v))) continue; const nc=c+mw(k);
          if(nc<(d.has(v)?d.get(v):Infinity)){ d.set(v,nc); pq.push([nc,v]); } } }
      return d; };
    for(const s of stops) if(s===undefined||s===null) throw new Error('bad stop node');
    const D=new Map(); for(const s of new Set(stops)) D.set(s,bfs(s));
    if(start!==undefined&&start!==null&&!D.has(start)) D.set(start,bfs(start));
    const n=stops.length; let best=Infinity;
    const perm=(arr,cur)=>{ if(!arr.length){
        const pos=new Map(cur.map((x,i)=>[x,i]));
        for(let j=0;j*2+1<n;j++) if(pos.get(j*2)>pos.get(j*2+1)) return;
        let tot=0;
        if(start!==undefined&&start!==null){ const v=D.get(start).get(stops[cur[0]]); if(v===undefined) return; tot+=v; }
        for(let i=0;i+1<cur.length;i++){ const d=D.get(stops[cur[i]]); const v=d.get(stops[cur[i+1]]);
          if(v===undefined) return; tot+=v; }
        if(tot<best) best=tot; return; }
      for(let i=0;i<arr.length;i++) perm(arr.filter((_,j)=>j!==i),cur.concat(arr[i])); };
    perm([...Array(n).keys()],[]);
    return best;
  }

  // Circus (optional). On a card whose number is a multiple of OPT.circusMod the circus
  // can be hauled to that card's lowest-paying city for a flat 20M; the chip then lives
  // there. Two chips exist. With OPT.circusReplaces (the printed Eurorails variant) the
  // lowest demand is replaced by the circus; otherwise (house rule) it is an extra option.
  function demandsOf(cardNo){ const ds=CARDS[cardNo]||[];
    if(!(OPT.circusReplaces && circusOption(cardNo))) return ds;
    let lo=0; ds.forEach((d,i)=>{ if(d.payout<ds[lo].payout) lo=i; });
    return ds.filter((_,i)=>i!==lo); }
  function circusOption(cardNo){
    const ds=CARDS[cardNo]; if(!ds) return null;
    if(!OPT.circusMod || Number(cardNo)%OPT.circusMod!==0) return null;
    let lo=ds[0]; for(const d of ds) if(d.payout<lo.payout) lo=d;
    return {circus:true,load:'circus',city:lo.city,payout:20};
  }

  // cheapest connection between two cities, for entering track by hand
  function connect(aKey,bKey,owned,fewestMoves){
    owned=owned||new Set();
    const wt=fewestMoves ? ((u,v,sg,k)=>mw(k)) : ((u,v,sg,k)=>w(u,v,sg,owned,k));
    const src=CITY[aKey], dst=CITY[bKey];
    if(src===undefined||dst===undefined) return null;
    const d=new Float64Array(N).fill(Infinity), prev=new Int32Array(N).fill(-1);
    d[src]=0; const pq=new PQ(); pq.push([0,src]);
    while(pq.size){ const [c,u]=pq.pop(); if(c>d[u])continue; if(u===dst)break;
      for(const [v,sg,k] of adj[u]){ const nc=c+wt(u,v,sg,k); if(nc<d[v]){d[v]=nc;prev[v]=u;pq.push([nc,v]);} } }
    if(d[dst]===Infinity) return null;
    const edges=[]; let v=dst;
    while(prev[v]>=0){ edges.push(ekey(prev[v],v)); v=prev[v]; }
    const fresh=edges.filter(e=>!owned.has(e));
    const moves=edges.reduce((t,e)=>t+mw(KIND[e]||0),0);
    return {cost:treeCost(new Set(edges),owned,src),moves,edges,newSegments:fresh.length};
  }

  function treeCost(tedges,owned,root){
    const nb={}; for(const e of tedges){ const [a,b]=e.split('_').map(Number);
      (nb[a]=nb[a]||[]).push(b); (nb[b]=nb[b]||[]).push(a); }
    const surch={}; for(const [u,v,sg] of G.edges) if(sg) surch[ekey(u,v)]=sg;
    let tot=0; const seen=new Set([root]), q=[root];
    while(q.length){ const u=q.shift();
      for(const v of (nb[u]||[])) if(!seen.has(v)){ seen.add(v);
        const e=ekey(u,v);
        if(!owned.has(e)) tot += COST[v] + (surch[e]||0);
        q.push(v); } }
    return tot;
  }

  function plan(hand,loads,speed,owned,topn,circus,startKey,carrying,routes){
    owned=owned||new Set();
    // a chip can be parked in a city, riding on your train ('aboard'), or held
    // by someone else ('taken') and therefore unusable
    circus=(circus&&circus.length?circus:OPT.circusHome).map(norm);
    const chips=OPT.circusMod ? circus.filter(x=>x!=='taken') : [];
    const CD={}; for(const k in CITY) CD[k]=dijkstra(CITY[k],owned);
    carrying=carrying||[];
    const held=carrying.map(c=>({card:c.card,d:Object.assign({},CARDS[c.card][c.idx],{held:true})}));
    const want=Math.max(0,Math.min(routes||loads,loads)-held.length);
    const usedCards=new Set(held.map(h=>h.card));
    hand=hand.filter(h=>!usedCards.has(h));
    const combos=[];
    const pick=(idx,chosen)=>{ if(chosen.length===want){ combos.push(held.concat(chosen)); return; }
      for(let i=idx;i<hand.length;i++){
        for(const d of demandsOf(hand[i])) pick(i+1,chosen.concat([{card:hand[i],d}]));
        const c=circusOption(hand[i]);
        if(c && chosen.filter(x=>x.d.circus).length < chips.length)
          pick(i+1,chosen.concat([{card:hand[i],d:c}]));
      } };
    pick(0,[]);
    const cand=[];
    for(const combo of combos){
      // a load already aboard needs no pickup: its leg starts wherever the train is
      const srcLists=combo.map(c=> c.d.held ? [startKey||norm(c.d.city)]
                                : c.d.circus ? [...new Set(chips)] : (SRC[c.d.load.toLowerCase()]||[]));
      const walk=(i,acc)=>{ if(i===srcLists.length){
          // don't take more chips out of a city than are parked there
          // a chip already sitting in the destination city isn't a delivery
          for(let j=0;j<combo.length;j++)
            if(combo[j].d.circus && acc[j]!=='aboard' && acc[j]===norm(combo[j].d.city)) return;
          const need={}; combo.forEach((c,j)=>{ if(c.d.circus) need[acc[j]]=(need[acc[j]]||0)+1; });
          for(const k in need){ const have=chips.filter(x=>x===k).length; if(need[k]>have) return; }
          const terms=[]; combo.forEach((c,j)=>{
            if(!c.d.held && acc[j]!=='aboard') terms.push(acc[j]);
            terms.push(norm(c.d.city)); });
          const uniq=[...new Set(terms)];
          let bound=0; const inn=new Set([uniq[0]]);
          while(inn.size<uniq.length){ let bd=Infinity,bn=null;
            for(const x of inn) for(const y of uniq) if(!inn.has(y)){ const v=CD[x][CITY[y]]; if(v<bd){bd=v;bn=y;} }
            bound+=bd; inn.add(bn); }
          cand.push({bound,combo,srcs:acc.slice(),terms});
          return; }
        for(const s of srcLists[i]) walk(i+1,acc.concat([s])); };
      walk(0,[]);
    }
    cand.sort((a,b)=>a.bound-b.bound);
    const out=[];
    for(const c of cand.slice(0,topn||8)){
      const tn=c.terms.map(k=>CITY[k]);
      const tn2=startKey?tn.concat([CITY[startKey]]):tn;
      const tre=steiner(tn2,owned); const cost=tre.cost, nodes=tre.nodes;
      const fast=steiner(tn2,owned,(u,v,sg,k)=>mw(k));
      const stops=[]; c.combo.forEach((x,j)=>{
        if(!x.d.held && c.srcs[j]!=='aboard') stops.push(CITY[c.srcs[j]]);
        stops.push(CITY[norm(x.d.city)]); });
      const mv=tourMoves(nodes,stops,owned,startKey?CITY[startKey]:null,tre.edges);
      const fmv=tourMoves(fast.nodes,stops,owned,startKey?CITY[startKey]:null,fast.edges);
      const fcost=treeCost(fast.edges,owned,tn2[0]);
      // cities this plan newly connects, and what they are worth
      const already=new Set();
      for(const e of owned){ const [a,b]=e.split('_').map(Number);
        if(NODE2CITY[a])already.add(NODE2CITY[a]); if(NODE2CITY[b])already.add(NODE2CITY[b]); }
      let reach=0; const newCities=[];
      for(const nd of nodes){ const ck=NODE2CITY[nd];
        if(ck&&!already.has(ck)){ reach+=VALUE[ck]||0; newCities.push(NAME[ck]); } }
      const turns=Math.max(1,Math.ceil(mv/speed));
      out.push({build:cost,moves:mv,turns,reach,newCities,
        perTurn:Math.round(c.combo.reduce((s,x)=>s+x.d.payout,0)/turns),
        payout:c.combo.reduce((s,x)=>s+x.d.payout,0),
        legs:c.combo.map((x,j)=>({card:x.card,load:x.d.load,circus:!!x.d.circus,held:!!x.d.held,
          from:(x.d.held||c.srcs[j]==='aboard')?'aboard':(NAME[c.srcs[j]]||c.srcs[j]),
          to:x.d.city,pay:x.d.payout})),
        fastBuild:fcost, fastMoves:fmv, fastTurns:Math.max(1,Math.ceil(fmv/speed)),
        nodes:[...nodes], edges:[...tre.edges],
        fastNodes:[...fast.nodes], fastEdges:[...fast.edges]});
    }
    return out;   // caller sorts
  }
  function sortBy(res,mode){
    const r=res.slice();
    if(mode==='perTurn') r.sort((a,b)=>b.perTurn-a.perTurn || a.build-b.build);
    else if(mode==='moves') r.sort((a,b)=>a.moves-b.moves || a.build-b.build);
    else if(mode==='reach') r.sort((a,b)=>(b.reach-b.build*2)-(a.reach-a.build*2) || a.build-b.build);
    else r.sort((a,b)=>a.build-b.build || a.moves-b.moves);
    return r;
  }
  return {plan,sortBy,connect,NAME,CITY,ekey,norm,VALUE,NODE2CITY,CARDS,setOptions,circusOption,demandsOf,OPT,KIND};
}
if(typeof module!=='undefined') module.exports={makeCore};
