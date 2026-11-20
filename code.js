// ===== DS Relink · ядро =====
// Робить локальними змінні, стилі й компоненти, які прийшли з інших файлів/бібліотек,
// і перев'язує на них усі вузли. За бажанням прив'язує «сирі» кольори й тексти до ДС.

const R = {
  opts: null,
  dry: false,
  stats: null,
  issues: null,
  onLog: function () {},
  onProgress: function () {},
};

function newStats() {
  return {
    nodes: 0,
    varsCreated: 0, varsReused: 0, varBindings: 0,
    stylesCreated: 0, stylesReused: 0, styleBindings: 0,
    remoteInstances: 0, instancesSwapped: 0, componentsCreated: 0, setsCreated: 0,
    rawColorsBound: 0, rawColorsCreated: 0, rawTextsBound: 0, rawTextStylesCreated: 0,
    errors: 0,
  };
}

// ---------- мови / languages ----------
const I18N = {
  en: {
    k_modes: 'Variable modes', k_vars: 'Variables', k_skipped: 'Skipped', k_fonts: 'Fonts', k_styles: 'Styles', k_components: 'Components', k_errors: 'Errors',
    nothingSelected: 'Nothing is selected.',
    importedVars: 'Imported variables',
    modeLimit: 'Collection “{0}”: couldn’t add mode “{1}” (mode limit on your plan).',
    aliasMissing: '“{0}” refers to a variable that couldn’t be found.',
    pattern: '“{0}”: pattern fill – Figma doesn’t let plugins rewrite it, bind the color manually.',
    fontMissing: '{0} – not installed, these texts were skipped.',
    styleNoFont: 'Text style “{0}” wasn’t created: font {1} is missing.',
    libSuffix: ' · from library',
    setExists: 'The file already has “{0}”, but without the needed variants. Created “{1}” – check it and switch instances manually if needed.',
    compExists: 'Component “{0}” already exists in the file with a different structure. Created “{1}”.',
    swapProp: '“{0}”: instance swap property “{1}” wasn’t transferred – set it up manually.',
    propsRestore: '“{0}”: couldn’t restore property values ({1}).',
    noMain: 'Instance “{0}” has no main component – skipped.',
    pass: 'Components, pass {0}: {1} instances from other files',
    noLocal: 'No local “{0}”.',
    localPage: 'Local components · DS Relink',
    rawColl: 'DS Relink · found colors',
    loading: 'Loading pages…',
    components: 'Components…',
    tokensProgress: 'Variables and styles: {0} / {1}',
    rawProgress: 'Unbound values: {0} / {1}',
    done: 'Done',
  },
  uk: {
    k_modes: 'Режими змінних', k_vars: 'Змінні', k_skipped: 'Пропущено', k_fonts: 'Шрифти', k_styles: 'Стилі', k_components: 'Компоненти', k_errors: 'Помилки',
    nothingSelected: 'Нічого не виділено.',
    importedVars: 'Імпортовані змінні',
    modeLimit: 'Колекція «{0}»: не вдалося додати режим «{1}» (ліміт режимів на вашому плані).',
    aliasMissing: '«{0}» посилається на змінну, яку не вдалося знайти.',
    pattern: '«{0}»: заливка з візерунком (pattern) – Figma не дає її перезаписати плагіном, прив\'яжіть колір вручну.',
    fontMissing: '{0} – не встановлено, ці тексти пропущено.',
    styleNoFont: 'Текстовий стиль «{0}» не створено: немає шрифту {1}.',
    libSuffix: ' · з бібліотеки',
    setExists: 'У файлі вже є «{0}», але без потрібних варіантів. Створено «{1}» – перевірте й за потреби переключіть інстанси вручну.',
    compExists: 'Компонент «{0}» уже є у файлі з іншою будовою. Створено «{1}».',
    swapProp: '«{0}»: властивість заміни «{1}» не перенесено – налаштуйте вручну.',
    propsRestore: '«{0}»: не вдалося повернути значення властивостей ({1}).',
    noMain: 'Інстанс «{0}» без головного компонента – пропущено.',
    pass: 'Компоненти, прохід {0}: {1} інстансів з інших файлів',
    noLocal: 'Немає локального «{0}».',
    localPage: 'Локальні компоненти · DS Relink',
    rawColl: 'DS Relink · знайдені кольори',
    loading: 'Завантажую сторінки…',
    components: 'Компоненти…',
    tokensProgress: 'Змінні й стилі: {0} / {1}',
    rawProgress: 'Сирі значення: {0} / {1}',
    done: 'Готово',
  },
};
function L() { return I18N[(R.opts && R.opts.lang) === 'uk' ? 'uk' : 'en']; }
function tr(key) { const a = arguments; return String(L()[key]).replace(/\{(\d)\}/g, function (_, i) { return a[+i + 1]; }); }
function issueK(k, msg) { issue(L()['k_' + k], msg); }
function q(s) { return (L() === I18N.uk ? '«' : '“') + s + (L() === I18N.uk ? '»' : '”'); }

