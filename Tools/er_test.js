// Quick regression check for the Eurorails core:  node Tools/er_test.js
const {makeCore}=require('./er_core.js');
const G=require('./er-plan-graph.json');
const core=makeCore(G,require('../Cards/er-demand-cards.json'),require('../Map/er-cities.json').cities);
const assert=(c,m)=>{ if(!c){ console.error('FAIL:',m); process.exitCode=1; } else console.log('ok  ',m); };
const kinds=r=>r.edges.map(e=>core.KIND[e]||0);

core.setOptions({speed:9,loads:2});
let r=core.connect('london','paris',new Set(),true);
assert(!kinds(r).includes(2),'Freight never uses the Chunnel');
assert(kinds(r).includes(1),'Freight London-Paris goes by ferry');
core.setOptions({speed:12,loads:2});
r=core.connect('london','paris',new Set(),true);
assert(kinds(r).includes(2),'upgraded train takes the Chunnel when shortest');
assert(r.cost===30,'London-Paris via Chunnel costs 30 (includes 20 Chunnel and 5 to enter Paris) - got '+r.cost);
core.setOptions({speed:9,loads:2});
const p=core.plan(['1','2','3'],2,9,new Set(),10,null,null,[],2);
assert(p.length>0,'plan returns options for cards 1,2,3');
core.setOptions({circusMod:0});
assert(core.circusOption('10')===null,'circus off by default');
core.setOptions({circusMod:10,circusReplaces:true});
assert(core.circusOption('10')&&core.demandsOf('10').length===2,'rulebook circus replaces the lowest demand on card 10');
