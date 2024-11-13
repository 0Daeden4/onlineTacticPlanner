document.addEventListener('DOMContentLoaded', function() {
    const canvas = new fabric.Canvas('canvas', {
        backgroundColor: '#121212',
        width: window.innerWidth - 250,
        height: window.innerHeight,
        selection: true
    });

    let currentTool = 'select'; // default tool
    let actionStack = [];
    let redoStack = [];
    let customCursor = null;
    let isPlacingIcon = false; // icon placement mode
    let floatingIcon = null;   // follows the mouse
    let iconImageSrc = '';

    // undo/redo
    let isUndoing = false;
    let isRedoing = false;

    window.addEventListener('resize', () => {
        canvas.setWidth(window.innerWidth - 250);
        canvas.setHeight(window.innerHeight);
    });

    const categoryButtons = document.querySelectorAll('.category-button');
    const categories = document.querySelectorAll('.category');

    categories[0].classList.add('active');

    categoryButtons.forEach(button => {
        button.addEventListener('click', () => {
            categories.forEach(category => {
                category.classList.remove('active');
            });
            const selectedCategory = document.getElementById(button.getAttribute('data-category'));
            selectedCategory.classList.add('active');
        });
    });

    const selectIconsCheckbox = document.getElementById('select-icons');
    const selectLinesCheckbox = document.getElementById('select-lines');

    selectIconsCheckbox.addEventListener('change', updateSelectableObjects);
    selectLinesCheckbox.addEventListener('change', updateSelectableObjects);

    function updateSelectableObjects() {
        const selectIcons = selectIconsCheckbox.checked;
        const selectLines = selectLinesCheckbox.checked;

        canvas.getObjects().forEach(obj => {
            if (obj.customType === 'icon') {
                obj.selectable = selectIcons;
                obj.evented = selectIcons;
            } else if (obj.customType === 'line') {
                obj.selectable = selectLines;
                obj.evented = selectLines;
            } else if (obj.isBackgroundImage) {
                obj.selectable = false;
                obj.evented = false;
            }
        });

        canvas.renderAll();
    }

    document.getElementById('select-tool').addEventListener('click', () => {
        currentTool = 'select';
        canvas.isDrawingMode = false;
        canvas.selection = true;
        removeCustomCursor();
        updateSelectableObjects();
    });

    document.getElementById('draw-tool').addEventListener('click', () => {
        currentTool = 'draw';
        canvas.isDrawingMode = true;
        updateBrushSettings();
        canvas.selection = false;
        addCustomCursor();
    });

    document.getElementById('pan-tool').addEventListener('click', () => {
        currentTool = 'pan';
        canvas.isDrawingMode = false;
        canvas.selection = false;
        removeCustomCursor();
    });

    document.getElementById('clear-canvas').addEventListener('click', () => {
        const bgObjects = canvas.getObjects().filter(obj => obj.isBackgroundImage);
        canvas.getObjects().forEach(obj => {
            if (!obj.isBackgroundImage) {
                canvas.remove(obj);
            }
        });
        actionStack = []; // clear action stack
        redoStack = []; // clear redo stack
        canvas.renderAll();
    });

    function resetTools() {
        canvas.isDrawingMode = false;
        canvas.selection = true;
        currentTool = 'select';
        removeCustomCursor();
        updateSelectableObjects();
    }

    // Update brush settings
    function updateBrushSettings() {
        const brushSize = document.getElementById('brush-size').value;
        const brushColor = document.getElementById('color-picker').value;
        const zoom = canvas.getZoom();
        canvas.freeDrawingBrush.width = brushSize / zoom; // resize brush size based on zoom level
        canvas.freeDrawingBrush.color = brushColor;
    }

    document.getElementById('brush-size').addEventListener('input', () => {
        updateBrushSettings();
        updateCustomCursor();
    });

    document.getElementById('color-picker').addEventListener('input', updateBrushSettings);

    document.getElementById('zoom-slider').addEventListener('input', (e) => {
        const zoom = e.target.value / 100;
        canvas.zoomToPoint({ x: canvas.width / 2, y: canvas.height / 2 }, zoom);
        canvas.requestRenderAll();
        updateBrushSettings(); // update brush settings after zoom
        updateCustomCursor();
    });

    canvas.on('mouse:wheel', function(opt) {
        var delta = opt.e.deltaY;
        var zoom = canvas.getZoom();
        zoom *= 0.999 ** delta;
        if (zoom > 10) zoom = 10;
        if (zoom < 0.1) zoom = 0.1;
        canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
        document.getElementById('zoom-slider').value = zoom * 100;
        updateBrushSettings();
        opt.e.preventDefault();
        opt.e.stopPropagation();
        updateCustomCursor();
    });

    canvas.on('mouse:down', function(opt) {
        if (currentTool === 'pan' || opt.e.button === 1) {
            this.isDragging = true;
            this.selection = false;
            this.lastPosX = opt.e.clientX;
            this.lastPosY = opt.e.clientY;
        } else if (currentTool === 'rotate' && opt.target && opt.target.selectable) {
            isRotating = true;
            rotatingObject = opt.target;
            rotatingObject.set('selectable', false);
            canvas.selection = false;
        } else if (isPlacingIcon) {
            placeIcon(opt);
        } else if (opt.e.button === 2) {
            resetTools();
        }

        // capture object state before modification
        if (opt.target && (currentTool === 'select' || currentTool === 'rotate')) {
            opt.target._stateBeforeModification = opt.target.saveState();
            opt.target._stateBeforeModification.properties = opt.target.toObject();
        }
    });

    canvas.on('mouse:move', function(opt) {
        if (isRotating && rotatingObject) {
            const pointer = canvas.getPointer(opt.e);
            const angle = Math.atan2(pointer.y - rotatingObject.top, pointer.x - rotatingObject.left) * (180 / Math.PI);
            rotatingObject.set('angle', angle + 90); // +90 to make the top face the cursor
            canvas.renderAll();
        } else if (this.isDragging) {
            const e = opt.e;
            const vpt = this.viewportTransform;
            vpt[4] += e.clientX - this.lastPosX;
            vpt[5] += e.clientY - this.lastPosY;
            this.requestRenderAll();
            this.lastPosX = e.clientX;
            this.lastPosY = e.clientY;
        }
    });

    canvas.on('mouse:up', function(opt) {
        if (this.isDragging) {
            this.isDragging = false;
            this.selection = (currentTool === 'select');
        } else if (isRotating && rotatingObject) {
            rotatingObject.set('selectable', true);
            canvas.selection = true;
            isRotating = false;
            rotatingObject = null;
        }
    });

    document.getElementById('icon-upload').addEventListener('change', (e) => {
        const files = e.target.files;
        for (let file of files) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const imgElement = document.createElement('img');
                imgElement.src = event.target.result;
                imgElement.addEventListener('click', () => selectIcon(event.target.result));
                document.getElementById('icon-list').appendChild(imgElement);
            };
            reader.readAsDataURL(file);
        }
    });

    function selectIcon(src) {
        currentTool = 'add-icon';
        canvas.isDrawingMode = false;
        isPlacingIcon = true;
        iconImageSrc = src;

        floatingIcon = document.createElement('img');
        floatingIcon.src = src;
        floatingIcon.className = 'floating-icon';
        document.body.appendChild(floatingIcon);

        const maxSize = parseInt(document.getElementById('icon-max-size').value) || 100;
        floatingIcon.onload = function() {
            const scaleFactor = Math.min(maxSize / floatingIcon.naturalWidth, maxSize / floatingIcon.naturalHeight, 1);
            floatingIcon.width = floatingIcon.naturalWidth * scaleFactor;
            floatingIcon.height = floatingIcon.naturalHeight * scaleFactor;
        };

        document.addEventListener('mousemove', moveFloatingIcon);
        canvas.on('mouse:down', placeIcon);
    }

    function moveFloatingIcon(e) {
        if (isPlacingIcon && floatingIcon) {
            const iconWidth = floatingIcon.width / 2;
            const iconHeight = floatingIcon.height / 2;
            floatingIcon.style.left = (e.clientX - iconWidth) + 'px';
            floatingIcon.style.top = (e.clientY - iconHeight) + 'px';
        }
    }

  function placeIcon(opt) {
    if (isPlacingIcon) {
        isPlacingIcon = false;
        document.removeEventListener('mousemove', moveFloatingIcon);
        canvas.off('mouse:down', placeIcon);
        document.body.removeChild(floatingIcon);
        floatingIcon = null;

        const pointer = canvas.getPointer(opt.e);

        fabric.Image.fromURL(iconImageSrc, function(img) {
            const maxSize = parseInt(document.getElementById('icon-max-size').value) || 100;

            const scaleFactor = Math.min(maxSize / img.width, maxSize / img.height, 1);
            img.scale(scaleFactor);

            img.set({
                left: pointer.x,
                top: pointer.y,
                selectable: selectIconsCheckbox.checked,
                evented: selectIconsCheckbox.checked,
                customType: 'icon'
            });
            canvas.add(img);
            canvas.renderAll();
            resetTools();

            actionStack.push({
                type: 'add',
                object: img
            });
            redoStack = [];
        });
    }
}


    canvas.on('path:created', function(opt) {
        const path = opt.path;
        path.set({
            customType: 'line',
            selectable: selectLinesCheckbox.checked,
            evented: selectLinesCheckbox.checked
        });
        actionStack.push({
            type: 'add',
            object: path
        });
        redoStack = [];
    });

    let isRotating = false;
    let rotatingObject = null;

    canvas.on('mouse:down', function(opt) {
        if (opt.e.button === 2) {
            resetTools();
        }
    });

    canvas.upperCanvasEl.oncontextmenu = function(e) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    };

    document.getElementById('export-png').addEventListener('click', () => {
        const dataURL = canvas.toDataURL({
            format: 'png',
            quality: 1,
            multiplier: 2
        });
        downloadURI(dataURL, 'canvas.png');
    });

    document.getElementById('export-pdf').addEventListener('click', () => {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('l', 'pt', [canvas.getWidth(), canvas.getHeight()]);
        pdf.addImage(canvas.toDataURL({ format: 'png' }), 'PNG', 0, 0, canvas.getWidth(), canvas.getHeight());
        pdf.save('canvas.pdf');
    });

    function downloadURI(uri, name) {
        const link = document.createElement('a');
        link.download = name;
        link.href = uri;
        link.click();
    }

    document.getElementById('save-progress').addEventListener('click', () => {
        const json = canvas.toDatalessJSON(['customType', 'isBackgroundImage']);
        const data = JSON.stringify(json);
        const blob = new Blob([data], { type: 'application/json' });
        const link = document.createElement('a');
        link.download = 'progress.json';
        link.href = URL.createObjectURL(blob);
        link.click();
    });

    document.getElementById('load-progress').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                const json = JSON.parse(event.target.result);
                canvas.loadFromJSON(json, () => {
                    canvas.getObjects().forEach(obj => {
                        if (obj.customType === 'icon') {
                            obj.set({
                                selectable: selectIconsCheckbox.checked,
                                evented: selectIconsCheckbox.checked
                            });
                        } else if (obj.customType === 'line') {
                            obj.set({
                                selectable: selectLinesCheckbox.checked,
                                evented: selectLinesCheckbox.checked
                            });
                        } else if (obj.isBackgroundImage) {
                            obj.set({
                                selectable: false,
                                evented: false,
                                isBackgroundImage: true
                            });
                        }
                    });
                    canvas.renderAll();
                    actionStack = [];
                    redoStack = [];
                });
            };
            reader.readAsText(file);
        });
        input.click();
    });

    document.getElementById('set-background').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                const dataURL = event.target.result;
                fabric.Image.fromURL(dataURL, function(img) {
                    const bgObjects = canvas.getObjects().filter(obj => obj.isBackgroundImage);
                    bgObjects.forEach(obj => canvas.remove(obj));

                    img.set({
                        left: 0,
                        top: 0,
                        originX: 'left',
                        originY: 'top',
                        selectable: false,
                        evented: false,
                        isBackgroundImage: true
                    });

                    img.scaleToWidth(canvas.getWidth());
                    img.scaleToHeight(canvas.getHeight());

                    canvas.insertAt(img, 0);
                    canvas.renderAll();
                });
            };
            reader.readAsDataURL(file);
        });
        input.click();
    });

    document.getElementById('theme-toggle').addEventListener('change', function() {
        if (this.checked) {
            document.body.style.backgroundColor = '#121212';
            document.body.style.color = '#ffffff';
            canvas.setBackgroundColor('#121212', canvas.renderAll.bind(canvas));
            updateStylesForTheme('dark');
        } else {
            document.body.style.backgroundColor = '#ffffff';
            document.body.style.color = '#000000';
            canvas.setBackgroundColor('#ffffff', canvas.renderAll.bind(canvas));
            updateStylesForTheme('light');
        }
    });

    function updateStylesForTheme(theme) {
        const panel = document.getElementById('panel');
        const categoryButtons = document.querySelectorAll('.category-button');
        const labels = document.querySelectorAll('label');
        const buttons = panel.querySelectorAll('button');
        const inputs = panel.querySelectorAll('input');

        if (theme === 'dark') {
            panel.style.backgroundColor = '#1e1e1e';
            categoryButtons.forEach(btn => {
                btn.style.backgroundColor = '#2e2e2e';
                btn.style.color = '#ffffff';
            });
            labels.forEach(label => label.style.color = '#ffffff');
            buttons.forEach(btn => {
                btn.style.backgroundColor = '#2e2e2e';
                btn.style.color = '#ffffff';
            });
            inputs.forEach(input => {
                input.style.color = '#ffffff';
                input.style.backgroundColor = '#2e2e2e';
            });
            if (customCursor) {
                customCursor.style.borderColor = '#ffffff';
            }
        } else {
            panel.style.backgroundColor = '#f0f0f0';
            categoryButtons.forEach(btn => {
                btn.style.backgroundColor = '#ffffff';
                btn.style.color = '#000000';
            });
            labels.forEach(label => label.style.color = '#000000');
            buttons.forEach(btn => {
                btn.style.backgroundColor = '#ffffff';
                btn.style.color = '#000000';
            });
            inputs.forEach(input => {
                input.style.color = '#000000';
                input.style.backgroundColor = '#ffffff';
            });
            if (customCursor) {
                customCursor.style.borderColor = '#000000';
            }
        }
    }

    // Additional Event Listeners
    canvas.on('object:added', function(e) {
        if (!e.target.isBackgroundImage && !isRedoing && !isUndoing) {
            actionStack.push({ type: 'add', object: e.target });
            redoStack = [];
        }
    });

    canvas.on('object:modified', function(e) {
        if (!isUndoing && !isRedoing) {
            const object = e.target;

            const prevState = object._stateBeforeModification ? object._stateBeforeModification.properties : {};
            const newState = object.toObject();

            actionStack.push({
                type: 'modified',
                object: object,
                prevState: prevState,
                newState: newState
            });
            redoStack = [];

            delete object._stateBeforeModification;
        }
    });

    canvas.on('object:removed', function(e) {
        if (!e.target.isBackgroundImage && !isUndoing && !isRedoing) {
            actionStack.push({ type: 'remove', object: e.target });
            redoStack = [];
        }
    });

    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            undo();
        }
        if (e.ctrlKey && e.key === 'y') {
            e.preventDefault();
            redo();
        }
        if (e.key === 'x') {
            const activeObject = canvas.getActiveObject();
            if (activeObject && !activeObject.isBackgroundImage) {
                canvas.remove(activeObject);
                actionStack.push({ type: 'remove', object: activeObject });
                redoStack = [];
                canvas.discardActiveObject();
                canvas.renderAll();
            }
        }
    });

    function undo() {
        if (actionStack.length > 0) {
            isUndoing = true;
            const lastAction = actionStack.pop();
            redoStack.push(lastAction);

            if (lastAction.type === 'add') {
                canvas.remove(lastAction.object);
            } else if (lastAction.type === 'remove') {
                canvas.add(lastAction.object);
            } else if (lastAction.type === 'modified') {
                lastAction.object.set(lastAction.prevState);
                lastAction.object.setCoords();
                canvas.renderAll();
            }
            canvas.renderAll();
            isUndoing = false;
        }
    }

    function redo() {
        if (redoStack.length > 0) {
            isRedoing = true;
            const action = redoStack.pop();
            actionStack.push(action);

            if (action.type === 'add') {
                canvas.add(action.object);
            } else if (action.type === 'remove') {
                canvas.remove(action.object);
            } else if (action.type === 'modified') {
                action.object.set(action.newState);
                action.object.setCoords();
                canvas.renderAll();
            }
            canvas.renderAll();
            isRedoing = false;
        }
    }

    function addCustomCursor() {
        if (customCursor) return;

        customCursor = document.createElement('div');
        customCursor.className = 'custom-cursor';
        updateCustomCursor();

        document.body.appendChild(customCursor);

        canvas.on('mouse:move', moveCustomCursor);
    }

    function removeCustomCursor() {
        if (customCursor) {
            document.body.removeChild(customCursor);
            customCursor = null;
        }
        canvas.off('mouse:move', moveCustomCursor);
    }

    function moveCustomCursor(opt) {
        if (customCursor) {
            customCursor.style.left = opt.e.clientX + 'px';
            customCursor.style.top = opt.e.clientY + 'px';
        }
    }

    function updateCustomCursor() {
        if (customCursor) {
            const size = document.getElementById('brush-size').value;
            customCursor.style.width = size + 'px';
            customCursor.style.height = size + 'px';
            customCursor.style.borderColor = document.getElementById('color-picker').value;
        }
    }
});