function log(msg) { R.onLog(msg); }
function progress(msg) { R.onProgress(msg); }
function issue(kind, msg) {
  if (!R.issues[kind]) R.issues[kind] = [];
  if (R.issues[kind].indexOf(msg) === -1) R.issues[kind].push(msg);
}
function pause() { return new Promise(function (r) { setTimeout(r, 0); }); }

// кеші запитів – на великих файлах це головне прискорення
const CACHE = { vars: new Map(), styles: new Map(), colls: new Map() };
async function getVar(id) { if (!CACHE.vars.has(id)) CACHE.vars.set(id, await figma.variables.getVariableByIdAsync(id)); return CACHE.vars.get(id); }
async function getColl(id) { if (!CACHE.colls.has(id)) CACHE.colls.set(id, await figma.variables.getVariableCollectionByIdAsync(id)); return CACHE.colls.get(id); }

// ---------- обхід ----------
function isInsideInstance(n) {
  let p = n.parent;
  while (p && p.type !== 'PAGE' && p.type !== 'DOCUMENT') {
    if (p.type === 'INSTANCE') return true;
    p = p.parent;
  }
  return false;
}

function collect(roots) {
  const top = [];
  const inInst = [];
  function walk(n, inside) {
    (inside ? inInst : top).push(n);
    if ('children' in n) {
      const next = inside || n.type === 'INSTANCE';
      for (const c of n.children) walk(c, next);
    }
  }
  for (const r of roots) {
    if (r.type === 'PAGE') { for (const c of r.children) walk(c, false); }
    else walk(r, isInsideInstance(r));
  }
  return { top: top, inInst: inInst };
}

async function loadPages() {
  const pages = figma.root.children.slice();
  for (const p of pages) { await p.loadAsync(); }
  return pages;
}

async function getRoots(scope) {
  if (scope === 'selection') {
    const s = figma.currentPage.selection.slice();
    if (!s.length) throw new Error(tr('nothingSelected'));
    return s;
  }
  if (scope === 'page') return [figma.currentPage];
  return await loadPages();
}

// ---------- змінні ----------
const V = {
  map: new Map(),          // remoteVarId -> localVar | null
  collByName: new Map(),   // name -> local collection
  modeMap: new Map(),      // remoteCollId -> {remoteModeId: localModeId}
  localIndex: new Map(),   // collId|name|type -> var
};

async function initVariables() {
  V.map.clear(); V.collByName.clear(); V.modeMap.clear(); V.localIndex.clear();
  const colls = await figma.variables.getLocalVariableCollectionsAsync();
  for (const c of colls) V.collByName.set(c.name, c);
  const vars = await figma.variables.getLocalVariablesAsync();
  for (const v of vars) V.localIndex.set(v.variableCollectionId + '|' + v.name + '|' + v.resolvedType, v);
}

async function localCollectionFor(rc) {
  const name = rc ? rc.name : tr('importedVars');
  let lc = V.collByName.get(name);
  if (!lc) {
    if (R.dry) return { id: 'dry:' + name, dry: true, modes: [] };
    lc = figma.variables.createVariableCollection(name);
    if (rc && rc.modes && rc.modes.length) {
      lc.renameMode(lc.modes[0].modeId, rc.modes[0].name);
      for (let i = 1; i < rc.modes.length; i++) {
        try { lc.addMode(rc.modes[i].name); }
        catch (e) { issueK('modes', tr('modeLimit', name, rc.modes[i].name)); }
      }
    }
    V.collByName.set(name, lc);
  }
  if (rc && !V.modeMap.has(rc.id)) {
    const m = {};
    if (!lc.dry) {
      for (const rm of rc.modes) {
        const lm = lc.modes.find(function (x) { return x.name === rm.name; });
        m[rm.modeId] = lm ? lm.modeId : lc.defaultModeId;
      }
    }
    V.modeMap.set(rc.id, m);
  }
  return lc;
}

async function ensureLocalVar(rv) {
  if (!rv) return null;
  if (!rv.remote) return rv;
  if (V.map.has(rv.id)) return V.map.get(rv.id);
  const rc = await getColl(rv.variableCollectionId);
  const lc = await localCollectionFor(rc);
  const key = lc.id + '|' + rv.name + '|' + rv.resolvedType;
  let lv = V.localIndex.get(key);
  if (lv) { V.map.set(rv.id, lv.dry ? null : lv); if (!lv.dry) R.stats.varsReused++; return lv.dry ? null : lv; }
  if (R.dry) { V.map.set(rv.id, null); V.localIndex.set(key, { dry: true }); R.stats.varsCreated++; return null; }
  lv = figma.variables.createVariable(rv.name, lc, rv.resolvedType);
  V.map.set(rv.id, lv);
  V.localIndex.set(key, lv);
  R.stats.varsCreated++;
  try { lv.description = rv.description || ''; } catch (e) {}
  try { lv.scopes = rv.scopes; } catch (e) {}
  try { lv.hiddenFromPublishing = rv.hiddenFromPublishing; } catch (e) {}
  const mm = rc ? V.modeMap.get(rc.id) : {};
  for (const rModeId of Object.keys(rv.valuesByMode)) {
    const lModeId = (mm && mm[rModeId]) || lc.defaultModeId;
    let val = rv.valuesByMode[rModeId];
    if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
      const target = await getVar(val.id);
      const lt = await ensureLocalVar(target);
      if (lt) val = figma.variables.createVariableAlias(lt);
      else { issueK('vars', tr('aliasMissing', rv.name)); continue; }
    }
    try { lv.setValueForMode(lModeId, val); }
    catch (e) { issueK('vars', q(rv.name) + ': ' + e.message); }
  }
  return lv;
}

