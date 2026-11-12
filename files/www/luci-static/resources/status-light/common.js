'use strict';
'require baseclass';
'require fs';
'require uci';

/* Shared by the pages System > LED Configuration > Internet Status / Breathing Light / Detection /
 * Scenario Lights. */

var scTitle = {
    1: _('All fine (IPv4 and IPv6)'),
    2: _('IPv4 only (no IPv6 route)'),
    3: _('IPv6 only (no IPv4 route)'),
    4: _('IPv6 broken (route, but no answer)'),
    5: _('IPv4 broken (route, but no answer)'),
    6: _('DNS failure'),
    7: _('No answer (routes exist, nothing reachable)'),
    8: _('No uplink (no default route)')
};

var famText = {
    none: _('No default route'),
    ok: _('Working'),
    down: _('Not answering')
};

function okText(v) {
    return v == 'ok' ? _('Working') : (v == 'fail' ? _('Not answering') : '–');
}

function famRow(label, f) {
    var t = famText[f.state] || f.state;

    if (f.dev)
        t += ' (' + f.dev + ')';
    if (f.dns_upstream && f.dns_upstream != '-')
        t += ', ' + _('upstream DNS') + ': ' + okText(f.dns_upstream);

    return E('tr', { 'class': 'tr' }, [
        E('td', { 'class': 'td left', 'width': '33%' }, label),
        E('td', { 'class': 'td left' }, t)
    ]);
}

/* the rows under the "LED now" row */
function stateRows(d) {
    if (!d || typeof(d) != 'object' || !d.scenario)
        return [ E('tr', { 'class': 'tr' }, E('td', { 'class': 'td left', 'colspan': 2 },
            E('em', _('The service is not running, or its first check has not finished yet.')))) ];

    var age = Math.max(0, Math.floor(Date.now() / 1000) - (d.time || 0));

    return [
        E('tr', { 'class': 'tr' }, [
            E('td', { 'class': 'td left', 'width': '33%' }, _('Scenario')),
            E('td', { 'class': 'td left' }, E('strong', {}, d.scenario + ' – ' + (scTitle[d.scenario] || d.name)))
        ]),
        famRow('IPv4', d.ipv4 || {}),
        famRow('IPv6', d.ipv6 || {}),
        E('tr', { 'class': 'tr' }, [
            E('td', { 'class': 'td left' }, _('Router DNS resolver')),
            E('td', { 'class': 'td left' }, okText(d.dns && d.dns.system))
        ]),
        E('tr', { 'class': 'tr' }, [
            E('td', { 'class': 'td left' }, _('Last check')),
            E('td', { 'class': 'td left' }, _('%d s ago').format(age))
        ])
    ];
}

function readState() {
    return L.resolveDefault(fs.read_direct('/tmp/status-light.json', 'json'), null);
}

/* Breathing light of scenario 1: written as "status breathing" entries into the system
 * LED configuration, one per colour channel. Every channel gets the same number of steps
 * of the same length, so the channels never drift apart. */
var STEPS = 8;      /* steps of one fade */
var MINLEVEL = 8;   /* the dimmest channel does not stop below this level: its whole numbers are too coarse there */
var GAMMA = 2.2;    /* an LED looks far brighter than its duty cycle: 25% already looks like half */

function mkPattern(peak, ramp, hold, dark, minPeak) {
    var seg = Math.max(1, Math.round(ramp / STEPS)), p = [], i, j, k = [ 0 ],
        /* level of step i (0..STEPS), spaced evenly as the eye sees it, not as the duty cycle */
        q = function(i) {
        var v = Math.round(peak * Math.pow(i / STEPS, GAMMA));
        return (i > 0 && peak > 0) ? Math.max(1, v) : v;
        };

    /* The channels are whole numbers 0-255 and the dimmest one has the fewest levels: at 1 or 2 it
     * is far off its share of the colour and the light flashes red or purple. So the lowest levels
     * of the dimmest channel (below MINLEVEL) are left out, for all channels alike (the steps stay equal in number)
     * and the fade crosses that range in one go. */
    for (i = 1; i <= STEPS; i++)
        if (i == STEPS || Math.round(minPeak * Math.pow(i / STEPS, GAMMA)) >= MINLEVEL)
            k.push(i);

    /* The kernel reads a step "<brightness> <ms>" as: starting at this brightness, fade to the
     * brightness of the NEXT step within these ms. Two equal steps in a row are a hold. So:
     * hold at the peak, fade down in steps, hold at 0, fade up in steps. */
    p.push(peak, hold);
    for (j = k.length - 1; j >= 1; j--)
        p.push(q(k[j]), seg * (k[j] - k[j - 1]));
    p.push(0, Math.max(1, dark));
    for (j = 0; j < k.length - 1; j++)
        p.push(q(k[j]), seg * (k[j + 1] - k[j]));

    return p.join(' ');
}

