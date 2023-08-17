/* eslint-disable linebreak-style */
/* eslint-disable indent */
/* eslint-disable no-tabs */
/* eslint-disable max-len */

'use strict';

const Homey = require('homey');
const WorxDriver = require('../WorxDriver');

class LandxcapeDriver extends WorxDriver {

	async onInit() {
		this.server = 'landxcape';
		super.onInit();
	}

}

module.exports = LandxcapeDriver;
