/*eslint-env browser */
/*global require: false, module: false */

'use strict';

var _ = require('../underscore_ext');
var Rx = require('rx');
var xenaQuery = require('../xenaQuery');
var widgets = require('../columnWidgets');
var util = require('../util');
var kmModel = require('../models/km');

var	datasetProbeValues = xenaQuery.dsID_fn(xenaQuery.dataset_probe_values);
var identity = x => x;

//function cases([tag, ...data], c) {
//	return c[tag](...data);
//}

function cohortQuery(servers) {
	return Rx.Observable.zipArray(_.map(servers, xenaQuery.all_cohorts))
			.map(servers => ['cohorts', _.union.apply(null, servers)]);
}

function fetchCohorts(ch, servers) {
	ch.onNext(['cohorts-slot', cohortQuery(servers)]);
}

var datasetSamples = xenaQuery.dsID_fn(xenaQuery.dataset_samples);

function samplesQuery(servers, cohort, samplesFrom) {
	return (samplesFrom ?
				datasetSamples(samplesFrom) :
				Rx.Observable.zipArray(
					_.map(servers, s => xenaQuery.all_samples(s, cohort))
				).map(_.apply(_.union))
			).map(samps => ['samples', samps]);
}

function fetchSamples(ch, servers, cohort, samplesFrom) {
	ch.onNext(['samples-slot', samplesQuery(servers, cohort, samplesFrom)]);
}

function datasetQuery(servers, cohort) {
	return (cohort ?
			xenaQuery.dataset_list(servers, cohort) :
			Rx.Observable.return([], Rx.Scheduler.timeout))
		.map(servers =>
				['datasets', {
					servers: servers,
					datasets:
						_.object(_.flatmap(servers, s => _.map(s.datasets, d => [d.dsID, d])))
				}]);
}

function fetchDatasets(ch, servers, cohort) {
	ch.onNext(['datasets-slot', datasetQuery(servers, cohort)]);
}

function fetchColumnData(state, id) {
	let {comms: {server}} = state,
		settings = _.getIn(state, ['columns', id]),
		samples = _.get(state, "samples");
	// XXX make serverCh group by _.isArray && v[0], so we don't have to
	// pass null? Or wrap this in a call? We can get out-of-order responses
	// with this mechanism. Need something different.
	server.onNext(['$none', widgets.fetch(settings, samples)
			.map(data => ['widget-data', data, id])]);
}

function sortFeatures(features) {
	return _.map(features, (label, name) => ({value: name, label: label}))
		.sort((a, b) => util.caseInsensitiveSort(a.label, b.label));
}

function featureQuery(dsID) {
	return xenaQuery.dsID_fn(xenaQuery.feature_list)(dsID)
		.map(list => ['columnEdit-features', sortFeatures(list)]);
}
function fetchFeatures(state, dsID) {
	let {comms: {server}} = state;
	server.onNext(['columnEdit-features', featureQuery(dsID)]);
}

function exampleQuery(dsID) {
	return xenaQuery.dsID_fn(xenaQuery.dataset_field_examples)(dsID)
		.map(list => ['columnEdit-examples', _.pluck(list, 'name')]);
}

function fetchExamples(state, dsID) {
	let {comms: {server}} = state;
	server.onNext(['columnEdit-examples', exampleQuery(dsID)]);
}

var datasetVar = (samples, {dsID, name}) =>
	datasetProbeValues(dsID, samples, [name]).map(_.first);

// data: [[val, ...], [val, ...], [val, ...]]
// data must be in order (event, tte, patient)
// returns { event: { sampleId: val, ... }, tte: ... }
var indexSurvivalData = (samples, missing, data) =>
	_.object(missing,
			_.map(data, v => _.object(samples, _.map(v, xenaQuery.nanstr))));


