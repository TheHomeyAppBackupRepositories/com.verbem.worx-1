/* eslint-disable linebreak-style */
/* eslint-disable indent */
/* eslint-disable no-tabs */
/* eslint-disable max-len */

'use strict';

const Homey = require('homey');
const WorxDriver = require('../WorxDriver');

class KressDriver extends WorxDriver {

	async onInit() {
		this.server = 'kress';
		super.onInit();
	}

}

module.exports = KressDriver;