async function mapVarAlias(alias) {
  if (!alias || !alias.id) return null;
  const v = await getVar(alias.id);
  if (!v || !v.remote) return null;
  return await ensureLocalVar(v);
}

const WRITABLE = { SOLID: 1, GRADIENT_LINEAR: 1, GRADIENT_RADIAL: 1, GRADIENT_ANGULAR: 1, GRADIENT_DIAMOND: 1, IMAGE: 1, VIDEO: 1, SHADER: 1 };
function canWrite(paints) { return paints.every(function (p) { return WRITABLE[p.type]; }); }
// Figma при першій прив'язці змінної скидає прозорість заливки до прозорості змінної – записуємо вдруге
function writePaints(target, prop, paints) {
  const ops = paints.map(function (p) { return p.opacity; });
  target[prop] = paints;
  const cur = target[prop];
  if (!Array.isArray(cur)) return;
  let differs = false;
  for (let i = 0; i < cur.length; i++) {
    const want = ops[i]; const got = cur[i].opacity === undefined ? 1 : cur[i].opacity;
    if (want !== undefined && Math.abs(got - want) > 0.001) differs = true;
  }
  if (differs) target[prop] = cur.map(function (p, i) { return ops[i] === undefined ? p : Object.assign({}, p, { opacity: ops[i] }); });
}
function skipPattern(n) { issueK('skipped', tr('pattern', n.name)); }

const SKIP_BOUND = { fills: 1, strokes: 1, effects: 1, layoutGrids: 1, textRangeFills: 1, componentProperties: 1 };

async function remapPaints(paints) {
  // повертає {changed, paints}
  let changed = false;
  const out = [];
  for (const p of paints) {
    let np = p;
    const bv = p.boundVariables && p.boundVariables.color;
    if (bv) {
      const v = await getVar(bv.id);
      if (v && v.remote) {
        R.stats.varBindings++;
        const lv = await ensureLocalVar(v);
        if (lv && !R.dry) {
          np = figma.variables.setBoundVariableForPaint(p, 'color', lv);
          if (p.opacity !== undefined) np = Object.assign({}, np, { opacity: p.opacity });
          changed = true;
        }
      }
    }
    out.push(np);
  }
  return { changed: changed, paints: out };
}

async function remapEffects(effects) {
  let changed = false;
  const out = [];
  for (const ef of effects) {
    let ne = ef;
    const bvs = ef.boundVariables || {};
    for (const field of Object.keys(bvs)) {
      const lv = await mapVarAlias(bvs[field]);
      if (bvs[field]) {
        const v = await getVar(bvs[field].id);
        if (v && v.remote) R.stats.varBindings++;
      }
      if (lv && !R.dry) { ne = figma.variables.setBoundVariableForEffect(ne, field, lv); changed = true; }
    }
    out.push(ne);
  }
  return { changed: changed, effects: out };
}

async function rebindNodeVariables(n) {
  for (const prop of ['fills', 'strokes']) {
    if (!(prop in n)) continue;
    const arr = n[prop];
    if (!Array.isArray(arr) || !arr.length) continue;
    const r = await remapPaints(arr);
    if (r.changed) { if (canWrite(r.paints)) writePaints(n, prop, r.paints); else skipPattern(n); }
  }
  if ('effects' in n && Array.isArray(n.effects) && n.effects.length) {
    const r = await remapEffects(n.effects);
    if (r.changed) n.effects = r.effects;
  }
  const bv = n.boundVariables || {};
  for (const field of Object.keys(bv)) {
    if (SKIP_BOUND[field]) continue;
    const val = bv[field];
    if (Array.isArray(val)) continue;
    const v = val && val.id ? await getVar(val.id) : null;
    if (!v || !v.remote) continue;
    R.stats.varBindings++;
    const lv = await ensureLocalVar(v);
    if (lv && !R.dry) {
      try { n.setBoundVariable(field, lv); }
      catch (e) { issueK('vars', q(n.name) + ' · ' + field + ': ' + e.message); }
    }
  }
  // кольори діапазонів у тексті
  if (n.type === 'TEXT' && n.fills === figma.mixed) {
    const segs = n.getStyledTextSegments(['fills']);
    let need = false;
    for (const s of segs) for (const p of s.fills) if (p.boundVariables && p.boundVariables.color) need = true;
    if (need) {
      const ok = await loadNodeFonts(n);
      for (const s of segs) {
        const r = await remapPaints(s.fills);
        if (r.changed && ok) { n.setRangeFills(s.start, s.end, r.paints); n.setRangeFills(s.start, s.end, r.paints); }
      }
    }
  }
}

