const STORAGE_KEY = 'recipes-list';
let recipes = [];
let loaded = false;
let view = 'calc'; // 'calc' | 'recipes'
let selectedRecipeId = null;
let servings = 10;
let dilutionOn = true;
let dilutionPct = 20;
let displayUnit = 'oz';
let editingRecipe = null; // object being edited in modal, or null
let storageError = false;

// auth / cloud state
let authUser = null;      // {uid,email,name,photo} when signed in, else null
let bootDone = false;     // has the app rendered its first real state?
let cloudAvailable = false; // did the Firebase module load and expose window.Cloud?
let permissionError = false; // last cloud failure was a rules/permission denial

const OZ_TO_ML = 29.5735;

function uid(){ return Math.random().toString(36).slice(2,9); }

// ---- local storage helpers ----
// Guest recipes live under STORAGE_KEY. A signed-in user's recipes are cached
// under a per-account key so they survive offline and never mix with guest data.
function guestLoad(){
  try{ const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; }
  catch(e){ return null; }
}
function guestSave(list){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); return true; }
  catch(e){ return false; }
}
// Per-account cache stores {recipes, dirty}. `dirty` means the local copy has
// edits that failed to reach the cloud and must be re-pushed on the next load.
function cacheKey(uidStr){ return STORAGE_KEY + ':' + uidStr; }
function cacheLoad(uidStr){
  try{
    const raw = localStorage.getItem(cacheKey(uidStr));
    if(!raw) return null;
    const o = JSON.parse(raw);
    if(Array.isArray(o)) return { recipes:o, dirty:false }; // tolerate old format
    return { recipes: Array.isArray(o.recipes) ? o.recipes : [], dirty: !!o.dirty };
  }catch(e){ return null; }
}
function cacheSave(uidStr, list, dirty){
  try{ localStorage.setItem(cacheKey(uidStr), JSON.stringify({ recipes:list, dirty:!!dirty })); }catch(e){}
}

async function loadRecipes(){
  storageError = false;
  permissionError = false;
  if(authUser){
    const cached = cacheLoad(authUser.uid);

    // If there are un-synced local edits, push them first (last write wins).
    if(cached && cached.dirty){
      recipes = cached.recipes;
      const ok = await pushToCloud();
      cacheSave(authUser.uid, recipes, !ok);
      if(!ok) storageError = true;
      finishLoad();
      return;
    }

    let cloud;
    try{
      cloud = await window.Cloud.loadRecipes(); // array | null
    }catch(e){
      console.error('[cloud] load failed', e);
      if(e && e.code === 'permission-denied') permissionError = true;
      recipes = cached ? cached.recipes : [];
      storageError = true;
      finishLoad();
      return;
    }

    if(cloud === null){
      // brand-new account: offer to import guest recipes, else seed defaults
      const guest = guestLoad();
      if(guest && guest.length){
        loaded = true;
        openImportModal(guest);
        return; // loadRecipes resumes via the import choice
      }
      recipes = defaultRecipes();
      const ok = await pushToCloud();
      cacheSave(authUser.uid, recipes, !ok);
      if(!ok) storageError = true;
    } else {
      recipes = cloud;
      cacheSave(authUser.uid, recipes, false);
    }
  } else {
    // guest mode
    const guest = guestLoad();
    recipes = guest ? guest : defaultRecipes();
  }
  finishLoad();
}

function finishLoad(){
  if(recipes.length && (!selectedRecipeId || !recipes.some(r=>r.id===selectedRecipeId))){
    selectedRecipeId = recipes[0].id;
  }
  if(!recipes.length) selectedRecipeId = null;
  loaded = true;
  render();
}

async function pushToCloud(){
  try{
    await window.Cloud.saveRecipes(recipes);
    return true;
  }catch(e){
    console.error('[cloud] save failed', e);
    if(e && e.code === 'permission-denied') permissionError = true;
    return false;
  }
}

async function saveRecipes(){
  storageError = false;
  permissionError = false;
  if(authUser){
    const ok = await pushToCloud();
    // On failure, keep a dirty local copy so the edit re-syncs on next load.
    cacheSave(authUser.uid, recipes, !ok);
    if(!ok) storageError = true;
  } else {
    if(!guestSave(recipes)) storageError = true;
  }
  render();
}

