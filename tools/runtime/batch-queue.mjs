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
function cleanupReceiptPath(value) {
  return typeof value==='string' && /^artifacts\/[a-zA-Z0-9_./-]+\.json$/.test(value) && !value.split('/').includes('..');
}
export function claim(state, plan, request, limits) {
  const game = plan.games.find(g => g.path === request.game);
  if (!game || game.state !== 'queued') throw Error('game is absent or reserved for existing review');
  if (request.kind === 'utility') throw Error('Use claim-utility for a utility task');
  const reservation = (state.reservations || []).find(r=>r.game===request.game);
  if (reservation && reservation.owner!==request.owner) throw Error('game reserved by another worker');
  return allocateLease(state,request,limits,false);
}
export function claimUtility(state, request, limits) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(request.task || '')) throw Error('utility task must be a short non-secret label');
  if (request.game !== undefined) throw Error('Utility tasks cannot claim a catalog recipe');
  return allocateLease(state,{...request,game:'utility/'+request.task},limits,true);
}
// A retry records a separate attempt. Never rewrite a tested/blocked outcome to
// released merely to make it claimable. The caller must freshly verify cleanup;
// this ledger records that review, it cannot inspect Wings or Docker itself.
export function claimReviewedRetry(state, plan, request, limits) {
  const game=plan.games.find(g=>g.path===request.game);
  if(!game || game.state!=='queued' || request.kind==='utility')throw Error('Retry requires a queued catalog game');
  const reservation=(state.reservations||[]).find(r=>r.game===request.game);
  if(reservation && reservation.owner!==request.owner)throw Error('game reserved by another worker');
  return reviewedRetry(state,request,limits,false);
}
export function claimReviewedUtilityRetry(state, request, limits) {
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(request.task||'') || request.game!==undefined)throw Error('Utility retry requires a task label, not a catalog recipe');
  return reviewedRetry(state,{...request,game:'utility/'+request.task},limits,true);
}
function reviewedRetry(state,request,limits,utility) {
  const previous=state.claims.filter(c=>c.game===request.game).at(-1);
  const review=request.retry_review;
  if(!previous || !['tested','blocked','released'].includes(previous.status) || !previous.finished_at || previous.lease_id!==review?.lease_id)throw Error('Retry requires the latest terminal lease');
  if(state.claims.some(c=>c.game===request.game && c.status==='active'))throw Error('game already claimed');
  if(review.game!==request.game || review.resources_removed!==true || !/^[a-zA-Z0-9_-]{1,64}$/.test(review.reviewer||'') || !cleanupReceiptPath(review.cleanup_receipt) || !/^[a-f0-9]{64}$/.test(review.cleanup_sha256||''))throw Error('Retry requires an exact cleanup review and receipt hash');
  if(utility && previous.kind!=='utility')throw Error('Utility retry requires a previous utility lease');
  const row=allocateLease(state,request,limits,utility,previous.lease_id);
  row.retry_of=previous.lease_id;
  row.retry_review=structuredClone(review);
  return row;
}
function allocateLease(state,request,limits,utility,retryOf) {
  for (const key of ['memory_mib','disk_mib']) positive(request[key], key);
  if (utility) {
    if (!Number.isSafeInteger(request.ports) || request.ports < 0) throw Error('utility ports must be a nonnegative integer');
  } else positive(request.ports,'ports');
  for (const key of ['memory_mib','disk_mib','max_active','port_min','port_max']) positive(limits[key], key);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(request.owner || '')) throw Error('owner must be a short non-secret worker label');
  if (!retryOf && state.claims.some(c => c.game === request.game && c.status !== 'released')) throw Error('game already claimed or finished');
  const active = state.claims.filter(c => c.status === 'active');
  const reserve = limits.reserved_disk_mib ?? 20480;
  if (!Number.isSafeInteger(reserve) || reserve < 0) throw Error('reserved_disk_mib must be a nonnegative integer');
  if (active.length >= limits.max_active || active.reduce((s,c)=>s+c.memory_mib,0)+request.memory_mib > limits.memory_mib || active.reduce((s,c)=>s+c.disk_mib,0)+request.disk_mib+reserve > limits.disk_mib) throw Error('resource budget exhausted');
  const used = new Set(active.flatMap(c => c.ports));
  let ports=utility && request.ports===0 ? [] : undefined;
  for (let first=limits.port_min; !ports && first+request.ports-1<=limits.port_max; first++) {
    const candidate = Array.from({length:request.ports},(_,i)=>first+i);
    if (candidate.every(p=>!used.has(p))) { ports=candidate; break; }
  }
  if (!ports) throw Error('port pool exhausted');
  const row = {lease_id:crypto.randomUUID(), owner:request.owner, game:request.game, memory_mib:request.memory_mib, disk_mib:request.disk_mib, ports, status:'active', claimed_at:new Date().toISOString()};
  if(utility){row.kind='utility';row.task=request.task;}
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
  const memoryChange=request.memory_mib!==undefined,diskChange=request.disk_mib!==undefined;
  if(!memoryChange&&!diskChange)throw Error('Resize requires memory_mib or disk_mib');
  if(memoryChange){positive(request.memory_mib,'memory_mib');positive(limits.memory_mib,'memory budget');}
  if(diskChange){positive(request.disk_mib,'disk_mib');positive(limits.disk_mib,'disk budget');}
  const row=state.claims.find(c=>c.lease_id===request.lease_id && c.owner===request.owner && c.status==='active');
  if(!row)throw Error('No owned active lease to resize');
  if(request.stopped_confirmed!==true)throw Error('Resource resize requires confirmed stopped native server and installer');
  const active=state.claims.filter(c=>c.status==='active' && c!==row);
  if(memoryChange&&active.reduce((sum,c)=>sum+c.memory_mib,0)+request.memory_mib>limits.memory_mib)throw Error('Memory budget exhausted');
  if(diskChange){
    const reserve=limits.reserved_disk_mib??20480;
    if(!Number.isSafeInteger(reserve)||reserve<0)throw Error('reserved_disk_mib must be a nonnegative integer');
    if(active.reduce((sum,c)=>sum+c.disk_mib,0)+request.disk_mib+reserve>limits.disk_mib)throw Error('Disk budget exhausted');
  }
  const nextMemory=memoryChange?request.memory_mib:row.memory_mib;
  row.resource_changes ||= [];row.resource_changes.push({previous_memory_mib:row.memory_mib,memory_mib:nextMemory,...(diskChange?{previous_disk_mib:row.disk_mib,disk_mib:request.disk_mib}:{}),at:new Date().toISOString()});
  row.memory_mib=nextMemory;if(diskChange)row.disk_mib=request.disk_mib;return row;
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
    if(command==='claim-utility') {
      if(!args.limits) throw Error('claim-utility requires explicit resource limits');
      return claimUtility(state,args,args.limits);
    }
    if(command==='release') return release(state,args.lease_id,args.owner,args.outcome,args.resources_removed===true);
    if(command==='resize') return resize(state,args,args.limits||{});
    if(command==='replace-port') return replacePort(state,args,args.limits||{});
    if(command==='requeue') {
      throw Error('Historical outcomes are retained; use claim-reviewed-retry with a cleanup review');
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
    if(!['claim','claim-reviewed-retry','claim-reviewed-utility-retry'].includes(command)) throw Error('usage: batch-queue.mjs claim|claim-reviewed-retry|claim-reviewed-utility-retry|release|status JSON');
    if(!args.limits) throw Error('claim requires explicit node resource/port limits');
    if(command==='claim-reviewed-retry' || command==='claim-reviewed-utility-retry') {
      const receipt=args.retry_review?.cleanup_receipt;
      if(!cleanupReceiptPath(receipt))throw Error('Invalid cleanup receipt path');
      const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,receipt))).digest('hex');
      if(digest!==args.retry_review.cleanup_sha256)throw Error('Cleanup receipt hash changed');
      if(command==='claim-reviewed-utility-retry')return claimReviewedUtilityRetry(state,args,args.limits);
      const plan=JSON.parse(fs.readFileSync(path.join(root,'artifacts/game-batch-plan.json'),'utf8'));
      return claimReviewedRetry(state,plan,args,args.limits);
    }
    const plan=JSON.parse(fs.readFileSync(path.join(root,'artifacts/game-batch-plan.json'),'utf8'));
    return claim(state,plan,args,args.limits);
  });
  console.log(JSON.stringify(result,null,2));
}