// ---------- шрифти ----------
const FONTS = { ok: new Set(), bad: new Set() };
async function loadFont(f) {
  const k = f.family + '|' + f.style;
  if (FONTS.ok.has(k)) return true;
  if (FONTS.bad.has(k)) return false;
  try { await figma.loadFontAsync({ family: f.family, style: f.style }); FONTS.ok.add(k); return true; }
  catch (e) { FONTS.bad.add(k); issueK('fonts', tr('fontMissing', f.family + ' ' + f.style)); return false; }
}
async function loadNodeFonts(t) {
  if (t.characters.length === 0) return true;
  let ok = true;
  for (const f of t.getRangeAllFontNames(0, t.characters.length)) { if (!(await loadFont(f))) ok = false; }
  return ok;
}

// ---------- стилі ----------
const S = { map: new Map(), local: new Map() }; // remoteStyleId -> localStyle ; type|name -> style

async function initStyles() {
  S.map.clear(); S.local.clear();
  const add = function (list) { for (const s of list) S.local.set(s.type + '|' + s.name, s); };
  add(await figma.getLocalTextStylesAsync());
  add(await figma.getLocalPaintStylesAsync());
  add(await figma.getLocalEffectStylesAsync());
  add(await figma.getLocalGridStylesAsync());
}

async function ensureLocalStyle(rs) {
  if (!rs) return null;
  if (!rs.remote) return rs;
  if (S.map.has(rs.id)) return S.map.get(rs.id);
  const key = rs.type + '|' + rs.name;
  let ls = S.local.get(key);
  if (ls) { S.map.set(rs.id, ls.dry ? null : ls); if (!ls.dry) R.stats.stylesReused++; return ls.dry ? null : ls; }
  if (R.dry) { S.map.set(rs.id, null); S.local.set(key, { dry: true }); R.stats.stylesCreated++; if (rs.type === 'TEXT') await loadFont(rs.fontName); return null; }
  try {
    if (rs.type === 'TEXT') {
      if (!(await loadFont(rs.fontName))) { S.map.set(rs.id, null); issueK('styles', tr('styleNoFont', rs.name, rs.fontName.family + ' ' + rs.fontName.style)); return null; }
      ls = figma.createTextStyle();
      ls.name = rs.name;
      ls.fontName = rs.fontName;
      ls.fontSize = rs.fontSize;
      ls.lineHeight = rs.lineHeight;
      ls.letterSpacing = rs.letterSpacing;
      ls.paragraphSpacing = rs.paragraphSpacing;
      ls.paragraphIndent = rs.paragraphIndent;
      ls.textCase = rs.textCase;
      ls.textDecoration = rs.textDecoration;
      try { if (rs.leadingTrim) ls.leadingTrim = rs.leadingTrim; } catch (e) {}
      try { if (rs.listSpacing !== undefined) ls.listSpacing = rs.listSpacing; } catch (e) {}
      const bvs = rs.boundVariables || {};
      for (const f of Object.keys(bvs)) {
        const lv = await mapVarAlias(bvs[f]);
        if (lv) { try { ls.setBoundVariable(f, lv); } catch (e) {} }
      }
    } else if (rs.type === 'PAINT') {
      ls = figma.createPaintStyle();
      ls.name = rs.name;
      writePaints(ls, 'paints', (await remapPaints(rs.paints)).paints);
    } else if (rs.type === 'EFFECT') {
      ls = figma.createEffectStyle();
      ls.name = rs.name;
      ls.effects = (await remapEffects(rs.effects)).effects;
    } else if (rs.type === 'GRID') {
      ls = figma.createGridStyle();
      ls.name = rs.name;
      ls.layoutGrids = rs.layoutGrids;
    }
    if (ls) { try { ls.description = rs.description || ''; } catch (e) {} }
  } catch (e) {
    issueK('styles', q(rs.name) + ': ' + e.message);
    ls = null;
  }
  S.map.set(rs.id, ls);
  if (ls) { S.local.set(key, ls); R.stats.stylesCreated++; }
  return ls;
}

async function styleById(id) {
  if (!id || id === figma.mixed) return null;
  if (CACHE.styles.has(id)) return CACHE.styles.get(id);
  let st = null; try { st = await figma.getStyleByIdAsync(id); } catch (e) {}
  CACHE.styles.set(id, st); return st;
}