function defaultRecipes(){
  return [
    {
      id: uid(),
      name: 'Old Fashioned',
      servingUnit: 'oz',
      ingredients: [
        {id: uid(), name:'Bourbon', amount:2, unit:'oz'},
        {id: uid(), name:'Simple syrup', amount:0.25, unit:'oz'},
        {id: uid(), name:'Angostura bitters', amount:2, unit:'dash'}
      ]
    },
    {
      id: uid(),
      name: 'Daiquiri',
      servingUnit: 'oz',
      ingredients: [
        {id: uid(), name:'White rum', amount:2, unit:'oz'},
        {id: uid(), name:'Lime juice', amount:1, unit:'oz'},
        {id: uid(), name:'Simple syrup', amount:0.75, unit:'oz'}
      ]
    }
  ];
}

// unit conversion: base storage unit for volume ingredients is oz. 'dash' stays as dash (not scaled by unit conversion, only by servings).
function toDisplay(ozValue){
  if(displayUnit === 'ml') return ozValue * OZ_TO_ML;
  return ozValue;
}

function fmt(n){
  if(n === null || n === undefined || isNaN(n)) return '—';
  return (Math.round(n*100)/100).toString();
}

function getSelectedRecipe(){
  return recipes.find(r => r.id === selectedRecipeId) || null;
}

function computeBatch(recipe){
  if(!recipe) return null;
  const lines = recipe.ingredients.map(ing => {
    if(ing.unit === 'dash'){
      return {name: ing.name, amount: ing.amount * servings, unit: 'dash', isVolume:false, perServing: ing.amount, perServingUnit:'dash'};
    }
    // convert stored amount to oz base first
    let ozAmt = ing.unit === 'ml' ? ing.amount / OZ_TO_ML : ing.amount;
    const totalOz = ozAmt * servings;
    return {name: ing.name, amount: toDisplay(totalOz), unit: displayUnit, isVolume:true, totalOz, perServing: ing.amount, perServingUnit: ing.unit};
  });
  const volumeTotalOz = lines.filter(l=>l.isVolume).reduce((s,l)=>s+l.totalOz,0);
  let waterOz = 0;
  if(dilutionOn){
    waterOz = volumeTotalOz * (dilutionPct/100);
  }
  const grandTotalOz = volumeTotalOz + waterOz;
  return {
    lines,
    waterDisplay: toDisplay(waterOz),
    volumeTotalDisplay: toDisplay(volumeTotalOz),
    grandTotalDisplay: toDisplay(grandTotalOz)
  };
}

function render(){
  const app = document.getElementById('app');
  if(!loaded){
    app.innerHTML = '<div class="loading">loading ticket…</div>';
    return;
  }
  const recipe = getSelectedRecipe();
  const batch = view==='calc' ? computeBatch(recipe) : null;

  let html = `
    <header>
      <div>
        <h1>Batch<span>Ticket</span></h1>
        <div class="sub">Prep math, scaled &amp; diluted right</div>
      </div>
      ${renderAuth()}
    </header>
    <div class="tabs">
      <div class="tab ${view==='calc'?'active':''}" onclick="setView('calc')">Calculator</div>
      <div class="tab ${view==='recipes'?'active':''}" onclick="setView('recipes')">Recipes</div>
    </div>
  `;

  if(storageError){
    let msg;
    if(permissionError){
      msg = "Can't reach your account yet — the database rules may not be published. Changes are saved on this device for now.";
    } else if(authUser){
      msg = "Offline — changes are saved on this device and will sync next time you open the app online.";
    } else {
      msg = "Couldn't save — changes may not persist. Try again in a moment.";
    }
    html += `<div class="card" style="border-color:var(--danger);color:var(--danger);font-family:'IBM Plex Mono',monospace;font-size:12px;">${msg}</div>`;
  }

  if(view === 'recipes'){
    html += renderRecipeList();
  } else {
    html += renderCalculator(recipe, batch);
  }

  app.innerHTML = html;
}