var chanDef = {
    'red:status':   { id: 'sbe1v1k_status_red',   name: 'status breathing red' },
    'green:status': { id: 'sbe1v1k_status_green', name: 'status breathing green' },
    'blue:status':  { id: 'sbe1v1k_status_led',   name: 'status breathing blue' }
};

/* The colour is what you would see on a screen (0-255 per channel). The three LED
 * channels are not equally bright (green is far brighter than red and blue), so each channel
 * is scaled by its calibration in percent before it becomes the peak of a pattern. */
var defGain = { r: 100, g: 43, b: 100 };

function clampInt(v, lo, hi, d) {
    var n = parseInt(v, 10);
    return isNaN(n) ? d : Math.min(hi, Math.max(lo, n));
}

function peaksOf(c) {
    return {
        'red:status':   clampInt(Math.round(c.r * c.gr / 100), 0, 255, 0),
        'green:status': clampInt(Math.round(c.g * c.gg / 100), 0, 255, 0),
        'blue:status':  clampInt(Math.round(c.b * c.gb / 100), 0, 255, 0)
    };
}

function keyframes(ramp, hold, dark) {
    var t = 2 * ramp + hold + dark;

    return '@keyframes statusLightBreath{0%{opacity:1}' + (ramp / t * 100).toFixed(2) + '%{opacity:.04}' +
        ((ramp + dark) / t * 100).toFixed(2) + '%{opacity:.04}' +
        ((2 * ramp + dark) / t * 100).toFixed(2) + '%{opacity:1}100%{opacity:1}}';
}

/* sections: [{ id, sysfs, trigger }] of the system config; returns what to do */
function planBreathing(sections, c) {
    var ops = [], found = {}, sysfs, peaks = peaksOf(c);
    var minPeak = Math.min.apply(null, Object.keys(peaks).map(function(k) { return peaks[k]; }).filter(function(v) { return v > 0; }));

    if (c.mode == 'manual' || (!peaks['red:status'] && !peaks['green:status'] && !peaks['blue:status']))
        return ops;

    sections.forEach(function(s) {
        if (chanDef[s.sysfs] && !found[s.sysfs])
            found[s.sysfs] = s;
    });

    for (sysfs in chanDef) {
        var s = found[sysfs];

        if (peaks[sysfs]) {
            var id = s ? s.id : chanDef[sysfs].id;

            if (!s)
                ops.push({ op: 'add', id: id, name: chanDef[sysfs].name, sysfs: sysfs });
            if (s && (!s.name || s.name == 'status breathing'))
                ops.push({ op: 'name', id: id, name: chanDef[sysfs].name });
            ops.push({ op: 'set', id: id, trigger: 'pattern', pattern: mkPattern(peaks[sysfs], c.ramp, c.hold, c.dark, minPeak) });
        }
        else if (s && s.trigger == 'pattern') {
            /* Not removed: a removed entry leaves the LED running its old pattern until the next
             * reboot. An all-zero pattern of the same length switches it off and keeps it in step. */
            ops.push({ op: 'set', id: s.id, trigger: 'pattern', pattern: mkPattern(0, c.ramp, c.hold, c.dark, minPeak) });
        }
        else if (!s && sysfs == 'blue:status') {
            /* The device lights blue by default, with no entry anywhere that could switch it off:
             * a breathing light of another colour needs an entry that keeps blue dark, in step. */
            ops.push({ op: 'add', id: chanDef[sysfs].id, name: chanDef[sysfs].name, sysfs: sysfs });
            ops.push({ op: 'set', id: chanDef[sysfs].id, trigger: 'pattern', pattern: mkPattern(0, c.ramp, c.hold, c.dark, minPeak) });
        }
    }

    return ops;
}