async function rebindNodeStyles(n) {
  // текстові стилі
  if (n.type === 'TEXT') {
    if (n.textStyleId === figma.mixed) {
      for (const seg of n.getStyledTextSegments(['textStyleId'])) {
        const rs = await styleById(seg.textStyleId);
        if (rs && rs.remote) {
          R.stats.styleBindings++;
          const ls = await ensureLocalStyle(rs);
          if (ls && !R.dry) await n.setRangeTextStyleIdAsync(seg.start, seg.end, ls.id);
        }
      }
    } else {
      const rs = await styleById(n.textStyleId);
      if (rs && rs.remote) {
        R.stats.styleBindings++;
        const ls = await ensureLocalStyle(rs);
        if (ls && !R.dry) await n.setTextStyleIdAsync(ls.id);
      }
    }
    if (n.fillStyleId === figma.mixed) {
      for (const seg of n.getStyledTextSegments(['fillStyleId'])) {
        const rs = await styleById(seg.fillStyleId);
        if (rs && rs.remote) {
          R.stats.styleBindings++;
          const ls = await ensureLocalStyle(rs);
          if (ls && !R.dry) await n.setRangeFillStyleIdAsync(seg.start, seg.end, ls.id);
        }
      }
    }
  }
  const pairs = [['fillStyleId', 'setFillStyleIdAsync'], ['strokeStyleId', 'setStrokeStyleIdAsync'], ['effectStyleId', 'setEffectStyleIdAsync'], ['gridStyleId', 'setGridStyleIdAsync']];
  for (const pr of pairs) {
    if (!(pr[0] in n)) continue;
    const id = n[pr[0]];
    if (!id || id === figma.mixed) continue;
    const rs = await styleById(id);
    if (rs && rs.remote) {
      R.stats.styleBindings++;
      const ls = await ensureLocalStyle(rs);
      if (ls && !R.dry) await n[pr[1]](ls.id);
    }
  }
}

// ---------- компоненти ----------
const K = { index: new Map(), names: new Set(), page: null, placedX: 0, placedY: 0, rowH: 0 };

function normVariant(name) {
  return name.split(',').map(function (s) { return s.trim(); }).sort().join(', ');
}
function compKey(c) {
  const p = c.parent;
  if (p && p.type === 'COMPONENT_SET') return 'V|' + p.name + '|' + normVariant(c.name);
  return 'C|' + c.name;
}
async function initComponents(pages) {
  K.index.clear(); K.names.clear();
  for (const pg of pages) {
    const list = pg.findAllWithCriteria({ types: ['COMPONENT'] });
    for (const c of list) {
      const k = compKey(c); if (!K.index.has(k)) K.index.set(k, c);
      K.names.add(c.parent && c.parent.type === 'COMPONENT_SET' ? c.parent.name : c.name);
    }
  }
}

function placementPage() {
  if (K.page) return K.page;
  const name = tr('localPage');
  K.page = figma.root.children.find(function (p) { return p.name === I18N.en.localPage || p.name === I18N.uk.localPage; }) || null;
  if (!K.page) { K.page = figma.createPage(); K.page.name = name; }
  return K.page;
}
function place(node) {
  const W = 4000;
  if (K.placedX + node.width > W) { K.placedX = 0; K.placedY += K.rowH + 120; K.rowH = 0; }
  node.x = K.placedX; node.y = K.placedY;
  K.placedX += node.width + 120;
  K.rowH = Math.max(K.rowH, node.height);
}

function pairWalk(a, b, fn) {
  // однакова структура: remote main ↔ локальна копія
  fn(a, b);
  if ('children' in a && 'children' in b && a.type !== 'INSTANCE') {
    const n = Math.min(a.children.length, b.children.length);
    for (let i = 0; i < n; i++) pairWalk(a.children[i], b.children[i], fn);
  }
}

async function buildLocalFromRemote(remoteMains) {
  // remoteMains: масив віддалених COMPONENT однієї множини (або один компонент)
  const pg = placementPage();
  const created = [];
  for (const rm of remoteMains) {
    const tmp = rm.createInstance();
    pg.appendChild(tmp);
    const fr = tmp.detachInstance();
    fr.name = rm.name;
    const comp = figma.createComponentFromNode(fr);
    try { comp.description = rm.description || ''; } catch (e) {}
    created.push({ remote: rm, local: comp });
    R.stats.componentsCreated++;
  }
  let owner;
  const rset = remoteMains[0].parent && remoteMains[0].parent.type === 'COMPONENT_SET' ? remoteMains[0].parent : null;
  if (rset) {
    const set = figma.combineAsVariants(created.map(function (c) { return c.local; }), pg);
    set.name = K.names.has(rset.name) ? rset.name + tr('libSuffix') : rset.name;
    if (set.name !== rset.name) issueK('components', tr('setExists', rset.name, set.name));
    K.names.add(set.name);
    set.layoutMode = 'HORIZONTAL'; set.layoutWrap = 'WRAP'; set.itemSpacing = 24; set.counterAxisSpacing = 24;
    set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 24;
    owner = set;
    R.stats.setsCreated++;
  } else {
    owner = created[0].local;
    if (K.names.has(owner.name)) { owner.name = owner.name + tr('libSuffix'); issueK('components', tr('compExists', remoteMains[0].name, owner.name)); }
    K.names.add(owner.name);
  }
  // властивості (текст, булеві) — за посиланнями у віддаленому компоненті
  let defs = {};
  try { defs = (rset || remoteMains[0]).componentPropertyDefinitions || {}; } catch (e) {}
  const keyMap = {};
  for (const k of Object.keys(defs)) {
    const d = defs[k];
    if (d.type === 'VARIANT') continue;
    if (d.type === 'INSTANCE_SWAP') { issueK('components', tr('swapProp', owner.name, k.split('#')[0])); continue; }
    try { keyMap[k] = owner.addComponentProperty(k.split('#')[0], d.type, d.defaultValue); } catch (e) {}
  }
  for (const c of created) {
    pairWalk(c.remote, c.local, function (ra, lb) {
      const refs = ra.componentPropertyReferences;
      if (!refs) return;
      const nr = {};
      for (const f of Object.keys(refs)) if (keyMap[refs[f]]) nr[f] = keyMap[refs[f]];
      if (Object.keys(nr).length) { try { lb.componentPropertyReferences = nr; } catch (e) {} }
    });
  }
  place(owner);
  for (const c of created) K.index.set(compKey(c.remote), c.local);
  return created;
}