function renderRecipeList(){
  if(recipes.length === 0){
    return `<div class="empty">No recipes yet.<br>Add one to start building tickets.</div>
      <button class="btn-amber btn-full" onclick="openEditor(null)">+ Add Recipe</button>`;
  }
  let out = '';
  recipes.forEach(r => {
    out += `<div class="card">
      <div class="recipe-name">${escapeHtml(r.name)}</div>
      <div class="recipe-meta">${r.ingredients.length} ingredient${r.ingredients.length===1?'':'s'}</div>
      ${r.ingredients.map(i=>`<div class="ing-row"><span>${escapeHtml(i.name)}</span><span class="ing-amt">${fmt(i.amount)} ${i.unit}</span></div>`).join('')}
      <div class="card-actions">
        <button class="btn-ghost" onclick="openEditor('${r.id}')">Edit</button>
        <button class="btn-danger" onclick="deleteRecipe('${r.id}')">Delete</button>
      </div>
    </div>`;
  });
  out += `<button class="btn-amber btn-full" onclick="openEditor(null)">+ Add Recipe</button>`;
  return out;
}

function renderCalculator(recipe, batch){
  if(recipes.length === 0){
    return `<div class="empty">No recipes saved yet.<br>Add one in the Recipes tab first.</div>`;
  }
  let out = `<div class="card">
    <label>Recipe</label>
    <select onchange="selectRecipe(this.value)">
      ${recipes.map(r=>`<option value="${r.id}" ${r.id===selectedRecipeId?'selected':''}>${escapeHtml(r.name)}</option>`).join('')}
    </select>

    <div class="row2">
      <div>
        <label>Servings</label>
        <input type="number" min="0.25" step="0.25" value="${servings}" oninput="setServings(this.value)">
      </div>
      <div>
        <label>Display unit</label>
        <select onchange="setUnit(this.value)">
          <option value="oz" ${displayUnit==='oz'?'selected':''}>oz</option>
          <option value="ml" ${displayUnit==='ml'?'selected':''}>ml</option>
        </select>
      </div>
    </div>

    <div class="toggle-row">
      <div class="lbl">Dilution adjustment
        <small>Adds water to replace what shaking/stirring would add</small>
      </div>
      <div class="switch ${dilutionOn?'on':''}" onclick="toggleDilution()"></div>
    </div>
    ${dilutionOn ? `
      <label>Dilution % (typical: 20–25%)</label>
      <input type="number" min="0" max="100" value="${dilutionPct}" oninput="setDilutionPct(this.value)">
    ` : ''}
  </div>`;

  if(batch){
    out += `<div class="ticket">
      <div class="ticket-head">${escapeHtml(recipe.name)} — ×${servings}</div>
      ${batch.lines.map(l=>`<div class="ticket-line"><span>${escapeHtml(l.name)}<br><span style="color:var(--text-muted);font-size:11px;">${fmt(l.perServing)} ${l.perServingUnit} × ${fmt(servings)}</span></span><span>${fmt(l.amount)} ${l.unit}</span></div>`).join('')}
      ${dilutionOn ? `<div class="ticket-line water"><span>+ Water (dilution)<br><span style="color:var(--text-muted);font-size:11px;">${dilutionPct}% of ${fmt(batch.volumeTotalDisplay)} ${displayUnit}</span></span><span>${fmt(batch.waterDisplay)} ${displayUnit}</span></div>` : ''}
      <div class="ticket-total"><span>Total batch volume</span><span>${fmt(batch.grandTotalDisplay)} ${displayUnit}</span></div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text-muted);margin-top:10px;padding-top:10px;border-top:1px dotted var(--line);">Per serving after dilution: ${fmt(batch.grandTotalDisplay/servings)} ${displayUnit}</div>
    </div>`;
  }

  return out;
}