function applyBreathing(c) {
    return uci.load('system').then(function() {
        var secs = uci.sections('system', 'led').map(function(s) {
            return { id: s['.name'], sysfs: s.sysfs, trigger: s.trigger, name: s.name };
        });

        planBreathing(secs, c).forEach(function(o) {
            if (o.op == 'add') {
                uci.add('system', 'led', o.id);
                uci.set('system', o.id, 'name', o.name);
                uci.set('system', o.id, 'sysfs', o.sysfs);
            }
            else if (o.op == 'name') {
                uci.set('system', o.id, 'name', o.name);
            }
            else if (o.op == 'set') {
                uci.set('system', o.id, 'trigger', o.trigger);
                uci.set('system', o.id, 'pattern', o.pattern);
            }
            else if (o.op == 'remove') {
                uci.remove('system', o.id);
            }
        });

        return uci.save();
    });
}

/* are there breathing entries in the system LED configuration? */
function hasBreathing() {
    return uci.sections('system', 'led').some(function(s) {
        return chanDef[s.sysfs] && s.trigger == 'pattern';
    });
}

var chanColor = { r: '#e03131', g: '#2f9e44', b: '#1c7ed6' };

/* @keyframes for a kernel pattern ("brightness ms ..." pairs) */
function patternKeyframes(v, peak) {
    var total = 0, cum = 0, i, css, n = v.length;

    for (i = 1; i < n; i += 2)
        total += v[i];

    if (!(total > 0) || !(peak > 0))
        return null;

    var op = function(b) { return Math.max(0.04, Math.pow(b / peak, 1 / GAMMA)).toFixed(3); };

    /* a step fades from its brightness to the brightness of the next one within its time */
    css = '@keyframes statusLightBreath{0%{opacity:' + op(v[0]) + '}';
    for (i = 0; i + 1 < n; i += 2) {
        cum += v[i + 1];
        css += (cum / total * 100).toFixed(2) + '%{opacity:' + op(v[(i + 2) % n]) + '}';
    }
    css += '}';

    return { css: css, dur: total };
}

/* the breathing light the system LED configuration has now: colour, timing, or null */
function systemLook(secs, c) {
    var key = { 'red:status': 'r', 'green:status': 'g', 'blue:status': 'b' },
        gain = { r: c.gr, g: c.gg, b: c.gb }, peak = { r: 0, g: 0, b: 0 }, pat = null;

    secs.forEach(function(s) {
        var k = key[s.sysfs], v, pk = 0, i;

        if (!k || s.trigger != 'pattern' || !s.pattern)
            return;

        v = String(s.pattern).trim().split(/\s+/).map(Number);
        if (v.length < 2 || v.length % 2 || v.some(isNaN))
            return;

        for (i = 0; i < v.length; i += 2)
            pk = Math.max(pk, v[i]);

        peak[k] = pk;
        if (!pat || pk > pat.pk)
            pat = { v: v, pk: pk };
    });

    if (!pat)
        return null;

    var kf = patternKeyframes(pat.v, pat.pk);
    if (!kf)
        return null;

    return {
        r: Math.min(255, Math.round(peak.r * 100 / gain.r)),
        g: Math.min(255, Math.round(peak.g * 100 / gain.g)),
        b: Math.min(255, Math.round(peak.b * 100 / gain.b)),
        css: kf.css, dur: kf.dur
    };
}

var presets = {
    red:   [ 255, 0,   0   ],
    green: [ 0,   255, 0   ],
    blue:  [ 0,   0,   255 ]
};

