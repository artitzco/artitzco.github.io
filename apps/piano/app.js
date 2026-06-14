(() => {
    'use strict';

    /* ═══════════════════════════════
       Audio Engine
    ═══════════════════════════════ */

    let ctx = null;
    let masterGain = null;
    const activeNotes = new Map();

    function initAudio() {
        if (ctx) {
            if (ctx.state === 'suspended') ctx.resume();
            return;
        }
        ctx = new (window.AudioContext || window.webkitAudioContext)();

        masterGain = ctx.createGain();
        masterGain.gain.value = 0.7;
        masterGain.connect(ctx.destination);

        const delay = ctx.createDelay();
        delay.delayTime.value = 0.12;

        const feedback = ctx.createGain();
        feedback.gain.value = 0.15;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2500;

        masterGain.connect(delay);
        delay.connect(filter);
        filter.connect(feedback);
        feedback.connect(delay);
        delay.connect(ctx.destination);
    }

    const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const WHITE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const BLACK_OFFSETS = { 'C#': 1, 'D#': 2, 'F#': 4, 'G#': 5, 'A#': 6 };
    const MIN_OCTAVE = 1;
    const MAX_OCTAVE = 12;

    function noteFromMidi(midi) {
        const name = NOTE_NAMES[midi % 12];
        const octave = Math.floor(midi / 12) - 1;
        return {
            id: `${name}${octave}`,
            name,
            octave,
            midi,
            type: name.includes('#') ? 'black' : 'white',
            frequency: 440 * Math.pow(2, (midi - 69) / 12),
        };
    }

    function midiFromName(name, octave) {
        return (octave + 1) * 12 + NOTE_NAMES.indexOf(name);
    }

    function makeWhiteNotes() {
        const notes = [];
        for (let octave = MIN_OCTAVE; octave <= MAX_OCTAVE; octave++) {
            for (const name of WHITE_NAMES) {
                notes.push(noteFromMidi(midiFromName(name, octave)));
            }
        }
        return notes;
    }

    function play(id, frequency) {
        if (activeNotes.has(id)) return;
        initAudio();
        const t = ctx.currentTime;

        const osc1 = ctx.createOscillator();
        osc1.type = 'triangle';
        osc1.frequency.value = frequency;
        const g1 = ctx.createGain();
        g1.gain.setValueAtTime(0.001, t);
        g1.gain.linearRampToValueAtTime(0.35, t + 0.008);
        g1.gain.exponentialRampToValueAtTime(0.15, t + 0.3);

        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = frequency * 2;
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.001, t);
        g2.gain.linearRampToValueAtTime(0.07, t + 0.008);
        g2.gain.exponentialRampToValueAtTime(0.02, t + 0.2);

        osc1.connect(g1);
        osc2.connect(g2);
        g1.connect(masterGain);
        g2.connect(masterGain);
        osc1.start(t);
        osc2.start(t);

        activeNotes.set(id, [
            { osc: osc1, gain: g1 },
            { osc: osc2, gain: g2 },
        ]);
    }

    function stop(id) {
        const parts = activeNotes.get(id);
        if (!parts || !ctx) return;
        const t = ctx.currentTime;
        for (const { osc, gain } of parts) {
            gain.gain.cancelScheduledValues(t);
            gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.001), t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
            osc.stop(t + 0.3);
        }
        activeNotes.delete(id);
    }

    /* ═══════════════════════════════
       Piano Builder
    ═══════════════════════════════ */

    const whiteNotes = makeWhiteNotes();
    const state = {
        manualCount: 2,
        linked: true,
        visibleWhites: 14,
        offsets: [35, 21],
    };

    const manuals = document.getElementById('manuals');
    const manualCount = document.getElementById('manual-count');
    const linkedManuals = document.getElementById('linked-manuals');
    const visibleKeys = document.getElementById('visible-keys');
    const visibleKeysValue = document.getElementById('visible-keys-value');
    const downloadApp = document.getElementById('download-app');

    function maxOffset() {
        return Math.max(0, whiteNotes.length - state.visibleWhites);
    }

    function clampOffsets() {
        if (state.linked && state.manualCount === 2) {
            const maxLinkedBase = Math.max(0, maxOffset() - state.visibleWhites);
            state.offsets[1] = Math.min(Math.max(0, state.offsets[1]), maxLinkedBase);
            state.offsets[0] = state.offsets[1] + state.visibleWhites;
        } else {
            state.offsets[0] = Math.min(Math.max(0, state.offsets[0]), maxOffset());
            state.offsets[1] = Math.min(Math.max(0, state.offsets[1]), maxOffset());
        }
    }

    function visibleChromaticNotes(offset) {
        const firstWhite = whiteNotes[offset];
        const lastWhite = whiteNotes[Math.min(offset + state.visibleWhites - 1, whiteNotes.length - 1)];
        const firstMidi = firstWhite.midi;
        const notes = [];

        for (let midi = firstMidi; midi <= Math.min(lastWhite.midi, midiFromName('B', MAX_OCTAVE)); midi++) {
            const note = noteFromMidi(midi);
            if (note.type === 'white' || midi < lastWhite.midi) {
                notes.push(note);
            }
        }
        return notes;
    }

    function blackPosition(note, offset) {
        const octaveBase = (note.octave - MIN_OCTAVE) * 7;
        return octaveBase + BLACK_OFFSETS[note.name] - offset;
    }

    function buildManual(index) {
        const manual = document.createElement('section');
        manual.className = 'manual';
        manual.dataset.manual = index;

        const left = document.createElement('button');
        left.className = 'manual-shift';
        left.type = 'button';
        left.dataset.dir = '-1';
        left.dataset.manual = index;
        left.setAttribute('aria-label', `Desplazar nivel ${index + 1} a la izquierda`);
        left.textContent = '<';

        const keyboard = document.createElement('div');
        keyboard.className = 'keyboard';
        keyboard.dataset.manual = index;

        const right = document.createElement('button');
        right.className = 'manual-shift';
        right.type = 'button';
        right.dataset.dir = '1';
        right.dataset.manual = index;
        right.setAttribute('aria-label', `Desplazar nivel ${index + 1} a la derecha`);
        right.textContent = '>';

        manual.append(left, keyboard, right);
        return manual;
    }

    function renderKeyboard(keyboard, offset) {
        const notes = visibleChromaticNotes(offset);
        const ww = 100 / state.visibleWhites;
        const bw = ww * 0.62;
        keyboard.innerHTML = '';

        for (const note of notes.filter((n) => n.type === 'white')) {
            const el = document.createElement('div');
            el.className = 'key white';
            el.dataset.note = note.id;
            el.dataset.freq = note.frequency;

            const label = document.createElement('span');
            label.className = 'key-label';
            label.textContent = note.name === 'C' ? note.id : note.name;
            el.appendChild(label);
            keyboard.appendChild(el);
        }

        for (const note of notes.filter((n) => n.type === 'black')) {
            const el = document.createElement('div');
            el.className = 'key black';
            el.dataset.note = note.id;
            el.dataset.freq = note.frequency;
            const left = blackPosition(note, offset) * ww - bw / 2;
            el.style.left = `${left}%`;
            el.style.width = `${bw}%`;
            keyboard.appendChild(el);
        }
    }

    function render() {
        clampOffsets();
        manuals.className = state.manualCount === 2 ? 'double' : 'single';
        manuals.classList.toggle('linked', state.linked && state.manualCount === 2);
        visibleKeysValue.value = state.visibleWhites;
        visibleKeysValue.textContent = state.visibleWhites;

        if (!manuals.children.length) {
            manuals.append(buildManual(0), buildManual(1));
        }

        [...manuals.children].forEach((manual, index) => {
            manual.classList.toggle('hidden', index >= state.manualCount);
            manual.querySelectorAll('.manual-shift').forEach((button) => {
                const dir = parseInt(button.dataset.dir, 10);
                const linkedHidden = state.linked && state.manualCount === 2 &&
                    !((index === 0 && dir === 1) || (index === 1 && dir === -1));
                button.classList.toggle('shift-hidden', linkedHidden);
            });
            const keyboard = manual.querySelector('.keyboard');
            renderKeyboard(keyboard, state.offsets[index]);
        });
    }

    function shiftManual(index, direction) {
        const step = direction;
        if (state.linked && state.manualCount === 2) {
            if ((index === 0 && direction === 1) || (index === 1 && direction === -1)) {
                state.offsets[1] += step;
            }
        } else {
            state.offsets[index] += step;
        }
        render();
    }

    /* ═══════════════════════════════
       Standalone Download
    ═══════════════════════════════ */

    async function readTextAsset(url, fallbackSelector) {
        try {
            if (window.fetch) {
                const response = await window.fetch(url);
                if (response.ok) return response.text();
            }
        } catch (error) {
            try {
                return await new Promise((resolve, reject) => {
                    const request = new XMLHttpRequest();
                    request.open('GET', url);
                    request.onload = () => {
                        if (request.status === 0 || (request.status >= 200 && request.status < 300)) {
                            resolve(request.responseText);
                        } else {
                            reject(new Error(`No se pudo leer ${url}`));
                        }
                    };
                    request.onerror = reject;
                    request.send();
                });
            } catch (xhrError) {
                // Opening from file:// may block file reads; fall back to inline assets if present.
            }
        }

        const fallback = document.querySelector(fallbackSelector);
        return fallback ? fallback.textContent : '';
    }

    function escapeCss(css) {
        return css.replace(/<\/style/gi, '<\\/style');
    }

    function escapeScript(js) {
        return js.replace(/<\/script/gi, '<\\/script');
    }

    function standaloneMarkup(css, js) {
        const doc = document.implementation.createHTMLDocument('Piano');
        doc.documentElement.lang = document.documentElement.lang || 'es';
        doc.head.innerHTML = `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="theme-color" content="#12121f">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="description" content="Piano virtual simple para tocar desde el celular">
    <title>Piano</title>
    <style>${escapeCss(css)}</style>`;
        doc.body.innerHTML = document.getElementById('app').outerHTML;
        doc.body.querySelector('#manuals').innerHTML = '';
        doc.body.insertAdjacentHTML('beforeend', `<script>${escapeScript(js)}<\/script>`);
        return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
    }

    async function downloadStandaloneApp() {
        const css = await readTextAsset('style.css', 'style');
        const js = await readTextAsset('app.js', 'script:not([src])');

        if (!css.trim() || !js.trim()) {
            alert('No se pudo preparar la descarga completa. Abre esta app desde el servidor local o desde la pagina publicada e intentalo de nuevo.');
            return;
        }

        const blob = new Blob([standaloneMarkup(css, js)], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = 'piano-virtual.html';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    /* ═══════════════════════════════
       Event Handling
    ═══════════════════════════════ */

    function findKey(x, y) {
        const el = document.elementFromPoint(x, y);
        return el ? el.closest('.key') : null;
    }

    function noteOn(key) {
        if (!key) return;
        play(key.dataset.note, parseFloat(key.dataset.freq));
        document.querySelectorAll(`[data-note="${key.dataset.note}"]`).forEach((el) => {
            el.classList.add('active');
        });
    }

    function noteOff(noteId) {
        if (!noteId) return;
        stop(noteId);
        document.querySelectorAll(`[data-note="${noteId}"]`).forEach((el) => {
            el.classList.remove('active');
        });
    }

    const touchMap = new Map();

    function onTouchStart(e) {
        if (e.target.closest('.manual-shift')) return;
        e.preventDefault();
        for (const t of e.changedTouches) {
            const key = findKey(t.clientX, t.clientY);
            if (key) {
                touchMap.set(t.identifier, key.dataset.note);
                noteOn(key);
            }
        }
    }

    function onTouchMove(e) {
        e.preventDefault();
        for (const t of e.changedTouches) {
            const key = findKey(t.clientX, t.clientY);
            const prev = touchMap.get(t.identifier);
            const curr = key?.dataset.note;

            if (curr !== prev) {
                noteOff(prev);
                if (curr) {
                    touchMap.set(t.identifier, curr);
                    noteOn(key);
                } else {
                    touchMap.delete(t.identifier);
                }
            }
        }
    }

    function onTouchEnd(e) {
        e.preventDefault();
        for (const t of e.changedTouches) {
            noteOff(touchMap.get(t.identifier));
            touchMap.delete(t.identifier);
        }
    }

    let mouseNote = null;

    function onMouseDown(e) {
        const key = e.target.closest('.key');
        if (!key) return;
        mouseNote = key.dataset.note;
        noteOn(key);
    }

    function onMouseMove(e) {
        if (!mouseNote && !e.buttons) return;
        if (!(e.buttons & 1)) return;
        const key = findKey(e.clientX, e.clientY);
        const curr = key?.dataset.note;
        if (curr !== mouseNote) {
            noteOff(mouseNote);
            if (curr) {
                mouseNote = curr;
                noteOn(key);
            } else {
                mouseNote = null;
            }
        }
    }

    function onMouseUp() {
        noteOff(mouseNote);
        mouseNote = null;
    }

    const KB = {
        'a': 'C4', 'w': 'C#4', 's': 'D4', 'e': 'D#4', 'd': 'E4',
        'f': 'F4', 't': 'F#4', 'g': 'G4', 'y': 'G#4', 'h': 'A4',
        'u': 'A#4', 'j': 'B4', 'k': 'C5', 'o': 'C#5', 'l': 'D5',
        'p': 'D#5', ';': 'E5', "'": 'F5',
    };
    const keysHeld = new Set();

    function onKeyDown(e) {
        if (e.repeat || e.ctrlKey || e.metaKey) return;
        const noteId = KB[e.key.toLowerCase()];
        if (!noteId || keysHeld.has(e.key)) return;
        keysHeld.add(e.key);
        const key = document.querySelector(`[data-note="${noteId}"]`);
        if (key) noteOn(key);
    }

    function onKeyUp(e) {
        const noteId = KB[e.key.toLowerCase()];
        if (!noteId) return;
        keysHeld.delete(e.key);
        noteOff(noteId);
    }

    manualCount.addEventListener('change', () => {
        state.manualCount = parseInt(manualCount.value, 10);
        render();
    });

    linkedManuals.addEventListener('change', () => {
        state.linked = linkedManuals.checked;
        render();
    });

    visibleKeys.addEventListener('input', () => {
        state.visibleWhites = parseInt(visibleKeys.value, 10);
        render();
    });

    downloadApp.addEventListener('click', () => {
        downloadStandaloneApp().catch((error) => {
            console.error('No se pudo generar la descarga.', error);
        });
    });

    manuals.addEventListener('click', (e) => {
        const button = e.target.closest('.manual-shift');
        if (!button) return;
        shiftManual(parseInt(button.dataset.manual, 10), parseInt(button.dataset.dir, 10));
    });

    manuals.addEventListener('touchstart', onTouchStart, { passive: false });
    manuals.addEventListener('touchmove', onTouchMove, { passive: false });
    manuals.addEventListener('touchend', onTouchEnd, { passive: false });
    manuals.addEventListener('touchcancel', onTouchEnd, { passive: false });

    manuals.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    render();
})();
