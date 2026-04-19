// --- GLOBAL STATE ---
        let project = {
            workspaces: [
                { id: 'w_home', type: 'scene', name: 'Main Scene', hierarchy: [], pan: { x: 0, y: 0 }, zoom: 1 }
            ],
            activeWorkspaceId: 'w_home',
            hierarchy: [], // Proxy to active workspace hierarchy
            blueprints: [],
            symbols: [],
            scripts: [],
            nameCounters: { magic: 1, shape: 1, text: 1, empty: 1, symbol: 1 },
            settings: { basePath: "", lineWeight: 1.5, bgColor: "#0c0c0e" }
        };
        
        let selectedIds = new Set();
        let zoom = 1, pan = { x: 0, y: 0 };
        let isPanning = false, isDragging = false, dragTargets = [], lastMouse = { x: 0, y: 0 };
        
        // Gizmo State
        let isDraggingGizmo = false; 
        let dragGizmoState = null;
        
        let activeWinDrag = null;
        let winDragOffset = { x: 0, y: 0 };

        // Autocomplete State
        let acState = { active: false, input: null, options: [], index: 0 };
        
        // Undo System
        let undoStack = [];
        const MAX_UNDO = 30;
        window.pushUndoState = function() {
            const state = JSON.stringify({
                workspaces: project.workspaces,
                nameCounters: project.nameCounters,
                settings: project.settings
            });
            if (undoStack.length > 0 && undoStack[undoStack.length - 1] === state) return;
            undoStack.push(state);
            if (undoStack.length > MAX_UNDO) undoStack.shift();
        };
        window.undo = function() {
            if (undoStack.length === 0) return toast("Nothing to undo");
            try {
                const state = JSON.parse(undoStack.pop());
                project.workspaces = state.workspaces;
                project.nameCounters = state.nameCounters;
                project.settings = state.settings;
                
                const activeWs = project.workspaces.find(w => w.id === project.activeWorkspaceId);
                if (activeWs && activeWs.type === 'scene') project.hierarchy = activeWs.hierarchy;
                
                selectedIds.clear();
                refreshUI();
                
                if (activeWs && activeWs.type === 'forge' && window.loadForgeWorkspace) {
                    window.loadForgeWorkspace(activeWs);
                }
                
                document.body.style.backgroundColor = project.settings.bgColor;
                document.getElementById('set-bgColor').value = project.settings.bgColor;
                if(document.getElementById('set-lineWeight')) document.getElementById('set-lineWeight').value = project.settings.lineWeight;
                
                toast("Undo applied");
            } catch(e) {
                toast("Undo failed");
            }
        };

        const canvas = document.getElementById('mainCanvas');
        const ctx = canvas.getContext('2d');
        const ctxDiv = document.getElementById('ctxMenu');

        // Asset Cache for Symbols
        const imageCache = {}; 
        const tintCache = {}; 
        
        // --- API INTEGRATION ---
        window.ArcanistAPI = {
            createMagicCircle: function(name, parentId, props) {
                const obj = createObject('magic', name || 'Scripted Circle', parentId);
                if (props) Object.assign(obj, props);
                if (parentId) {
                    const parent = findById(parentId);
                    if (parent) parent.children.push(obj);
                } else project.hierarchy.push(obj);
                return obj.id;
            },
            createPolygon: function(name, parentId, props) {
                const obj = createObject('shape', name || 'Scripted Polygon', parentId);
                if (props) Object.assign(obj, props);
                if (parentId) {
                    const parent = findById(parentId);
                    if (parent) parent.children.push(obj);
                } else project.hierarchy.push(obj);
                return obj.id;
            },
            createText: function(name, text, parentId, props) {
                const obj = createObject('text', name || 'Scripted Text', parentId);
                obj.textContent = text || 'ARCANE';
                if (props) Object.assign(obj, props);
                if (parentId) {
                    const parent = findById(parentId);
                    if (parent) parent.children.push(obj);
                } else project.hierarchy.push(obj);
                return obj.id;
            },
            clearAll: function() { project.hierarchy = []; selectedIds.clear(); refreshUI(); },
            getById: function(id) { return findById(id); },
            refresh: function() { refreshUI(); }
        };

        function init() {
            window.onresize = () => { 
                canvas.width = window.innerWidth; 
                canvas.height = window.innerHeight - 80; // 48px nav + 32px tab bar
            };
            window.onresize();
            const exMenu = document.getElementById('examples-menu');
            if (exMenu) {
                exMenu.innerHTML = '';
                if (window.ARCANIST_EXAMPLES && Object.keys(window.ARCANIST_EXAMPLES).length > 0) {
                    for (let name of Object.keys(window.ARCANIST_EXAMPLES)) {
                        const btn = document.createElement('button');
                        btn.className = "px-4 py-3 text-[10px] text-left hover:bg-emerald-600 text-emerald-300";
                        btn.innerText = name;
                        btn.onclick = () => loadExample(name);
                        exMenu.appendChild(btn);
                    }
                } else {
                    exMenu.innerHTML = '<div class="px-4 py-2 text-[9px] text-slate-500 italic">No examples found</div>';
                }
            }

            setupEvents();
            initScripts();
            initForge();
            
            // Sync current workspace state
            const homeWs = project.workspaces.find(w => w.id === project.activeWorkspaceId) || project.workspaces[0];
            project.hierarchy = homeWs.hierarchy;
            pan = { ...homeWs.pan };
            zoom = homeWs.zoom;
            
            refreshUI();
            renderTabs();
            
            document.body.style.backgroundColor = project.settings.bgColor;
            document.getElementById('set-bgColor').value = project.settings.bgColor;

            requestAnimationFrame(renderLoop);
        }

        // --- WORKSPACE & TAB SYSTEM ---
        function addWorkspace(type, name) {
            const id = 'w_' + Math.random().toString(36).substr(2, 9);
            const wsName = name || (type === 'scene' ? 'New Scene' : 'New Forge');
            
            const newWs = {
                id, 
                type, 
                name: wsName,
                pan: { x: 0, y: 0 },
                zoom: 1
            };

            if (type === 'scene') {
                newWs.hierarchy = [];
            } else {
                newWs.layers = [{ id: 'l_base', name: 'Background', visible: true, locked: false, shapes: [] }];
                newWs.activeLayerId = 'l_base';
                newWs.undoHistory = [];
                newWs.redoHistory = [];
            }

            project.workspaces.push(newWs);
            switchWorkspace(id);
            toast(`${wsName} Created`);
        }

        function switchWorkspace(id) {
            // Save current state before switching
            const currentWs = project.workspaces.find(w => w.id === project.activeWorkspaceId);
            if (currentWs) {
                currentWs.pan = { ...pan };
                currentWs.zoom = zoom;
            }

            const nextWs = project.workspaces.find(w => w.id === id);
            if (!nextWs) return;

            project.activeWorkspaceId = id;
            pan = { ...nextWs.pan };
            zoom = nextWs.zoom;
            selectedIds.clear();

            // Toggle Panes
            const isForge = nextWs.type === 'forge';
            document.getElementById('pane-scene').classList.toggle('hidden', !( nextWs.type === 'scene'));
            const forgePaneEl = document.getElementById('pane-forge');
            forgePaneEl.classList.toggle('hidden', nextWs.type !== 'forge');
            // Forge pane must sit above floating OS windows (z-index:10)
            forgePaneEl.style.zIndex = isForge ? '50' : '';

            // Hide scene-only floating windows when in Forge, restore when back in scene
            const sceneOnlyWindows = ['win-hierarchy', 'win-inspector'];
            sceneOnlyWindows.forEach(winId => {
                const el = document.getElementById(winId);
                if (!el) return;
                if (isForge) {
                    el.dataset.hiddenByForge = el.classList.contains('hidden') ? 'already' : 'yes';
                    el.classList.add('hidden');
                } else {
                    if (el.dataset.hiddenByForge === 'yes') el.classList.remove('hidden');
                    delete el.dataset.hiddenByForge;
                }
            });

            if (nextWs.type === 'scene') {
                project.hierarchy = nextWs.hierarchy;
            } else {
                if (window.loadForgeWorkspace) window.loadForgeWorkspace(nextWs);
            }

            renderTabs();
            refreshUI();
        }

        function removeWorkspace(id, e) {
            if (e) e.stopPropagation();
            if (project.workspaces.length <= 1) return toast("Cannot close last workspace");
            
            const idx = project.workspaces.findIndex(w => w.id === id);
            if (idx === -1) return;

            const wasActive = project.activeWorkspaceId === id;
            project.workspaces.splice(idx, 1);

            if (wasActive) {
                const nextId = project.workspaces[Math.max(0, idx - 1)].id;
                switchWorkspace(nextId);
            } else {
                renderTabs();
            }
        }

        function renderTabs() {
            const list = document.getElementById('tabs-list');
            list.innerHTML = '';
            project.workspaces.forEach(ws => {
                const isActive = ws.id === project.activeWorkspaceId;
                const tab = document.createElement('div');
                tab.className = `group flex items-center h-7 px-3 gap-2 rounded-t text-[10px] font-bold uppercase tracking-wider cursor-pointer border-x border-t transition-all ${isActive ? 'bg-[#0c0c0e] border-white/20 text-blue-400 z-10 -mb-px shadow-[0_-4px_10px_rgba(0,0,0,0.5)]' : 'bg-black/40 border-transparent text-slate-500 hover:bg-white/5 hover:text-slate-300'}`;
                
                const icon = ws.type === 'scene' ? '⌬' : '✧';
                tab.innerHTML = `
                    <span onclick="switchWorkspace('${ws.id}')">${icon} ${ws.name}</span>
                    <span onclick="removeWorkspace('${ws.id}', event)" class="opacity-50 group-hover:opacity-100 hover:text-red-500 transition-opacity ml-1" title="Close tab">✕</span>
                `;
                tab.onclick = () => switchWorkspace(ws.id);
                list.appendChild(tab);
            });
        }

        function getActiveWorkspace() {
            return project.workspaces.find(w => w.id === project.activeWorkspaceId);
        }

        function dropToActiveScene(e) {
            e.preventDefault();
            const ws = getActiveWorkspace();
            if (ws && ws.type === 'scene') {
                eDropCanvas(e);
            }
        }

        function getVal(val) {
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
                if (!isNaN(val) && val.trim() !== '') return parseFloat(val);
                try {
                    if (window[val] !== undefined) return window[val];
                    const res = eval(val);
                    return typeof res === 'number' ? res : 0;
                } catch(e) { return 0; }
            }
            return 0;
        }

        // --- SCRIPTS & VARS SYSTEM ---
        let activeScriptEditId = null;

        function initScripts() {
            if (!project.scripts) project.scripts = [];
            // Migration for old workspaces
            if (project.settings.script && project.settings.script.trim() !== "") {
                project.scripts.push({
                    id: 's_' + Date.now(),
                    name: 'Legacy Variables',
                    code: project.settings.script
                });
                delete project.settings.script;
            }
            renderScriptList();
        }

        function renderScriptList() {
            const list = document.getElementById('script-list');
            list.innerHTML = '';
            
            if (project.scripts.length === 0) {
                list.innerHTML = `<div class="text-[10px] text-slate-500 text-center italic py-6">No scripts created yet.</div>`;
                return;
            }

            project.scripts.forEach(s => {
                const item = document.createElement('div');
                item.className = "flex justify-between items-center p-2.5 bg-white/5 border border-white/10 rounded group hover:border-yellow-500/50 transition-colors";
                item.innerHTML = `
                    <span class="text-[11px] font-bold text-yellow-400 flex-1 truncate pr-3">${s.name}</span>
                    <div class="flex gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button onclick="runScript('${s.id}')" class="px-2.5 py-1 bg-yellow-600/20 text-yellow-500 hover:bg-yellow-600 hover:text-white rounded text-[9px] uppercase font-bold transition-colors">Run</button>
                        <button onclick="editScript('${s.id}')" class="px-2.5 py-1 bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white rounded text-[9px] uppercase font-bold transition-colors">Edit</button>
                        <button onclick="deleteScript('${s.id}')" class="px-2 py-1 bg-red-600/20 text-red-400 hover:bg-red-600 hover:text-white rounded text-[9px] uppercase font-bold transition-colors">✕</button>
                    </div>
                `;
                list.appendChild(item);
            });
        }

        function createNewScript() {
            const id = 's_' + Date.now();
            project.scripts.push({ id, name: 'New Script', code: '// Write procedural generation code or declare globals here\n' });
            editScript(id);
        }

        function editScript(id) {
            const s = project.scripts.find(x => x.id === id);
            if(!s) return;
            activeScriptEditId = id;
            document.getElementById('script-edit-name').value = s.name;
            document.getElementById('script-editor').value = s.code;
            
            document.getElementById('script-list-view').classList.add('hidden');
            document.getElementById('script-edit-view').classList.remove('hidden');
            document.getElementById('script-edit-view').classList.add('flex');
        }

        function runActiveScript() {
            if (activeScriptEditId) {
                // Ensure latest code is executed without having to save first
                const code = document.getElementById('script-editor').value;
                try {
                    window.eval(code);
                    toast("Script Executed Successfully");
                    refreshUI();
                } catch(e) { toast("Script Error: " + e.message); }
            }
        }

        function runScript(id) {
            const s = project.scripts.find(x => x.id === id);
            if(!s) return;
            try {
                window.eval(s.code);
                toast(`'${s.name}' Executed Successfully`);
                refreshUI();
            } catch(e) { toast("Script Error: " + e.message); }
        }

        function saveAndCloseScript() {
            const s = project.scripts.find(x => x.id === activeScriptEditId);
            if(s) {
                s.name = document.getElementById('script-edit-name').value || 'Unnamed Script';
                s.code = document.getElementById('script-editor').value;
                toast("Script Saved");
            }
            closeScriptEditor();
            renderScriptList();
        }

        function closeScriptEditor() {
            activeScriptEditId = null;
            document.getElementById('script-list-view').classList.remove('hidden');
            document.getElementById('script-edit-view').classList.add('hidden');
            document.getElementById('script-edit-view').classList.remove('flex');
        }

        function deleteScript(id) {
            project.scripts = project.scripts.filter(x => x.id !== id);
            renderScriptList();
        }

        // Script Import/Export
        function exportScripts() {
            if (project.scripts.length === 0) return toast("No scripts to export.");
            const blob = new Blob([JSON.stringify(project.scripts, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; 
            a.download = `arcanist_scripts_${Date.now()}.json`;
            a.click();
            toast("Scripts Exported");
        }

        function importScripts(e) {
            const f = e.target.files[0]; 
            if (!f) return;
            const r = new FileReader();
            r.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (Array.isArray(data)) {
                        let count = 0;
                        data.forEach(s => {
                            if (s.name && s.code) {
                                project.scripts.push({
                                    id: 's_' + Date.now() + Math.random().toString(36).substr(2,5),
                                    name: s.name,
                                    code: s.code
                                });
                                count++;
                            }
                        });
                        renderScriptList();
                        toast(`Imported ${count} Script(s)`);
                    } else {
                        toast("Invalid scripts format.");
                    }
                } catch(err) {
                    toast("Failed to parse file.");
                }
            };
            r.readAsText(f);
            e.target.value = '';
        }

        // --- AUTOCOMPLETE SYSTEM ---
        function getScriptVars() {
            const vars = new Set();
            project.scripts.forEach(s => {
                const matches = s.code.matchAll(/(?:var|let|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
                for (const match of matches) vars.add(match[1]);
            });
            return Array.from(vars);
        }

        function openAc(input) {
            acState.active = true;
            acState.input = input;
            
            const rect = input.getBoundingClientRect();
            const menu = document.getElementById('ac-menu');
            menu.style.left = rect.left + 'px';
            menu.style.top = (rect.bottom + 4) + 'px';
            menu.classList.remove('hidden');
            menu.classList.add('flex');
            
            updateAcOptions();
        }

        function closeAc() {
            acState.active = false;
            acState.input = null;
            const menu = document.getElementById('ac-menu');
            menu.classList.add('hidden');
            menu.classList.remove('flex');
        }

        function updateAcOptions() {
            if(!acState.input) return;
            const vars = getScriptVars();
            const val = acState.input.value;
            const pos = acState.input.selectionStart;
            const lastSlash = val.lastIndexOf('/', pos - 1);
            let prefix = '';
            
            if(lastSlash !== -1) {
                prefix = val.substring(lastSlash + 1, pos).toLowerCase();
            }
            
            acState.options = vars.filter(v => v.toLowerCase().includes(prefix));
            acState.index = acState.options.length ? 0 : -1;
            renderAc();
        }

        function renderAc() {
            const menu = document.getElementById('ac-menu');
            menu.innerHTML = '';
            if(acState.options.length === 0) {
                menu.innerHTML = '<div class="p-2 text-slate-500 italic">No variables found</div>';
                return;
            }
            acState.options.forEach((opt, i) => {
                const div = document.createElement('div');
                div.className = `ac-item ${i === acState.index ? 'active' : ''}`;
                div.innerText = opt;
                div.onmousedown = (e) => {
                    e.preventDefault(); // prevent input blur
                    acState.index = i;
                    insertAcOption();
                };
                menu.appendChild(div);
            });
            const activeEl = menu.querySelector('.active');
            if(activeEl) activeEl.scrollIntoView({block: 'nearest'});
        }

        function insertAcOption() {
            if(!acState.input || acState.index < 0 || !acState.options[acState.index]) return;
            const val = acState.input.value;
            const pos = acState.input.selectionStart;
            const lastSlash = val.lastIndexOf('/', pos - 1);
            
            if (lastSlash !== -1) {
                const before = val.substring(0, lastSlash);
                const after = val.substring(pos);
                acState.input.value = before + acState.options[acState.index] + after;
                const newPos = before.length + acState.options[acState.index].length;
                acState.input.selectionStart = acState.input.selectionEnd = newPos;
                acState.input.dispatchEvent(new Event('input')); // Trigger update
            }
            closeAc();
        }

        function handleAcKeyDown(e) {
            if (e.target.tagName !== 'INPUT' || e.target.type !== 'text') return;
            
            if (acState.active) {
                if (e.key === 'ArrowDown') { e.preventDefault(); if(acState.options.length) acState.index = (acState.index + 1) % acState.options.length; renderAc(); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); if(acState.options.length) acState.index = (acState.index - 1 + acState.options.length) % acState.options.length; renderAc(); return; }
                if (e.key === 'Enter') { e.preventDefault(); insertAcOption(); return; }
                if (e.key === 'Escape') { e.preventDefault(); closeAc(); return; }
            }
        }

        function handleAcKeyUp(e) {
            if (e.target.tagName !== 'INPUT' || e.target.type !== 'text') return;
            
            const val = e.target.value;
            const pos = e.target.selectionStart;
            const lastSlash = val.lastIndexOf('/', pos - 1);
            
            if (lastSlash !== -1) {
                const afterSlash = val.substring(lastSlash + 1, pos);
                // Trigger autocomplete only if there's no space after the slash 
                if (!afterSlash.includes(' ')) {
                    if (!acState.active) {
                        openAc(e.target);
                    } else {
                        updateAcOptions();
                    }
                } else if (acState.active) {
                    closeAc(); // Space means it's probably division, close the menu
                }
            } else if (acState.active) {
                closeAc();
            }
        }

        // --- CORE LOGIC ---
        function getTintedImage(id, data, color) {
            const key = id + '_' + color;
            if (tintCache[key]) return tintCache[key];
            
            if (!imageCache[id]) {
                const img = new Image();
                img.onload = () => { if(window.refreshUI) window.refreshUI(); };
                img.src = data;
                imageCache[id] = img;
                return img; 
            }
            
            const img = imageCache[id];
            if (!img.complete) return img;
            
            let nw = img.naturalWidth || 1024;
            let nh = img.naturalHeight || 1024;
            
            if (nw < 1024 && nw > 0) {
                const ratio = nh / nw;
                nw = 1024; nh = 1024 * ratio;
            } else if (nw === 0) {
                nw = 1024; nh = 1024; 
            }
            
            if (color === '#ffffff' && img.naturalWidth === 0) return img;
            
            const tc = document.createElement('canvas');
            tc.width = nw;
            tc.height = nh;
            const tx = tc.getContext('2d');
            tx.drawImage(img, 0, 0, nw, nh);
            tx.globalCompositeOperation = 'source-in';
            tx.fillStyle = color;
            tx.fillRect(0, 0, tc.width, tc.height);
            
            tintCache[key] = tc;
            return tc;
        }

        function createObject(type, name, parentId = null, extraData = null) {
            const obj = {
                id: Math.random().toString(36).substr(2, 9),
                type, name, parentId,
                x: 0, y: 0, radius: 180,
                symmetry: 6, edgeIndex: -1, independentEdges: false, visible: true,
                rotation: 0, rotationSpeed: 0, drawOuterCircle: true,
                outerThickness: 1.5, outerDashed: false, outerDashConfig: "10, 5",
                doubleRim: false, rimGap: 8, drawPerimeter: true,
                connectPoints: false, connectPointsSkip: 1, connectMidPoints: false, 
                symbolsAtPoints: false, symbolText: "☿♀♁♂♃♄", centerSymbol: false, centerSymbolText: "🜔",
                linesCenter: false, inscribe: false,
                textContent: "ARCANE", fontSize: 24, fontWeight: 400, letterSpacing: 5, straightText: false,
                color: "#ffffff", children: []
            };

            if (type === 'empty') { obj.radius = 0; obj.symmetry = 0; }
            if (type === 'text') { obj.radius = 200; obj.drawOuterCircle = false; }
            if (type === 'shape') { obj.drawOuterCircle = false; }
            if (type === 'symbol') { obj.radius = 80; obj.drawOuterCircle = false; obj.symbolData = extraData; }

            return obj;
        }

        function getActive() {
            return selectedIds.size === 1 ? findById(Array.from(selectedIds)[0]) : null;
        }

        function resetActivePosition() {
            const active = getActive();
            if (active && active.parentId) {
                window.pushUndoState();
                active.x = 0;
                active.y = 0;
                if (document.getElementById('p-x')) document.getElementById('p-x').value = '0';
                if (document.getElementById('p-y')) document.getElementById('p-y').value = '0';
                refreshUI();
                toast("Position Reset to Parent Edge");
            }
        }

        function loadExample(name) {
            try {
                if (!window.ARCANIST_EXAMPLES || !window.ARCANIST_EXAMPLES[name]) {
                    throw new Error("Example data not found. Run build_examples.py first.");
                }
                const data = window.ARCANIST_EXAMPLES[name];
                
                window.pushUndoState();
                
                const clone = JSON.parse(JSON.stringify(data));
                function randomizeIds(node) {
                    node.id = Math.random().toString(36).substr(2, 9);
                    if (node.children) node.children.forEach(randomizeIds);
                }
                randomizeIds(clone);
                
                clone.parentId = null;
                const worldPos = screenToWorld(window.innerWidth/2, window.innerHeight/2);
                clone.x = worldPos.x;
                clone.y = worldPos.y;
                project.hierarchy.push(clone);
                
                selectedIds.clear();
                selectedIds.add(clone.id);
                refreshUI();
                closeCtx();
                document.querySelectorAll('.dropdown-container').forEach(c => c.classList.remove('dropdown-open'));
                toast(`Loaded Example: ${name}`);
            } catch (err) {
                toast(`Failed to load ${name}`);
                console.error(err);
            }
        }

        function addObject(type, forceParentId = null, forceEdgeIndex = -1, extraData = null) {
            window.pushUndoState();
            const worldPos = screenToWorld(window.innerWidth/2, window.innerHeight/2);
            const prettyTypes = { magic: 'Magic Circle', shape: 'True Polygon', text: 'Arcane Text', empty: 'Group Folder', symbol: 'Symbol' };
            project.nameCounters = project.nameCounters || { magic: 1, shape: 1, text: 1, empty: 1, symbol: 1 };
            const name = `${prettyTypes[type]} ${project.nameCounters[type]++}`;
            
            const obj = createObject(type, name, forceParentId, extraData);
            obj.edgeIndex = forceEdgeIndex;

            const activeId = forceParentId || getActive()?.id;
            const active = findById(activeId);
            
            if (active) {
                obj.x = 0; obj.y = 0;
                obj.parentId = active.id;
                active.children.push(obj);
            } else {
                obj.x = worldPos.x; obj.y = worldPos.y;
                project.hierarchy.push(obj);
            }
            
            selectedIds.clear();
            selectedIds.add(obj.id);
            refreshUI();
            closeCtx();
            document.querySelectorAll('.dropdown-container').forEach(c => c.classList.remove('dropdown-open'));
        }

        function promptAddObjToEdge(parentId, edgeIndex) {
            const e = window.event;
            showContext(e, [
                { label: "Add Magic Circle", action: () => addObject('magic', parentId, edgeIndex) },
                { label: "Add True Polygon", action: () => addObject('shape', parentId, edgeIndex) },
                { label: "Add Arcane Text", action: () => addObject('text', parentId, edgeIndex) },
                { label: "Add Group Folder", action: () => addObject('empty', parentId, edgeIndex) }
            ]);
        }

        function findById(id, list = project.hierarchy) {
            if (!id) return null;
            for (let item of list) {
                if (item.id === id) return item;
                const found = findById(id, item.children);
                if (found) return found;
            }
            return null;
        }

        function isAncestor(nodeId, targetId) {
            let current = findById(targetId);
            while(current) {
                if (current.id === nodeId) return true;
                current = current.parentId ? findById(current.parentId) : null;
            }
            return false;
        }

        function deleteById(id, list = project.hierarchy) {
            for (let i = 0; i < list.length; i++) {
                if (list[i].id === id) { list.splice(i, 1); return true; }
                if (deleteById(id, list[i].children)) return true;
            }
            return false;
        }

        // --- WINDOW & MENU MGMT ---
        function toggleTopMenu(e, id) {
            e.stopPropagation();
            const wasOpen = document.getElementById(id).classList.contains('dropdown-open');
            document.querySelectorAll('.dropdown-container').forEach(c => c.classList.remove('dropdown-open'));
            if (!wasOpen) document.getElementById(id).classList.add('dropdown-open');
        }

        function startWindowDrag(e, winId) {
            activeWinDrag = document.getElementById(winId);
            // Block drag if window is full screen
            if (activeWinDrag.classList.contains('fullscreen-win')) {
                activeWinDrag = null; 
                return;
            }
            const rect = activeWinDrag.getBoundingClientRect();
            winDragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            activeWinDrag.style.zIndex = 100;
            document.querySelectorAll('.os-window').forEach(w => { if(w !== activeWinDrag) w.style.zIndex = 10; });
        }

        function toggleWindow(id) {
            const w = document.getElementById(id);
            w.classList.toggle('hidden');
        }

        function toggleFullscreen(winId) {
            const win = document.getElementById(winId);
            if (win.classList.contains('fullscreen-win')) {
                win.classList.remove('fullscreen-win');
                // Restore original dimensions and position
                win.style.top = win.dataset.origTop;
                win.style.left = win.dataset.origLeft;
                win.style.width = win.dataset.origWidth;
                win.style.height = win.dataset.origHeight;
            } else {
                // Save current state
                win.dataset.origTop = win.style.top || '';
                win.dataset.origLeft = win.style.left || '';
                win.dataset.origWidth = win.style.width || '';
                win.dataset.origHeight = win.style.height || '';
                
                // Clear inline constraints
                win.style.top = ''; win.style.left = ''; win.style.width = ''; win.style.height = '';
                win.classList.add('fullscreen-win');
            }
        }

        // --- RENDERING ---
        function drawEntity(ent, tCtx, ox, oy, oRot, isThumbnail = false) {
            if (ent.visible === false) return;

            const r = getVal(ent.radius);
            const rotSpeed = ent.rotationSpeed !== undefined ? getVal(ent.rotationSpeed) : 0;
            const rot = oRot + (getVal(ent.rotation) * Math.PI / 180) + (rotSpeed * (window.globalTime || 0));
            const sym = Math.floor(getVal(ent.symmetry));
            const entX = getVal(ent.x);
            const entY = getVal(ent.y);

            tCtx.save();
            
            tCtx.translate(ox, oy);
            const parentMatrix = tCtx.getTransform();
            
            tCtx.translate(entX, entY);
            const nodeMatrix = tCtx.getTransform();
            
            if (selectedIds.size === 1 && selectedIds.has(ent.id) && !isThumbnail) {
                window.activeGizmoParentMatrix = parentMatrix;
                window.activeGizmoNodeMatrix = nodeMatrix;
            }

            tCtx.rotate(rot);

            tCtx.strokeStyle = ent.color || '#ffffff';
            tCtx.fillStyle = ent.color || '#ffffff';
            tCtx.lineWidth = project.settings.lineWeight;
            
            if (selectedIds.has(ent.id) && !isThumbnail) {
                tCtx.shadowBlur = 15; tCtx.shadowColor = "#3b82f6";
            }

            if (ent.type === 'magic' || ent.type === 'shape') {
                if (ent.drawOuterCircle) {
                    tCtx.save();
                    const thick = ent.outerThickness !== undefined ? getVal(ent.outerThickness) : project.settings.lineWeight;
                    tCtx.lineWidth = thick;
                    
                    if (ent.outerDashed) {
                        const dashes = (ent.outerDashConfig || "10, 5").split(',').map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
                        if (dashes.length > 0) tCtx.setLineDash(dashes);
                    }

                    tCtx.beginPath(); tCtx.arc(0,0, Math.max(0, r), 0, Math.PI*2); tCtx.stroke();
                    if (ent.doubleRim) {
                        const rim = getVal(ent.rimGap);
                        tCtx.beginPath(); tCtx.arc(0,0, Math.max(0, r + rim), 0, Math.PI*2); tCtx.stroke();
                    }
                    tCtx.restore();
                }

                if (sym > 0) {
                    const pts = [];
                    for(let i=0; i<sym; i++){
                        const a = i * 2 * Math.PI / sym;
                        pts.push({ x: Math.cos(a)*r, y: Math.sin(a)*r, a });
                    }
                    
                    if (ent.drawPerimeter !== false) {
                        tCtx.beginPath();
                        pts.forEach((p, i) => i === 0 ? tCtx.moveTo(p.x, p.y) : tCtx.lineTo(p.x, p.y));
                        if (sym > 2) tCtx.closePath();
                        tCtx.stroke();
                    }

                    if (ent.linesCenter) pts.forEach(p => { tCtx.beginPath(); tCtx.moveTo(0,0); tCtx.lineTo(p.x, p.y); tCtx.stroke(); });
                    
                    if (ent.connectPoints && sym > 2) {
                        const skip = ent.connectPointsSkip !== undefined ? getVal(ent.connectPointsSkip) : 1;
                        tCtx.beginPath();
                        for(let i=0; i<sym; i++) {
                            const p1 = pts[i];
                            const p2 = pts[(i+skip)%sym];
                            tCtx.moveTo(p1.x, p1.y);
                            tCtx.lineTo(p2.x, p2.y);
                        }
                        tCtx.stroke();
                    }
                    
                    if (ent.connectMidPoints && sym > 2) {
                        tCtx.beginPath();
                        for(let i=0; i<sym; i++) {
                            const p1 = pts[i];
                            const p2 = pts[(i+1)%sym];
                            const midX = (p1.x + p2.x)/2;
                            const midY = (p1.y + p2.y)/2;
                            if(i===0) tCtx.moveTo(midX, midY);
                            else tCtx.lineTo(midX, midY);
                        }
                        tCtx.closePath();
                        tCtx.stroke();
                    }
                    
                    if (ent.inscribe && sym >= 3) {
                        const inscribeRadius = Math.max(0, r * Math.cos(Math.PI/sym));
                        tCtx.beginPath(); tCtx.arc(0,0, inscribeRadius, 0, Math.PI*2); tCtx.stroke();
                    }

                    if (ent.symbolsAtPoints && ent.symbolText && sym > 0) {
                        tCtx.save();
                        const fSize = getVal(ent.fontSize) || 24;
                        tCtx.font = `${fSize}px 'Cinzel', serif`;
                        tCtx.textAlign = 'center';
                        tCtx.textBaseline = 'middle';
                        const chars = Array.from(ent.symbolText);
                        if (chars.length > 0) {
                            pts.forEach((p, i) => {
                                const char = chars[i % chars.length];
                                tCtx.save();
                                tCtx.translate(p.x, p.y);
                                tCtx.rotate(p.a + Math.PI/2);
                                tCtx.fillText(char, 0, 0);
                                tCtx.restore();
                            });
                        }
                        tCtx.restore();
                    }
                    
                    ent.children.forEach(c => {
                        if (ent.independentEdges && c.edgeIndex !== undefined && c.edgeIndex >= 0 && c.edgeIndex < pts.length) {
                            const p = pts[c.edgeIndex];
                            drawEntity(c, tCtx, p.x, p.y, p.a, isThumbnail);
                        } else {
                            pts.forEach(p => drawEntity(c, tCtx, p.x, p.y, p.a, isThumbnail));
                        }
                    });
                } else {
                    ent.children.forEach(c => drawEntity(c, tCtx, 0, 0, 0, isThumbnail));
                }
                
                if (ent.centerSymbol && ent.centerSymbolText) {
                    tCtx.save();
                    const fSize = getVal(ent.fontSize) || 24;
                    tCtx.font = `${fSize * 2}px 'Cinzel', serif`;
                    tCtx.textAlign = 'center';
                    tCtx.textBaseline = 'middle';
                    tCtx.fillText(ent.centerSymbolText, 0, 0);
                    tCtx.restore();
                }

            } else if (ent.type === 'text') {
                const fSize = getVal(ent.fontSize);
                const fWeight = getVal(ent.fontWeight);
                const lSpacing = getVal(ent.letterSpacing);

                tCtx.font = `${fWeight} ${fSize}px 'Cinzel', serif`;
                tCtx.textAlign = 'center';
                tCtx.textBaseline = 'middle';
                
                if (ent.straightText) {
                    if (tCtx.letterSpacing !== undefined) tCtx.letterSpacing = lSpacing + "px";
                    tCtx.fillText(ent.textContent, 0, -r);
                    if (tCtx.letterSpacing !== undefined) tCtx.letterSpacing = "0px";
                } else {
                    const chars = ent.textContent.split('');
                    const charWidthEstimate = fSize * 0.6; 
                    const arcStep = (charWidthEstimate + lSpacing) / r;
                    const startAngle = -((chars.length - 1) * arcStep) / 2;

                    chars.forEach((char, i) => {
                        tCtx.save();
                        const angle = startAngle + (i * arcStep);
                        tCtx.rotate(angle);
                        tCtx.fillText(char, 0, -r);
                        tCtx.restore();
                    });
                }
                ent.children.forEach(c => drawEntity(c, tCtx, 0, 0, 0, isThumbnail));
            } else if (ent.type === 'symbol') {
                if (ent.symbolData) {
                    const imgToDraw = getTintedImage(ent.id, ent.symbolData, ent.color || '#ffffff');
                    if (imgToDraw && imgToDraw.width) {
                        const aspect = imgToDraw.width / imgToDraw.height;
                        let w = r * 2;
                        let h = w / aspect;
                        if (h > r * 2) {
                            h = r * 2;
                            w = h * aspect;
                        }
                        tCtx.drawImage(imgToDraw, -w/2, -h/2, w, h);
                    }
                }
                ent.children.forEach(c => drawEntity(c, tCtx, 0, 0, 0, isThumbnail));
            } else {
                ent.children.forEach(c => drawEntity(c, tCtx, 0, 0, 0, isThumbnail));
            }

            tCtx.restore();
        }

        function renderLoop() {
            if (!ctx) return requestAnimationFrame(renderLoop);

            // Reset transform to identity before clear to ensure full canvas is wiped
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0,0, canvas.width, canvas.height);
            
            if (window.globalTime === undefined) window.globalTime = 0;
            window.globalTime += 0.016;

            window.activeGizmoNodeMatrix = null;
            window.activeGizmoParentMatrix = null;
            window.activeGizmoRenderMatrix = null;

            const activeWs = getActiveWorkspace();
            if (!activeWs) return requestAnimationFrame(renderLoop);
            if (activeWs && activeWs.type === 'scene') {
                ctx.save();
                ctx.translate(canvas.width/2 + pan.x, canvas.height/2 + pan.y);
                ctx.scale(zoom, zoom);
                project.hierarchy.forEach(root => drawEntity(root, ctx, 0, 0, 0));
                ctx.restore();
            }
            
            if (selectedIds.size === 1 && document.getElementById('ui-gizmo').checked && window.activeGizmoNodeMatrix) {
                ctx.save();
                const gMatrix = new DOMMatrix(window.activeGizmoNodeMatrix).scale(1/zoom, 1/zoom);
                window.activeGizmoRenderMatrix = gMatrix;
                ctx.setTransform(gMatrix);
                
                ctx.lineWidth = 3;
                ctx.shadowBlur = 5;
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                
                // X Arrow (Red)
                ctx.strokeStyle = '#ef4444'; ctx.fillStyle = '#ef4444';
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(60, 0); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(60, -6); ctx.lineTo(75, 0); ctx.lineTo(60, 6); ctx.fill();

                // Y Arrow (Green)
                ctx.strokeStyle = '#22c55e'; ctx.fillStyle = '#22c55e';
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 60); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-6, 60); ctx.lineTo(0, 75); ctx.lineTo(6, 60); ctx.fill();
                
                // Center square (Yellow)
                ctx.fillStyle = '#eab308';
                ctx.fillRect(-6, -6, 12, 12);
                
                ctx.restore();
            }

            requestAnimationFrame(renderLoop);
        }

        function computeMaxBounds(ent) {
            let maxRadius = getVal(ent.radius) || 0;
            if (ent.children) {
                ent.children.forEach(c => {
                    const cRadius = computeMaxBounds(c);
                    const sym = Math.floor(getVal(ent.symmetry) || 0);
                    if (sym > 0) {
                        maxRadius = Math.max(maxRadius, maxRadius + cRadius);
                    } else {
                        const dist = Math.hypot(getVal(c.x)||0, getVal(c.y)||0);
                        maxRadius = Math.max(maxRadius, dist + cRadius);
                    }
                });
            }
            return maxRadius;
        }

        function generateThumbnail(ent) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = 120; tempCanvas.height = 120;
            const tCtx = tempCanvas.getContext('2d');
            
            tCtx.translate(60, 60);
            const maxDim = Math.max(computeMaxBounds(ent) || 10, 80);
            const scale = 50 / maxDim; 
            tCtx.scale(scale, scale);
            
            drawEntity(ent, tCtx, 0, 0, 0, true); 
            return tempCanvas.toDataURL();
        }

        // --- UI REFRESH ---
        function refreshUI() {
            const root = document.getElementById('tree-root');
            root.innerHTML = '';
            const buildTree = (node, container) => {
                const el = document.createElement('div');
                el.className = `tree-node ${selectedIds.has(node.id) ? 'active' : ''}`;
                el.draggable = true;
                const icon = node.type === 'empty' ? '📁' : (node.type === 'text' ? '✍' : (node.type === 'symbol' ? '✧' : '⌬'));
                
                let prefix = '';
                if (node.edgeIndex !== undefined && node.edgeIndex >= 0) {
                    prefix = `<span class="text-blue-400 mr-1" title="Attached to Point ${node.edgeIndex+1}">[Pt${node.edgeIndex + 1}]</span>`;
                }
                
                const isVis = node.visible !== false;
                el.innerHTML = `<div class="flex items-center">
                    <span class="vis-btn mr-2 opacity-50 hover:opacity-100 cursor-pointer text-[10px]" title="Toggle Visibility">${isVis ? '👁' : '✕'}</span>
                    <span style="color:${node.color||'#fff'}" class="mr-1 w-2 h-2 rounded-full inline-block border border-white/20"></span>
                    <span class="text-[10px] uppercase font-bold tracking-wider pointer-events-none ${isVis ? '' : 'opacity-40'}">${prefix}${icon} ${node.name}</span>
                </div>`;
                
                const visBtn = el.querySelector('.vis-btn');
                visBtn.onclick = (e) => {
                    e.stopPropagation();
                    node.visible = !isVis;
                    refreshUI();
                };

                el.onclick = (e) => { 
                    if (e.target === visBtn) return;
                    e.stopPropagation(); 
                    if (e.ctrlKey || e.metaKey) {
                        if (selectedIds.has(node.id)) selectedIds.delete(node.id);
                        else selectedIds.add(node.id);
                    } else {
                        selectedIds.clear();
                        selectedIds.add(node.id);
                    }
                    refreshUI(); 
                };
                el.ondragstart = (e) => { 
                    if (!selectedIds.has(node.id)) {
                        selectedIds.clear();
                        selectedIds.add(node.id);
                    }
                    e.dataTransfer.setData('text/plain', 'hierarchy');
                    e.stopPropagation(); 
                };
                el.ondragover = eDragOver;
                el.ondragleave = eDragLeave;
                el.ondrop = (e) => eDrop(e, node.id);
                el.oncontextmenu = (e) => handleNodeContext(e, node);
                container.appendChild(el);
                node.children.forEach(c => buildTree(c, el));
            };
            project.hierarchy.forEach(n => buildTree(n, root));

            const active = getActive();
            const body = document.getElementById('insp-body'), empty = document.getElementById('insp-empty');
            
            if (selectedIds.size > 1) {
                body.classList.add('hidden'); empty.classList.remove('hidden');
                empty.innerHTML = `<span class="font-bold text-blue-500">${selectedIds.size}</span> Items Selected<br><br><span class="text-[9px]">Multi-edit currently unsupported. Use dragging/deleting.</span>`;
            } else if (active) {
                body.classList.remove('hidden'); empty.classList.add('hidden');
                document.getElementById('geom-props').style.display = active.type === 'empty' ? 'none' : 'block';
                document.getElementById('props-magic').classList.toggle('hidden', active.type === 'text' || active.type === 'symbol');
                document.getElementById('props-text').classList.toggle('hidden', active.type !== 'text');
                
                const parent = findById(active.parentId);
                if (parent && parent.symmetry > 0 && parent.independentEdges) {
                    document.getElementById('prop-edgeIndex-container').classList.remove('hidden');
                    const select = document.getElementById('p-edgeIndex');
                    let opts = `<option value="-1">All Points</option>`;
                    for(let i=0; i<parent.symmetry; i++){
                        opts += `<option value="${i}">Point ${i+1}</option>`;
                    }
                    select.innerHTML = opts;
                    select.value = active.edgeIndex !== undefined ? active.edgeIndex : -1;
                } else {
                    document.getElementById('prop-edgeIndex-container').classList.add('hidden');
                }

                const edgesContainer = document.getElementById('edges-container');
                if (active.independentEdges && active.symmetry > 0) {
                    edgesContainer.classList.remove('hidden');
                    edgesContainer.innerHTML = '';
                    for (let i = 0; i < active.symmetry; i++) {
                        edgesContainer.innerHTML += `
                        <div class="edge-dropzone flex justify-between items-center text-[9px] border-b border-white/5 py-1 px-1 hover:bg-white/5 rounded"
                             ondragover="eDragOver(event)" ondragleave="eDragLeave(event)" ondrop="eDropToEdge(event, '${active.id}', ${i})">
                            <span class="text-slate-300 font-bold pointer-events-none">Point ${i+1}</span>
                            <button onclick="promptAddObjToEdge('${active.id}', ${i})" class="px-2 py-0.5 bg-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-white rounded transition-colors">+ Add</button>
                        </div>`;
                    }
                } else {
                    edgesContainer.classList.add('hidden');
                }
                
                if (document.getElementById('reset-pos-container')) {
                    document.getElementById('reset-pos-container').classList.toggle('hidden', !active.parentId);
                }

                // Toggle conditional sections
                if (document.getElementById('outer-circle-extras')) {
                    document.getElementById('outer-circle-extras').style.display = active.drawOuterCircle ? 'block' : 'none';
                    document.getElementById('dash-config-container').style.display = active.outerDashed ? 'block' : 'none';
                }
                if (document.getElementById('rim-gap-ctrl')) {
                    document.getElementById('rim-gap-ctrl').style.display = active.doubleRim ? 'block' : 'none';
                }

                const props = ['name', 'color', 'x', 'y', 'radius', 'symmetry', 'rotation', 'rotationSpeed', 'drawOuterCircle', 'outerThickness', 'outerDashed', 'outerDashConfig', 'doubleRim', 'rimGap', 'drawPerimeter', 'connectPoints', 'connectPointsSkip', 'connectMidPoints', 'symbolsAtPoints', 'symbolText', 'centerSymbol', 'centerSymbolText', 'linesCenter', 'inscribe', 'independentEdges', 'textContent', 'fontSize', 'fontWeight', 'letterSpacing', 'straightText'];
                props.forEach(k => {
                    const el = document.getElementById('p-' + k);
                    if (!el) return;
                    if (el.type === 'checkbox') el.checked = active[k];
                    else el.value = active[k] !== undefined ? active[k] : el.value;
                    
                    const elVal = document.getElementById('p-' + k + '-val');
                    if (elVal) elVal.value = active[k] !== undefined ? active[k] : elVal.value;
                });
            } else { 
                body.classList.add('hidden'); empty.classList.remove('hidden'); 
                empty.innerText = "No Selection";
            }
            updateLibUI();
        }

        function updateLibUI() {
            const bView = document.getElementById('view-bp'); bView.innerHTML = '';
            project.blueprints.forEach((b, i) => {
                const div = document.createElement('div');
                div.className = "p-2 bg-white/5 border border-white/10 rounded hover:border-blue-500 cursor-pointer text-[9px] font-bold text-center flex flex-col items-center gap-1 group relative";
                
                const thumb = b.thumbnail || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><circle cx="25" cy="25" r="20" stroke="white" stroke-width="2" fill="none"/></svg>';
                
                div.innerHTML = `
                    <img src="${thumb}" class="w-12 h-12 object-contain opacity-70 group-hover:opacity-100 transition-opacity drop-shadow-md">
                    <span class="truncate w-full text-slate-300 group-hover:text-white">${b.name}</span>
                `;
                
                div.onclick = () => {
                    const clone = JSON.parse(JSON.stringify(b));
                    clone.id = Math.random().toString(36).substr(2, 9);
                    const active = getActive();
                    if (active) active.children.push(clone); else project.hierarchy.push(clone);
                    selectedIds.clear(); selectedIds.add(clone.id);
                    refreshUI();
                };
                div.oncontextmenu = (e) => showContext(e, [{ label: "Delete Blueprint", action: () => { project.blueprints.splice(i, 1); updateLibUI(); } }]);
                bView.appendChild(div);
            });
            
            const sList = document.getElementById('symbol-list'); sList.innerHTML = '';
            document.getElementById('symbol-empty').style.display = project.symbols.length ? 'none' : 'block';
            
            project.symbols.forEach((s, i) => {
                const img = document.createElement('div');
                img.className = "p-2 bg-white/5 border border-white/10 rounded cursor-pointer relative group flex items-center justify-center";
                img.draggable = true;
                img.className = "p-2 bg-white/5 border border-white/10 rounded overflow-hidden cursor-pointer relative group flex items-center justify-center";
                img.innerHTML = `
                    <div class="absolute inset-0 bg-black/80 flex border border-blue-500 rounded items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <button class="px-1 text-[8px] bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded" title="Delete" onclick="event.stopPropagation(); project.symbols.splice(${i}, 1); updateLibUI();">✕</button>
                        <button class="px-1 text-[8px] bg-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-white rounded" title="Edit in Forge" onclick="event.stopPropagation(); if(window.editForgeSymbol) window.editForgeSymbol(${i});">Edit</button>
                        <button class="px-1 text-[8px] bg-green-500/20 text-green-400 hover:bg-green-500 hover:text-white rounded" title="Duplicate" onclick="event.stopPropagation(); project.symbols.push(JSON.parse(JSON.stringify(project.symbols[${i}]))); updateLibUI();">Copy</button>
                    </div>
                    <img src="${s.data}" class="w-full h-8 object-contain opacity-60 group-hover:opacity-10 invert pointer-events-none">
                `;
                img.title = s.name;
                
                img.onclick = () => addObject('symbol', null, -1, s.data);
                img.ondragstart = (e) => {
                    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'symbol', data: s.data }));
                };

                img.oncontextmenu = (e) => showContext(e, [{ label: "Delete Symbol", action: () => { project.symbols.splice(i, 1); updateLibUI(); } }]);
                sList.appendChild(img);
            });
        }

        // --- CONTEXT MENUS ---
        function closeCtx() { ctxDiv.style.display = 'none'; }

        function showContext(e, items) {
            e.preventDefault(); e.stopPropagation();
            ctxDiv.innerHTML = '';
            items.forEach(item => {
                const d = document.createElement('div');
                d.className = `context-menu-item`;
                d.innerText = item.label;
                d.onclick = (ev) => { ev.stopPropagation(); item.action(); closeCtx(); };
                ctxDiv.appendChild(d);
            });
            ctxDiv.style.display = 'flex';
            
            let x = e.clientX; let y = e.clientY;
            if (x + 150 > window.innerWidth) x -= 150;
            if (y + (items.length * 30) > window.innerHeight) y -= (items.length * 30);
            
            ctxDiv.style.left = x + 'px'; ctxDiv.style.top = y + 'px';
        }

        function handleHierarchyGlobalContext(e) {
            showContext(e, [
                { label: "Add Magic Circle", action: () => addObject('magic') },
                { label: "Add True Polygon", action: () => addObject('shape') },
                { label: "Add Arcane Text", action: () => addObject('text') },
                { label: "Add Group Folder", action: () => addObject('empty') }
            ]);
        }

        function handleNodeContext(e, node) {
            if (!selectedIds.has(node.id)) {
                selectedIds.clear(); selectedIds.add(node.id); refreshUI();
            }
            
            showContext(e, [
                { label: "Edit in Forge", action: () => { if(node.type === 'symbol') { if(window.editForgeEntity) window.editForgeEntity(node.id); } else { toast("Only symbols can be edited in the Forge directly."); } } },
                { label: "Add Child Magic", action: () => addObject('magic', node.id) },
                { label: "Add Child Polygon", action: () => addObject('shape', node.id) },
                { label: "Add Child Text", action: () => addObject('text', node.id) },
                { label: "Add Child Folder", action: () => addObject('empty', node.id) },
                { label: "Save as Blueprint", action: () => { 
                    if(selectedIds.size > 1) return toast("Only export one at a time.");
                    const clone = JSON.parse(JSON.stringify(node));
                    clone.thumbnail = generateThumbnail(clone);
                    project.blueprints.push(clone); 
                    updateLibUI(); 
                    toast("Blueprint Saved to Library"); 
                }},
                { label: "Duplicate", action: duplicateActive },
                { label: "Delete", action: deleteActive }
            ]);
        }

        // --- INTERACTION ---
        function setupEvents() {
            // Autocomplete Events
            document.getElementById('win-inspector').addEventListener('keydown', handleAcKeyDown);
            document.getElementById('win-inspector').addEventListener('keyup', handleAcKeyUp);
            document.addEventListener('mousedown', (e) => {
                if(acState.active && !e.target.closest('#ac-menu')) closeAc();
            });

            window.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                    e.preventDefault();
                    window.undo();
                }
            });

            window.onmousemove = (e) => {
                if (activeWinDrag) {
                    activeWinDrag.style.left = (e.clientX - winDragOffset.x) + 'px';
                    activeWinDrag.style.top = (e.clientY - winDragOffset.y) + 'px';
                    return;
                } 
                if (isPanning) {
                    pan.x += e.clientX - lastMouse.x; pan.y += e.clientY - lastMouse.y;
                    lastMouse = { x: e.clientX, y: e.clientY };
                    return;
                } 

                if (!isDragging && !isPanning && !isDraggingGizmo) {
                    if (selectedIds.size === 1 && document.getElementById('ui-gizmo').checked && window.activeGizmoRenderMatrix) {
                        const inv = window.activeGizmoRenderMatrix.inverse();
                        const cmp = canvasMousePos(e);
                        const localPt = new DOMPoint(cmp.x, cmp.y).matrixTransform(inv);
                        if ( (localPt.x > -10 && localPt.x < 75 && localPt.y > -10 && localPt.y < 10) || 
                             (localPt.y > -10 && localPt.y < 75 && localPt.x > -10 && localPt.x < 10) ) {
                            canvas.style.cursor = 'move';
                        } else {
                            canvas.style.cursor = 'default';
                        }
                    } else {
                        canvas.style.cursor = 'default';
                    }
                }

                if (isDraggingGizmo && dragGizmoState) {
                    const ent = dragGizmoState.entity;
                    const parentInv = window.activeGizmoParentMatrix.inverse();
                    const cmp = canvasMousePos(e);
                    const parentSpacePt = new DOMPoint(cmp.x, cmp.y).matrixTransform(parentInv);
                    const deltaX = parentSpacePt.x - dragGizmoState.mouseStartX;
                    const deltaY = parentSpacePt.y - dragGizmoState.mouseStartY;
                    
                    if (isDraggingGizmo === 'x' || isDraggingGizmo === 'xy') {
                        if (typeof ent.x === 'number' || !isNaN(ent.x)) {
                            ent.x = dragGizmoState.startX + deltaX;
                            if(document.getElementById('p-x')) document.getElementById('p-x').value = ent.x.toFixed(1);
                        }
                    }
                    if (isDraggingGizmo === 'y' || isDraggingGizmo === 'xy') {
                        if (typeof ent.y === 'number' || !isNaN(ent.y)) {
                            ent.y = dragGizmoState.startY + deltaY;
                            if(document.getElementById('p-y')) document.getElementById('p-y').value = ent.y.toFixed(1);
                        }
                    }
                    return;
                }

                if (isDragging && dragTargets.length > 0) {
                    const wp = screenToWorld(e.clientX, e.clientY);
                    
                    dragTargets.forEach(target => {
                        if (typeof target.node.x === 'number' || !isNaN(target.node.x)) {
                            target.node.x = wp.x - target.offset.x;
                            if(selectedIds.size === 1 && document.getElementById('p-x')) document.getElementById('p-x').value = target.node.x.toFixed(1);
                        }
                        if (typeof target.node.y === 'number' || !isNaN(target.node.y)) {
                            target.node.y = wp.y - target.offset.y;
                            if(selectedIds.size === 1 && document.getElementById('p-y')) document.getElementById('p-y').value = target.node.y.toFixed(1);
                        }
                    });
                }
            };
            
            window.onmouseup = () => { 
                isDragging = isPanning = false; 
                isDraggingGizmo = false;
                dragGizmoState = null;
                dragTargets = []; 
                activeWinDrag = null; 
            };
            
            canvas.onmousedown = (e) => {
                closeCtx();
                document.querySelectorAll('.dropdown-container').forEach(c => c.classList.remove('dropdown-open'));
                lastMouse = { x: e.clientX, y: e.clientY };
                
                if (e.button === 1 || (e.button === 0 && e.altKey)) {
                    isPanning = true;
                    return;
                }

                if (e.button === 0) {
                    if (selectedIds.size === 1 && document.getElementById('ui-gizmo').checked && window.activeGizmoRenderMatrix) {
                        const inv = window.activeGizmoRenderMatrix.inverse();
                        const cmp = canvasMousePos(e);
                        const localPt = new DOMPoint(cmp.x, cmp.y).matrixTransform(inv);
                        
                        if (localPt.x > -10 && localPt.x < 10 && localPt.y > -10 && localPt.y < 10) isDraggingGizmo = 'xy';
                        else if (localPt.x >= 10 && localPt.x <= 75 && localPt.y >= -10 && localPt.y <= 10) isDraggingGizmo = 'x';
                        else if (localPt.y >= 10 && localPt.y <= 75 && localPt.x >= -10 && localPt.x <= 10) isDraggingGizmo = 'y';
                        
                        if (isDraggingGizmo) {
                            const ent = getActive();
                            const parentInv = window.activeGizmoParentMatrix.inverse();
                            const cmpStart = canvasMousePos(e);
                            const parentSpacePt = new DOMPoint(cmpStart.x, cmpStart.y).matrixTransform(parentInv);
                            window.pushUndoState();
                            dragGizmoState = {
                                startX: getVal(ent.x),
                                startY: getVal(ent.y),
                                mouseStartX: parentSpacePt.x,
                                mouseStartY: parentSpacePt.y,
                                entity: ent
                            };
                            return; 
                        }
                    }

                    const wp = screenToWorld(e.clientX, e.clientY);
                    let hit = null;
                    const check = (list) => {
                        for(let r of [...list].reverse()){
                            check(r.children); if(hit) return;
                            
                            const evalX = getVal(r.x);
                            const evalY = getVal(r.y);
                            const d = Math.sqrt((wp.x-evalX)**2 + (wp.y-evalY)**2);
                            
                            if (d < 25 || (r.type !== 'empty' && d < getVal(r.radius))) { hit = r; return; }
                        }
                    };
                    check(project.hierarchy);
                    
                    if (hit) {
                        window.pushUndoState();
                        if (!selectedIds.has(hit.id)) {
                            if (!e.ctrlKey && !e.metaKey) selectedIds.clear();
                            selectedIds.add(hit.id);
                        }
                        isDragging = true; 
                        
                        dragTargets = Array.from(selectedIds).map(id => {
                            const node = findById(id);
                            return { node, offset: { x: wp.x - getVal(node.x), y: wp.y - getVal(node.y) } };
                        });
                    } else { 
                        selectedIds.clear(); 
                    }
                    refreshUI();
                }
            };

            canvas.onwheel = (e) => { e.preventDefault(); zoom *= Math.pow(1.1, -e.deltaY / 200); };

            document.querySelectorAll('input, select, textarea').forEach(el => {
                el.addEventListener('mousedown', () => window.pushUndoState());
                el.addEventListener('focus', () => window.pushUndoState());
                el.addEventListener('input', () => {
                    const active = getActive();
                    
                    if (el.id.startsWith('set-')) {
                        const k = el.id.replace('set-', '');
                        project.settings[k] = el.type === 'range' ? parseFloat(el.value) : el.value;
                        if (document.getElementById('v-'+k)) document.getElementById('v-'+k).innerText = el.value;
                        if (k === 'bgColor') document.body.style.backgroundColor = project.settings.bgColor;
                        return;
                    }
                    
                    if (!active || !el.id.startsWith('p-')) return;
                    
                    let k = el.id.replace('p-', '');
                    let isValInput = false;
                    
                    if (k.endsWith('-val')) {
                        k = k.replace('-val', '');
                        isValInput = true;
                    }
                    
                    if (el.tagName === 'SELECT') {
                        active[k] = parseInt(el.value);
                        refreshUI(); 
                        return;
                    }
                    
                    if (el.type === 'checkbox') {
                        active[k] = el.checked;
                    } else if (el.type === 'range') {
                        active[k] = parseFloat(el.value);
                        const vInp = document.getElementById('p-' + k + '-val');
                        if (vInp) vInp.value = active[k];
                    } else {
                        const raw = el.value;
                        active[k] = (isNaN(raw) || raw.trim() === '') ? raw : parseFloat(raw);
                        
                        if (isValInput && !isNaN(raw) && raw.trim() !== '') {
                            const slider = document.getElementById('p-' + k);
                            if (slider) slider.value = parseFloat(raw);
                        }
                    }
                    
                    if (['independentEdges', 'symmetry', 'drawOuterCircle', 'outerDashed', 'doubleRim'].includes(k)) refreshUI(); 
                });
            });
        }

        function clearHierarchySelection(e) {
            if (e.target.closest('.tree-node')) return;
            selectedIds.clear();
            refreshUI();
            closeCtx();
        }

        function eDragOverCanvas(e) { e.preventDefault(); }
        function eDropCanvas(e) {
            e.preventDefault();
            const dataStr = e.dataTransfer.getData('application/json');
            if (dataStr) {
                try {
                    const data = JSON.parse(dataStr);
                    if (data.type === 'symbol') {
                        const wp = screenToWorld(e.clientX, e.clientY);
                        project.nameCounters = project.nameCounters || { magic: 1, shape: 1, text: 1, empty: 1, symbol: 1 };
                        const obj = createObject('symbol', 'Symbol ' + project.nameCounters['symbol']++, null, data.data);
                        obj.x = wp.x; obj.y = wp.y;
                        project.hierarchy.push(obj);
                        selectedIds.clear(); selectedIds.add(obj.id);
                        refreshUI();
                    }
                } catch(err) {}
            }
        }

        // --- UTILS ---
        function canvasMousePos(e) {
            const rect = canvas.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }

        function screenToWorld(sx, sy) {
            const rect = canvas.getBoundingClientRect();
            return { x: (sx - rect.left - canvas.width / 2 - pan.x) / zoom, y: (sy - rect.top - canvas.height / 2 - pan.y) / zoom };
        }
        
        // Export & Import Systems
        function exportHQImage(withBackground) {
            toast("Generating High Quality Export...");
            setTimeout(() => {
                const size = 4000;
                const expCanvas = document.createElement('canvas');
                expCanvas.width = size;
                expCanvas.height = size;
                const eCtx = expCanvas.getContext('2d');
                
                if (withBackground) {
                    eCtx.fillStyle = project.settings.bgColor;
                    eCtx.fillRect(0, 0, size, size);
                }

                eCtx.save();
                
                // Map the screen center to the 4000x4000 center.
                // We will scale up by a factor to make it "High Quality".
                // 'zoom' is the current view zoom. Let's scale up by 4x fixed relative to screen size.
                // Or safely, just render at a constant 4x of current zoom.
                const expScale = 4;
                eCtx.translate(size/2 + pan.x * expScale, size/2 + pan.y * expScale);
                eCtx.scale(zoom * expScale, zoom * expScale);

                project.hierarchy.forEach(root => drawEntity(root, eCtx, 0, 0, 0));
                
                eCtx.restore();

                const url = expCanvas.toDataURL('image/png', 1.0);
                const a = document.createElement('a');
                a.href = url;
                a.download = `arcanist_export_${Date.now()}.png`;
                a.click();
                toast("Export Complete!");
            }, 100);
        }

        // Starter assets are imported by the user via File > Import or the Library panel.
        // No server-side fetch is needed for this static site.

        function saveProjectFile() {
            const exportData = { 
                workspaces: project.workspaces, 
                settings: project.settings, 
                scripts: project.scripts,
                blueprints: project.blueprints.filter(b => !b.premade), 
                symbols: project.symbols.filter(s => !s.premade), 
                nameCounters: project.nameCounters 
            };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `arcanist_workspace_${Date.now()}.json`;
            a.click();
            toast("Workspace Downloaded");
        }

        function loadProjectFile(e) {
            const f = e.target.files[0]; if (!f) return;
            const r = new FileReader();
            r.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    project.workspaces = data.workspaces || [{ id: 'w_legacy', type: 'scene', name: 'Legacy Scene', hierarchy: data.hierarchy || [], pan: { x: 0, y: 0 }, zoom: 1 }];
                    project.settings = data.settings || project.settings;
                    switchWorkspace(project.workspaces[0].id);
                    project.scripts = data.scripts || [];
                    project.blueprints = data.blueprints || [];
                    project.symbols = data.symbols || [];
                    project.nameCounters = data.nameCounters || { magic: 1, shape: 1, text: 1, empty: 1, symbol: 1 };
                    
                    document.body.style.backgroundColor = project.settings.bgColor;
                    document.getElementById('set-bgColor').value = project.settings.bgColor;
                    if(document.getElementById('set-lineWeight')) document.getElementById('set-lineWeight').value = project.settings.lineWeight;
                    
                    // Legacy workspace script migration on load
                    if (data.settings && data.settings.script && data.settings.script.trim() !== '') {
                        project.scripts.push({ id: 's_legacy', name: 'Legacy Workspace Script', code: data.settings.script });
                        delete data.settings.script;
                    }
                    
                    renderScriptList();
                    selectedIds.clear(); refreshUI(); toast("Workspace Restored");
                } catch(err) {
                    toast("Failed to parse project file.");
                }
            };
            r.readAsText(f);
            e.target.value = ''; 
        }

        function exportBlueprint() {
            if (selectedIds.size !== 1) return toast("Select exactly one object to export");
            const active = getActive();
            if(!active) return;
            const blob = new Blob([JSON.stringify(active, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `arcanist_blueprint_${active.name.toLowerCase()}.json`;
            a.click();
            toast("Blueprint Exported");
        }

        function loadBlueprintFile(e) {
            const f = e.target.files[0]; if (!f) return;
            const r = new FileReader();
            r.onload = (ev) => {
                try {
                    const bp = JSON.parse(ev.target.result);
                    if(bp.id && bp.type) {
                        bp.thumbnail = generateThumbnail(bp);
                        project.blueprints.push(bp);
                        updateLibUI();
                        toast("Blueprint Imported to Library");
                    } else {
                        toast("Invalid blueprint file format");
                    }
                } catch(err) {
                    toast("Failed to parse blueprint.");
                }
            };
            r.readAsText(f);
            e.target.value = '';
        }

        function importSymbols(e) {
            const files = Array.from(e.target.files);
            let count = 0;
            files.forEach(f => {
                const r = new FileReader();
                r.onload = (ev) => { 
                    project.symbols.push({ name: f.name, data: ev.target.result, premade: false }); 
                    updateLibUI(); 
                };
                r.readAsDataURL(f);
                count++;
            });
            if (count > 0) toast(`Imported ${count} Symbols`);
            e.target.value = ''; 
        }

        function importWorkspace(e) {
            const files = Array.from(e.target.files);
            let symCount = 0, bpCount = 0;
            files.forEach(f => {
                const path = f.webkitRelativePath.toLowerCase();
                if (f.type.startsWith('image/')) {
                    const r = new FileReader();
                    r.onload = (ev) => { project.symbols.push({ name: f.name, data: ev.target.result, premade: false }); updateLibUI(); };
                    r.readAsDataURL(f);
                    symCount++;
                } else if (f.name.endsWith('.json') && path.includes('blueprint')) {
                    const r = new FileReader();
                    r.onload = (ev) => { 
                        try {
                            const bp = JSON.parse(ev.target.result);
                            if(bp.id && bp.type) { project.blueprints.push(bp); updateLibUI(); }
                        } catch(err){}
                    };
                    r.readAsText(f);
                    bpCount++;
                }
            });
            toast(`Imported ${symCount} images and ${bpCount} blueprints`);
            e.target.value = '';
        }

        function eDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); e.stopPropagation(); }
        function eDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
        
        function eDrop(e, targetId) {
            e.preventDefault(); e.stopPropagation();
            e.currentTarget.classList.remove('drag-over');
            window.pushUndoState();
            
            selectedIds.forEach(id => {
                if (id === targetId || isAncestor(id, targetId)) return;
                const moving = findById(id);
                deleteById(id);
                moving.edgeIndex = -1;
                if (targetId) {
                    const parent = findById(targetId);
                    moving.parentId = targetId; parent.children.push(moving);
                } else { 
                    moving.parentId = null; project.hierarchy.push(moving); 
                }
            });
            refreshUI();
        }

        function eDropToEdge(e, parentId, edgeIndex) {
            e.preventDefault(); e.stopPropagation();
            e.currentTarget.classList.remove('drag-over');
            window.pushUndoState();
            
            selectedIds.forEach(id => {
                if (id === parentId || isAncestor(id, parentId)) return;
                const moving = findById(id);
                deleteById(id);
                moving.parentId = parentId;
                moving.edgeIndex = edgeIndex;
                const parent = findById(parentId);
                parent.children.push(moving);
            });
            refreshUI();
        }

        function setLibTab(t) {
            document.getElementById('t-bp').classList.toggle('active', t==='bp');
            document.getElementById('t-sm').classList.toggle('active', t==='sm');
            document.getElementById('view-bp').classList.toggle('hidden', t!=='bp');
            document.getElementById('view-sm').classList.toggle('hidden', t!=='sm');
        }

        function deleteActive() { 
            if(selectedIds.size > 0) { 
                window.pushUndoState();
                selectedIds.forEach(id => deleteById(id)); 
                selectedIds.clear(); 
                refreshUI(); 
            }
        }
        
        function duplicateActive() {
            if(selectedIds.size === 0) return;
            window.pushUndoState();
            const newIds = new Set();
            selectedIds.forEach(id => {
                const active = findById(id);
                if (!active) return;
                const clone = JSON.parse(JSON.stringify(active));
                clone.id = Math.random().toString(36).substr(2, 9);
                clone.x = getVal(active.x) + 10; 
                clone.y = getVal(active.y) + 10;
                
                function randomizeIds(node) {
                    node.id = Math.random().toString(36).substr(2, 9);
                    if (node.children) node.children.forEach(randomizeIds);
                }
                if (clone.children) clone.children.forEach(randomizeIds);

                if (active.parentId) {
                    const parent = findById(active.parentId);
                    if (parent) parent.children.push(clone);
                } else project.hierarchy.push(clone);
                
                newIds.add(clone.id);
            });
            selectedIds = newIds; 
            refreshUI();
        }

        function globalDeselect(e) { 
            document.querySelectorAll('.dropdown-container').forEach(c => c.classList.remove('dropdown-open'));
            
            if(e.target.tagName === 'CANVAS') { 
                selectedIds.clear(); refreshUI(); closeCtx(); 
            } 
        }
function toast(m) { const t = document.getElementById('toast'); t.innerText = m; t.style.opacity = 1; setTimeout(() => t.style.opacity = 0, 2500); }

        window.onload = () => { init(); project.activeWorkspaceId = project.workspaces[0].id; renderTabs(); };