/* what the daemon uses for a scenario that has no section at all */
var lookDef = {
    1: [ 'system' ],
    2: [ 'solid', 0, 255, 0 ],
    3: [ 'solid', 0, 45, 255 ],
    4: [ 'flashing', 0, 255, 0, 1 ],
    5: [ 'flashing', 0, 0, 255, 1 ],
    6: [ 'flashing', 255, 115, 0, 0.25 ],
    7: [ 'solid', 255, 30, 0 ],
    8: [ 'solid', 255, 0, 0 ]
};

/* the look of scenario n, read the way the daemon reads it */
function scenarioLook(n, c, sys) {
    var g = function(k) { return uci.get('status_light', 's' + n, k); },
        d = lookDef[n] || lookDef[8], mode = g('mode'), r = g('red'), gr = g('green'), b = g('blue'), h = g('half'),
        raw, half;

    if (!mode && !h && r == null && gr == null && b == null) {
        mode = d[0]; r = d[1]; gr = d[2]; b = d[3]; h = d[4];
    }
    else if (!mode) {
        mode = h ? 'flashing' : 'solid';
    }

    if (mode == 'system' || mode == 'easing') {
        if (sys)
            return { r: sys.r, g: sys.g, b: sys.b, css: sys.css.replace('statusLightBreath', 'statusLightNow'),
                anim: 'statusLightNow ' + sys.dur + 'ms linear infinite', text: _('Easing (breathing), from the system LED configuration') };

        if (mode == 'easing')
            return { text: _('Easing (breathing) is chosen, but no breathing light is saved yet') };

        /* the device's default: the blue light is on */
        return { r: 0, g: 0, b: 255, text: _('Follows the system settings') };
    }

    raw = {
        r: clampInt(r, 0, 255, 0), g: clampInt(gr, 0, 255, 0), b: clampInt(b, 0, 255, 0)
    };

    var out = {
        r: Math.min(255, Math.round(raw.r * 100 / c.gr)),
        g: Math.min(255, Math.round(raw.g * 100 / c.gg)),
        b: Math.min(255, Math.round(raw.b * 100 / c.gb))
    };

    if (mode == 'flashing') {
        half = parseFloat(h);
        if (!(half > 0))
            half = 0.25;

        out.css = '@keyframes statusLightNow{0%{opacity:1}49.99%{opacity:1}50%{opacity:.04}100%{opacity:.04}}';
        out.anim = 'statusLightNow ' + (2 * half) + 's step-end infinite';
        out.text = _('Flashing, %s s on and %s s off').format(half, half);
    }
    else {
        out.text = _('Solid');
    }

    return out;
}

/* The device with its status light. If status-light/device.png or status-light/device.svg exists (a picture of the
 * top of the device, installed by hand), the light is laid over the slit in that picture; otherwise a
 * plain icon is used. The light is painted and animated like the real LED. */
var deviceImages = [
    /* device.png has the slit already blacked out, so no cover patch is needed */
    { file: 'status-light/device.png', ratio: 0.2695, led: { left: 38.7, width: 22.7, top: 51.9, height: 4.8 }, round: '4% 4% 0 0 / 80% 80% 0 0' }
];

