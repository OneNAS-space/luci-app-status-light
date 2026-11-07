'use strict';
'require baseclass';
'require form';

return baseclass.extend({
	trigger: _('Pattern'),
	description: _('Fades the LED through a list of brightness and duration pairs, for example a breathing light.'),
	kernel: true,
	addFormOptions: function(s) {
		var o;

		o = s.option(form.Value, 'pattern', _('Pattern'),
			_('Pairs of "brightness milliseconds": the LED fades to the brightness (0 to 255) in the given time, then goes on to the next pair and starts over at the end. Example: 0 1500 255 1500 255 1000'));
		o.modalonly = true;
		o.placeholder = '0 1500 255 1500';
		o.rmempty = false;
		o.depends('trigger', 'pattern');
	}
});
