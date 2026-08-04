(function(){
// Generic multi-level linear interpolation engine for the expanded rating
// tables. Each combo's cooling/heating data is nested:
//   data[cfm][secondary][outer][inner] = { TC, 'S/T'?, kW }
// secondary = Outdoor DB (cooling) or Indoor DB (heating)
// outer     = Indoor WB (cooling) or 'ALL' constant (heating, no 3rd axis)
// inner     = Indoor DB (cooling) or Outdoor DB (heating)

function numKeys(node) {
  return Object.keys(node)
    .map(k => ({ raw: k, num: parseFloat(k) }))
    .filter(k => !isNaN(k.num))
    .sort((a, b) => a.num - b.num);
}

const EPS = 1e-6;

// Finds the bracketing pair for `query` among a node's numeric keys, or
// throws a RangeError-like object {axis, min, max, value} if out of range.
function bracket(node, query, axisLabel, clamp) {
  const keys = numKeys(node);
  if (keys.length === 0) throw { axis: axisLabel, message: `No data available for ${axisLabel}.` };
  const min = keys[0].num, max = keys[keys.length - 1].num;
  if (keys.length === 1) return { lo: keys[0], hi: keys[0], frac: 0 };
  if (query < min - EPS || query > max + EPS) {
    if (clamp) query = Math.max(min, Math.min(max, query));
    else throw { axis: axisLabel, min, max, value: query,
      message: `${axisLabel} must be between ${min} and ${max} (entered ${query}).` };
  }
  let lo = keys[0], hi = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (query >= keys[i].num - EPS && query <= keys[i + 1].num + EPS) { lo = keys[i]; hi = keys[i + 1]; break; }
  }
  const frac = hi.num === lo.num ? 0 : (query - lo.num) / (hi.num - lo.num);
  return { lo, hi, frac: Math.max(0, Math.min(1, frac)) };
}

function lerpLeaf(a, b, frac) {
  const out = {};
  for (const k of Object.keys(a)) {
    const av = a[k], bv = (b && b[k] !== undefined) ? b[k] : av;
    out[k] = av + (bv - av) * frac;
  }
  return out;
}

// Recursively interpolate: axes = [[query, label], ...] innermost last.
// An axis entry may instead be {fixed: 'key'} to descend a literal key with
// no interpolation (used for the heating table's dummy 'ALL' tier).
// node is the data object at the current level; leaf is reached when axes is empty.
function interpLevel(node, axes, clamp) {
  if (axes.length === 0) return node; // leaf {TC, kW, ...}
  const ax = axes[0];
  if (ax.fixed !== undefined) return interpLevel(node[ax.fixed], axes.slice(1), clamp);
  const [query, label] = ax;
  const { lo, hi, frac } = bracket(node, query, label, clamp);
  if (lo.raw === hi.raw) return interpLevel(node[lo.raw], axes.slice(1), clamp);
  const a = interpLevel(node[lo.raw], axes.slice(1), clamp);
  const b = interpLevel(node[hi.raw], axes.slice(1), clamp);
  return lerpLeaf(a, b, frac);
}

// combo.cooling: data[cfm][odb][iwb][idb] = {TC, 'S/T', kW}
function interpolateCooling(coolingData, { cfm, odb, iwb, idb }, clamp) {
  const leaf = interpLevel(coolingData, [
    [cfm, 'Airflow (CFM)'],
    [odb, 'Outdoor DB (cooling)'],
    [iwb, 'Indoor WB (cooling)'],
    [idb, 'Indoor DB (cooling)'],
  ], clamp);
  const st = Math.max(0, Math.min(1, leaf['S/T']));
  const total = leaf.TC * 1000;
  const sensible = total * st;
  return { totalBtuh: total, sensibleBtuh: sensible, latentBtuh: total - sensible, stRatio: st, kW: leaf.kW };
}

// combo.heating: data[cfm][id]['ALL'][odb] = {TC, kW}
function interpolateHeating(heatingData, { cfm, id, odb }, clamp) {
  const leaf = interpLevel(heatingData, [
    [cfm, 'Airflow (CFM)'],
    [id, 'Indoor DB (heating)'],
    { fixed: 'ALL' },
    [odb, 'Outdoor DB (heating)'],
  ], clamp);
  return { totalBtuh: leaf.TC * 1000, kW: leaf.kW };
}

// Range helpers for building UI hints / validating before calculation.
function coolingRanges(coolingData) {
  const cfmKeys = numKeys(coolingData);
  const cfmR = [cfmKeys[0].num, cfmKeys[cfmKeys.length - 1].num];
  const anyCfm = coolingData[cfmKeys[0].raw];
  const odbKeys = numKeys(anyCfm);
  const odbR = [odbKeys[0].num, odbKeys[odbKeys.length - 1].num];
  const anyOdb = anyCfm[odbKeys[0].raw];
  const iwbKeys = numKeys(anyOdb);
  const iwbR = [iwbKeys[0].num, iwbKeys[iwbKeys.length - 1].num];
  let idbMin = Infinity, idbMax = -Infinity;
  for (const iw of iwbKeys) {
    const idbKeys = numKeys(anyOdb[iw.raw]);
    idbMin = Math.min(idbMin, idbKeys[0].num);
    idbMax = Math.max(idbMax, idbKeys[idbKeys.length - 1].num);
  }
  return { cfm: cfmR, odb: odbR, iwb: iwbR, idb: [idbMin, idbMax] };
}

function heatingRanges(heatingData) {
  const cfmKeys = numKeys(heatingData);
  const cfmR = [cfmKeys[0].num, cfmKeys[cfmKeys.length - 1].num];
  const anyCfm = heatingData[cfmKeys[0].raw];
  const idKeys = numKeys(anyCfm);
  const idR = [idKeys[0].num, idKeys[idKeys.length - 1].num];
  const anyId = anyCfm[idKeys[0].raw]['ALL'];
  const odbKeys = numKeys(anyId);
  const odbR = [odbKeys[0].num, odbKeys[odbKeys.length - 1].num];
  return { cfm: cfmR, id: idR, odb: odbR };
}

window.RatingsInterp = { interpolateCooling, interpolateHeating, coolingRanges, heatingRanges };

})();