async function swapKeepingProps(inst, target) {
  const before = {};
  const cp = inst.componentProperties || {};
  for (const k of Object.keys(cp)) if (cp[k].type !== 'VARIANT' && cp[k].type !== 'INSTANCE_SWAP') before[k.split('#')[0]] = cp[k].value;
  inst.swapComponent(target);
  const after = inst.componentProperties || {};
  const set = {};
  for (const k of Object.keys(after)) {
    const base = k.split('#')[0];
    if (before[base] !== undefined && after[k].value !== before[base]) set[k] = before[base];
  }
  if (Object.keys(set).length) {
    try { inst.setProperties(set); }
    catch (e) { issueK('components', tr('propsRestore', inst.name, e.message)); }
  }
}

async function localizeComponents(roots, pages) {
  for (let pass = 1; pass <= 6; pass++) {
    const all = [];
    const scan = roots.concat(K.page ? [K.page] : []);
    for (const r of scan) {
      const list = r.type === 'INSTANCE' ? [r] : [];
      if ('findAllWithCriteria' in r) list.push.apply(list, r.findAllWithCriteria({ types: ['INSTANCE'] }));
      for (const i of list) all.push(i);
    }
    const remote = [];
    for (const i of all) {
      let mc = null;
      try { mc = await i.getMainComponentAsync(); } catch (e) {}
      if (!mc) { issueK('components', tr('noMain', i.name)); continue; }
      if (mc.remote) remote.push({ inst: i, mc: mc });
    }
    // вкладені інстанси всередині іншого «чужого» інстансу міняються разом з ним – пропускаємо
    const remoteIds = new Set(remote.map(function (r) { return r.inst.id; }));
    for (let j = remote.length - 1; j >= 0; j--) {
      let p = remote[j].inst.parent, nested = false;
      while (p && p.type !== 'PAGE') { if (p.type === 'INSTANCE' && remoteIds.has(p.id)) { nested = true; break; } p = p.parent; }
      if (nested) remote.splice(j, 1);
    }
    if (pass === 1) R.stats.remoteInstances = remote.length;
    if (!remote.length) break;
    progress(tr('pass', pass, remote.length));
    // яких локальних бракує
    const missing = new Map(); // setId|compId -> [mc]
    for (const r of remote) {
      if (K.index.has(compKey(r.mc))) continue;
      const grp = r.mc.parent && r.mc.parent.type === 'COMPONENT_SET' ? r.mc.parent.id : r.mc.id;
      if (!missing.has(grp)) missing.set(grp, []);
      const arr = missing.get(grp);
      if (arr.indexOf(r.mc) === -1 && !arr.some(function (x) { return x.id === r.mc.id; })) arr.push(r.mc);
    }
    if (R.dry) {
      let toCreate = 0; missing.forEach(function (v) { toCreate += v.length; });
      R.stats.componentsCreated = toCreate;
      R.stats.instancesSwapped = remote.length;
      break;
    }
    if (R.opts.createComponents) {
      for (const arr of missing.values()) {
        // якщо локальна множина з такою назвою вже є – дописуємо варіанти в неї
        const rset = arr[0].parent && arr[0].parent.type === 'COMPONENT_SET' ? arr[0].parent : null;
        try { await buildLocalFromRemote(arr); }
        catch (e) { R.stats.errors++; issueK('components', q(rset ? rset.name : arr[0].name) + ': ' + e.message); }
        await pause();
      }
    }
    let swapped = 0;
    for (const r of remote) {
      const target = K.index.get(compKey(r.mc));
      if (!target) { issueK('components', tr('noLocal', (r.mc.parent && r.mc.parent.type === 'COMPONENT_SET' ? r.mc.parent.name + ' / ' : '') + r.mc.name)); continue; }
      try { await swapKeepingProps(r.inst, target); swapped++; R.stats.instancesSwapped++; }
      catch (e) { R.stats.errors++; issueK('components', q(r.inst.name) + ': ' + e.message); }
      if (swapped % 200 === 0) await pause();
    }
    if (!swapped) break;
  }
}

