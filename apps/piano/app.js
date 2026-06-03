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

        // Master volume
        masterGain = ctx.createGain();
        masterGain.gain.value = 0.7;
        masterGain.connect(ctx.destination);

        // Simple delay reverb
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

    // Note frequency from name + octave (A4 = 440 Hz)
    const SEMITONES = { 'C': -9, 'C#': -8, 'D': -7, 'D#': -6, 'E': -5,
                        'F': -4, 'F#': -3, 'G': -2, 'G#': -1, 'A': 0,
                        'A#': 1, 'B': 2 };

    function freq(name, octave) {
        return 440 * Math.pow(2, (SEMITONES[name] + (octave - 4) * 12) / 12);
    }

    function play(id, frequency) {
        if (activeNotes.has(id)) return;
        initAudio();
        const t = ctx.currentTime;

        // Triangle fundamental
        const osc1 = ctx.createOscillator();
        osc1.type = 'triangle';
        osc1.frequency.value = frequency;
        const g1 = ctx.createGain();
        g1.gain.setValueAtTime(0.001, t);
        g1.gain.linearRampToValueAtTime(0.35, t + 0.008);
        g1.gain.exponentialRampToValueAtTime(0.15, t + 0.3);

        // Sine 2nd harmonic for brightness
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
        if (!parts) return;
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

    const START_OCTAVE = 4;
    const NUM_OCTAVES = 2;

    // Pattern per octave: note name, type, and for black keys which white key they sit after
    const OCTAVE = [
        { n: 'C',  t: 'white' },
        { n: 'C#', t: 'black', after: 0 },
        { n: 'D',  t: 'white' },
        { n: 'D#', t: 'black', after: 1 },
        { n: 'E',  t: 'white' },
        { n: 'F',  t: 'white' },
        { n: 'F#', t: 'black', after: 3 },
        { n: 'G',  t: 'white' },
        { n: 'G#', t: 'black', after: 4 },
        { n: 'A',  t: 'white' },
        { n: 'A#', t: 'black', after: 5 },
        { n: 'B',  t: 'white' },
    ];

    function buildPiano() {
        const piano = document.getElementById('piano');
        const totalWhite = NUM_OCTAVES * 7;
        const ww = 100 / totalWhite;       // white key width %
        const bw = ww * 0.62;              // black key width %

        for (let o = 0; o < NUM_OCTAVES; o++) {
            const oct = START_OCTAVE + o;
            for (const k of OCTAVE) {
                const id = k.n + oct;
                const f = freq(k.n, oct);

                const el = document.createElement('div');
                el.className = `key ${k.t}`;
                el.dataset.note = id;
                el.dataset.freq = f;

                if (k.t === 'black') {
                    const gw = o * 7 + k.after;
                    el.style.left = `${(gw + 1) * ww - bw / 2}%`;
                    el.style.width = `${bw}%`;
                } else {
                    const label = document.createElement('span');
                    label.className = 'key-label';
                    label.textContent = k.n === 'C' ? `C${oct}` : k.n;
                    el.appendChild(label);
                }

                piano.appendChild(el);
            }
        }
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
        key.classList.add('active');
    }

    function noteOff(noteId) {
        if (!noteId) return;
        stop(noteId);
        const el = document.querySelector(`[data-note="${noteId}"]`);
        if (el) el.classList.remove('active');
    }

    // ── Touch (multi-touch + glissando) ──
    const touchMap = new Map();

    function onTouchStart(e) {
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

    // ── Mouse (click + drag) ──
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

    // ── Keyboard ──
    const KB = {
        'a': 'C4',  'w': 'C#4', 's': 'D4',  'e': 'D#4', 'd': 'E4',
        'f': 'F4',  't': 'F#4', 'g': 'G4',  'y': 'G#4', 'h': 'A4',
        'u': 'A#4', 'j': 'B4',  'k': 'C5',  'o': 'C#5', 'l': 'D5',
        'p': 'D#5', ';': 'E5',  "'": 'F5',
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

    /* ═══════════════════════════════
       Init
    ═══════════════════════════════ */

    buildPiano();

    const piano = document.getElementById('piano');
    piano.addEventListener('touchstart',  onTouchStart,  { passive: false });
    piano.addEventListener('touchmove',   onTouchMove,   { passive: false });
    piano.addEventListener('touchend',    onTouchEnd,    { passive: false });
    piano.addEventListener('touchcancel', onTouchEnd,    { passive: false });

    piano.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
})();