function deviceDrawing(width) {
    var box = E('div', { 'class': 'status-light-device', 'style': 'width:' + width + ';flex:none;position:relative;line-height:0' }),
        cur = { col: null, anim: 'none' }, lamp = null, led = null, svgLamp = null,
        next = 0;

    function paint() {
        var col = cur.col || '#333';

        if (lamp) {
            lamp.style.background = cur.col || 'transparent';
            lamp.style.boxShadow = cur.col ? '0 0 5px 1px ' + cur.col : 'none';
            lamp.style.animation = cur.anim;
        }
        else if (led) {
            led.setAttribute('fill', col);
            svgLamp.style.animation = cur.anim;
        }
    }

    /* no picture: a small generic icon of a rounded top with a light slit */
    function plainIcon() {
        box.innerHTML =
            '<svg viewBox="0 0 200 46" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="device">' +
            '<path d="M4 46Q14 4 100 3Q186 4 196 46Z" fill="#30363b"/>' +
            '<rect x="30" y="8" width="140" height="22" rx="11" fill="#232a2f"/>' +
            '<rect x="70" y="31" width="60" height="5" rx="2.5" fill="#14181b"/>' +
            '<g class="status-light-lamp"><rect class="status-light-led" x="72" y="32" width="56" height="3" rx="1.5" fill="#333"/></g></svg>';

        lamp = null;
        svgLamp = box.querySelector('.status-light-lamp');
        led = box.querySelector('.status-light-led');
        paint();
    }

    /* try device.png, then device.svg, then the plain icon */
    function tryNext() {
        var d = deviceImages[next++], img;

        if (!d)
            return plainIcon();

        img = E('img', { 'src': L.resource(d.file), 'alt': '', 'style': 'width:100%;height:auto;display:block;filter:drop-shadow(0 3px 5px rgba(0,0,0,.35));-webkit-mask-image:linear-gradient(to bottom,#000 80%,transparent);mask-image:linear-gradient(to bottom,#000 80%,transparent)' });
        img.addEventListener('error', function() {
            if (img.parentNode)
                img.parentNode.removeChild(img);
            tryNext();
        });
        img.addEventListener('load', function() {
            var pos = function(n) { return n.toFixed(2) + '%'; }, l = d.led;

            /* a dark patch hides the light that is drawn in the picture, the lamp goes on top of it */
            if (d.patch)
                box.appendChild(E('div', { 'style': 'position:absolute;background:#000;border-radius:' + d.patch + ';left:' + pos(l.left - 1) +
                    ';width:' + pos(l.width + 2) + ';top:' + pos(l.top - 2) + ';height:' + pos(l.height + 3) }));

            lamp = E('div', { 'style': 'position:absolute;border-radius:' + d.round + ';min-height:2px;left:' + pos(l.left) +
                ';width:' + pos(l.width) + ';top:' + pos(l.top) + ';height:' + pos(l.height) });
            box.appendChild(lamp);

            paint();
        });

        box.appendChild(img);
    }

    tryNext();

    box.statusLightLight = function(col, anim) {
        cur.col = col;
        cur.anim = anim || 'none';
        paint();
    };

    return box;
}

/* The "Status light" row, first row of the state table: the top of the device with the light, then
 * a description of the light. The rows below it are rebuilt every few seconds, this one is not, so
 * the animation is not restarted by the refresh. */
function ledNowRow() {
    var style = E('style'),
        dev = deviceDrawing('13.5em'),
        last = null,
        row = E('tr', { 'class': 'tr' }, [
        E('td', { 'class': 'td left', 'width': '33%', 'style': 'vertical-align:middle' }, _('Status light')),
        E('td', { 'class': 'td left' }, [ style, dev ])
        ]);

    row.statusLightUpdate = function(d) {
        var c = breathCfg(), sys = systemLook(uci.sections('system', 'led'), c), l, key;

        l = (!d || !d.scenario) ? { text: '–' } : scenarioLook(d.scenario, c, sys);

        key = JSON.stringify(l);
        if (key == last)
            return;
        last = key;

        dev.statusLightLight(l.r == null ? null : 'rgb(' + l.r + ',' + l.g + ',' + l.b + ')', l.anim);

        style.textContent = l.css || '';
        /* the description of the light is the tooltip of the picture */
        dev.title = l.text || '';
    };

    return row;
}