// XXX carry dsID/name through to km-survival-data, so we can verify we're holding
// the correct data before drawing.
function fetchSurvival(state) {
	let {comms: {server}, features, samples, km, survival} = state,
		vars = kmModel.pickSurvivalVars(features, km.user),
		missing = ['ev', 'tte', 'patient'].filter(
				key => !_.isEqual(vars[key], _.getIn(survival, [key, 'field']))),
		queries = missing.map(key => datasetVar(samples, vars[key])),
		addField = fields => _.mapObject(fields, (data, key) => ({field: vars[key], data}));

	// This could be optimized by grouping by server. This would be easier
	// if we used proper hash-trie immutable data, where we could hash on dsID
	// instead of building a json encoding of dsID to allow hashing.
	server.onNext(['survival', Rx.Observable.zipArray(...queries)
			.map(data =>
					['km-survival-data',
						addField(indexSurvivalData(samples, missing, data))])
			]);
}

var controls = {
	'init-post!': (previous, current) => {
		let {comms: {server}, servers: {user}} = current;
		fetchCohorts(server, user);
	},
	cohort: (state, cohort) => _.assoc(state,
									   "cohort", cohort,
									   "samplesFrom", null,
									   "samples", [],
									   "columns", {},
									   "columnOrder", [],
									   "data", {},
									   "km", null),
	'cohort-post!': (previous, current) => {
		let {comms: {server}, servers: {user}} = current,
			cohort = _.get(current, "cohort"),
			samplesFrom = _.get(current, "samplesFrom");
		fetchDatasets(server, user, cohort);
		fetchSamples(server, user, cohort, samplesFrom);
	},
	samplesFrom: (state, dataset) => _.assoc(state, "samplesFrom", dataset),
	'samplesFrom-post!': (previous, current) => {
		let {comms: {server}, servers: {user}} = current,
			cohort = _.get(current, "cohort"),
			samplesFrom = _.get(current, "samplesFrom");
		fetchSamples(server, user, cohort, samplesFrom);
	},
	'add-column': (state, id, settings) => {
		var ns = _.updateIn(state, ["columns"], s => _.assoc(s, id, settings));
		return _.updateIn(ns, ["columnOrder"], co => _.conj(co, id));
	},
	'add-column-post!': (previous, current, id) =>
		fetchColumnData(current, id),
	resize: (state, id, {width, height}) =>
		_.assocInAll(state,
				['zoom', 'height'], height,
				['columns', id, 'width'], width),
	remove: (state, id) => {
		let ns = _.updateIn(state, ["columns"], c => _.dissoc(c, id));
		ns = _.updateIn(ns, ["columnOrder"], co => _.without(co, id));
		return _.updateIn(ns, ["data"], d => _.dissoc(d, id));
	},
	order: (state, order) => _.assoc(state, "columnOrder", order),
	zoom: (state, zoom) => _.assoc(state, "zoom", zoom),
	dataType: (state, id, dataType) =>
		_.assocIn(state, ['columns', id, 'dataType'], dataType),
	'dataType-post!': (previous, current, id) => fetchColumnData(current, id),
	vizSettings: (state, dsID, settings) =>
		_.assocIn(state, ['vizSettings', dsID], settings),
	'edit-dataset-post!': (previous, current, dsID, meta) => {
		if (meta.type === 'clinicalMatrix') {
			fetchFeatures(current, dsID);
		} else if (meta.type !== 'mutationVector') {
			fetchExamples(current, dsID);
		}
	},
	'columnLabel': (state, dsID, value) =>
		_.assocIn(state, ['columns', dsID, 'columnLabel', 'user'], value),
	'fieldLabel': (state, dsID, value) =>
		_.assocIn(state, ['columns', dsID, 'fieldLabel', 'user'], value),
	'km-open': (state, id) => _.assocInAll(state,
			['km', 'id'], id,
			['km', 'label'], _.getIn(state, ['columns', id, 'fieldLabel', 'user'])),
	'km-open-post!': (previous, current) => fetchSurvival(current),
	'km-close': (state) => _.assocIn(state, ['km', 'id'], null)
};

module.exports = {
	event: (state, [tag, ...args]) => (controls[tag] || identity)(state, ...args),
	postEvent: (previous, current, [tag, ...args]) => (controls[tag + '-post!'] || identity)(previous, current, ...args)
};