// ---------- «сирі» значення ----------
function hex(c) { return '#' + [c.r, c.g, c.b].map(function (v) { return Math.round(v * 255).toString(16).padStart(2, '0'); }).join('').toUpperCase(); }

const RAW = { colorIndex: new Map(), textIndex: new Map(), rawColl: null };

async function resolveColor(v, depth) {
  const coll = await getColl(v.variableCollectionId);
  let val = v.valuesByMode[coll.defaultModeId];
  if (val && val.type === 'VARIABLE_ALIAS' && (depth || 0) < 6) {
    const t = await getVar(val.id);
    return t ? resolveColor(t, (depth || 0) + 1) : null;
  }
  return val;
}

async function initRaw() {
  RAW.colorIndex.clear(); RAW.textIndex.clear(); RAW.rawColl = null;
  if (R.dry) {
    // у перевірці враховуємо змінні й стилі, які буде створено з бібліотек
    for (const id of V.map.keys()) {
      const rv = await getVar(id);
      if (!rv || rv.resolvedType !== 'COLOR') continue;
      const c = await resolveColor(rv);
      if (!c) continue;
      const k = hex(c) + '@' + Math.round((c.a === undefined ? 1 : c.a) * 100);
      if (!RAW.colorIndex.has(k)) RAW.colorIndex.set(k, { dry: true });
    }
    for (const id of S.map.keys()) {
      const rs = await styleById(id);
      if (rs && rs.type === 'TEXT') { const k = textKey(rs); if (!RAW.textIndex.has(k)) RAW.textIndex.set(k, { dry: true }); }
    }
  }
  const vars = await figma.variables.getLocalVariablesAsync('COLOR');
  for (const v of vars) {
    const c = await resolveColor(v);
    if (!c) continue;
    const a = c.a === undefined ? 1 : c.a;
    const k = hex(c) + '@' + Math.round(a * 100);
    if (!RAW.colorIndex.has(k)) RAW.colorIndex.set(k, v);
  }
  for (const s of await figma.getLocalTextStylesAsync()) RAW.textIndex.set(textKey(s), s);
}

function lhKey(lh) { return lh.unit === 'AUTO' ? 'auto' : lh.unit[0] + Math.round(lh.value * 10) / 10; }
function lsKey(ls) { return ls.unit[0] + Math.round(ls.value * 100) / 100; }
function textKey(o) { return o.fontName.family + '|' + o.fontName.style + '|' + o.fontSize + '|' + lhKey(o.lineHeight) + '|' + lsKey(o.letterSpacing); }

async function rawColorVar(c, opacity) {
  // спершу точний збіг (колір + прозорість змінної), потім колір без прозорості
  let v = RAW.colorIndex.get(hex(c) + '@' + Math.round(opacity * 100));
  if (v) return { v: v, keepOpacity: false };
  v = RAW.colorIndex.get(hex(c) + '@100');
  if (v) return { v: v, keepOpacity: true };
  if (!R.opts.createRaw) return null;
  const k = hex(c) + '@100';
  if (R.dry) { const d = { dry: true }; RAW.colorIndex.set(k, d); R.stats.rawColorsCreated++; return { v: d, keepOpacity: true }; }
  if (!RAW.rawColl) {
    const name = tr('rawColl');
    RAW.rawColl = (await figma.variables.getLocalVariableCollectionsAsync()).find(function (x) { return x.name === I18N.en.rawColl || x.name === I18N.uk.rawColl; }) || figma.variables.createVariableCollection(name);
  }
  const nv = figma.variables.createVariable('unsorted/' + hex(c).slice(1), RAW.rawColl, 'COLOR');
  nv.setValueForMode(RAW.rawColl.defaultModeId, { r: c.r, g: c.g, b: c.b, a: 1 });
  RAW.colorIndex.set(k, nv);
  R.stats.rawColorsCreated++;
  return { v: nv, keepOpacity: true };
}

async function bindRawColors(n) {
  for (const prop of ['fills', 'strokes']) {
    if (!(prop in n)) continue;
    const arr = n[prop];
    if (!Array.isArray(arr) || !arr.length) continue;
    if (prop === 'fills' && n.fillStyleId && n.fillStyleId !== figma.mixed) continue;
    if (prop === 'strokes' && n.strokeStyleId) continue;
    let changed = false;
    const out = [];
    for (const p of arr) {
      if (p.type !== 'SOLID' || p.visible === false || (p.boundVariables && p.boundVariables.color)) { out.push(p); continue; }
      const op = p.opacity === undefined ? 1 : p.opacity;
      const m = await rawColorVar(p.color, op);
      if (!m || !m.v) { out.push(p); continue; }
      R.stats.rawColorsBound++;
      if (R.dry || m.v.dry) { out.push(p); continue; }
      let np = figma.variables.setBoundVariableForPaint(p, 'color', m.v);
      if (m.keepOpacity) np = Object.assign({}, np, { opacity: op });
      out.push(np); changed = true;
    }
    if (changed) { if (canWrite(out)) writePaints(n, prop, out); else skipPattern(n); }
  }
}