/* values saved in /etc/config/status_light; the first test version stored 'white' and 'blue' */
function breathCfg() {
    var g = function(k) { return uci.get('status_light', 'main', k); },
        c = {
        mode: g('breath_mode') || 'manual', /* 'manual' = nothing stored yet */
        r: clampInt(g('breath_r'), 0, 255, 255),
        g: clampInt(g('breath_g'), 0, 255, 255),
        b: clampInt(g('breath_b'), 0, 255, 255),
        ramp: clampInt(g('breath_ramp'), 200, 10000, 1500),
        hold: clampInt(g('breath_hold'), 0, 10000, 1000),
        dark: clampInt(g('breath_dark'), 0, 10000, 600),
        gr: clampInt(g('gain_r'), 1, 100, defGain.r),
        gg: clampInt(g('gain_g'), 1, 100, defGain.g),
        gb: clampInt(g('gain_b'), 1, 100, defGain.b)
    };

    /* earlier test versions stored 'white', 'blue' and 'colour' */
    if (c.mode == 'white') { c.mode = 'custom'; c.r = c.g = c.b = 255; }
    else if (c.mode == 'colour') { c.mode = 'custom'; }
    if ([ 'manual', 'red', 'green', 'blue', 'custom' ].indexOf(c.mode) < 0)
        c.mode = 'manual';

    /* nothing stored: take the colour of the breathing entries that are there, or start with blue */
    if (c.mode == 'manual') {
        var sl = systemLook(uci.sections('system', 'led'), c);

        if (sl) {
            c.mode = 'custom';
            c.r = sl.r; c.g = sl.g; c.b = sl.b;
        }
        else {
            c.mode = 'blue';
        }
    }

    /* a preset is its colour, whatever else is stored */
    if (presets[c.mode]) {
        c.r = presets[c.mode][0];
        c.g = presets[c.mode][1];
        c.b = presets[c.mode][2];
    }

    return c;
}

