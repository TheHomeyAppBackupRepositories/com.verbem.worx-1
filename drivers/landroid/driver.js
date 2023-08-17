/* eslint-disable linebreak-style */
/* eslint-disable indent */
/* eslint-disable no-tabs */
/* eslint-disable max-len */

'use strict';

const Homey = require('homey');
const WorxDriver = require('../WorxDriver');

class LandroidDriver extends WorxDriver {

	async onInit() {
		this.server = 'worx';
		super.onInit();
	}

}

module.exports = LandroidDriver;
