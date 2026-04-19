// --- SYMBOL FORGE LOGIC ---
        let forgeState = { isDrawing: false, mode: 'freehand', layers: [{ id: 'layer_1', name: 'Background', visible: true, locked: false, shapes: [] }], activeLayerId: 'layer_1', currentShape: null, color: '#fff', weight: 2, previewPt: null, activeBezierPt: null, showGrid: true, snapGrid: false, gridSize: 20, editingSymbolIdx: null, editingEntityId: null, selectedIndex: -1, undoHistory: [], redoHistory: [] };
        let forgeCanvas, fCtx;

        
        window.loadForgeWorkspace = function(ws) {
            forgeState.activeWorkspaceId = ws.id;
            if(!ws.layers || ws.layers.length === 0) ws.layers = [{ id: 'l_'+Math.random().toString(36).substr(2,6), name: 'Background', visible: true, locked: false, shapes: [] }];
            forgeState.layers = ws.layers;
            forgeState.activeLayerId = ws.activeLayerId || ws.layers[0].id;
            forgeState.undoHistory = ws.undoHistory || [];
            forgeState.redoHistory = ws.redoHistory || [];
            forgeState.isDrawing = false;
            forgeState.currentShape = null;
            
            // Sync UI inputs if possible
            if (document.getElementById('forge-w')) document.getElementById('forge-w').value = forgeCanvas.width;
            if (document.getElementById('forge-h')) document.getElementById('forge-h').value = forgeCanvas.height;
            
            redrawForge();
        };

        // Make sure switching edits local active workspace immediately
        function syncForgeToWorkspace() {
            if(!window.project || !forgeState.activeWorkspaceId) return;
            const ws = project.workspaces.find(w => w.id === forgeState.activeWorkspaceId);
            if(ws) {
                ws.layers = forgeState.layers;
                ws.activeLayerId = forgeState.activeLayerId;
                ws.undoHistory = forgeState.undoHistory;
                ws.redoHistory = forgeState.redoHistory;
            }
        }

        function getActiveLayer() {
            return forgeState.layers.find(l => l.id === forgeState.activeLayerId) || forgeState.layers[0];
        }

        function getActiveShapes() {
            const lyr = getActiveLayer();
            return lyr ? lyr.shapes : [];
        }

        function smoothPoints(pts, amount) {
            if (amount === 0 || pts.length < 3) return pts;
            let p = [...pts];
            for(let itr=0; itr<amount; itr++) {
                let smoothed = [p[0]];
                for(let i=1; i<p.length-1; i++) {
                    smoothed.push({ x: (p[i-1].x + p[i].x*2 + p[i+1].x)/4, y: (p[i-1].y + p[i].y*2 + p[i+1].y)/4 });
                }
                smoothed.push(p[p.length-1]);
                p = smoothed;
            }
            return p;
        }

        function setForgeTool(tool) {
            const prevMode = forgeState.mode;
            forgeState.mode = tool;
            // Update toolbar button styles
            const toolbar = document.getElementById('forge-toolbar');
            if (toolbar) {
                toolbar.querySelectorAll('button[data-tool]').forEach(btn => {
                    const isActive = btn.dataset.tool === tool;
                    if (isActive) {
                        btn.classList.add('bg-blue-600', 'text-white');
                        btn.classList.remove('text-slate-400', 'hover:text-white');
                    } else {
                        btn.classList.remove('bg-blue-600', 'text-white');
                        btn.classList.add('text-slate-400', 'hover:text-white');
                    }
                    // Clear any leftover inline styles
                    btn.style.background = '';
                    btn.style.color = '';
                });
            }
            // Cancel any in-progress drawing when switching tools
            if (forgeState.isDrawing && prevMode !== tool) {
                forgeState.isDrawing = false;
                const shapes = getActiveShapes();
                if (forgeState.currentShape && shapes.length > 0 &&
                    shapes[shapes.length-1] === forgeState.currentShape) {
                    shapes.pop();
                }
                forgeState.currentShape = null;
                forgeState.previewPt = null;
                forgeState.activeBezierPt = null;
            }
            redrawForge();
        }

        function initForge() {
            forgeCanvas = document.getElementById('forgeCanvas');
            if(!forgeCanvas) return;
            fCtx = forgeCanvas.getContext('2d', { willReadFrequently: true });
            
            forgeCanvas.addEventListener('pointerdown', (e) => {
                if(e.button !== 0) return;
                e.preventDefault(); e.stopPropagation();
                
                forgeState.color = document.getElementById('draw-color').value;
                forgeState.weight = parseFloat(document.getElementById('draw-weight').value);
                const rect = forgeCanvas.getBoundingClientRect();
                const {x, y} = snapPt(e.clientX - rect.left, e.clientY - rect.top);
                
                // Save undo only on start of new shape (or clicking vector erase)
                if(!forgeState.isDrawing && forgeState.mode !== 'erase-vector') saveUndoState();

                if (forgeState.mode === 'erase-vector') {
                    // Reverse iterate to delete top-most shape hitting X Y in active layer
                    const shapes = getActiveShapes();
                    const lyr = getActiveLayer();
                    if(lyr.locked) { toast("Active layer is locked"); return; }
                    for(let i=shapes.length-1; i>=0; i--) {
                        let s = shapes[i];
                        let hit = false;
                        if(s.type === 'circle') hit = Math.hypot(x-s.cx, y-s.cy) <= s.r + (s.weight/2+2);
                        else if(s.type==='rect') hit = (x>=Math.min(s.x1,s.x2)-(s.weight/2+2) && x<=Math.max(s.x1,s.x2)+(s.weight/2+2) && y>=Math.min(s.y1,s.y2)-(s.weight/2+2) && y<=Math.max(s.y1,s.y2)+(s.weight/2+2));
                        else if(s.type==='line') { // Approximate box hit
                            hit = (x>=Math.min(s.x1,s.x2)-10 && x<=Math.max(s.x1,s.x2)+10 && y>=Math.min(s.y1,s.y2)-10 && y<=Math.max(s.y1,s.y2)+10);
                        } else if(s.type==='freehand' || s.type==='bezier') {
                            for(let pt of s.points) { if(Math.hypot(x-pt.x, y-pt.y) < 15) { hit = true; break; } }
                        }
                        if(hit) {
                            saveUndoState();
                            shapes.splice(i, 1);
                            if(forgeState.selectedIndex === s.id) forgeState.selectedIndex = null;
                            redrawForge();
                            toast("Shape Erased");
                            break;
                        }
                    }
                    return;
                }
        

                if (forgeState.mode === 'freehand' || forgeState.mode === 'erase-mask') {
                    forgeState.isDrawing = true;
                    forgeState.currentShape = { type: 'freehand', name:(forgeState.mode==='erase-mask'?'Mask Eraser':'Freehand'), color: (forgeState.mode==='erase-mask' ? 'black' : forgeState.color), isMask: (forgeState.mode === 'erase-mask'), weight: forgeState.weight, points: [{x, y}] };
                    forgeState.currentShape.id = Math.random().toString(36).substr(2,9);
                    getActiveShapes().push(forgeState.currentShape);
                } else if (forgeState.mode === 'dummy-guard') {
                    forgeState.isDrawing = true;
                    forgeState.currentShape = { type: 'freehand', color: forgeState.color, weight: forgeState.weight, points: [{x, y}] };
                    forgeState.currentShape.id = Math.random().toString(36).substr(2,9);
                    getActiveShapes().push(forgeState.currentShape);
                } else if (forgeState.mode === 'line') {
                    forgeState.isDrawing = true;
                    forgeState.currentShape = { type: 'line', color: forgeState.color, weight: forgeState.weight, x1: x, y1: y, x2: x, y2: y };
                    forgeState.currentShape.id = Math.random().toString(36).substr(2,9);
                    getActiveShapes().push(forgeState.currentShape);
                } else if (forgeState.mode === 'circle') {
                    forgeState.isDrawing = true;
                    forgeState.currentShape = { type: 'circle', color: forgeState.color, weight: forgeState.weight, cx: x, cy: y, r: 0 };
                    forgeState.currentShape.id = Math.random().toString(36).substr(2,9);
                    getActiveShapes().push(forgeState.currentShape);
                } else if (forgeState.mode === 'rect') {
                    forgeState.isDrawing = true;
                    forgeState.currentShape = { type: 'rect', color: forgeState.color, weight: forgeState.weight, x1: x, y1: y, x2: x, y2: y };
                    forgeState.currentShape.id = Math.random().toString(36).substr(2,9);
                    getActiveShapes().push(forgeState.currentShape);
                } else if (forgeState.mode === 'curve') {
                    if (!forgeState.isDrawing) {
                        forgeState.isDrawing = true;
                        forgeState.currentShape = { type: 'bezier', color: forgeState.color, weight: forgeState.weight, points: [] };
                        forgeState.currentShape.id = Math.random().toString(36).substr(2,9);
                    getActiveShapes().push(forgeState.currentShape);
                    }
                    const pt = { x, y, h1x: x, h1y: y, h2x: x, h2y: y };
                    forgeState.currentShape.points.push(pt);
                    forgeState.activeBezierPt = pt;
                }
                redrawForge();
            });

            forgeCanvas.addEventListener('pointermove', (e) => {
                const _rect0 = forgeCanvas.getBoundingClientRect();
                const _rx = e.clientX - _rect0.left, _ry = e.clientY - _rect0.top;
                updateForgeCoords(_rx, _ry);
                if (!forgeState.isDrawing || !forgeState.currentShape) return;
                e.preventDefault(); e.stopPropagation();
                const rect = forgeCanvas.getBoundingClientRect();
                const {x, y} = snapPt(e.clientX - rect.left, e.clientY - rect.top);
                
                // Save undo only on start of new shape (or clicking vector erase)
                if(!forgeState.isDrawing && forgeState.mode !== 'erase-vector') saveUndoState();

                if (forgeState.mode === 'erase-vector') {
                    // Reverse iterate to delete top-most shape hitting X Y in active layer
                    const shapes = getActiveShapes();
                    const lyr = getActiveLayer();
                    if(lyr.locked) { toast("Active layer is locked"); return; }
                    for(let i=shapes.length-1; i>=0; i--) {
                        let s = shapes[i];
                        let hit = false;
                        if(s.type === 'circle') hit = Math.hypot(x-s.cx, y-s.cy) <= s.r + (s.weight/2+2);
                        else if(s.type==='rect') hit = (x>=Math.min(s.x1,s.x2)-(s.weight/2+2) && x<=Math.max(s.x1,s.x2)+(s.weight/2+2) && y>=Math.min(s.y1,s.y2)-(s.weight/2+2) && y<=Math.max(s.y1,s.y2)+(s.weight/2+2));
                        else if(s.type==='line') { // Approximate box hit
                            hit = (x>=Math.min(s.x1,s.x2)-10 && x<=Math.max(s.x1,s.x2)+10 && y>=Math.min(s.y1,s.y2)-10 && y<=Math.max(s.y1,s.y2)+10);
                        } else if(s.type==='freehand' || s.type==='bezier') {
                            for(let pt of s.points) { if(Math.hypot(x-pt.x, y-pt.y) < 15) { hit = true; break; } }
                        }
                        if(hit) {
                            saveUndoState();
                            shapes.splice(i, 1);
                            if(forgeState.selectedIndex === s.id) forgeState.selectedIndex = null;
                            redrawForge();
                            toast("Shape Erased");
                            break;
                        }
                    }
                    return;
                }
        
                
                if (forgeState.mode === 'freehand' || forgeState.mode === 'erase-mask') {
                    const lastPt = forgeState.currentShape.points[forgeState.currentShape.points.length - 1];
                    if (Math.hypot(x - lastPt.x, y - lastPt.y) > 2) {
                        forgeState.currentShape.points.push({x, y});
                        redrawForge();
                    }
                } else if (forgeState.mode === 'line') {
                    forgeState.currentShape.x2 = x;
                    forgeState.currentShape.y2 = y;
                    redrawForge();
                } else if (forgeState.mode === 'rect') {
                    forgeState.currentShape.x2 = x;
                    forgeState.currentShape.y2 = y;
                    redrawForge();
                } else if (forgeState.mode === 'circle') {
                    const cx = forgeState.currentShape.cx;
                    const cy = forgeState.currentShape.cy;
                    forgeState.currentShape.r = Math.hypot(x - cx, y - cy);
                    redrawForge();
                } else if (forgeState.mode === 'curve') {
                    if (e.buttons === 1 && forgeState.activeBezierPt) {
                        forgeState.activeBezierPt.h2x = x;
                        forgeState.activeBezierPt.h2y = y;
                        forgeState.activeBezierPt.h1x = forgeState.activeBezierPt.x - (x - forgeState.activeBezierPt.x);
                        forgeState.activeBezierPt.h1y = forgeState.activeBezierPt.y - (y - forgeState.activeBezierPt.y);
                    } else {
                        forgeState.previewPt = {x, y};
                    }
                    redrawForge();
                }
            });

            forgeCanvas.addEventListener('contextmenu', (e) => {
                if (forgeState.mode === 'curve' && forgeState.isDrawing) {
                    e.preventDefault();
                    forgeState.isDrawing = false;
                    forgeState.previewPt = null;
                    forgeState.activeBezierPt = null;
                    redrawForge();
                }
            });

            const stopDraw = (e) => {
                if (!forgeState.isDrawing) return;
                e.stopPropagation();
                if (forgeState.mode !== 'curve') {
                    forgeState.isDrawing = false;
                    forgeState.currentShape = null;
                } else {
                    forgeState.activeBezierPt = null;
                }
                redrawForge();
            };

            forgeCanvas.addEventListener('pointerup', stopDraw);
            forgeCanvas.addEventListener('pointerleave', stopDraw);
        }

        function syncRef() { if(!window.project || !forgeState.activeWorkspaceId) return; const ws=project.workspaces.find(w=>w.id===forgeState.activeWorkspaceId); if(ws){ws.layers=forgeState.layers;ws.activeLayerId=forgeState.activeLayerId;ws.undoHistory=forgeState.undoHistory;ws.redoHistory=forgeState.redoHistory;} }

        function redrawForge(ctx = fCtx, skipPreview = false) {
            if (!ctx) {
                // Potential recovery if global reference lost
                const cvs = document.getElementById('forgeCanvas');
                if (cvs) { fCtx = cvs.getContext('2d'); ctx = fCtx; }
            }
            if(!ctx) return;
            
            if (ctx === fCtx) {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0,0, forgeCanvas.width, forgeCanvas.height);
                drawForgeGrid(ctx);
            }
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';

            forgeState.layers.forEach(lyr => {
                if(!lyr.visible) return;
                lyr.shapes.forEach(s => {
                    ctx.beginPath();
                    ctx.strokeStyle = s.color;
                    ctx.lineWidth = s.weight;
                    
                    if(forgeState.selectedIndex === s.id && !skipPreview) {
                        ctx.shadowBlur = 8; ctx.shadowColor='#3b82f6';
                    } else ctx.shadowBlur = 0;

                if (s.type === 'freehand') {
                    if (s.points.length === 0) return;
                    const el = document.getElementById('draw-smooth');
                    const smoothAmt = el ? parseInt(el.value) : 0;
                    const pts = smoothPoints(s.points, smoothAmt);
                    ctx.moveTo(pts[0].x, pts[0].y);
                    if (pts.length === 1) ctx.lineTo(pts[0].x + 0.1, pts[0].y);
                    else for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
                    if(s.isMask) ctx.globalCompositeOperation = 'destination-out';
                    ctx.stroke();
                    if(s.isMask) ctx.globalCompositeOperation = 'source-over';
                } else if (s.type === 'line') {
                    ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
                } else if (s.type === 'rect') {
                    ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
                } else if (s.type === 'circle') {
                    ctx.arc(s.cx, s.cy, Math.max(0.1, s.r), 0, Math.PI * 2); ctx.stroke();
                } else if (s.type === 'bezier') {
                    if (s.points.length === 0) return;
                    const pts = s.points;
                    ctx.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) {
                        ctx.bezierCurveTo(pts[i-1].h2x, pts[i-1].h2y, pts[i].h1x, pts[i].h1y, pts[i].x, pts[i].y);
                    }
                    if (!skipPreview && s === forgeState.currentShape && forgeState.previewPt) {
                        ctx.bezierCurveTo(pts[pts.length-1].h2x, pts[pts.length-1].h2y, forgeState.previewPt.x, forgeState.previewPt.y, forgeState.previewPt.x, forgeState.previewPt.y);
                    }
                    ctx.stroke();

                    if (!skipPreview && s === forgeState.currentShape && forgeState.isDrawing && ctx === fCtx) {
                        ctx.save();
                        pts.forEach(pt => {
                            ctx.fillStyle = '#ef4444'; ctx.fillRect(pt.x-2, pt.y-2, 4, 4);
                            ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1;
                            ctx.beginPath(); ctx.moveTo(pt.h1x, pt.h1y); ctx.lineTo(pt.h2x, pt.h2y); ctx.stroke();
                            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(pt.h1x, pt.h1y, 3, 0, Math.PI*2); ctx.fill(); ctx.stroke();
                            ctx.beginPath(); ctx.arc(pt.h2x, pt.h2y, 3, 0, Math.PI*2); ctx.fill(); ctx.stroke();
                        });
                        ctx.restore();
                    }
                }
                });
            });

            if (!skipPreview && forgeState.mode === 'curve' && forgeState.isDrawing && ctx === fCtx) {
                ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10px Inter';
                ctx.fillText("Right-click to finish curve", 10, 20);
            }
            renderForgeHierarchy(); syncRef();
        }

        function drawUndo() {
            forceUndo(); 
        }

        function drawClear() {
            if(!confirm("Clear all drawing?")) return;
            forgeState.layers = [{ id: 'layer_1', name:'Background', visible:true, locked:false, shapes:[] }]; forgeState.activeLayerId='layer_1'; forgeState.isDrawing = false; forgeState.currentShape = null;
            redrawForge();
        }

        function resizeForgeCanvas() {
            const w = Math.max(100, Math.min(2000, parseInt(document.getElementById('forge-w').value) || 460));
            const h = Math.max(100, Math.min(2000, parseInt(document.getElementById('forge-h').value) || 400));
            forgeCanvas.width = w;
            forgeCanvas.height = h;
            // Resize the container div to match
            const container = document.getElementById('draw-container');
            if (container) { container.style.width = w + 'px'; container.style.height = h + 'px'; }
            
            fCtx = forgeCanvas.getContext('2d');
            redrawForge();
        }

        function loadTraceImage(e) {
            const f = e.target.files[0]; if (!f) return;
            const r = new FileReader(); r.onload = ev => {
                const img = document.getElementById('trace-bg');
                img.src = ev.target.result; img.classList.remove('hidden');
            }; r.readAsDataURL(f); e.target.value = '';
        }

        function clearTraceImage() {
            const img = document.getElementById('trace-bg'); img.src = ''; img.classList.add('hidden');
        }

        function updateTraceOpacity() { document.getElementById('trace-bg').style.opacity = document.getElementById('trace-opacity').value; }

        function saveForgeAsSymbol() {
            if (forgeState.layers.every(l => l.shapes.length === 0)) return toast("Nothing drawn to save.");
            const isEditing = getActiveWorkspace()?.editingSymbolIdx !== null && getActiveWorkspace()?.editingSymbolIdx !== undefined;
            const defaultName = isEditing ? project.symbols[getActiveWorkspace()?.editingSymbolIdx].name : "Drawn Symbol " + (project.nameCounters.symbol || 1);
            const name = prompt("Name this Vector Symbol:", defaultName);
            if (!name) return;
            
            let minX = 9999, minY = 9999, maxX = -9999, maxY = -9999;
            forgeState.layers.forEach(l => l.shapes.forEach(s => {
                const r = s.weight / 2 + 2;
                const addPt = (x, y) => {
                    if (x - r < minX) minX = x - r; if (x + r > maxX) maxX = x + r;
                    if (y - r < minY) minY = y - r; if (y + r > maxY) maxY = y + r;
                };
                if (s.type === 'circle') { addPt(s.cx - s.r, s.cy - s.r); addPt(s.cx + s.r, s.cy + s.r);
                } else if (s.type === 'line' || s.type === 'rect') { addPt(s.x1, s.y1); addPt(s.x2, s.y2);
                } else if (s.type === 'freehand') { s.points.forEach(pt => addPt(pt.x, pt.y));
                } else if (s.type === 'bezier') { s.points.forEach(pt => { addPt(pt.x, pt.y); addPt(pt.h1x, pt.h1y); addPt(pt.h2x, pt.h2y); }); }
            }));

            if (minX > maxX || minY > maxY) return;
            minX = Math.max(0, minX); minY = Math.max(0, minY); maxX = Math.min(forgeCanvas.width, maxX); maxY = Math.min(forgeCanvas.height, maxY);
            const w = maxX - minX; const h = maxY - minY; if(w <= 0 || h <= 0) return;

            const tempC = document.createElement('canvas'); tempC.width = w; tempC.height = h; const tempCtx = tempC.getContext('2d');
            tempCtx.translate(-minX, -minY); redrawForge(tempCtx, true);
            const dataUrl = tempC.toDataURL('image/png');
            const shapeData = JSON.parse(JSON.stringify(forgeState.layers));
            if (getActiveWorkspace()?.editingSymbolIdx !== null && getActiveWorkspace()?.editingSymbolIdx !== undefined) {
                // Overwrite existing symbol
                project.symbols[getActiveWorkspace()?.editingSymbolIdx] = { name, data: dataUrl, premade: false, shapeData };
                const _ws422 = getActiveWorkspace(); if (_ws422) _ws422.editingSymbolIdx = null;
                toast("Symbol updated in Library!");
            } else {
                project.nameCounters.symbol = project.nameCounters.symbol ? project.nameCounters.symbol + 1 : 2;
                project.symbols.push({ name, data: dataUrl, premade: false, shapeData });
                toast("Vector Symbol Saved to Library!");
            }
            updateLibUI(); document.getElementById('win-library').classList.remove('hidden'); setLibTab('sm');
        }


        // Snap a coordinate to the grid
        function snapPt(x, y) {
            if (!forgeState.snapGrid) return {x, y};
            const g = forgeState.gridSize || 20;
            return { x: Math.round(x/g)*g, y: Math.round(y/g)*g };
        }

        function drawForgeGrid(ctx) {
            if (!forgeState.showGrid) return;
            const g = forgeState.gridSize || 20;
            const w = forgeCanvas.width, h = forgeCanvas.height;
            ctx.save();
            for (let x = 0; x <= w; x += g) {
                ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h);
                ctx.strokeStyle = (x % (g*5) === 0) ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
                ctx.lineWidth = 0.5; ctx.stroke();
            }
            for (let y = 0; y <= h; y += g) {
                ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y);
                ctx.strokeStyle = (y % (g*5) === 0) ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
                ctx.lineWidth = 0.5; ctx.stroke();
            }
            ctx.restore();
        }

        function toggleForgeGrid() {
            forgeState.showGrid = !forgeState.showGrid;
            const btn = document.getElementById('btn-grid');
            if (btn) btn.style.background = forgeState.showGrid ? '#1e3a8a' : 'transparent';
            redrawForge();
        }

        function toggleForgeSnap() {
            forgeState.snapGrid = !forgeState.snapGrid;
            const btn = document.getElementById('btn-snap');
            if (btn) { btn.style.background = forgeState.snapGrid ? '#065f46' : 'transparent'; btn.style.color = forgeState.snapGrid ? '#6ee7b7' : '#94a3b8'; }
        }

        function updateGridSize() {
            forgeState.gridSize = Math.max(2, parseInt(document.getElementById('forge-gridsize').value) || 20);
            redrawForge();
        }

        function updateForgeCoords(x, y) {
            const el = document.getElementById('forge-coords');
            if (el) el.textContent = `X: ${Math.round(x)}  Y: ${Math.round(y)}`;
        }

        function updateTraceFilter() {
            const img = document.getElementById('trace-bg');
            if (!img) return;
            const hue = document.getElementById('trace-hue') ? document.getElementById('trace-hue').value : 0;
            const bri = document.getElementById('trace-brightness') ? document.getElementById('trace-brightness').value : 100;
            const inv = document.getElementById('trace-invert') ? (document.getElementById('trace-invert').checked ? 1 : 0) : 0;
            img.style.filter = `hue-rotate(${hue}deg) brightness(${bri}%) invert(${inv})`;
        }

        function recolorStrokes() {
            const el = document.getElementById('recolor-pick');
            if (!el) return;
            forgeState.layers.forEach(l => l.shapes.forEach(s => s.color = el.value));
            redrawForge();
            toast('All strokes recolored!');
        }

        function forgeCropDataUrl() {
            if (forgeState.layers.every(l => l.shapes.length === 0)) return null;
            let minX=9999,minY=9999,maxX=-9999,maxY=-9999;
            forgeState.layers.forEach(l => l.shapes.forEach(s => {
                const r = s.weight/2+2;
                const ap=(x,y)=>{if(x-r<minX)minX=x-r;if(x+r>maxX)maxX=x+r;if(y-r<minY)minY=y-r;if(y+r>maxY)maxY=y+r;};
                if(s.type==='circle'){ap(s.cx-s.r,s.cy-s.r);ap(s.cx+s.r,s.cy+s.r);}
                else if(s.type==='line'||s.type==='rect'){ap(s.x1,s.y1);ap(s.x2,s.y2);}
                else if(s.type==='freehand'){s.points.forEach(p=>ap(p.x,p.y));}
                else if(s.type==='bezier'){s.points.forEach(p=>{ap(p.x,p.y);ap(p.h1x,p.h1y);ap(p.h2x,p.h2y);});}
            }));
            if(minX>maxX||minY>maxY) return null;
            minX=Math.max(0,minX);minY=Math.max(0,minY);
            maxX=Math.min(forgeCanvas.width,maxX);maxY=Math.min(forgeCanvas.height,maxY);
            const w=maxX-minX,h=maxY-minY;
            if(w<=0||h<=0) return null;
            const tc=document.createElement('canvas');tc.width=w;tc.height=h;
            const tx=tc.getContext('2d');tx.translate(-minX,-minY);
            redrawForge(tx,true);
            return { dataUrl: tc.toDataURL('image/png'), w, h };
        }

        function placeForgeInScene() {
            if (forgeState.layers.every(l => l.shapes.length === 0)) return toast("Nothing to place.");
            const name = prompt("Name for this scene element:", "Forge Shape");
            if (!name) return;
            const crop = forgeCropDataUrl();
            if (!crop) return toast("Could not crop drawing.");
            const shapeData = JSON.parse(JSON.stringify(forgeState.layers));
            
            // Use createObject so the entity has all required fields (radius, color, visible, etc.)
            const entity = createObject('symbol', name, null, crop.dataUrl);
            entity.radius = Math.max(crop.w, crop.h) / 2;
            entity.x = 0;
            entity.y = 0;
            entity.shapeData = shapeData;
            
            project.hierarchy.push(entity);
            selectedIds.clear();
            selectedIds.add(entity.id);
            refreshUI();
            toast(`"${name}" placed in scene!`);
        }

        function editForgeSymbol(symIndex) {
            const sym = project.symbols[symIndex];
            if (!sym || !sym.shapeData) return toast("This symbol has no editable Forge data.");
            const wsId = 'w_forge_' + Math.random().toString(36).substr(2,6);
            project.workspaces.push({ 
                id: wsId, type: 'forge', name: 'Editing: ' + sym.name,
                layers: Array.isArray(sym.shapeData) ? JSON.parse(JSON.stringify(sym.shapeData)) : [{id:'legacy', name:'Legacy', visible:true, locked:false, shapes: JSON.parse(JSON.stringify(sym.shapeData))}],
                undoHistory: [], redoHistory: [], editingSymbolIdx: symIndex, editingEntityId: null
            });
            window.switchWorkspace(wsId);
            toast("Symbol loaded into Forge — edit and re-save.");
        }

        function editForgeEntity(entityId) {
            const ent = findById(entityId);
            if (!ent || !ent.shapeData) return toast("This entity has no Forge data.");
            const wsId = 'w_forge_' + Math.random().toString(36).substr(2,6);
            project.workspaces.push({ 
                id: wsId, type: 'forge', name: 'Editing: ' + ent.name,
                layers: Array.isArray(ent.shapeData) ? JSON.parse(JSON.stringify(ent.shapeData)) : [{id:'legacy', name:'Legacy', visible:true, locked:false, shapes: JSON.parse(JSON.stringify(ent.shapeData))}],
                undoHistory: [], redoHistory: [], editingSymbolIdx: null, editingEntityId: entityId
            });
            window.switchWorkspace(wsId);
            toast("Entity loaded into Forge — edit and re-save.");
        }




        function addForgeLayer() {
            const id = 'l_' + Math.random().toString(36).substr(2,6);
            forgeState.layers.unshift({ id, name: 'New Layer', visible: true, locked: false, shapes: [] });
            forgeState.activeLayerId = id;
            renderForgeHierarchy(); syncRef();
        }

        function deleteForgeLayer(id) {
            if(forgeState.layers.length <= 1) return toast("Cannot delete last layer");
            forgeState.layers = forgeState.layers.filter(l => l.id !== id);
            if(forgeState.activeLayerId === id) forgeState.activeLayerId = forgeState.layers[0].id;
            saveUndoState(); redrawForge();
        }

        function toggleLayerLock(id) {
            const l = forgeState.layers.find(ly => ly.id === id); if(l) l.locked = !l.locked;
            renderForgeHierarchy(); syncRef();
        }
        function toggleLayerVis(id) {
            const l = forgeState.layers.find(ly => ly.id === id); if(l) l.visible = !l.visible;
            redrawForge();
        }

        function renderForgeHierarchy() {
            const container = document.getElementById('forge-hierarchy');
            if(!container) return;
            
            let html = `<div class="flex justify-between items-center mb-1 pb-1 border-b border-white/10">
                <span class="text-[10px] font-bold text-slate-400">LAYERS</span>
                <button onclick="addForgeLayer()" class="text-[10px] px-1 bg-white/10 hover:bg-white/20 rounded">+</button>
            </div>`;
            
            html += `<div class="flex flex-col gap-1 w-full max-h-[140px] overflow-y-auto mb-2">`;
            
            forgeState.layers.forEach(lyr => {
                const isActive = forgeState.activeLayerId === lyr.id;
                html += `<div class="flex flex-col">
                    <div class="flex items-center p-1 rounded ${isActive ? 'bg-blue-600/30 border border-blue-500/50' : 'bg-white/5 border border-transparent'}">
                        <button onclick="toggleLayerVis('${lyr.id}')" class="text-[11px] w-4 opacity-70 hover:opacity-100">${lyr.visible ? '👁' : '✕'}</button>
                        <button onclick="toggleLayerLock('${lyr.id}')" class="text-[10px] w-4 opacity-70 hover:opacity-100 mr-1">${lyr.locked ? '🔒' : '🔓'}</button>
                        <input type="text" class="flex-1 text-[10px] bg-transparent text-white border-none focus:outline-none overflow-hidden text-ellipsis mr-1" value="${lyr.name}" onchange="const l=forgeState.layers.find(x=>x.id==='${lyr.id}'); if(l) l.name=this.value;">
                        <button onclick="forgeState.activeLayerId='${lyr.id}'; renderForgeHierarchy();" class="text-[8px] px-1 bg-white/10 hover:bg-white/20 rounded mr-1" title="Select Layer">Select</button>
                        <button onclick="deleteForgeLayer('${lyr.id}')" class="text-[9px] text-red-400 hover:text-white">✕</button>
                    </div>`;
                    
                if (isActive) {
                    if (lyr.shapes.length === 0) html += `<div class="text-[8px] text-slate-500 italic pl-6 pr-1 py-1">Layer empty</div>`;
                    lyr.shapes.forEach((s) => {
                        const isNodeSel = forgeState.selectedIndex === s.id;
                        html += `<div class="ml-4 mr-1 mt-0.5 p-1 text-[9px] rounded flex justify-between items-center cursor-pointer ${isNodeSel ? 'bg-blue-500/20 text-blue-300' : 'text-slate-400 hover:bg-white/5'}" onclick="forgeState.selectedIndex='${s.id}'; renderForgeHierarchy(); redrawForge();">
                            <span class="truncate">${s.name || s.type.toUpperCase()} ${s.isMask ? '(Mask)' : ''}</span>
                            <button onclick="event.stopPropagation(); saveUndoState(); getActiveShapes().splice(getActiveShapes().findIndex(shape=>shape.id==='${s.id}'), 1); if(forgeState.selectedIndex==='${s.id}') forgeState.selectedIndex=null; redrawForge();" class="text-red-500 hover:text-white text-[8px]">✕</button>
                        </div>`;
                    });
                }
                html += `</div>`;
            });
            html += `</div>`;
            container.innerHTML = html;
            
            renderForgeProperties();
        }
        
        function renderForgeProperties() {
            const container = document.getElementById('forge-properties');
            if(!container) return;
            const forms = getActiveShapes().filter(s => s.id === forgeState.selectedIndex);
            const s = forms.length ? forms[0] : null;
            
            if(!s) {
                container.innerHTML = '<div class="text-slate-600 italic px-2">Select a shape above...</div>';
                return;
            }

            let propsHTML = `<div class="flex flex-col gap-1">`;
            const upFn = `oninput="updateSelectedForgeShape()" onchange="saveUndoState(); updateSelectedForgeShape()"`;
            
            // Shared properties
            propsHTML += `<label class="flex justify-between items-center text-slate-300">Name: <input type="text" id="fp-name" value="${s.name || s.type}" class="w-20 bg-black/50 border border-white/10 px-1 text-white" ${upFn}></label>`;
            propsHTML += `<label class="flex justify-between items-center text-slate-300">Weight: <input type="number" step="0.1" id="fp-weight" value="${s.weight}" class="w-16 bg-black/50 border border-white/10 px-1 text-white" ${upFn}></label>`;
            propsHTML += `<label class="flex justify-between items-center text-slate-300">Color: <input type="color" id="fp-color" value="${s.color}" class="w-16 h-4 bg-transparent border-none cursor-pointer p-0" ${upFn}></label>`;
            
            if(s.type === 'circle') {
                propsHTML += `<label class="flex justify-between items-center text-slate-300">CX: <input type="number" id="fp-cx" value="${s.cx}" class="w-16 bg-black/50 border border-white/10 px-1 text-white" ${upFn}></label>`;
                propsHTML += `<label class="flex justify-between items-center text-slate-300">CY: <input type="number" id="fp-cy" value="${s.cy}" class="w-16 bg-black/50 border border-white/10 px-1 text-white" ${upFn}></label>`;
                propsHTML += `<label class="flex justify-between items-center text-slate-300">R: <input type="number" id="fp-r" value="${s.r}" class="w-16 bg-black/50 border border-white/10 px-1 text-white" ${upFn}></label>`;
            } else if(s.type === 'rect' || s.type === 'line') {
                propsHTML += `<label class="flex justify-between items-center text-slate-300">X1: <input type="number" id="fp-x1" value="${s.x1}" class="w-16 bg-black/50 border border-white/10 px-1 text-white" ${upFn}></label>`;
                propsHTML += `<label class="flex justify-between items-center text-slate-300">Y1: <input type="number" id="fp-y1" value="${s.y1}" class="w-16 bg-black/50 border border-white/10 px-1 text-white" ${upFn}></label>`;
                propsHTML += `<label class="flex justify-between items-center text-slate-300">X2: <input type="number" id="fp-x2" value="${s.x2}" class="w-16 bg-black/50 border border-white/10 px-1 text-white" ${upFn}></label>`;
                propsHTML += `<label class="flex justify-between items-center text-slate-300">Y2: <input type="number" id="fp-y2" value="${s.y2}" class="w-16 bg-black/50 border border-white/10 px-1 text-white" ${upFn}></label>`;
            } else if(s.type === 'freehand' || s.type === 'bezier') {
                propsHTML += `<div class="text-yellow-500/70 text-[9px] mt-1 italic">Path points can be redrawn.</div>`;
            }

            // Eraser masks properties 
            if(s.isMask) {
                propsHTML += `<div class="text-red-500/70 font-bold text-[9px] mt-1 uppercase">Mask Eraser</div>`;
            }

            propsHTML += `</div>`;
            container.innerHTML = propsHTML;
        }

        function updateSelectedForgeShape() {
            const forms = getActiveShapes().filter(s => s.id === forgeState.selectedIndex);
            if(!forms.length) return;
            const s = forms[0];
            
            const v = (id) => { const el = document.getElementById(id); return el ? parseFloat(el.value) || 0 : 0; };
            const vs = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

            if(document.getElementById('fp-name')) s.name = vs('fp-name');
            if(document.getElementById('fp-weight')) s.weight = v('fp-weight');
            if(document.getElementById('fp-color')) s.color = vs('fp-color');
            
            if(s.type === 'circle') {
                s.cx = v('fp-cx'); s.cy = v('fp-cy'); s.r = v('fp-r');
            } else if(s.type === 'rect' || s.type === 'line') {
                s.x1 = v('fp-x1'); s.y1 = v('fp-y1'); s.x2 = v('fp-x2'); s.y2 = v('fp-y2');
            }
            redrawForge();
        }


        function saveUndoState() {
            // Push deep copy clone
            forgeState.undoHistory.push(JSON.parse(JSON.stringify(forgeState.layers)));
            if(forgeState.undoHistory.length > 30) forgeState.undoHistory.shift();
            forgeState.redoHistory = []; // Clear redo on action
        }

        function forceUndo() {
            if(forgeState.undoHistory.length > 0) {
                forgeState.redoHistory.push(JSON.parse(JSON.stringify(forgeState.layers)));
                forgeState.layers = forgeState.undoHistory.pop();
                forgeState.selectedIndex = -1;
                redrawForge();
                toast('Undid action');
            } else {
                toast('No history');
            }
        }

        function forceRedo() {
            if(forgeState.redoHistory.length > 0) {
                forgeState.undoHistory.push(JSON.parse(JSON.stringify(forgeState.layers)));
                forgeState.layers = forgeState.redoHistory.pop();
                forgeState.selectedIndex = -1;
                redrawForge();
                toast('Redid action');
            } else {
                toast('Nothing to redo');
            }
        }

        document.addEventListener('keydown', (e) => {
            // Only capture Ctrl+Z / Ctrl+Y if forge pane is visible
            if(document.getElementById('pane-forge').classList.contains('hidden')) return;
            // Ignore if typing in text inputs inside draw window
            if(document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.type==='text') return;
            
            if (e.ctrlKey && e.key.toLowerCase() === 'z') {
                if (e.shiftKey) forceRedo();
                else forceUndo();
                e.preventDefault();
            } else if (e.ctrlKey && (e.key.toLowerCase() === 'y')) {
                forceRedo();
                e.preventDefault();
            }
        });
