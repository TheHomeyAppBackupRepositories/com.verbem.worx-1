/* eslint-disable linebreak-style */
/* eslint-disable indent */
/* eslint-disable no-tabs */
/* eslint-disable max-len */

'use strict';

module.exports = {
	async getLogs({ homey, query }) {
		// get logs
		return homey.app.getLogs();
	},
	
	async clearLogs({ homey }) {
		// clear logs
		return homey.app.clearLogs();
	},
};