function breathingBlock(c, sys) {
    var rgb = {}, nums = {}, rng = {}, cal = {}, style = E('style'),
        rangeStyle = function(key) { return 'width:14em;margin:0!important;padding:0!important;accent-color:' + chanColor[key]; },
        mode = E('select', { 'class': 'cbi-input-select', 'change': onMode }, [
        E('option', { 'value': 'red' }, _('Red')),
        E('option', { 'value': 'green' }, _('Green')),
        E('option', { 'value': 'blue' }, _('Blue')),
        E('option', { 'value': 'custom' }, _('Custom colour'))
        ]),
        dev = deviceDrawing('10em'),
        ramp = E('input', { 'type': 'number', 'class': 'cbi-input-text', 'style': 'width:6em', 'min': 200, 'max': 10000, 'value': c.ramp, 'input': refresh }),
        hold = E('input', { 'type': 'number', 'class': 'cbi-input-text', 'style': 'width:6em', 'min': 0, 'max': 10000, 'value': c.hold, 'input': refresh }),
        dark = E('input', { 'type': 'number', 'class': 'cbi-input-text', 'style': 'width:6em', 'min': 0, 'max': 10000, 'value': c.dark, 'input': refresh }),
        root;

    mode.value = c.mode;

    function refresh() {
        var rr = clampInt(rgb.r, 0, 255, 0), gg = clampInt(rgb.g, 0, 255, 0), bb = clampInt(rgb.b, 0, 255, 0),
            rp = clampInt(ramp.value, 200, 10000, 1500), hp = clampInt(hold.value, 0, 10000, 1000),
            dp = clampInt(dark.value, 0, 10000, 600);

        dev.statusLightLight('rgb(' + rr + ',' + gg + ',' + bb + ')', 'statusLightBreath ' + (2 * rp + hp + dp) + 'ms linear infinite');
        style.textContent = keyframes(rp, hp, dp);
    }

    function setVal(key, v) {
        v = clampInt(v, 0, 255, 0);
        rgb[key] = v;
        rng[key].value = v;
        nums[key].value = v;
    }

    /* a preset puts its colour on the sliders; touching a slider makes it a custom colour */
    function onMode() {
        var p = presets[mode.value];

        if (p) {
            setVal('r', p[0]);
            setVal('g', p[1]);
            setVal('b', p[2]);
        }

        refresh();
    }

    function onSlider(key, v) {
        var name, p;

        setVal(key, v);

        mode.value = 'custom';
        for (name in presets) {
            p = presets[name];
            if (rgb.r == p[0] && rgb.g == p[1] && rgb.b == p[2])
                mode.value = name;
        }

        refresh();
    }

    function pair(key, label) {
        rgb[key] = c[key];
        rng[key] = E('input', { 'type': 'range', 'min': 0, 'max': 255, 'value': c[key], 'style': rangeStyle(key),
            'input': function(ev) { onSlider(key, ev.target.value); } });
        nums[key] = E('input', { 'type': 'number', 'class': 'cbi-input-text', 'style': 'width:5em', 'min': 0, 'max': 255, 'value': c[key],
            'input': function(ev) { onSlider(key, ev.target.value); } });

        return E('tr', { 'class': 'tr' }, [
            E('td', { 'class': 'td left', 'style': 'white-space:nowrap;padding-right:1em;color:' + chanColor[key] }, label),
            E('td', { 'class': 'td left' }, rng[key]),
            E('td', { 'class': 'td left' }, nums[key])
        ]);
    }

    /* the box first, the colour after it, so the first box lines up with the ones above */
    function gainRow(key, label) {
        cal[key] = E('input', { 'type': 'number', 'class': 'cbi-input-text', 'style': 'width:5em', 'min': 1, 'max': 100, 'value': c[key] });
        return E('span', { 'style': 'margin-right:1.4em;white-space:nowrap' }, [ cal[key], ' ', E('span', { 'style': 'color:' + chanColor[key.charAt(1)] }, label) ]);
    }

    root = E('div', { 'class': 'cbi-section', 'id': 'status-light-breath' }, [
        style,
        E('h3', _('Breathing light (scenario 1)')),
        E('div', { 'class': 'cbi-section-descr' }, _('Used when scenario 1 is set to Easing (breathing). The matching "status breathing" entries are written into the LED Configuration tab when you save; switching scenario 1 back to "Follow system settings" leaves them in place. Pick a colour as you would on a screen: the red, green and blue channels are scaled by the calibration below, so white looks white. The preview is only an approximation of the real LED.')),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Breathing light')),
            E('div', { 'class': 'cbi-value-field' }, mode)
        ]),
        E('div', { 'class': 'cbi-value', 'style': 'align-items:flex-end;height:auto;min-height:0;overflow:visible;padding-top:.3em;padding-bottom:.3em' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Preview')),
            E('div', { 'class': 'cbi-value-field', 'style': 'display:flex;align-items:flex-end;height:auto;min-height:0' }, dev)
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Colour')),
            E('div', { 'class': 'cbi-value-field' },
                E('table', { 'class': 'table', 'style': 'width:auto' }, [ pair('r', _('Red')), pair('g', _('Green')), pair('b', _('Blue')) ]))
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Fade time')),
            E('div', { 'class': 'cbi-value-field' }, [ ramp, ' ms ', E('em', {}, _('(one fade, up or down)')) ])
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Peak time')),
            E('div', { 'class': 'cbi-value-field' }, [ hold, ' ms ', E('em', {}, _('(stays at full brightness)')) ])
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Dark time')),
            E('div', { 'class': 'cbi-value-field' }, [ dark, ' ms ', E('em', {}, _('(stays off before fading up)')) ])
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('LED calibration')),
            E('div', { 'class': 'cbi-value-field' }, [
                gainRow('gr', _('Red')), gainRow('gg', _('Green')), gainRow('gb', _('Blue')),
                E('div', { 'class': 'cbi-value-description' }, _('How much of each channel is used at full colour, 1 to 100. The green LED is much brighter than the others, 43 gives a white light on this device.'))
            ])
        ])
    ]);

    setVal('r', c.r); setVal('g', c.g); setVal('b', c.b);
    refresh();

    root.statusLightRead = function() {
        return {
            mode: mode.value,
            r: clampInt(rgb.r, 0, 255, 255), g: clampInt(rgb.g, 0, 255, 255), b: clampInt(rgb.b, 0, 255, 255),
            ramp: clampInt(ramp.value, 200, 10000, 1500), hold: clampInt(hold.value, 0, 10000, 1000), dark: clampInt(dark.value, 0, 10000, 600),
            gr: clampInt(cal.gr.value, 1, 100, defGain.r), gg: clampInt(cal.gg.value, 1, 100, defGain.g), gb: clampInt(cal.gb.value, 1, 100, defGain.b)
        };
    };

    return root;
}

return baseclass.extend({
    scTitle: scTitle,
    readState: readState,
    stateRows: stateRows,
    ledNowRow: ledNowRow,
    breathCfg: breathCfg,
    breathingBlock: breathingBlock,
    systemLook: systemLook,
    planBreathing: planBreathing,
    applyBreathing: applyBreathing,
    hasBreathing: hasBreathing
});