function escapeHtml(s){
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---- auth ----
function renderAuth(){
  if(authUser){
    const who = authUser.name || authUser.email || 'Signed in';
    return `<div class="auth">
      <div class="auth-who" title="${escapeHtml(authUser.email||'')}">
        <span class="auth-dot"></span>${escapeHtml(who)}
      </div>
      <button class="auth-link" onclick="signOutUser()">Sign out</button>
    </div>`;
  }
  if(cloudAvailable){
    return `<button class="btn-amber auth-signin" onclick="signIn()">Sign in</button>`;
  }
  return ''; // Firebase unavailable (offline / blocked): stay in guest mode silently
}

async function signIn(){
  if(!window.Cloud) return;
  try{
    await window.Cloud.signIn();
    // onAuthStateChanged -> cloud-auth-changed handles reload/render
  }catch(e){
    const code = e && e.code;
    if(code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request'){
      alert('Sign-in failed: ' + ((e && e.message) || code || 'unknown error'));
    }
  }
}

async function signOutUser(){
  if(!window.Cloud) return;
  try{ await window.Cloud.signOut(); }catch(e){}
}

// One-time prompt on first sign-in when the account has no cloud recipes yet.
function openImportModal(guestRecipes){
  let bg = document.getElementById('modal-bg');
  if(!bg){
    bg = document.createElement('div');
    bg.id = 'modal-bg';
    bg.className = 'modal-bg';
    document.body.appendChild(bg);
  }
  const n = guestRecipes.length;
  bg.innerHTML = `
    <div class="modal">
      <h2>Welcome${authUser && authUser.name ? ', ' + escapeHtml(authUser.name.split(' ')[0]) : ''}</h2>
      <p style="font-family:'Inter',sans-serif;font-size:14px;color:var(--text);margin:0 0 18px;line-height:1.5;">
        You have <strong>${n}</strong> recipe${n===1?'':'s'} saved on this device.
        Add ${n===1?'it':'them'} to your account so ${n===1?'it syncs':'they sync'} across your phones?
      </p>
      <div class="card-actions">
        <button class="btn-amber" style="flex:1" onclick="importGuestRecipes()">Add to my account</button>
        <button class="btn-ghost" onclick="startFreshAccount()">Start fresh</button>
      </div>
    </div>`;
  // stash for the choice handlers
  window.__pendingImport = guestRecipes;
}

async function importGuestRecipes(){
  const guest = window.__pendingImport || [];
  recipes = JSON.parse(JSON.stringify(guest));
  window.__pendingImport = null;
  closeImportModal();
  storageError = false; permissionError = false;
  const ok = await pushToCloud();
  cacheSave(authUser.uid, recipes, !ok);
  if(!ok) storageError = true;
  finishLoad();
}

async function startFreshAccount(){
  window.__pendingImport = null;
  recipes = defaultRecipes();
  closeImportModal();
  storageError = false; permissionError = false;
  const ok = await pushToCloud();
  cacheSave(authUser.uid, recipes, !ok);
  if(!ok) storageError = true;
  finishLoad();
}

function closeImportModal(){
  const bg = document.getElementById('modal-bg');
  if(bg) bg.remove();
}

// ---- interactions ----
function setView(v){ view = v; render(); }
function selectRecipe(id){ selectedRecipeId = id; render(); }
function setServings(v){ servings = Math.max(0.25, parseFloat(v)||0.25); render(); }
function setUnit(v){ displayUnit = v; render(); }
function toggleDilution(){ dilutionOn = !dilutionOn; render(); }
function setDilutionPct(v){ dilutionPct = Math.min(100, Math.max(0, parseFloat(v)||0)); render(); }

function deleteRecipe(id){
  recipes = recipes.filter(r=>r.id!==id);
  if(selectedRecipeId === id) selectedRecipeId = recipes.length ? recipes[0].id : null;
  saveRecipes();
}

// ---- editor modal ----
function openEditor(id){
  if(id){
    const r = recipes.find(x=>x.id===id);
    editingRecipe = JSON.parse(JSON.stringify(r));
  } else {
    editingRecipe = {id: uid(), name:'', ingredients:[{id:uid(), name:'', amount:1, unit:'oz'}]};
  }
  renderModal();
}

function closeEditor(){
  editingRecipe = null;
  const bg = document.getElementById('modal-bg');
  if(bg) bg.remove();
}

function renderModal(){
  let bg = document.getElementById('modal-bg');
  if(!bg){
    bg = document.createElement('div');
    bg.id = 'modal-bg';
    bg.className = 'modal-bg';
    document.body.appendChild(bg);
  }
  const r = editingRecipe;
  bg.innerHTML = `
    <div class="modal">
      <h2>${r.name ? 'Edit Recipe' : 'New Recipe'}</h2>
      <label>Recipe name</label>
      <input type="text" id="rname" value="${escapeHtml(r.name)}" placeholder="e.g. Whiskey Sour">
      <label>Ingredients (amount is per single serving)</label>
      <div id="ing-list"></div>
      <button class="add-ing-btn" onclick="addIngredientRow()">+ Add ingredient</button>
      <div class="card-actions" style="margin-top:18px;">
        <button class="btn-amber" style="flex:1" onclick="commitEditor()">Save Recipe</button>
        <button class="btn-ghost" onclick="closeEditor()">Cancel</button>
      </div>
    </div>
  `;
  renderIngredientRows();
}

function renderIngredientRows(){
  const list = document.getElementById('ing-list');
  if(!list) return;
  list.innerHTML = editingRecipe.ingredients.map((ing, idx) => `
    <div class="ing-edit-row">
      <input type="text" placeholder="Ingredient" value="${escapeHtml(ing.name)}" oninput="updateIng(${idx},'name',this.value)">
      <input type="number" step="0.01" value="${ing.amount}" oninput="updateIng(${idx},'amount',this.value)">
      <select onchange="updateIng(${idx},'unit',this.value)">
        <option value="oz" ${ing.unit==='oz'?'selected':''}>oz</option>
        <option value="ml" ${ing.unit==='ml'?'selected':''}>ml</option>
        <option value="dash" ${ing.unit==='dash'?'selected':''}>dash</option>
      </select>
      <button class="remove-x" onclick="removeIng(${idx})">×</button>
    </div>
  `).join('');
}

function updateIng(idx, field, value){
  if(field==='amount') value = Math.max(0, parseFloat(value)||0);
  editingRecipe.ingredients[idx][field] = value;
}

function addIngredientRow(){
  editingRecipe.ingredients.push({id:uid(), name:'', amount:1, unit:'oz'});
  renderIngredientRows();
}

function removeIng(idx){
  editingRecipe.ingredients.splice(idx,1);
  renderIngredientRows();
}

function commitEditor(){
  const name = document.getElementById('rname').value.trim();
  if(!name){ alert('Give the recipe a name.'); return; }
  editingRecipe.name = name;
  editingRecipe.ingredients = editingRecipe.ingredients.filter(i=>i.name.trim().length>0);
  if(editingRecipe.ingredients.length === 0){ alert('Add at least one ingredient.'); return; }

  const existingIdx = recipes.findIndex(r=>r.id===editingRecipe.id);
  if(existingIdx >= 0){
    recipes[existingIdx] = editingRecipe;
  } else {
    recipes.push(editingRecipe);
  }
  if(!selectedRecipeId) selectedRecipeId = editingRecipe.id;
  closeEditor();
  saveRecipes();
}

// ---- boot ----
function applyAuth(detail){
  authUser = detail;                 // {uid,email,name,photo} or null
  cloudAvailable = !!window.Cloud;
  loadRecipes();                     // async; renders when done (or opens import modal)
}

// Fired once Firebase resolves the initial auth state.
window.addEventListener('cloud-ready', (e) => {
  bootDone = true;
  cloudAvailable = true;
  applyAuth(e.detail);
});

// Fired on later sign-in / sign-out.
window.addEventListener('cloud-auth-changed', (e) => {
  cloudAvailable = true;
  selectedRecipeId = null;           // the recipe set changes with the account
  applyAuth(e.detail);
});

// Fallback: if Firebase never loads (offline / blocked / CDN down), boot as a
// guest so the app is always usable.
setTimeout(() => {
  if(!bootDone){
    bootDone = true;
    cloudAvailable = !!window.Cloud;
    applyAuth(null);
  }
}, 3500);
