'use strict';
'require view';
'require form';
'require poll';
'require ui';
'require uci';
'require status-light.common as nc';

/* One page, four tabs: Current state, Scenario lights, Detection and, when it is used, Breathing light.
 * All tabs belong to one form, so Save & Apply on any tab saves them all. */
return view.extend({
	load: function() {
		return Promise.all([ nc.readState(), uci.load('system') ]);
	},

	render: function(data) {
		var state = data[0], m, s, o, ledRow = nc.ledNowRow(), breathTab = null;

		/* the Breathing light tab is there when scenario 1 is set to Breathing or when breathing
		 * entries are in the system LED configuration; mode is the value being edited, if any */
		var wantBreathingTab = function(mode) {
			return (mode || uci.get('status_light', 's1', 'mode') || 'system') == 'easing' || nc.hasBreathing();
		};

		var showBreathingTab = function(mode) {
			this.breathingTab = wantBreathingTab(mode);

			if (breathTab)
				breathTab.style.display = this.breathingTab ? '' : 'none';
		}.bind(this);

		this.breathingTab = wantBreathingTab();

		m = new form.Map('status_light', _('Status Light'),
			_('Shows the state of the internet connection on the status LED. IPv4 and IPv6 are checked separately; the LED look of each of the eight cases can be changed. "Follow system settings" gives the LED back to the system LED configuration. Scenario 1 can also use Easing (breathing); its colour is set on the Breathing light tab.'));

		/* tab 1: current state (read only) */
		s = m.section(form.NamedSection, 'main', 'status_light');
		s.render = function() {
			ledRow.statusLightUpdate(state);

			return E('div', { 'class': 'cbi-section' },
				E('table', { 'class': 'table', 'id': 'status-light-state' }, [ ledRow ].concat(nc.stateRows(state))));
		};

		poll.add(function() {
			return nc.readState().then(function(d) {
				var el = document.getElementById('status-light-state');

				if (el) {
					while (el.children.length > 1)
						el.removeChild(el.lastChild);

					nc.stateRows(d).forEach(function(r) { el.appendChild(r); });
				}

				ledRow.statusLightUpdate(d);
			});
		}, 3);

		/* tab 2: scenario lights */
		s = m.section(form.GridSection, 'look', _('LED look per scenario'),
			_('Modes: Solid and Flashing use the colour levels below (0 to 255 per colour; flashing uses the half-period as on time and as off time). Follow system settings hands the LED to the LED Configuration tab. Easing (breathing), for scenario 1 only, shows the breathing light set on the Breathing light tab.'));
		s.anonymous = true;
		s.addremove = false;
		s.sortable = false;
		s.nodescriptions = true;

		o = s.option(form.DummyValue, '_name', _('Scenario'));
		o.cfgvalue = function(section_id) {
			return nc.scTitle[+String(section_id).replace(/^s/, '')] || section_id;
		};

		o = s.option(form.ListValue, 'mode', _('Mode'));
		o.value('solid', _('Solid'));
		o.value('flashing', _('Flashing'));
		o.value('system', _('Follow system settings'));
		o.value('easing', _('Easing (breathing)'));
		o.rmempty = false;
		o.forcewrite = true;

		/* the table cell shows the stored value; show the label of the option instead */
		o.textvalue = function(section_id) {
			var v = this.cfgvalue(section_id) || this.default || 'system', i = this.keylist.indexOf(v);

			return (i >= 0) ? this.vallist[i] : v;
		};

		/* only scenario 1 can breathe: the breathing light is a system LED configuration entry */
		o.renderWidget = function(section_id, option_index, cfgvalue) {
			var node = form.ListValue.prototype.renderWidget.apply(this, arguments);

			/* Easing is offered where there is no breathing light yet: with one in the system LED
			 * configuration, "Follow system settings" already breathes */
			if (section_id != 's1' || (nc.hasBreathing() && cfgvalue != 'easing'))
				Array.prototype.slice.call(node.querySelectorAll('option[value="easing"]')).forEach(function(e) {
					e.parentNode.removeChild(e);
				});

			return node;
		};

		o.onchange = function(ev, section_id, value) {
			if (section_id == 's1')
				showBreathingTab(value);
		};

		o = s.option(form.Value, 'red', _('Red'));
		o.datatype = 'range(0,255)';
		o.placeholder = '0';
		o.depends('mode', 'solid');
		o.depends('mode', 'flashing');

		o = s.option(form.Value, 'green', _('Green'));
		o.datatype = 'range(0,255)';
		o.placeholder = '0';
		o.depends('mode', 'solid');
		o.depends('mode', 'flashing');

		o = s.option(form.Value, 'blue', _('Blue'));
		o.datatype = 'range(0,255)';
		o.placeholder = '0';
		o.depends('mode', 'solid');
		o.depends('mode', 'flashing');

		o = s.option(form.Value, 'half', _('Flashing half-period (s)'));
		o.datatype = 'ufloat';
		o.placeholder = '0.25';
		o.depends('mode', 'flashing');

		/* leaving the edit window without saving: show the tab as saved */
		s.handleModalCancel = function() {
			showBreathingTab();
			return form.GridSection.prototype.handleModalCancel.apply(this, arguments);
		};

		/* tab 3: detection */
		s = m.section(form.NamedSection, 'main', 'status_light');
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.rmempty = false;

		o = s.option(form.Value, 'interval_ok', _('Check interval when all is fine'), _('seconds'));
		o.datatype = 'range(2,3600)';
		o.placeholder = '30';

		o = s.option(form.Value, 'interval_bad', _('Check interval when something is wrong'), _('seconds'));
		o.datatype = 'range(2,3600)';
		o.placeholder = '5';

		o = s.option(form.Value, 'fails', _('Checks in a row before a worse state is shown'));
		o.datatype = 'range(1,10)';
		o.placeholder = '2';

		o = s.option(form.DynamicList, 'hosts4', _('IPv4 hosts to ping'));
		o.datatype = 'ip4addr("nomask")';
		o.placeholder = '223.5.5.5';

		o = s.option(form.DynamicList, 'hosts6', _('IPv6 hosts to ping'));
		o.datatype = 'ip6addr("nomask")';
		o.placeholder = '2400:3200::1';

		o = s.option(form.Value, 'dns_name', _('Name to resolve'));
		o.datatype = 'hostname';
		o.placeholder = 'www.baidu.com';

		o = s.option(form.Flag, 'dns_strict', _('Also ask the upstream DNS servers directly'),
			_('Catches a resolver that still answers from its cache while the uplink is dead.'));
		o.default = o.enabled;

		o = s.option(form.DynamicList, 'dns_upstream4', _('IPv4 upstream DNS servers'));
		o.datatype = 'ip4addr("nomask")';
		o.placeholder = '223.5.5.5';

		o = s.option(form.DynamicList, 'dns_upstream6', _('IPv6 upstream DNS servers'));
		o.datatype = 'ip6addr("nomask")';
		o.placeholder = '2400:3200::1';

		/* tab 4: breathing light, only shown when scenario 1 breathes or breathing entries exist */
		s = m.section(form.NamedSection, 'main', 'status_light');
		s.render = function() {
			var c = nc.breathCfg();

			return nc.breathingBlock(c, nc.systemLook(uci.sections('system', 'led'), c));
		};

		this.map = m;

		/* saving the map draws the page again; the tabs are built every time it is drawn */
		var tabify = function(mapEl) {
			var secs = Array.prototype.filter.call(mapEl.children, function(n) { return n.classList.contains('cbi-section'); }),
			    titles = [ _('Current state'), _('Scenario lights'), _('Detection'), _('Breathing light') ], panes = [],
			    keep = openTab;

			if (secs.length != titles.length)
				return mapEl;

			/* the panes need a container of their own that already sits inside the page: the tab
			 * menu is inserted next to that container, and mapEl itself has no parent yet */
			var box = E('div', { 'class': 'status-light-tabs' });

			secs[0].parentNode.insertBefore(box, secs[0]);

			secs.forEach(function(el, i) {
				var pane = E('div', { 'data-tab': 'status-light-' + i, 'data-tab-title': titles[i] });

				pane.appendChild(el);
				box.appendChild(pane);
				panes.push(pane);
			});

			ui.tabs.initTabGroup(panes);

			breathTab = box.previousSibling && box.previousSibling.querySelector('[data-tab="status-light-3"]');
			showBreathingTab();

			/* stay on the tab that was open before the page was drawn again */
			var items = box.previousSibling && box.previousSibling.children;

			if (keep > 0 && items && items[keep] && items[keep].style.display != 'none') {
				var a = items[keep].querySelector('a');

				if (a)
					a.click();
			}

			return mapEl;
		};

		var origContents = m.renderContents, openTab = 0;

		m.renderContents = function() {
			/* which tab is open now, before the old page is thrown away */
			var cur = m.root && m.root.querySelector('.cbi-tabmenu > .cbi-tab');

			openTab = cur ? Array.prototype.indexOf.call(cur.parentNode.children, cur) : 0;

			return Promise.resolve(origContents.apply(m, arguments)).then(tabify);
		};

		return m.render();
	},

	handleSave: function(ev) {
		/* read the breathing light settings first: saving the map redraws the page from the
		 * stored configuration, after which the controls would show the old values again */
		var root = document.getElementById('status-light-breath'),
		    c = (root && root.statusLightRead && this.breathingTab) ? root.statusLightRead() : null;

		/* the breathing light entries go into the system LED configuration first, so that the page
		 * drawn after saving already finds them and keeps the tab */
		var done = c ? nc.applyBreathing(c) : Promise.resolve();

		return done.then(function() {
			if (c) {
				uci.set('status_light', 'main', 'breath_mode', c.mode);
				uci.set('status_light', 'main', 'breath_r', String(c.r));
				uci.set('status_light', 'main', 'breath_g', String(c.g));
				uci.set('status_light', 'main', 'breath_b', String(c.b));
				uci.set('status_light', 'main', 'breath_ramp', String(c.ramp));
				uci.set('status_light', 'main', 'breath_hold', String(c.hold));
				uci.set('status_light', 'main', 'breath_dark', String(c.dark));
				uci.set('status_light', 'main', 'gain_r', String(c.gr));
				uci.set('status_light', 'main', 'gain_g', String(c.gg));
				uci.set('status_light', 'main', 'gain_b', String(c.gb));

				/* easing has done its job once the entries exist: from now on "system" breathes */
				if (uci.get('status_light', 's1', 'mode') == 'easing')
					uci.set('status_light', 's1', 'mode', 'system');
			}

			return this.map.save();
		}.bind(this));
	}
});
