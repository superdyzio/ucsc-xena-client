/*jslint browser: true, nomen: true */
/*globals define: false, $: false, _: false */
define(['haml!haml/sheetWrap',
		'columnEdit',
		'columnUi',
		'uuid',
		'underscore_ext',
		'jquery',
		], function (template, columnEdit, columnUi, uuid, _, $) {

	"use strict";

	var widget,
		aWidget;

	// TODO copied from main.js 
	function deleteColumn(uuid, upd, state) {
		var cols = _.dissoc(upd.get_in(state, ['column_rendering']), uuid),
			order = _.without(upd.get_in(state, ['column_order']), uuid);
		return upd.assoc_in(
			upd.assoc_in(state, ['column_order'], order),
			['column_rendering'],
			cols
		);
	}

	aWidget = {

		deleteColumn: function (id) {
			return this.cursor.set(_.partial(deleteColumn, id));
		},

		duplicateColumn: function (id) {
			console.log('sheetWrap:duplicateColumn()');
		},

		addColumnClick: function (ev) {
			var id = uuid();
			/* TODO: maybe later to allow edit of existing column
			columnUi.create(id, {
				edit: true,
				sheetWrap: this,
				updateColumn: this.updateColumn
			});
			*/
			columnEdit.show(id, {
				sheetWrap: this,
				columnUi: undefined,
				updateColumn: this.updateColumn
			});
		},

		initialize: function (options) {
			_.bindAll.apply(_, [this].concat(_.functions(this)));
			//_(this).bindAll();
			//this.sheetWrap = options.sheetWrap;
			this.updateColumn = options.updateColumn;
			this.state = options.state;
			this.cursor = options.cursor;

			this.$el = $(template());
			options.$anchor.append(this.$el);
			this.$addColumn = this.$el.find('.addColumn');
			this.$addColumn.on('click', this.addColumnClick); // TODO make this Rx
		}
	};

	function create(options) {
		var w = Object.create(aWidget);
		w.initialize(options);
		return w;
	}

	return {

		get: function () {
			return widget;
		},
		
		columnShow: function (id, ws) {
			var column = columnUi.show(id, { ws: ws, sheetWrap: widget });
			return column.$samplePlot;
		},

		create: function (options) {
			widget = create(options);
			return widget;
		}
	};
});
