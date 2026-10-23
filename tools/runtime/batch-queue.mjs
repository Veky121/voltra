import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function transact(statePath, operation) {
  fs.mkdirSync(path.dirname(statePath), {recursive: true});
  const lock = statePath + '.lock';
  // A crashed owner leaves a visible lock. Do not guess that its resources are free.
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {schema_version: 1, claims: []};
    const result = operation(state);
    const tmp = statePath + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', {mode: 0o600});
    fs.renameSync(tmp, statePath);
    return result;
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
function positive(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw Error(`${name} must be a positive integer`);
  return value;
}
export function claim(state, plan, request, limits) {
  for (const key of ['memory_mib','disk_mib','ports']) positive(request[key], key);
  for (const key of ['memory_mib','disk_mib','max_active','port_min','port_max']) positive(limits[key], key);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(request.owner || '')) throw Error('owner must be a short non-secret worker label');
  const game = plan.games.find(g => g.path === request.game);
  if (!game || game.state !== 'queued') throw Error('game is absent or reserved for existing review');
  const reservation = (state.reservations || []).find(r=>r.game===request.game);
  if (reservation && reservation.owner!==request.owner) throw Error('game reserved by another worker');
  if (state.claims.some(c => c.game === request.game && c.status !== 'released')) throw Error('game already claimed or finished');
  const active = state.claims.filter(c => c.status === 'active');
  const reserve = limits.reserved_disk_mib ?? 20480;
  if (!Number.isSafeInteger(reserve) || reserve < 0) throw Error('reserved_disk_mib must be a nonnegative integer');
  if (active.length >= limits.max_active || active.reduce((s,c)=>s+c.memory_mib,0)+request.memory_mib > limits.memory_mib || active.reduce((s,c)=>s+c.disk_mib,0)+request.disk_mib+reserve > limits.disk_mib) throw Error('resource budget exhausted');
  const used = new Set(active.flatMap(c => c.ports));
  let ports;
  for (let first=limits.port_min; first+request.ports-1<=limits.port_max; first++) {
    const candidate = Array.from({length:request.ports},(_,i)=>first+i);
    if (candidate.every(p=>!used.has(p))) { ports=candidate; break; }
  }
  if (!ports) throw Error('port pool exhausted');
  const row = {lease_id:crypto.randomUUID(), owner:request.owner, game:request.game, memory_mib:request.memory_mib, disk_mib:request.disk_mib, ports, status:'active', claimed_at:new Date().toISOString()};
  state.claims.push(row); return row;
}
export function release(state, id, owner, outcome, resourcesRemoved) {
  const row = state.claims.find(c=>c.lease_id===id && c.owner===owner && c.status==='active');
  if (!row) throw Error('no matching active owner lease');
  if (!resourcesRemoved) throw Error('release requires explicit confirmation that owned servers and allocations are removed');
  if (!['released','blocked','tested'].includes(outcome)) throw Error('outcome must be released, blocked or tested');
  row.status=outcome; row.finished_at=new Date().toISOString();
  // tested is an observation, never an automatic catalog runtime_verified promotion.
  return row;
}
export function resize(state, request, limits) {
  positive(request.memory_mib,'memory_mib');positive(limits.memory_mib,'memory budget');
  const row=state.claims.find(c=>c.lease_id===request.lease_id && c.owner===request.owner && c.status==='active');
  if(!row)throw Error('No owned active lease to resize');
  if(request.stopped_confirmed!==true)throw Error('Memory resize requires confirmed stopped native server');
  const used=state.claims.filter(c=>c.status==='active' && c!==row).reduce((sum,c)=>sum+c.memory_mib,0);
  if(used+request.memory_mib>limits.memory_mib)throw Error('Memory budget exhausted');
  row.resource_changes ||= [];row.resource_changes.push({previous_memory_mib:row.memory_mib,memory_mib:request.memory_mib,at:new Date().toISOString()});
  row.memory_mib=request.memory_mib;return row;
}
export function replacePort(state, request, limits) {
  const row=state.claims.find(c=>c.lease_id===request.lease_id && c.owner===request.owner && c.status==='active');
  if(!row)throw Error('No owned active lease for port replacement');
  if(request.stopped_confirmed!==true)throw Error('Port replacement requires confirmed stopped native server and installer');
  for(const key of ['from_port','to_port']){positive(request[key],key);if(request[key]>65535)throw Error('Port outside native range');}
  positive(limits.port_min,'port_min');positive(limits.port_max,'port_max');
  if(request.to_port<limits.port_min || request.to_port>limits.port_max)throw Error('Replacement port outside reviewed range');
  if(!row.ports.includes(request.from_port))throw Error('Old port is not reserved by this lease');
  if(state.claims.some(c=>c.status==='active' && c.ports.includes(request.to_port)))throw Error('Replacement port already reserved');
  row.port_changes ||= [];row.port_changes.push({from_port:request.from_port,to_port:request.to_port,at:new Date().toISOString()});
  row.ports=row.ports.map(p=>p===request.from_port?request.to_port:p);return row;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, input='{}'] = process.argv.slice(2);
  const args=JSON.parse(input);
  const statePath=path.resolve(process.env.GAME_BATCH_STATE || path.join(root,'.local/game-batch/queue.json'));
  const result=transact(statePath,state=>{
    if(command==='status') return state;
    if(command==='release') return release(state,args.lease_id,args.owner,args.outcome,args.resources_removed===true);
    if(command==='resize') return resize(state,args,args.limits||{});
    if(command==='replace-port') return replacePort(state,args,args.limits||{});
    if(command==='requeue') {
      const row=state.claims.find(c=>c.lease_id===args.lease_id && c.owner===args.owner);
      if(!row || !['tested','blocked'].includes(row.status)) throw Error('requeue requires owned cleaned terminal lease');
      row.previous_outcome=row.status; row.status='released'; row.requeued_at=new Date().toISOString(); return row;
    }
    if(command==='reserve') {
      if(!/^[a-zA-Z0-9_-]{1,64}$/.test(args.owner || '')) throw Error('invalid owner');
      const plan=JSON.parse(fs.readFileSync(path.join(root,'artifacts/game-batch-plan.json'),'utf8'));
      const game=plan.games.find(g=>g.path===args.game && g.state==='queued');
      if(!game) throw Error('game absent or already reviewed');
      state.reservations ||= [];
      const existing=state.reservations.find(r=>r.game===args.game);
      if(existing && existing.owner!==args.owner) throw Error('reserved by another worker');
      if(existing) return existing;
      const row={owner:args.owner,game:args.game}; state.reservations.push(row); return row;
    }
    if(command!=='claim') throw Error('usage: batch-queue.mjs claim|release|status JSON');
    const plan=JSON.parse(fs.readFileSync(path.join(root,'artifacts/game-batch-plan.json'),'utf8'));
    if(!args.limits) throw Error('claim requires explicit node resource/port limits');
    return claim(state,plan,args,args.limits);
  });
  console.log(JSON.stringify(result,null,2));
}