async function rawTextStyle(o) {
  const k = textKey(o);
  let s = RAW.textIndex.get(k);
  if (s) return s;
  if (!R.opts.createRaw) return null;
  if (R.dry) { const d = { dry: true }; RAW.textIndex.set(k, d); R.stats.rawTextStylesCreated++; return d; }
  if (!(await loadFont(o.fontName))) return null;
  s = figma.createTextStyle();
  s.name = 'DS Relink/' + o.fontName.family + ' ' + o.fontName.style + ' ' + o.fontSize;
  s.fontName = o.fontName; s.fontSize = o.fontSize; s.lineHeight = o.lineHeight; s.letterSpacing = o.letterSpacing;
  RAW.textIndex.set(k, s);
  R.stats.rawTextStylesCreated++;
  return s;
}

async function bindRawText(t) {
  if (t.type !== 'TEXT') return;
  if (t.textStyleId !== '' && t.textStyleId !== figma.mixed) return;
  const segs = t.getStyledTextSegments(['textStyleId', 'fontName', 'fontSize', 'lineHeight', 'letterSpacing']);
  for (const s of segs) {
    if (s.textStyleId) continue;
    const st = await rawTextStyle(s);
    if (!st) continue;
    R.stats.rawTextsBound++;
    if (R.dry || st.dry) continue;
    const fills = t.getRangeFills(s.start, s.end);
    await t.setRangeTextStyleIdAsync(s.start, s.end, st.id);
    if (fills !== figma.mixed) { try { t.setRangeFills(s.start, s.end, fills); t.setRangeFills(s.start, s.end, fills); } catch (e) {} }
  }
}

// ---------- запуск ----------
async function runRelink(opts, dry) {
  R.opts = opts; R.dry = !!dry; R.stats = newStats(); R.issues = {};
  CACHE.vars.clear(); CACHE.styles.clear(); CACHE.colls.clear();
  FONTS.ok.clear(); FONTS.bad.clear();
  K.page = null; K.placedX = 0; K.placedY = 0; K.rowH = 0;
  progress(tr('loading'));
  const pages = await loadPages();
  const roots = await getRoots(opts.scope);
  await initVariables();
  await initStyles();
  await initComponents(pages);

  if (opts.components) {
    progress(tr('components'));
    await localizeComponents(roots, pages);
  }

  const scanRoots = roots.concat(K.page ? [K.page] : []);
  const col = collect(scanRoots);
  R.stats.nodes = col.top.length + col.inInst.length;

  if (opts.tokens) {
    let i = 0;
    for (const n of col.top.concat(col.inInst)) {
      try {
        await rebindNodeVariables(n);
        await rebindNodeStyles(n);
      } catch (e) { R.stats.errors++; issueK('errors', q(n.name) + ': ' + e.message); }
      if (++i % 300 === 0) { progress(tr('tokensProgress', i, R.stats.nodes)); await pause(); }
    }
  }

  if (opts.raw) {
    await initRaw();
    let i = 0;
    for (const n of col.top) {
      try {
        await bindRawColors(n);
        await bindRawText(n);
      } catch (e) { R.stats.errors++; issueK('errors', q(n.name) + ': ' + e.message); }
      if (++i % 300 === 0) { progress(tr('rawProgress', i, col.top.length)); await pause(); }
    }
  }
  progress(tr('done'));
  return { stats: R.stats, issues: R.issues, dry: R.dry, issuesLang: (opts.lang === 'uk' ? 'uk' : 'en') };
}

// ===== DS Relink · інтерфейс / UI =====
figma.showUI(__html__, { width: 440, height: 640, themeColors: true });

let LANG = 'en';
figma.clientStorage.getAsync('lang').then(function (l) {
  if (l === 'uk' || l === 'en') LANG = l;
  figma.ui.postMessage({ type: 'lang', lang: LANG });
}).catch(function () {});

R.onLog = function (m) { figma.ui.postMessage({ type: 'log', msg: m }); };
R.onProgress = function (m) { figma.ui.postMessage({ type: 'progress', msg: m }); };

figma.ui.onmessage = async function (msg) {
  if (msg.type === 'close') { figma.closePlugin(); return; }
  if (msg.type === 'setLang') { LANG = msg.lang === 'uk' ? 'uk' : 'en'; figma.clientStorage.setAsync('lang', LANG).catch(function () {}); return; }
  if (msg.type !== 'run') return;
  const uk = msg.opts && msg.opts.lang === 'uk';
  try {
    const res = await runRelink(msg.opts, msg.dry);
    figma.ui.postMessage({ type: 'done', result: res });
    figma.notify(res.dry ? (uk ? 'DS Relink: перевірку завершено, нічого не змінено' : 'DS Relink: check finished, nothing changed') : (uk ? 'DS Relink: готово' : 'DS Relink: done'));
  } catch (e) {
    figma.ui.postMessage({ type: 'error', msg: e && e.message ? e.message : String(e) });
  }
};
