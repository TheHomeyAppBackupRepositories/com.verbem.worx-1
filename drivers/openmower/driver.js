'use strict';

const { Driver } = require('homey');

class OpenmowerDriver extends Driver {

	async onInit() {
		this.log('OpenmowerDriver has been initialized');
		this.server = 'openmower';
		this.discoverDevices();
	}

	async onPairListDevices() {
		return this.foundDevices;
	}

	async discoverDevices() {
		this.foundDevices = [];

		const discoveryStrategyOpenmower = this.homey.discovery.getStrategy('openmower');
		const initialResultsOpenmower = discoveryStrategyOpenmower.getDiscoveryResults();

		discoveryStrategyOpenmower.on('result', discoveryResult => {
			this.log('Discovery result(ON) Openmower', JSON.stringify(discoveryResult, ' ', 4));       
			const db = {};
			db.data = {};
			db.settings = {};
			db.data.id = discoveryResult.id;
			db.settings.host = discoveryResult.address;
			db.settings.host = '192.168.107.88';
			db.name = discoveryResult.name;
			db.discoveryResult = discoveryResult;
			this.foundDevices = this.foundDevices.concat(db);
		});
	}

	async goWithTheFlow() {
		
	}

}

module.exports = OpenmowerDriver;
